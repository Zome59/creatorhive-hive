# Tiny, silent bee monitor videos

These six bee animations are original procedural artwork generated for this
repository by `tools/generate-monitor-videos.py`. No stock footage, downloaded
videos, people, music, logos, or external artwork is included.

The generated MP4 artwork in this folder is dedicated to the public domain
under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
This dedication applies only to these generated video assets, not the rest of
the repository. They can be shown, modified, and redistributed, including on
livestreams.

- `pollen-flight.mp4`: bees flying over flowers.
- `waggle-dance.mp4`: bees dancing in looping paths.
- `honey-loop.mp4`: bees flying over animated honey cells.
- `flower-clock.mp4`: a bee circling a ring of flowers.
- `nectar-run.mp4`: nectar transport over a conveyor garden.
- `hive-scan.mp4`: an animated hive scan with two bees.

All clips are **256 × 144**, **8 fps**, **6 seconds**, H.264 / YUV420p, with
**no audio stream**. Each must stay below **256 KiB**, with a combined budget of
**768 KiB**. Keep them in ordinary Git; **do not add large video files or Git
LFS**. Six monitors use at most six tiny video decoders, with randomized clip
choices and independent starting timestamps. Media pauses when the game
is paused, hidden, or inactive. Videos are served locally, never embedded from
an external site.

Regenerate with Python 3 and FFmpeg (including the libx264 encoder):

```sh
python3 tools/generate-monitor-videos.py
npm run check:media
```

The generator uses only the Python standard library, pipes frames directly to
FFmpeg, and does not keep large raw frames in the repository.

The clips use scene-specific colors: blue-sky flower flights, warm amber dances and honey cells, pastel flower clocks, navy nectar runs, and cyan/slate hive scans. Bees keep honey-colored bodies and pale wings.
