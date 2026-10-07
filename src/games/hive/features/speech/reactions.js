import { LINES, SOUNDS, TOPPLE, createPicker } from './lines.js';

// Turns simulation events into speech bubbles, comic sound words, and gibberish voices.
// `say` targets a bee id (or 'bumble'); `pow` is a sound word at a world position.
export function createReactions({ random = Math.random } = {}) {
  const pick = createPicker(random);
  let thudTalk = 0, upsetTalk = 0, swarmTalk = 0, thiefTalk = 0;
  return function react(events, game, dt = 0) {
    thudTalk = Math.max(0, thudTalk - dt); upsetTalk = Math.max(0, upsetTalk - dt); swarmTalk = Math.max(0, swarmTalk - dt); thiefTalk = Math.max(0, thiefTalk - dt);
    const out = [], player = [...game.players.values()].find(p => !p.bot);
    const near = event => !player || Math.hypot(event.x - player.x, event.z - player.z) < 26;
    for (const event of events) {
      if (event.type === 'bump') {
        if (!near(event)) continue;
        out.push(event.power ? { kind: 'pow', text: pick(TOPPLE.power), style: 'bumble', x: event.x, y: event.y, z: event.z } : { kind: 'pow', text: pick(SOUNDS.bump), style: 'bump', x: event.x, y: event.y, z: event.z });
        // The player's own bee stays quiet; scouts talk back.
        const victim = game.players.get(event.victim), by = game.players.get(event.by);
        if (victim?.bot) out.push({ kind: 'say', id: victim.id, text: pick(event.power ? LINES.hit : LINES.victim), style: event.power ? 'shout' : undefined, voice: true });
        if (by?.bot && (!victim?.bot || random() < 0.55)) out.push({ kind: 'say', id: by.id, text: pick(victim?.bot ? LINES.reply : LINES.victim), voice: true, delay: victim?.bot ? 1.1 : 0.15 });
      } else if (event.type === 'thud') {
        const bee = game.players.get(event.id);
        if (!near(event)) continue;
        out.push({ kind: 'pow', text: pick(SOUNDS.thud), style: 'thud', x: event.x, y: event.y, z: event.z });
        if (bee?.bot && !thudTalk && random() < 0.4) { thudTalk = 2.5; out.push({ kind: 'say', id: bee.id, text: pick(LINES.thud), voice: true, delay: 0.2 }); }
      } else if (event.type === 'bumble-hit') {
        out.push({ kind: 'pow', text: pick(SOUNDS.bumble), style: 'bumble', x: event.x, y: event.y, z: event.z });
        out.push({ kind: 'say', id: event.id, text: pick(LINES.hit), style: 'shout', voice: true, delay: 0.25 });
        if (random() < 0.65) out.push({ kind: 'say', id: 'bumble', text: pick(LINES.bumble), style: 'bumble', delay: 0.6 });
      } else if (event.type === 'upset') {
        if (upsetTalk > 1.2) continue;
        upsetTalk += 0.45;
        out.push({ kind: 'say', id: event.id, text: pick(LINES.upset), style: 'shout', voice: true, delay: 0.4 + random() * 0.9 });
      } else if (event.type === 'bumble-enter' && event.mode === 'heist') {
        out.push({ kind: 'say', id: 'bumble', text: pick(LINES.thiefArrives), style: 'bumble', delay: 0.8 });
      } else if (event.type === 'heist-perch' || (event.type === 'heist-drain' && !thiefTalk)) {
        thiefTalk = 3.5 + random() * 2;
        out.push({ kind: 'say', id: 'bumble', text: pick(LINES.thief), style: 'bumble' });
      } else if (event.type === 'heist-poke') {
        out.push({ kind: 'pow', text: pick(SOUNDS.poke), style: 'bump', x: event.x, y: event.y, z: event.z });
        if (!swarmTalk) { swarmTalk = 1.3; out.push({ kind: 'say', id: event.id, text: pick(LINES.swarm), style: 'shout', voice: true }); }
      } else if (event.type === 'heist-hit') {
        out.push({ kind: 'pow', text: pick(SOUNDS.thud), style: 'bumble', x: event.x, y: event.y, z: event.z });
        out.push({ kind: 'say', id: 'bumble', text: pick(LINES.thiefHit), style: 'bumble', delay: 0.15 });
      } else if (event.type === 'heist-end' && event.rescued) {
        out.push({ kind: 'pow', text: pick(SOUNDS.fall), style: 'bumble', x: event.x, y: event.y, z: event.z });
        out.push({ kind: 'say', id: 'bumble', text: pick(LINES.thiefFalls), style: 'bumble', delay: 0.2 });
        // Scouts cheer one after another.
        [...game.players.values()].filter(p => p.bot).slice(0, 3).forEach((p, i) => out.push({ kind: 'say', id: p.id, text: pick(LINES.cheer), voice: true, delay: 0.6 + i * 0.45 }));
      } else if (event.type === 'heist-end') {
        out.push({ kind: 'say', id: 'bumble', text: pick(LINES.thiefLeaves), style: 'bumble' });
      } else if (event.type === 'bumble-shoved') {
        out.push({ kind: 'pow', text: pick(TOPPLE.power), style: 'bumble', x: event.x, y: event.y, z: event.z });
        out.push({ kind: 'say', id: 'bumble', text: pick(event.leaving ? LINES.givesUp : LINES.shoved), style: 'bumble', delay: 0.2 });
        const fan = [...game.players.values()].find(p => p.bot && Math.hypot(p.x - event.x, p.z - event.z) < 14);
        if (fan) out.push({ kind: 'say', id: fan.id, text: pick(LINES.cheer), voice: true, delay: 0.8 });
      } else if (event.type === 'topple') {
        out.push({ kind: 'pow', text: pick(TOPPLE[event.kind] ?? TOPPLE.tree), style: 'bumble', x: event.x, y: event.y, z: event.z });
        const witness = [...game.players.values()].find(p => p.bot && Math.hypot(p.x - event.x, p.z - event.z) < 10);
        if (witness && !thudTalk) { thudTalk = 2; out.push({ kind: 'say', id: witness.id, text: pick(LINES.topple), voice: true, delay: 0.4 }); }
      } else if (event.type === 'restore' && near(event)) {
        out.push({ kind: 'pow', text: pick(TOPPLE.restore), style: 'bump', x: event.x, y: event.y, z: event.z });
      } else if (event.type === 'round-end' && event.result === 'complete') {
        // Everyone cheers, one after another, while they fly their victory loop.
        [...game.players.values()].filter(p => p.bot).forEach((p, i) => out.push({ kind: 'say', id: p.id, text: pick(LINES.cheer), voice: i < 2, delay: 0.6 + i * 0.55 }));
      } else if (event.type === 'bumble-thud') {
        out.push({ kind: 'pow', text: pick(SOUNDS.thud), style: 'thud', x: event.x, y: event.y, z: event.z });
        if (random() < 0.5) out.push({ kind: 'say', id: 'bumble', text: pick(LINES.bumbleThud), style: 'bumble', delay: 0.3 });
      }
    }
    return out;
  };
}
