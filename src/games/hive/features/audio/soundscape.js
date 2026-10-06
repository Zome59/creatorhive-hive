// Maps the garden's state and events to sound. The listener is the player's bee, so other bees
// are louder the closer they fly and pan with the current view.
const PASS = 2.8;

export function createSoundscape(audio, { random = Math.random } = {}) {
  const passes = new Map();
  const at = bee => ({ x: bee.x, y: bee.y, z: bee.z });
  return {
    frame(game, player, dt, { listener, beeView = false } = {}) {
      if (!audio.enabled) return;
      if (listener) audio.listen(listener);
      const keys = new Set(['garden']);
      audio.loop('garden', 'garden', { spatial: false });
      for (const bee of game.players.values()) {
        const key = `bee-${bee.id}`, own = bee === player, speed = Math.hypot(bee.vx, bee.vy, bee.vz);
        // Each bee keeps its own pitch; speed and boost raise it, a stunned bee wobbles.
        const pitch = 0.9 + (bee.id * 0.137 % 0.25) + Math.min(speed, 13) / 40 + (game.boosting(bee) ? 0.1 : 0) + (bee.stun ? Math.sin(bee.stun * 18) * 0.08 : 0);
        keys.add(key);
        audio.loop(key, 'buzz', { ...at(bee), spatial: !own, gain: own ? (beeView ? 0.32 : 0.2) : 1, rate: pitch });
        if (own || !player) continue;
        // "Bsss": a quick fly-by when a scout zips past close to the player.
        const d = Math.hypot(bee.x - player.x, bee.y - player.y, bee.z - player.z);
        const relative = Math.hypot(bee.vx - player.vx, bee.vy - player.vy, bee.vz - player.vz);
        const state = passes.get(bee.id) ?? { d, wait: 0 };
        state.wait = Math.max(0, state.wait - dt);
        if (state.d >= PASS && d < PASS && relative > 3 && !state.wait) { audio.play('pass', at(bee), { rate: pitch }); state.wait = 2.5; }
        state.d = d; passes.set(bee.id, state);
      }
      const b = game.bumble;
      if (b) { keys.add('bumble'); audio.loop('bumble', 'bumble', { ...at(b), gain: 1, rate: 0.95 + b.speed / 60 + Math.sin(b.age * 3) * 0.03 }); }
      audio.keep(keys);
    },
    events(events, game, player) {
      if (!audio.enabled) return;
      for (const event of events) {
        const own = player && event.id === player.id, bee = game.players.get(event.id);
        if (event.type === 'collect') own ? audio.play('collect', null, { rate: 0.94 + event.bag * 0.035 }) : bee && audio.play('collect', at(bee), { gain: 0.35 });
        else if (event.type === 'deliver') own ? audio.play('deliver') : audio.play('deliver', { x: 0, y: 2, z: 0 }, { gain: 0.35 });
        else if (event.type === 'boost' && own) audio.play('boost');
        else if (event.type === 'bump') audio.play('bump', event, { gain: Math.min(1, 0.55 + event.impact / 8) });
        else if (event.type === 'thud') audio.play('thud', event, { gain: Math.min(1, 0.45 + event.impact / 10) });
        else if (event.type === 'bumble-thud') audio.play('thud', event, { rate: 0.7 });
        else if (event.type === 'bumble-warning') audio.play('alarm', null, { gain: 0.8 });
        else if (event.type === 'bumble-hit') { audio.play('crash', event); audio.play('dizzy', event, { delay: 0.35 }); }
      }
    },
    // Comic gibberish that goes with a speech bubble, from the speaking bee.
    voice(position, { delay = 0, angry = false, deep = false } = {}) {
      if (!position) return;
      // The bumblebee uses the same gibberish, pitched far down.
      audio.play('grumble', position, { delay, gain: deep ? 1.2 : 1, rate: deep ? 0.6 + random() * 0.08 : (angry ? 1.05 : 0.95) + random() * 0.2 });
    },
    reset() { passes.clear(); },
  };
}
