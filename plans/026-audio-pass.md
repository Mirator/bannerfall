# Plan 026: The first real audio pass

## Status

- **Priority**: P1 (presentation; the game shipped with placeholder audio and no music)
- **Effort**: M
- **Risk**: MEDIUM — audio is the classic way a Playwright suite starts failing on
  console errors it never used to see (autoplay violations, 404s, unhandled rejections)
- **Depends on**: Plans 001-025 (DONE)
- **Category**: presentation / assets
- **Status**: DONE

## Why this mattered

`Sfx` synthesised every sound inline from oscillators and filtered noise: a square-wave
"coin", a sawtooth "horn", a noise burst per sword hit, and four `setTimeout` beeps for
victory. There was no music at all. It read as a prototype, because it was one.

## What was built

**`assets/audio/`** — 22 files, 3.6 MB total. Provenance and licences are recorded per
file in `assets/audio/SOURCES.md`; everything is CC0 or public domain and **nothing
requires attribution**. Twelve one-shots are converted from Kenney's CC0 Impact Sounds /
RPG Audio / UI Audio packs; the two music beds are RandomMind's CC0 "Medieval:
Exploration" and "Medieval: Battle" from OpenGameArt. The remaining eight — three war
horns, the bow release, two hoof falls, the victory fanfare and the defeat stinger — are
synthesised, because no CC0 pack surveyed had a war horn or a bowstring that fitted.

**`scripts/build-audio.py`** — the whole asset pipeline, checked in: decode, silence-trim,
peak-normalise, re-encode, plus the synthesis for the eight generated clips. Needs python,
numpy and ffmpeg, and runs **only** when the assets are rebuilt. It is not a build step and
adds no runtime dependency; the repository ships the rendered `.ogg` files.

Every SFX file is peak-normalised to the same −3 dBFS on purpose. The mix balance between
events therefore lives entirely in the `SFX` gain table in `src/audio.js`, where it is
readable and tunable, instead of being baked invisibly into 20 files.

**`src/audio.js`** — the `Sfx` class moved here out of `engine.js` and became
sample-backed. `audio.js` imports `engine.js` for its RNG helpers; `engine.js` must never
import back, or the no-bundler module graph gains a cycle.

Every public method name is unchanged (`hit()`, `swing()`, `horn(196)`, …), so **no
gameplay code was touched**: `src/battle/`, `src/world/` and their call sites are byte
identical apart from the release token. Two names are new — `uiMove()` and `uiSelect()`,
wired into the menu, which previously navigated in silence.

`horn(freq)` still takes a pitch, because the call sites mean it: 98 Hz is the stronghold
answering, 294 Hz is picking a squad. Three horn samples an octave apart back it; the
nearest is chosen and fine-tuned by playback rate, clamped to 0.7×–1.45× so the formant
shift never stops sounding like the same instrument.

Repeated one-shots draw a random sample from a small variant set and a random playback
rate from a per-event window, both from the module's own `AUDIO_FX` stream — the same RNG
domain the removed noise generator used. Audio is presentation and must never touch
`simRng`.

**Buses.** `master → destination`, with `music` and `sfx` gain nodes feeding master.
Defaults 0.85 / 0.32 / 0.75. `setMusicVolume` / `setSfxVolume` clamp to 0..1. Mute is
still the master gain and is still the only audio setting the save repository persists.

**`src/main.js`** — `setSceneMusic()` is the single scene-to-bed mapping. Menu and world
share the campaign bed deliberately: the menu vista *is* the campaign's establishing shot,
and cutting between two different pieces every time CONTINUE is pressed reads as a bug.
Battle takes the battle bed. The victory summary drops the bed entirely, because its
fanfare is the music for that screen. Switches are a 1.2 s crossfade in both directions.

## The two decisions that are not obvious

