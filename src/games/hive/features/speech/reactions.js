import { LINES, SOUNDS, createPicker } from './lines.js';

// Turns simulation events into speech bubbles, comic sound words, and gibberish voices.
// `say` targets a bee id (or 'bumble'); `pow` is a sound word at a world position.
export function createReactions({ random = Math.random } = {}) {
  const pick = createPicker(random);
  let thudTalk = 0, upsetTalk = 0;
  return function react(events, game, dt = 0) {
    thudTalk = Math.max(0, thudTalk - dt); upsetTalk = Math.max(0, upsetTalk - dt);
    const out = [], player = [...game.players.values()].find(p => !p.bot);
    const near = event => !player || Math.hypot(event.x - player.x, event.z - player.z) < 26;
    for (const event of events) {
      if (event.type === 'bump') {
        if (!near(event)) continue;
        out.push({ kind: 'pow', text: pick(SOUNDS.bump), style: 'bump', x: event.x, y: event.y, z: event.z });
        // The player's own bee stays quiet; scouts talk back.
        const victim = game.players.get(event.victim), by = game.players.get(event.by);
        if (victim?.bot) out.push({ kind: 'say', id: victim.id, text: pick(LINES.victim), voice: true });
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
      } else if (event.type === 'bumble-thud') {
        out.push({ kind: 'pow', text: pick(SOUNDS.thud), style: 'thud', x: event.x, y: event.y, z: event.z });
        if (random() < 0.5) out.push({ kind: 'say', id: 'bumble', text: pick(LINES.bumbleThud), style: 'bumble', delay: 0.3 });
      }
    }
    return out;
  };
}
