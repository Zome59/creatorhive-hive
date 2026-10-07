# The Hive

Honey Retrieval is a local, single-player 3D bee game for CreatorHive's livestream. Fly through a large floating hexagonal garden with natural grass, earth, and stone, trees to weave around, flowers at three heights, and honey-colored AI scouts, collect glossy honey drops from the flowers, and return them to the golden straw hive. Six AI scouts contribute to a shared goal of 300 nectar in three minutes. Around the middle of each round a clumsy bumblebee crashes the party. Rounds restart automatically.

## Run locally

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Click **▶** (or press **Enter**) to begin. The landing screen plays a short guided tour of the live garden: camera shots, including a moment in bee view, with captions explaining how to play. It ends on **“Let’s go!”** with a pulsing play button and then loops. The garden is audible quietly from your first click or key press (browsers need a gesture before playing sound) and fades up to full volume when the round starts. **ⓘ Full guide** in the caption, or **?** in the HUD during play (which pauses), opens the complete game guide.

The interface uses a minimal dark terminal theme: gameplay fills the page, the objective and timer sit inside the game, and a compact controls strip stays beneath it. Use the **Honey Retrieval** and **Worker Bee Sim** buttons to switch games; the inactive mode stops updating and its UI is removed from the page until you return.

## Settings

The centered navigation switches games. The top-right global **⚙** controls fullscreen, dark/light appearance, accent colors, and compact UI. Fullscreen shows only the game area (canvas and HUD) edge to edge; **Esc** leaves it. Honey Retrieval also has a **⛶** button and the **F** key. The default is black and yellow; preferences last for the current page session.

Worker Bee Sim has its own **⚙** inside the office HUD for first-person FoV (55–105°) and walking view bobbing (0–300%; default 100%; 0 disables camera and item motion). Reduced-motion devices default to no bobbing. Its sound volume slider controls cartoon effects and office ambience (default 55%; 0 mutes). The HUD **♫** button mutes/unmutes quickly.

## Worker Bee Sim

A first-person office game with wood desks, neutral walls, coordinated blue and sage dividers, and restrained ceramic mug and tie accents, stickman bee coworkers with shaped ties, subtle procedural surface grain, honeycomb archives, pollen paperwork, and a nectar cooler. Select **Worker Bee Sim** and click **▶** to clock in. Finish four tasks in order: approve pollen reports, print honey labels, file them, and refill your nectar mug. Objectives say where to go. Active stations have a large bobbing arrow, a glowing floor ring, and a distance indicator; at the destination the objective changes to a work action. After completing a shift, click **▶** for the next shift to start again.

- **WASD / arrows**: walk; **Shift**: sprint.
- **Space**: jump, then hold to glide for up to one second on descent. Glide recharges on landing. The bee can land on furniture; room bounds and the ceiling still constrain movement.
- **Mouse**: look around. Clicking Clock in captures the mouse; **Esc** releases it and pauses. Dragging the game is also supported when mouse capture is unavailable.
- **Hold E** near the highlighted station for 1.5 seconds to complete its task. For pollen reports, first press **F** at the marked computer chair to sit; the seated view lines up with the monitor center.
- **F** near an unoccupied computer chair: sit / stand. You can look around, throw mugs, and do computer work while seated; walking resumes after standing up. Hands and the hexagonal nectar mug bob and sway with walking and mouse movement.
- **Left click**: throw your nectar mug. A replacement appears after 0.2 seconds. Thrown mugs follow gravity, bounce off floors/walls/desktops, and disappear after four seconds.
- **P** or the pause button: pause/resume. Resume captures the mouse again.
- Touch devices: drag the game to look, use the direction buttons to walk, hold **Work** at a station, and use **Sit / Stand** and **Throw**.

Furniture and walls block movement. Switching modes releases the mouse, and returning to an active office shift shows a Resume button. Both games remain entirely local, without saved progress or multiplayer.

