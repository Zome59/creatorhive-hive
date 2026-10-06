# Honey Retrieval sound effects

Fifteen short MP3 files (mono, 44.1 kHz, 64 kbit/s, about 215 KiB together) for the garden game. They are loaded locally by `src/games/hive/features/audio/engine.js`; the game makes no external audio requests.

## Source

The raw clips were generated once, offline, with text-to-audio models through the Runware API, then trimmed, looped, and leveled locally by [`tools/generate-hive-sounds.mjs`](../../../../tools/generate-hive-sounds.mjs). The tool lists every prompt and the chosen seed.

| File | Model | Use |
| --- | --- | --- |
| `buzz.mp3` | Mirelo SFX 1.5 | Seamless honeybee buzz loop, one per bee, positioned and pitched per bee |
| `bumble.mp3` | Mirelo SFX 1.5 | Deep bumblebee drone loop |
| `garden.mp3` | Mirelo SFX 1.5 | Quiet meadow ambience loop |
| `pass.mp3` | derived from `buzz` | *Bsss* fly-by (Doppler glide and swell computed locally) |
| `bump.mp3`, `thud.mp3`, `crash.mp3` | Mirelo SFX 1.5 | Bee-to-bee bump, bonk against objects, bumblebee impact |
| `collect.mp3`, `deliver.mp3`, `boost.mp3` | Mirelo SFX 1.5 | Nectar pickup, hive delivery, boost whoosh |
| `alarm.mp3`, `dizzy.mp3` | Mirelo SFX 1.5 | Bumblebee warning, dizzy stars |
| `grumble-1.mp3` … `grumble-3.mp3` | Seed Audio 1.0 | Comic gibberish complaints (no real words), pitched up to bee size; pitched down for the bumblebee |

No recordings, samples, sound packs, music, or real speech are included.

## Rights

The files were generated for this repository by its contributor, who dedicates them to the public domain under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/), like the repository's other media. They can be used on livestreams.

## Regenerating

Generation needs a Runware account. The key is read only from the environment and never stored:

```sh
RUNWARE_API_KEY=... node tools/generate-hive-sounds.mjs   # fetch missing raw clips, then encode
node tools/generate-hive-sounds.mjs --encode-only         # re-encode from the local cache
```

Raw WAV downloads stay in the git-ignored `.cache/hive-sounds/`. Keep each file under 80 KiB and the set under 400 KiB (checked by `test/hive/audio.test.js`). Do not add large files or Git LFS.