**Music streams; it is not decoded.** The campaign bed is 233 seconds long, and
`decodeAudioData` on it yields an AudioBuffer of roughly 330 MB of resident float PCM —
an order of magnitude more memory than everything else the game holds. Music therefore
goes through an `HTMLAudioElement` and a `MediaElementAudioSourceNode` onto the same music
bus, so mute, crossfade and the volume control all still apply while the file streams. The
one-shots stay as decoded buffers: they total about ten seconds of audio, and a one-shot
that has to wait on the network has already missed its frame.

**Nothing sounds before a gesture, and nothing 404s.** Both would surface as
`console.error`, and `collectRuntimeErrors` fails any spec that sees one — which would
have been most of the suite at once. An AudioContext is created lazily on the first sound
request, `resume()` is attempted at most once at a time and always with a rejection
handler, and `applyTrack()` refuses to start a bed unless the context is actually
`running`, re-running when the resume lands. A single pointerdown/keydown handler
(`attachUnlock`, wired to `window` from `bootstrap()`) provides the gesture.

## Coverage

`tests/e2e/audio.spec.js`, six tests. A headless browser cannot judge whether a sword hit
sounds right, so the suite asserts what is checkable: booting constructs no audio at all;
a suspended context starts no bed and catches up on resume; every file the manifest names
returns 200; the entire SFX set decodes and every named event — including all eleven horn
pitches the game actually passes — finds a clip and starts a voice; scene changes move the
bed and mute reaches the master gain; the two buses are independently controllable and
clamped.

Note for anyone reading a failure there: Playwright launches Chromium with the autoplay
policy relaxed, so a context reaches `running` immediately and the suspended state a real
browser starts in never occurs by accident. The gate that matters in the field is driven
explicitly, by suspending the context and asserting nothing starts.

## Deliberately left out

- **Persisted music/SFX volume.** The gain nodes and their setters exist; nothing writes
  them to `settings`. Doing so is a `SaveRepository` settings-shape change with its own
  fixtures, and a settings-menu slider, which is its own slice.
- **Adaptive battle intensity.** One battle bed plays at one level regardless of how the
  fight is going. Layered stems keyed to remaining enemies would be the obvious next step.
- **Positional audio.** Every one-shot is mono into the master bus, with no pan or
  distance attenuation from the event's world position.
- **Distinct beds for menu, world and victory.** Three pieces would be better than the two
  shipped here; the menu/campaign sharing is a deliberate choice, victory's silence is a
  compromise.
- **A seamless music loop.** Neither source track is authored gapless. Trailing and
  leading silence is trimmed, so the seam is the composer's fade-out meeting the fade-in —
  a breath between repeats rather than a click, but not a true loop.

## Listening checklist (needs ears)

1. **Menu.** Load the page and click once. The campaign bed should fade in over ~1.2 s,
   not snap. Arrow up/down the menu: a soft tick per move, a firmer click on ENTER, and a
   horn layered under the click when a campaign actually starts.
2. **Campaign map.** Ride. Hoof falls should be a texture under the music, not a
   metronome — if they read as a repeated identical click, the rate/variant jitter is too
   narrow. Stop: the hoof falls stop with the world, the music does not.
3. **Town.** Recruit or heal: the coin purse should sit above the music without spiking.
4. **Battle entry.** The bed should crossfade, not cut, and the campaign bed must be gone
   by the time the fight starts.
5. **Melee.** Swing, hit, kill in quick succession. Listen for machine-gunning: twenty
   identical hits in ten seconds means the three hit variants are not being spread.
   Check the mix — hits should not drown the music, and `brute` should be the heaviest
   single sound in the game.
6. **Orders.** Press 1/2/3 and TAB. Each horn pitch should read as the same instrument at
   a different note; if a pitch sounds like a different, thinner instrument, its playback
   rate is being clamped and it needs its own sample.
7. **Endings.** Win a fight (victory fanfare), lose one (defeat stinger), and reach the
   campaign summary — the bed should be gone there and the fanfare should carry the screen
   alone.
8. **Mute.** M during play kills everything instantly and unmuting brings it back.