### Coworkers

Five stickman bee coworkers alternate between typing at their computers, standing up, walking around desks, nectar breaks, and idle conversation. Their joints animate for walking, sitting, typing, sipping, and gestures. Nearby thrown-mug impacts make them react briefly before returning to their routine. Land 2–3 direct mug hits within four seconds and a coworker randomly crumples, tumbles like a ragdoll, or bursts into honey-colored particles; they respawn at a random clear office location after 2.6 seconds. Each mug can hit a given coworker only once. They route around furniture, avoid the player, and reserve chairs while seated; returning workers wait if you took their chair. The pollen-report chair is always available for the player. NPC-to-NPC collisions are disabled. NPC activity pauses with the office.

### Cartoon sounds

Worker Bee Sim synthesizes **30 original cartoon effect families**, each with **three base variations** and randomized pitch/timing: footsteps, spring jumps, wing flutter, landing thuds, mug throws/refills and surface clinks, rubbery coworker hits, crumple/ragdoll/burst knockdowns, respawn pops, chair squeaks, report typing, printer noises, archive rustles, nectar bubbles, task jingles, bee chatter, sipping, and occasional buzzes.

Sound starts after clicking **▶**. The office **⚙** has a working volume slider; **♫** toggles mute. Nearby coworkers and impacts sound louder and pan with your view. Effects stop on pause, hidden tabs, or switching games. Monitor videos remain silent. The original synthesis recipes and resulting sounds are CC0-dedicated; no samples, recordings, third-party sound packs, audio downloads, or large files are used. See [audio source and rights](src/games/worker-bee/features/audio/README.md).

### Monitor videos

Office monitors play randomized, original bee animation clips. They are CC0-dedicated procedural artwork generated in this repo, **silent**, **256×144**, **8 fps**, and **six seconds** each. All six together are about **131 KiB**. Six screens use different clips and randomized starting timestamps, reuse six tiny video decoders, and pause their videos when the office is paused, hidden, or inactive.

**Keep video assets small: at most 256 KiB per clip and 768 KiB total. Do not add big files or Git LFS.** Source, rights, and regeneration instructions are in [public/media/README.md](public/media/README.md). `npm run check:media` uses FFprobe to verify sizes, codecs, and the absence of audio tracks. Ordinary `npm test` needs only Node.js.

### Launch from VS Code

After `npm ci`, open this repository in VS Code and press **F5** (or choose **The Hive: Play locally** in Run and Debug). The included `.vscode/launch.json` starts Vite on loopback and opens the game in your default browser. Press **Shift+F5** to stop it. If port 5173 is occupied, Vite chooses the next available port and opens that address automatically.

```sh
npm test
npm run build
npm start
```

`npm start` previews the production build at **http://127.0.0.1:4173**. Both servers bind to loopback by default. Nothing is deployed or published by these commands.

## Cloudflare hosting

The checked-in `wrangler.jsonc` serves the production `dist/` directory through Cloudflare Workers static assets. Wrangler is pinned in the development dependencies. No Worker script or Cloudflare Vite plugin is needed.

For the Cloudflare Workers Git build, use these settings:

| Setting | Value |
| --- | --- |
| Root directory | Repository root |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Worker name | `creatorhive-hive` |

