# Honey Retrieval sound effects

Twenty-three short sound effects and loops (mono MP3, 44.1 kHz, 64 kbit/s, about 330 KiB together) and two background loops (stereo MP3, 96 and 128 kbit/s, 70 and 80 seconds, about 0.8 and 1.2 MiB, loaded only when played) for the garden game. They are loaded locally by `src/games/hive/features/audio/engine.js`; the game makes no external audio requests.

## Source

The raw clips were generated once, offline, with text-to-audio models through the Runware API, then trimmed, looped, mixed with locally synthesized tones where noted, and leveled locally by [`tools/generate-hive-sounds.mjs`](../../../../tools/generate-hive-sounds.mjs). The tool lists every prompt and the chosen seed.

| File | Model | Use |
| --- | --- | --- |
| `buzz.mp3` | synthesized tone + Mirelo SFX 1.5 texture | Seamless, clean honeybee buzz loop (wingbeat tone around 228 Hz, with about 10 % of the generated clip as texture), one per bee, positioned and pitched per bee |
| `bumble.mp3` | synthesized tone + Mirelo SFX 1.5 texture | Deep bumblebee drone loop (around 118 Hz) |
| `garden.mp3` | Mirelo SFX 1.5 | Quiet meadow ambience loop (steep high-pass at 220 Hz: no low rumble) |
| `pass.mp3` | derived from `buzz` | *Bsss* fly-by (Doppler glide and swell computed locally) |
| `bump.mp3`, `thud.mp3`, `crash.mp3` | Mirelo SFX 1.5 | Bee-to-bee bump, bonk against objects, bumblebee impact |
| `collect.mp3`, `deliver.mp3`, `boost.mp3` | Mirelo SFX 1.5 | Nectar pickup, hive delivery, boost whoosh |
| `alarm.mp3` | synthesized | Soft two-note “uh-oh” chime over the swelling bumblebee drone (warning) |
| `dizzy.mp3`, `slurp.mp3` | Mirelo SFX 1.5 | Dizzy stars, the bumblebee drinking honey |
| `rain.mp3`, `shake.mp3` | Mirelo SFX 1.5 | Rain from the little cloud over a soaked bee (loop), the bee shaking itself dry |
| `wasp.mp3` | synthesized tone + Mirelo SFX 1.5 texture | The boss wasp's angry, pulsing drone loop (around 172 Hz) |
| `slam.mp3`, `crunch.mp3`, `wasted.mp3` | Mirelo SFX 1.5 | Butt slam on the wasp's head, the hive smashed and honey gushing out, the dark boom when the round is wasted |
| `brook.mp3` | Mirelo SFX 1.5 (a `music-meadow` brook layer) | Positioned brook loop (high-passed at 150 Hz); played slower and louder at the rim for the waterfall |
| `music-meadow.mp3` | Mirelo SFX 1.5 layers, mixed locally | Default background, nature only: a soft, low-passed breeze-in-the-grass bed (no insects, no birds) chained from one clip played forwards and backwards, and a quiet brook that drifts in and out; a narrow cut at 5 kHz removes a faint insect tone and a gentle high cut tames the hiss (instead of a dull low-pass), high-passed at 160 Hz; a seamless 80-second loop |
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
