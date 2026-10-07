// Maps the garden's state and events to sound. The listener is the player's bee, so other bees
// are louder the closer they fly and pan with the current view.
const PASS = 2.8;

export function createSoundscape(audio, { random = Math.random } = {}) {
  const passes = new Map();
  let slurp = 0, clock = 0, lastVoice = -9;
  const VOICE_GAP = 1.8, CHATTY = 0.6;
  const at = bee => ({ x: bee.x, y: bee.y, z: bee.z });
  return {
    frame(game, player, dt, { listener, beeView = false, music = 'off', water = [] } = {}) {
      clock += dt;
      if (!audio.enabled) return;
      if (listener) audio.listen(listener);
      const keys = new Set(['garden']);
      audio.loop('garden', 'garden', { spatial: false });
      // The brook and the waterfall: positioned, so they swell as you fly close.
      for (const source of water) { keys.add(source.key); audio.loop(source.key, 'brook', { x: source.x, y: source.y, z: source.z, rate: source.rate ?? 1, gain: source.gain ?? 1 }); }
      // One key per track, so switching tracks stops the previous one.
      if (music !== 'off') { keys.add(`music:${music}`); audio.loop(`music:${music}`, music, { spatial: false }); }
      for (const bee of game.players.values()) {
        const key = `bee-${bee.id}`, own = bee === player, speed = Math.hypot(bee.vx, bee.vy, bee.vz);
        // Each bee keeps its own pitch; speed and boost raise it, a stunned bee wobbles.
        const pitch = 0.9 + (bee.id * 0.137 % 0.25) + Math.min(speed, 13) / 40 + (game.boosting(bee) ? 0.1 : 0) + (bee.stun ? Math.sin(bee.stun * 18) * 0.08 : 0);
        keys.add(key);
        audio.loop(key, 'buzz', { ...at(bee), spatial: !own, gain: own ? (beeView ? 0.2 : 0.12) : 1, rate: pitch, bus: own ? 'own' : 'bees' });
        if (own || !player) continue;
        // "Bsss": a quick fly-by when a scout zips past close to the player.
        const d = Math.hypot(bee.x - player.x, bee.y - player.y, bee.z - player.z);
        const relative = Math.hypot(bee.vx - player.vx, bee.vy - player.vy, bee.vz - player.vz);
        const state = passes.get(bee.id) ?? { d, wait: 0 };
        state.wait = Math.max(0, state.wait - dt);
        if (state.d >= PASS && d < PASS && relative > 3 && !state.wait) { audio.play('pass', at(bee), { rate: pitch }); state.wait = 2.5; }
        state.d = d; passes.set(bee.id, state);
      }
      // A soaked player hears the little cloud's rain right above.
      if (player?.wet) { keys.add('rain'); audio.loop('rain', 'rain', { spatial: false }); }
      const b = game.bumble;
      if (b) {
        keys.add('bumble');
        // While it drinks on the hive the drone calms down and slurps come at a relaxed pace.
        const perched = b.phase === 'perched';
        audio.loop('bumble', 'bumble', { ...at(b), gain: perched ? 0.55 : 1, rate: perched ? 0.88 : 0.95 + b.speed / 60 + Math.sin(b.age * 3) * 0.03 });
        slurp -= dt;
        if (perched && slurp <= 0) { audio.play('slurp', at(b), { rate: 0.9 + random() * 0.2 }); slurp = 1.4 + random() * 0.8; }
      }
      audio.keep(keys);
    },
    events(events, game, player) {
      if (!audio.enabled) return;
      for (const event of events) {
        const own = player && event.id === player.id, bee = game.players.get(event.id);
        if (event.type === 'collect') own ? audio.play('collect', null, { rate: 0.94 + event.bag * 0.035 }) : bee && audio.play('collect', at(bee), { gain: 0.35 });
        else if (event.type === 'deliver') own ? audio.play('deliver') : audio.play('deliver', { x: 0, y: 2, z: 0 }, { gain: 0.35 });
        else if (event.type === 'boost' && own) { audio.play('boost', null, { rate: event.power ? 0.8 : 1 }); if (event.power) audio.play('pass', null, { rate: 0.7, gain: 0.8 }); }
        else if (event.type === 'bump' && event.power) { audio.play('crash', event); audio.play('bump', event, { rate: 0.8 }); }
        else if (event.type === 'bump') audio.play('bump', event, { gain: Math.min(1, 0.55 + event.impact / 8) });
        else if (event.type === 'power-ready' && own) { audio.play('collect', null, { rate: 1.45 }); audio.chime(1320); }
        else if (event.type === 'bumble-shoved') { audio.play('crash', event, { rate: 0.85 }); audio.play('dizzy', event, { delay: 0.3, rate: 0.7 }); }
        else if (event.type === 'rain-end' && own) audio.play('shake');
        else if (event.type === 'turbo' && own) audio.play('boost', null, { rate: 1.25, gain: 0.8 });
        else if (event.type === 'restore') audio.play('bump', event, { rate: 1.5, gain: 0.35 });
        else if (event.type === 'topple') { audio.play('crash', event, { rate: 0.85 }); audio.play('thud', event, { rate: 0.6, delay: 0.25 }); }
        else if (event.type === 'thud') audio.play('thud', event, { gain: Math.min(1, 0.45 + event.impact / 10) });
        else if (event.type === 'bumble-thud') audio.play('thud', event, { rate: 0.7 });
        else if (event.type === 'bumble-warning') audio.play('alarm', null, { gain: 0.7 });
        else if (event.type === 'bumble-hit') { audio.play('crash', event); audio.play('dizzy', event, { delay: 0.35 }); }
        else if (event.type === 'heist-poke') audio.play('bump', event, { gain: 0.5, rate: 0.9 });
        else if (event.type === 'heist-hit') { audio.play('bump', event, { rate: 0.75 }); audio.play('thud', event, { rate: 0.6 }); }
        else if (event.type === 'heist-end' && event.rescued) { audio.play('crash', event); audio.play('dizzy', event, { delay: 0.4, rate: 0.8 }); }
      }
    },
    // Comic gibberish that goes with a speech bubble, from the speaking bee.
    // Speech bubbles stay, but not every one gets a voice: a short gap between voices, and calm remarks only sometimes.
    voice(position, { delay = 0, angry = false, deep = false } = {}) {
      if (!position || clock - lastVoice < VOICE_GAP || (!angry && !deep && random() > CHATTY)) return;
      lastVoice = clock;
      // The bumblebee uses the same gibberish, pitched far down.
      audio.play('grumble', position, { delay, gain: deep ? 1.2 : 1, rate: deep ? 0.6 + random() * 0.08 : (angry ? 1.05 : 0.95) + random() * 0.2 });
    },
    reset() { passes.clear(); lastVoice = -9; },
  };
}
