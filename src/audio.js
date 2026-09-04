// Bannerfall audio: a sample-backed SFX set plus two looping music beds.
//
// This replaces the oscillator blips `Sfx` used to synthesise inline. The public method
// names are unchanged on purpose — every call site in world/, battle/ and main.js still
// says `sfx.hit()` / `sfx.horn(196)` — so swapping the implementation touched no gameplay
// code. Files live in assets/audio/ and are listed with their CC0 provenance in
// assets/audio/SOURCES.md.
//
// Three rules shape everything below:
//
//  1. AUDIO IS PRESENTATION. Nothing here reads or advances `simRng`, and no simulation
//     phase may read audio state. Sample choice and pitch jitter draw from the module's
//     own AUDIO_FX stream, the same domain the old noise generator used.
//  2. NOTHING SOUNDS BEFORE A GESTURE. An AudioContext is created lazily and music is
//     never started while the context is suspended, because Chromium logs a console error
//     for an autoplay violation and the e2e harness fails any test that sees one. The
//     context is resumed from `attachUnlock()`'s pointerdown/keydown handler and from
//     ensure(); `applyTrack()` re-runs once the resume actually lands.
//  3. NO 404s. Every name in SFX/MUSIC below must exist on disk. A missing file is a
//     console error in Chromium, which is likewise a test failure — `audio.spec.js`
//     asserts the whole manifest decodes.
import { makeRng, deriveSeed, RNG_DOMAINS } from './engine.js?v=rd93aa08103be';

// Resolved against this module, not against the document: the game is also served from a
// project-Pages subpath, where a document-relative 'assets/...' would be right only by
// luck of where index.html happens to sit.
const AUDIO_DIR = new URL('../assets/audio/', import.meta.url);
const fileUrl = name => new URL(name, AUDIO_DIR).href;

// Bus levels. Deliberately not persisted in this slice — see the plan note in
// progress.md; the mute flag is the only audio setting the save repository knows about.
export const MASTER_GAIN = 0.85;
export const DEFAULT_MUSIC_GAIN = 0.32;
export const DEFAULT_SFX_GAIN = 0.75;
const MUSIC_FADE = 1.2; // seconds; a crossfade rather than a cut, in both directions

// The SFX manifest. `gain` is the per-event mix level (files are all peak-normalised to
// the same -3 dBFS by scripts/build-audio.py, so ALL relative balance is here, in code,
// where it can be read and tuned). `rate` is a random playback-rate window that keeps a
// repeated event — twenty sword hits in one melee — from machine-gunning one identical
// sample. `throttle` is the old rate limiter, in milliseconds, unchanged.
const SFX = {
  swing: { files: ['swing.ogg'], gain: 0.45, rate: [0.92, 1.12], throttle: 60 },
  hit: { files: ['hit-1.ogg', 'hit-2.ogg', 'hit-3.ogg'], gain: 0.80, rate: [0.90, 1.12], throttle: 40 },
  kill: { files: ['kill-1.ogg', 'kill-2.ogg'], gain: 0.90, rate: [0.88, 1.06], throttle: 50 },
  hurt: { files: ['hurt.ogg'], gain: 1.00, rate: [0.94, 1.06] },
  dash: { files: ['dash.ogg'], gain: 0.50, rate: [0.96, 1.10] },
  bow: { files: ['bow.ogg'], gain: 0.60, rate: [0.94, 1.10], throttle: 80 },
  brute: { files: ['brute.ogg'], gain: 1.00, rate: [0.86, 0.98] },
  coin: { files: ['coin.ogg'], gain: 0.70, rate: [0.97, 1.05] },
  gallop: { files: ['gallop-1.ogg', 'gallop-2.ogg'], gain: 0.26, rate: [0.90, 1.14], throttle: 210 },
  uiMove: { files: ['ui-move.ogg'], gain: 0.35, rate: [0.98, 1.04], throttle: 40 },
  uiSelect: { files: ['ui-select.ogg'], gain: 0.55 },
  victory: { files: ['victory.ogg'], gain: 1.00 },
  defeat: { files: ['defeat.ogg'], gain: 1.00 },
  // The three horn samples back `horn(freq)`. Call sites pass a meaningful pitch (98 Hz
  // for the stronghold's answer, 294 Hz for a squad pick), so the nearest sample is
  // chosen and fine-tuned by playback rate rather than one sample being stretched across
  // an octave and a half.
  hornLow: { files: ['horn-low.ogg'], gain: 0.85 },
  hornMid: { files: ['horn-mid.ogg'], gain: 0.85 },
  hornHigh: { files: ['horn-high.ogg'], gain: 0.85 },
};