Keep the Worker name in the dashboard and config aligned. The explicit config prevents Wrangler from trying to automatically rewrite the Vite configuration during deployment. See [Cloudflare static assets documentation](https://developers.cloudflare.com/workers/static-assets/).

To validate deployment packaging locally without publishing or logging in:

```sh
npm run build
npm run check:deploy
```

Publishing is performed by Cloudflare's connected build after you push a commit. Local development and validation commands do not publish anything.

## Play

| Control | Action |
| --- | --- |
| WASD or arrow keys | Fly relative to the camera (garden view) |
| Space / C | Climb / sink (between the grass and the treetops); the same keys whether you steer with WASD or the arrow keys |
| Shift | 2.5-second boost; recharges in 3.5 seconds, faster with every nectar you collect. When your bee glows, it is a **power boost** |
| V or 👁 button | Toggle **bee view** (first person) |
| Left click + drag | Rotate the garden view; in bee view, look around |
| Scroll wheel | Zoom in / out (garden view) |
| F or ⛶ button | Fullscreen game area |
| P or pause button | Pause / resume |

A large **controls panel**, by default hanging half over the left edge of the game, lists every key, with the altitude keys highlighted; keys light up while you hold them. Drag it by its header anywhere, even beside the game. **H** or the 🎮 button shows and hides it. In fullscreen it starts hidden (H brings it back), and a menu bar at the top shows the main shortcuts with buttons for controls, view, sound, pause, and leaving fullscreen.

**Bee view** puts the camera on your bee's head, with its antennae and wing tips at the edge of the view. Click the garden to steer with the mouse (pointer lock; **Esc** releases it) or drag to look. **W** flies where you look, so looking down and pressing W dives; **A/D** strafe, **←/→** turn, Space/C still climb and sink. Boost widens the view.

Touch devices show directional, climb/sink, and boost buttons; drag the garden to rotate the view (or to look in bee view). Nectar collects automatically when you fly close to a honey drop; drops grow on low meadow flowers, mid-height flowers, and tall sunflowers, so altitude matters. Your bag holds eight drops. Fly into the center hive's glowing ring to deliver. Scouts are AI, visibly labeled throughout the interface. Leaving the window pauses active play.

### Honey in the hive

A ring of 30 honeycomb cells around the hive base shows the hive's honey, one cell per 10 nectar. Delivered nectar flies into the next cells as droplets; cells you filled are **orange**, the scouts' are **gold**, and the HUD bar shows your share in orange too. When the bumblebee drinks, the newest cells empty first.

### Load, points, and highscore

The bees have soft **shell fur** (the surface drawn again in a few thin, outward layers with strands cut by a shader, as in real-time fur demos); the bumblebee gets 32 layers up close and in its cutscene, and fewer layers with distance. Collected nectar shows as golden pollen baskets on your bee's hind legs, growing with every drop (scouts carry theirs too). From half a bag on the load weighs you down, gently at first and more with every drop: about 6 % slower at 4 of 8, 27 % slower with a full bag. A short hint appears when you reach half a bag, and the HUD shows the current slowdown. Delivering to the hive makes you fast again and scores **10 points per nectar**, with a **×1.5 bonus for 6–7 drops and ×2 for a full bag**, so you choose between quick trips and big, slow, risky ones. The HUD shows your score and the best round of this page session; the round result lists your best rounds and celebrates a new highscore. Like everything else in the game, scores are not stored and are gone after a page refresh.

### Nectar power

Every six nectar you collect charge your bee: it **glows** with a golden outline and rings that fade outward, the HUD shows **⚡ POWER READY**, and a short reminder appears now and then. Your next boost is a **power boost**: bumped bees fly much farther and see stars, and **trees and flowers you fly into fall over** and stand back up a couple of seconds later. Power-boosting into the crossing bumblebee **shoves it away** for 2 nectar from your bag per shove (the HUD counts the shoves you can afford; after two shoves it gives up and leaves). Against the honey thief on the hive a power bump counts double. The glow is used up when the boost ends.

### Bumps, bubbles, and the bumblebee

Bees, trees, flowers, and the hive are solid. Flying into another bee bumps both apart; flying into an object bonks you back. Each bump shows a comic sound word (*BOINK!*, *THUD!*) and the bees complain in comic speech bubbles with gibberish voices: the bumped scout complains (“Too much honey for breakfast?”), the other may talk back. Your own bee stays quiet. Scouts mostly yield to each other but daydream now and then, and nobody yields at the busy hive entrance.

Around the middle of each round (half the time or half the goal, whichever comes first, slightly randomized) a big, fuzzy bumblebee arrives. A red alert (**“ALERT – BUMBLEBEE INCOMING”**) with a soft alarm and a countdown announces it four seconds ahead, and an edge marker points to where it will enter. It wobbles across the garden for about 20 seconds, lurches toward bees (often you), and knocks the bees it hits flying: they tumble with dizzy stars for a moment, spill up to two nectar, and every bee nearby shouts at it. After a few seconds they calm down and fly on. Use altitude and boost to dodge it.

Each time it arrives, a short **entrance cutscene** plays (letterbox bars, about five seconds; Enter, Esc, or a click skips it): the bumblebee flies at the camera, zooms past it, and then the camera looks over its shoulder into the garden as it drops in. The round clock stops and your bee waits safely meanwhile.

Later in the round (about three quarters of the time or of the goal, at least six seconds after its first visit) it comes back, announced the same way, usually bumbles around knocking bees over for a few seconds, then lands on top of the hive, and **drinks the hive's honey** (2.5 nectar per second). An information sign tells you what to do: the scouts swarm it and poke it, but only you can get it off. **Bump into it three times** and it tumbles off the hive and flies away while the scouts cheer. Left alone, it leaves after 28 seconds with whatever it drank.

### Sound

Sound starts with **▶** and can be muted with the **♪** button. The **🎚 Sound mixer** at the bottom of the controls panel has a master volume and sliders (0–150 %) for other bees, your bee, the bumblebee, voices, effects, garden ambience, and music, plus **↺ Reset to default**. A quiet background plays by default: **Summer meadow** (only nature: a soft breeze in the grass, a brook now and then, a few quiet birds), or **Synthwave**, or **Off**; these files load only when played. Not every speech bubble gets a gibberish voice, so the garden stays calm. Mixer settings last for the current page session. Every bee has its own positioned buzz: the listener is your bee, so other bees get louder as they come closer and pan left/right with your view. Scouts zipping past make a quick *bsss* fly-by. Distant bees fade quickly, and your own bee's buzz stays soft. Bumps, bonks, nectar pickups, deliveries, boosts, the bumblebee's deep drone, crash, and honey slurping, a soft two-note warning chime, and the bees' gibberish complaints are all positioned in the garden, over a quiet meadow ambience. Audio pauses with the game, in hidden tabs, and when switching games. Sources and rights: [public/games/hive/audio/README.md](public/games/hive/audio/README.md).

## Privacy and scope

- All game state lives in memory in the browser. Refreshing clears it.
- No accounts, custom names, chat, persistent player identifiers, cookies, browser storage, telemetry, analytics, or external game connections.
- The player's alias is generated (`Bee 007`). No personal information is requested.
- Art and fonts are procedural or local. Honey Retrieval's sound effects are small AI-generated MP3 files stored in this repository and served locally. No remote assets or runtime CDN requests.
- This repository contains no CreatorHive user data or integration with its accounts, platform, or livestream service.
- A local development/preview server necessarily handles browser connections. The game does not record connection addresses or add access logging.
- The production build can be hosted as static files. Multiplayer and livestream integrations are internally planned only.

The game uses Three.js and needs WebGL 2 / hardware acceleration. Its entry screen explains when graphics are unavailable.

## Collaboration and modules

Each game owns a folder under `src/games/`: `hive/` for the garden and `worker-bee/` for the office. The shell discovers game entries and styles automatically; adding a game does not require editing navigation or a central registry. Game-specific features stay inside their owning module, with scoped styles and independent simulation files.

See [CONTRIBUTING.md](CONTRIBUTING.md), [the module contract](docs/GAME_MODULES.md), and [agent instructions](AGENTS.md). `npm run check:modules` enforces descriptor/import/style boundaries and runs automatically during `npm run build`. Tests verify gameplay, collisions, tasks, settings, media lifecycle, and switching between actual game modules.
