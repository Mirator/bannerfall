# Audio provenance

Every file in this folder is CC0 / public domain and requires **no attribution**. Nothing
here is CC-BY, NC, SA, or a "free tier" that becomes conditional on credit. This file is
the record that makes that checkable before a Steam release; keep it accurate when adding
or replacing a clip.

Two origins:

* **converted** — a CC0 upstream file, decoded to 44.1 kHz, silence-trimmed,
  peak-normalised and re-encoded to Vorbis by `scripts/build-audio.py`. The upstream packs
  are deliberately **not** vendored in this repository; the commands to reproduce a file
  are below.
* **synthesised** — rendered from scratch by `scripts/build-audio.py`. No CC0 pack had a
  war horn, a bowstring release or a hoof fall that fit the game, so those are original
  work, placed in the public domain along with the rest of the repository's assets.

All SFX are peak-normalised to −3 dBFS and all mix balance lives in the gain table in
`src/audio.js`. Music is peak-normalised to −1 dBFS.

## Upstream sources

| Pack / upload | Author | License | URL |
| --- | --- | --- | --- |
| Impact Sounds (1.0) | Kenney (Kenney Vleugels) | CC0 1.0 | https://kenney.nl/assets/impact-sounds |
| RPG Audio | Kenney (Kenney Vleugels) | CC0 1.0 | https://kenney.nl/assets/rpg-audio |
| UI Audio | Kenney (Kenney Vleugels) | CC0 1.0 | https://kenney.nl/assets/ui-audio |
| Medieval: Exploration | RandomMind | CC0 1.0 | https://opengameart.org/content/medieval-exploration |
| Medieval: Battle | RandomMind | CC0 1.0 | https://opengameart.org/content/medieval-battle |

Each Kenney pack ships a `License.txt` naming Creative Commons Zero and stating that
credit "would be nice but is not mandatory". Both OpenGameArt uploads list `CC0` as their
only license with no copyright/attribution notice attached.

## Shipped files

| File | Origin | Upstream file | License |
| --- | --- | --- | --- |
| `swing.ogg` | converted | RPG Audio `Audio/knifeSlice2.ogg` | CC0 1.0 |
| `hit-1.ogg` | converted | Impact Sounds `Audio/impactPlate_medium_000.ogg` | CC0 1.0 |
| `hit-2.ogg` | converted | Impact Sounds `Audio/impactPlate_medium_002.ogg` | CC0 1.0 |
| `hit-3.ogg` | converted | Impact Sounds `Audio/impactMetal_light_001.ogg` | CC0 1.0 |
| `kill-1.ogg` | converted | Impact Sounds `Audio/impactSoft_heavy_000.ogg` | CC0 1.0 |
| `kill-2.ogg` | converted | Impact Sounds `Audio/impactSoft_heavy_003.ogg` | CC0 1.0 |
| `hurt.ogg` | converted | Impact Sounds `Audio/impactPunch_heavy_001.ogg` | CC0 1.0 |
| `brute.ogg` | converted | Impact Sounds `Audio/impactWood_heavy_002.ogg` | CC0 1.0 |
| `dash.ogg` | converted | RPG Audio `Audio/cloth3.ogg` | CC0 1.0 |
| `coin.ogg` | converted | RPG Audio `Audio/handleCoins.ogg` | CC0 1.0 |
| `ui-move.ogg` | converted | UI Audio `Audio/rollover2.ogg` | CC0 1.0 |
| `ui-select.ogg` | converted | UI Audio `Audio/switch2.ogg` | CC0 1.0 |
| `music-campaign.ogg` | converted | Medieval: Exploration `Exploration.wav` | CC0 1.0 |
| `music-battle.ogg` | converted | Medieval: Battle `battle_1.wav` | CC0 1.0 |
| `horn-low.ogg` | synthesised | — (G2, 98.00 Hz) | CC0 / public domain |
| `horn-mid.ogg` | synthesised | — (F3, 174.61 Hz) | CC0 / public domain |
| `horn-high.ogg` | synthesised | — (C4, 261.63 Hz) | CC0 / public domain |
| `bow.ogg` | synthesised | — | CC0 / public domain |
| `gallop-1.ogg` | synthesised | — | CC0 / public domain |
| `gallop-2.ogg` | synthesised | — | CC0 / public domain |
| `victory.ogg` | synthesised | — | CC0 / public domain |
| `defeat.ogg` | synthesised | — | CC0 / public domain |

## Reproducing the set

```sh
# 1. Download the three Kenney packs from the URLs above and extract them.
#    Download Exploration.wav and battle_1.wav from the two OpenGameArt pages.
# 2. Put every needed source file, under its ORIGINAL name, in one folder.
# 3. Render everything (needs python 3, numpy and ffmpeg; none of these are runtime
#    dependencies of the game, and nothing runs at build or play time):
python scripts/build-audio.py --sources /path/to/that/folder

# Re-render only the synthesised clips after a tuning change:
python scripts/build-audio.py --synth-only
```

`scripts/build-audio.py` names the exact upstream file for every converted clip in its
`CONVERSIONS` table, so the mapping above is generated from the same source of truth.