const HORNS = [
  { key: 'hornLow', freq: 98.0 },
  { key: 'hornMid', freq: 174.61 },
  { key: 'hornHigh', freq: 261.63 },
];
// Beyond this the formant shift stops reading as the same instrument, so the nearest
// sample is preferred and the residual detune is simply dropped.
const HORN_RATE_MIN = 0.7, HORN_RATE_MAX = 1.45;

const MUSIC = {
  campaign: 'music-campaign.ogg',
  battle: 'music-battle.ogg',
};

export const AUDIO_MANIFEST = Object.freeze({
  sfx: Object.freeze(Object.fromEntries(Object.entries(SFX).map(([k, v]) => [k, Object.freeze([...v.files])]))),
  music: Object.freeze({ ...MUSIC }),
  files: Object.freeze([
    ...new Set([...Object.values(SFX).flatMap(entry => entry.files), ...Object.values(MUSIC)]),
  ]),
});

export class Sfx {
  constructor(saves = null) {
    this.saves = saves;
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.enabled = true;
    this.muted = saves?.getSettings?.().muted === true;
    this.musicVolume = DEFAULT_MUSIC_GAIN;
    this.sfxVolume = DEFAULT_SFX_GAIN;
    this.lastAt = {};
    // Presentation-only stream, same domain the removed noise generator used. Sample
    // choice and pitch jitter must never be able to touch a gameplay result.
    this.pickRng = makeRng(deriveSeed(0x534658, RNG_DOMAINS.AUDIO_FX));
    this.buffers = new Map();   // file name -> decoded AudioBuffer
    this.pending = new Map();   // file name -> in-flight load promise
    this.sfxLoading = null;
    this.sfxReady = false;
    this.resumePending = false;
    this.track = null;          // the track the game WANTS playing
    this.playing = null;        // { name, source, gain } actually sounding
    this.musicToken = 0;        // guards the await in applyTrack() against a later switch
    this.loadError = null;
    this.detachUnlock = null;
  }

