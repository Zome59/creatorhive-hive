// Bumblebee entrance: three short shots, then a fade back to play. The scene places the camera
// for each shot relative to the flying bumblebee; this module only keeps time and cross-fades.
export const CINEMATIC = Object.freeze([
  Object.freeze({ shot: 'approach', time: 1.8 }), // It flies straight at the camera.
  Object.freeze({ shot: 'pass', time: 1.4 }), // It zooms past a camera beside its path.
  Object.freeze({ shot: 'reveal', time: 2.3 }), // Over its shoulder into the garden full of bees.
]);
export const CINEMATIC_LENGTH = CINEMATIC.reduce((sum, step) => sum + step.time, 0);

export function createCinematic(shots = CINEMATIC, { fade = 0.28 } = {}) {
  const total = shots.reduce((sum, step) => sum + step.time, 0);
  let time = -1;
  return {
    get active() { return time >= 0; },
    start() { time = 0; },
    stop() { time = -1; },
    // Returns the current shot, its local time, and how dark the cut cover is (0–1); null when done.
    update(dt) {
      if (time < 0) return null;
      time += dt;
      if (time >= total) { time = -1; return null; }
      let start = 0, index = 0;
      while (time >= start + shots[index].time) start += shots[index++].time;
      const t = time - start, left = shots[index].time - t;
      return { shot: shots[index].shot, index, t, cover: Math.min(1, Math.max(0, 1 - t / fade, 1 - left / fade)) };
    },
  };
}
