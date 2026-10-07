# Honey Retrieval sound effects

Sixteen short sound effects (mono MP3, 44.1 kHz, 64 kbit/s, about 225 KiB together) and two background loops (stereo MP3, 64 kbit/s, 70 and 80 seconds, loaded only when played) for the garden game. They are loaded locally by `src/games/hive/features/audio/engine.js`; the game makes no external audio requests.

## Source

The raw clips were generated once, offline, with text-to-audio models through the Runware API, then trimmed, looped, mixed with locally synthesized tones where noted, and leveled locally by [`tools/generate-hive-sounds.mjs`](../../../../tools/generate-hive-sounds.mjs). The tool lists every prompt and the chosen seed.

| File | Model | Use |
| --- | --- | --- |
| `buzz.mp3` | synthesized tone + Mirelo SFX 1.5 texture | Seamless, clean honeybee buzz loop (wingbeat tone around 228 Hz, with about 10 % of the generated clip as texture), one per bee, positioned and pitched per bee |
| `bumble.mp3` | synthesized tone + Mirelo SFX 1.5 texture | Deep bumblebee drone loop (around 118 Hz) |
| `garden.mp3` | Mirelo SFX 1.5 | Quiet meadow ambience loop |
| `pass.mp3` | derived from `buzz` | *Bsss* fly-by (Doppler glide and swell computed locally) |
| `bump.mp3`, `thud.mp3`, `crash.mp3` | Mirelo SFX 1.5 | Bee-to-bee bump, bonk against objects, bumblebee impact |
| `collect.mp3`, `deliver.mp3`, `boost.mp3` | Mirelo SFX 1.5 | Nectar pickup, hive delivery, boost whoosh |
| `alarm.mp3` | synthesized | Soft two-note “uh-oh” chime over the swelling bumblebee drone (warning) |
| `dizzy.mp3`, `slurp.mp3` | Mirelo SFX 1.5 | Dizzy stars, the bumblebee drinking honey |
| `music-meadow.mp3` | Mirelo SFX 1.5 layers, mixed locally | Default background, nature only: a soft, low-passed breeze-in-the-grass bed (no insects) chained from four clips, a brook that drifts in and out, and four short bird phrases panned left and right; a seamless 80-second loop |
| `music-synthwave.mp3` | MiniMax Music 2.6 (instrumental) | Optional mellow synthwave, cut to a seamless 70-second loop |
| `grumble-1.mp3` … `grumble-3.mp3` | Seed Audio 1.0 | Comic gibberish complaints (no real words), pitched up to bee size; pitched down for the bumblebee |

No recordings, samples, sound packs, existing music, or real speech are included.

## Rights

The files were generated for this repository by its contributor, who dedicates them to the public domain under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/), like the repository's other media. They can be used on livestreams.

## Regenerating

Generation needs a Runware account. The key is read only from the environment and never stored:

```sh
RUNWARE_API_KEY=... node tools/generate-hive-sounds.mjs   # fetch missing raw clips, then encode
node tools/generate-hive-sounds.mjs --encode-only         # re-encode from the local cache
```

Raw WAV downloads stay in the git-ignored `.cache/hive-sounds/`. Keep each effect under 80 KiB (all effects under 400 KiB) and each music loop under 700 KiB (checked by `test/hive/audio.test.js`). Do not add large files or Git LFS.