  // ---------------------------------------------------------------- graph and unlocking
  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
        this.master.connect(this.ctx.destination);
        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = this.musicVolume;
        this.musicBus.connect(this.master);
        this.sfxBus = this.ctx.createGain();
        this.sfxBus.gain.value = this.sfxVolume;
        this.sfxBus.connect(this.master);
      } catch (e) {
        this.enabled = false;
        this.ctx = null;
        return null;
      }
      this.loadSfx();
    }
    if (this.ctx.state === 'suspended') {
      // Blocked by the autoplay policy this promise simply stays pending until the
      // document is interacted with, which is exactly the wanted behaviour — but one
      // pending attempt is enough, so a battle firing sfx at 25 Hz does not allocate a
      // promise per hit. It must not be left un-caught either: a rejected resume becomes
      // an unhandled rejection, which the e2e harness reports as a page error.
      if (!this.resumePending) {
        this.resumePending = true;
        this.ctx.resume().then(
          () => { this.resumePending = false; this.applyTrack(); },
          () => { this.resumePending = false; },
        );
      }
    } else {
      this.applyTrack();
    }
    return this.enabled ? this.ctx : null;
  }

  // Chromium only lets an AudioContext leave `suspended` once the document has been
  // interacted with. Wiring the first pointerdown/keydown is the whole unlock: main.js
  // calls this once at boot with `window`, so the DOM decision stays in main.js and the
  // audio behaviour stays here.
  attachUnlock(target) {
    if (this.detachUnlock || !target || typeof target.addEventListener !== 'function') return;
    // Clear resumePending first: this handler runs INSIDE the gesture, which is the one
    // moment a fresh resume() is certain to be honoured, so it must never be skipped in
    // favour of an older attempt that may still be parked.
    const unlock = () => { this.detachUnlock?.(); this.resumePending = false; this.ensure(); };
    target.addEventListener('pointerdown', unlock);
    target.addEventListener('keydown', unlock);
    this.detachUnlock = () => {
      target.removeEventListener('pointerdown', unlock);
      target.removeEventListener('keydown', unlock);
      this.detachUnlock = null;
    };
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : MASTER_GAIN;
    // Un-muting may be the first moment music is allowed to start (applyTrack refuses to
    // begin a bed while muted, so a player who boots muted never downloads one).
    if (!m) this.applyTrack();
    return this.saves?.setMuted?.(m) ?? Promise.resolve();
  }

  setMusicVolume(v) {
    this.musicVolume = Math.max(0, Math.min(1, v));
    if (this.musicBus) this.musicBus.gain.value = this.musicVolume;
  }

  setSfxVolume(v) {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    if (this.sfxBus) this.sfxBus.gain.value = this.sfxVolume;
  }

  // ---------------------------------------------------------------- loading
  async load(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    if (this.pending.has(name)) return this.pending.get(name);
    const task = (async () => {
      const response = await fetch(fileUrl(name));
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      // Safari-era callback form is not needed; every target here returns a promise.
      const buffer = await this.ctx.decodeAudioData(bytes);
      this.buffers.set(name, buffer);
      return buffer;
    })().catch(error => {
      // A warning, never console.error: a host that cannot serve one clip should lose
      // that clip, not fail the page (and not fail the harness's runtime-error check).
      this.loadError = error;
      console.warn('Bannerfall: audio clip unavailable —', error.message);
      return null;
    }).finally(() => { this.pending.delete(name); });
    this.pending.set(name, task);
    return task;
  }

  // The whole SFX set is ~150 KB, so it loads together the moment a context exists and a
  // one-shot never has to wait on the network. The two music beds are ~3.4 MB between
  // them and load only when a bed is actually about to play.
  loadSfx() {
    if (this.sfxLoading) return this.sfxLoading;
    const files = [...new Set(Object.values(SFX).flatMap(entry => entry.files))];
    this.sfxLoading = Promise.all(files.map(name => this.load(name)))
      .then(() => { this.sfxReady = true; });
    return this.sfxLoading;
  }

  // ---------------------------------------------------------------- one-shots
  throttle(name, ms) {
    const now = performance.now();
    if (this.lastAt[name] && now - this.lastAt[name] < ms) return true;
    this.lastAt[name] = now;
    return false;
  }

  play(key, { rate = 0, gain = 0 } = {}) {
    const entry = SFX[key];
    if (!entry) return false;
    if (entry.throttle && this.throttle(key, entry.throttle)) return false;
    const c = this.ensure();
    if (!c) return false;
    const file = entry.files.length === 1
      ? entry.files[0]
      : entry.files[Math.min(entry.files.length - 1, (this.pickRng() * entry.files.length) | 0)];
    const buffer = this.buffers.get(file);
    // Still loading (or unavailable): drop the one-shot rather than queueing it. A hit
    // that arrives 400 ms late is worse than a hit that never sounded.
    if (!buffer) { if (!this.buffers.has(file)) this.load(file); return false; }
    const t0 = c.currentTime;
    const source = c.createBufferSource();
    source.buffer = buffer;
    let playbackRate = rate || 1;
    if (!rate && entry.rate) {
      playbackRate = entry.rate[0] + this.pickRng() * (entry.rate[1] - entry.rate[0]);
    }
    source.playbackRate.value = playbackRate;
    const voice = c.createGain();
    voice.gain.value = (gain || entry.gain);
    source.connect(voice);
    voice.connect(this.sfxBus);
    source.start(t0);
    return true;
  }

  // ---------------------------------------------------------------- named events
  // These names are the contract with the rest of the game; do not rename one without
  // updating its call sites in src/world/, src/battle/ and src/main.js. Each returns
  // whether a voice actually started — gameplay ignores it, audio.spec.js asserts on it,
  // and that is the only way a silently missing clip gets caught.
  swing() { return this.play('swing'); }
  hit() { return this.play('hit'); }
  kill() { return this.play('kill'); }
  hurt() { return this.play('hurt'); }
  dash() { return this.play('dash'); }
  bow() { return this.play('bow'); }
  brute() { return this.play('brute'); }
  coin() { return this.play('coin'); }
  gallop() { return this.play('gallop'); }
  uiMove() { return this.play('uiMove'); }
  uiSelect() { return this.play('uiSelect'); }
  victory() { return this.play('victory'); }
  defeat() { return this.play('defeat'); }

  // Command/objective signal. `freq` carries meaning at the call sites (a low 98 Hz for
  // the stronghold answering, 294 Hz for picking a squad), so it is honoured as a pitch.
  horn(freq = 220) {
    let best = HORNS[0], bestErr = Infinity;
    for (const candidate of HORNS) {
      const err = Math.abs(Math.log(freq / candidate.freq));
      if (err < bestErr) { bestErr = err; best = candidate; }
    }
    const rate = Math.max(HORN_RATE_MIN, Math.min(HORN_RATE_MAX, freq / best.freq));
    return this.play(best.key, { rate });
  }

  // ---------------------------------------------------------------- music
  // Music does NOT go through decodeAudioData. The campaign bed is 233 seconds long, and
  // a decoded AudioBuffer for it is ~330 MB of float PCM resident for the whole session —
  // an order of magnitude more memory than the rest of the game put together. An
  // HTMLAudioElement streams it instead, and MediaElementAudioSourceNode puts it on the
  // same music bus, so mute, the crossfade and the volume control all still apply.
  //
  // `name` is a MUSIC key or null for silence. Safe to call on every scene change: an
  // unchanged track is a no-op, and a call before the context unlocks just records the
  // intent for applyTrack() to honour later.
  setTrack(name) {
    const wanted = name && MUSIC[name] ? name : null;
    if (wanted === this.track) return;
    this.track = wanted;
    this.applyTrack();
  }

  stopMusic() { this.setTrack(null); }

  applyTrack() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const wanted = this.track;
    if (this.playing && this.playing.name === wanted) return;
    this.musicToken++;
    if (this.playing) {
      const old = this.playing;
      this.playing = null;
      const t = c.currentTime;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(Math.max(0.0001, old.gain.gain.value), t);
      old.gain.gain.exponentialRampToValueAtTime(0.0001, t + MUSIC_FADE);
      // The element has to be released once it is inaudible; a WebAudio ramp cannot stop
      // a media element for us the way source.stop() stopped a buffer source.
      setTimeout(() => {
        try { old.element.pause(); old.source.disconnect(); old.gain.disconnect(); } catch (e) { /* torn down */ }
      }, (MUSIC_FADE + 0.1) * 1000);
    }
    if (!wanted) return;
    // Muted players never pay for the ~3.4 MB of music. setMuted(false) calls back here.
    if (this.muted) return;
    const element = new Audio(fileUrl(MUSIC[wanted]));
    element.loop = true;
    element.preload = 'auto';
    // No crossOrigin attribute: the beds are same-origin, and asking for a CORS fetch of
    // a same-origin file only adds a way for a strict host to refuse it.
    let source;
    try {
      source = c.createMediaElementSource(element);
    } catch (e) {
      console.warn('Bannerfall: music bed unavailable —', e.message);
      return;
    }
    const now = c.currentTime;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(1, now + MUSIC_FADE);
    source.connect(gain);
    gain.connect(this.musicBus);
    this.playing = { name: wanted, element, source, gain };
    // A warn, not an error: play() rejects if the gesture was withdrawn between the
    // resume and here, and a silent campaign is preferable to a failed page.
    element.play().catch(error => {
      if (this.playing && this.playing.element === element) this.playing = null;
      this.loadError = error;
      console.warn('Bannerfall: music bed could not start —', error.message);
    });
  }

  // Structural surface for the e2e audio spec — it cannot hear anything, so it asserts
  // the graph exists, the manifest decoded, and the right bed is selected and sounding.
  debugState() {
    return {
      enabled: this.enabled,
      contextState: this.ctx ? this.ctx.state : null,
      muted: this.muted,
      masterGain: this.master ? this.master.gain.value : null,
      musicGain: this.musicBus ? this.musicBus.gain.value : null,
      sfxGain: this.sfxBus ? this.sfxBus.gain.value : null,
      sfxReady: this.sfxReady,
      decoded: [...this.buffers.keys()].sort(),
      track: this.track,
      playing: this.playing ? this.playing.name : null,
      playingPaused: this.playing ? this.playing.element.paused : null,
      loadError: this.loadError ? this.loadError.message : null,
      // The full manifest, so the spec can prove every referenced file really exists —
      // a 404 is a console error in Chromium and therefore a harness failure.
      files: AUDIO_MANIFEST.files,
      sfxFiles: [...new Set(Object.values(SFX).flatMap(entry => entry.files))].sort(),
    };
  }
}
