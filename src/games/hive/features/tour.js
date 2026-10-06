// Landing-screen tour: camera shots of the live garden with short captions explaining the game.
// It ends on "Let's go!" and loops while nobody has started.
export const TOUR_STEPS = Object.freeze([
  { shot: 'orbit', time: 5, title: 'Welcome to the honey garden', text: 'Help the hive collect 300 nectar in 3 minutes, together with 6 AI scouts.' },
  { shot: 'chase', time: 5, title: 'Collect nectar', text: 'Fly into the glowing honey drops on the flowers. Your bag holds 8, and every 6 drops make your bee glow: its next boost is a power boost.' },
  { shot: 'bee', time: 5.5, title: 'Fly high and low', text: 'Flowers grow at three heights: SPACE climbs, C sinks. Press V to fly in bee view, like this.' },
  { shot: 'hive', time: 4.5, title: 'Deliver to the hive', text: 'Bring your nectar home through the glowing ring around the golden hive. Bigger loads score more points, but a heavy bee flies slower.' },
  { shot: 'bumble', time: 5.5, title: 'Beware the bumblebee', text: 'It crashes through the garden: dodge it! When it raids the hive, bump it off.' },
  { shot: 'finale', time: 14, title: 'Let’s go!', text: 'Press ▶ to start.', finale: true },
].map(Object.freeze));

export function createTour(steps = TOUR_STEPS, { fade = 0.45 } = {}) {
  let index = 0, time = 0;
  return {
    get step() { return steps[index]; },
    get index() { return index; },
    get time() { return time; },
    get count() { return steps.length; },
    // Advances the tour; `cover` (0–1) darkens the view at each cut for a short cross-fade.
    update(dt) {
      time += dt;
      let changed = false;
      while (time >= steps[index].time) { time -= steps[index].time; index = (index + 1) % steps.length; changed = true; }
      const left = steps[index].time - time;
      return { changed, cover: Math.min(1, Math.max(0, 1 - time / fade, 1 - left / fade)) };
    },
    reset() { index = 0; time = 0; },
  };
}
