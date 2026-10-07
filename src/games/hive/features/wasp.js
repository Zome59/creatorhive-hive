import { WORLD } from '../world.js';

// The final boss: a wasp that climbs over the island's rim near the end of the round and hunts the scouts.
// The player rallies the remaining scouts into a swarm (gather, attack formation, attack), the swarm mobs the
// wasp, and the player body-slams its head from above. Five slams send it packing; if it reaches the hive
// first, it smashes the hive, gorges on the honey, and the round is lost ("wasted").
// The round clock stands still from the moment it climbs up until it is gone.
export const WASP = Object.freeze({
  spawnLeft: 25, jitter: 8, // seconds left on the clock when it appears, ± jitter
  climb: 3.6, flip: 1.1, height: 6.2, rim: WORLD.island + 1.6, // just outside the hex columns of the rim
  cruise: 3.6, lunge: 4.8, catch: 1.7, struggle: 3.2, huntFor: 34, rest: 1.4, warmup: 2.5, // slow enough for the player to react
  head: Object.freeze({ forward: 0.99, up: 0.13 }), body: 1.7, // head offset from the body centre (as in wasp-model.js); body collision radius
  ride: 2.2, mobbed: Object.freeze([4.5, 6.5]), shake: 0.9, step: 4.5, advance: 2.6,
  hits: 5, hp: 100, // each slam takes hp / hits (shown as a floating damage number)
  slam: Object.freeze({ range: 1.9, above: Object.freeze([0.4, 7.5]), time: 0.42, bounce: 7.5 }),
  hiveReach: WORLD.hive.radius + 2.4, perch: 5.6,
  raid: Object.freeze({ kick: 4.6, eat: 4.2, leave: 3, steal: 0.75 }),
  down: Object.freeze({ fall: 1.0, struggle: 2.6, right: 1.2, leave: 3.6 }), bonus: 150,
  swarm: Object.freeze({ radius: 2.3, mob: 1.75 }),
});

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
// Phases in which the swarm, slams and the defenders can act.
export const WASP_FIGHT = Object.freeze(['hunt', 'approach', 'mobbed', 'shake', 'advance']);
// Defender bees (called in with a bee token during the fight) count a third more than a scout.
export const DEFENDER = 4 / 3;
const weight = p => (p.defender ? DEFENDER : 1);
export const swarmStrength = game => [...game.players.values()].filter(p => p.bot && p.swarmSlot >= 0 && !p.ko).reduce((sum, p) => sum + weight(p), 0);
const spellFor = game => (WASP.mobbed[0] + game.random() * (WASP.mobbed[1] - WASP.mobbed[0])) * (0.7 + 0.05 * swarmStrength(game));
const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const scouts = game => [...game.players.values()].filter(p => p.bot);
const playerOf = game => [...game.players.values()].find(p => !p.bot);

export function scheduleWasp(game) {
  game.wasp = null; game.waspDone = !game.boss; game.cheer = 0; // switched off in the game settings: no boss this round
  game.waspAt = WASP.spawnLeft + (game.random() * 2 - 1) * WASP.jitter;
  game.waspAngle = game.random() * Math.PI * 2;
  for (const p of game.players.values()) Object.assign(p, { ko: false, caught: false, swarmSlot: -1, slam: 0 });
}
// While the boss is on the island the round clock waits.
export const waspActive = game => !!game.wasp;
// Where its head is (mandibles, slam target).
export function waspHead(w) {
  return { x: w.x + Math.sin(w.yaw) * WASP.head.forward, y: w.y + WASP.head.up, z: w.z + Math.cos(w.yaw) * WASP.head.forward };
}
// The player can slam while hovering above the head, within reach, during the fight.
export function slamReady(game, p) {
  const w = game.wasp;
  if (!w || !p || p.slam || p.stun || !WASP_FIGHT.includes(w.phase)) return false;
  const h = waspHead(w), above = p.y - h.y;
  return Math.hypot(p.x - h.x, p.z - h.z) < WASP.slam.range && above > WASP.slam.above[0] && above < WASP.slam.above[1];
}

function spawn(game) {
  const a = game.waspAngle, r = WASP.rim;
  game.waspDone = true;
  game.wasp = { phase: 'climb', t: 0, x: Math.sin(a) * r, y: -3.2, z: Math.cos(a) * r, yaw: a + Math.PI, angle: a,
    hits: 0, swarm: 'none', swarmT: 0, target: null, hunted: 0, spell: 0, steps: 0, eaten: 0, stolen: 0, sx: 0, sz: 0, hitFlash: 0 };
  // Nobody steers during the entrance; the camera shows the claws coming over the rim.
  game.cutscene = Math.max(game.cutscene, WASP.climb + WASP.flip);
  // The bumblebee wants no part of this and leaves at once.
  if (game.bumble) { game.bumble.leaving = true; if (game.bumble.mode === 'heist') game.bumble.phase = 'leaving'; }
  game.bumbleWarn = 0;
  game.emit({ type: 'wasp-climb', x: game.wasp.x, z: game.wasp.z, angle: a });
}
function phase(game, w, name) { w.phase = name; w.t = 0; game.emit({ type: `wasp-${name}`, x: w.x, y: w.y, z: w.z }); }
function moveToward(w, x, y, z, speed, dt) {
  const dx = x - w.x, dy = y - w.y, dz = z - w.z, d = Math.hypot(dx, dy, dz);
  if (d > 1e-6) { const s = Math.min(d, speed * dt) / d; w.x += dx * s; w.y += dy * s; w.z += dz * s; }
  if (Math.hypot(dx, dz) > 0.2) { const want = Math.atan2(dx, dz), turn = Math.atan2(Math.sin(want - w.yaw), Math.cos(want - w.yaw)); w.yaw += turn * Math.min(1, dt * 5); }
  return d;
}
const toHive = w => Math.hypot(w.x, w.z);
function nearestPrey(game, w) {
  let best = null, bd = Infinity;
  for (const p of scouts(game)) {
    if (p.ko || p.caught) continue;
    const d = Math.hypot(p.x - w.x, p.y - w.y, p.z - w.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function knockOut(game, p) {
  Object.assign(p, { caught: false, ko: true, swarmSlot: -1, stun: 0, angry: 0, kx: 0, ky: 0, kz: 0 });
  game.emit({ type: 'wasp-ko', id: p.id, x: p.x, y: p.y, z: p.z });
}
function free(game) { // the swarm scatters when the wasp breaks loose
  for (const p of scouts(game)) if (p.swarmSlot >= 0 && !p.ko) {
    const w = game.wasp, dx = p.x - w.x, dz = p.z - w.z, d = Math.hypot(dx, dz) || 1, k = 7 / weight(p);
    p.kx += dx / d * k; p.ky += 2.5; p.kz += dz / d * k; p.stun = 0.7 / weight(p);
  }
}
function finishRaid(game) {
  game.wasp = null;
  for (const p of game.players.values()) p.caught = false;
  game.emit({ type: 'wasp-wasted', stolen: game.waspStolen ?? 0 });
  game.finish('wasted');
}
function defeat(game) {
  const w = game.wasp, player = playerOf(game);
  if (w.caughtId) release(game, w); // drops whoever it was holding
  phase(game, w, 'fall');
  game.cheer = WASP.down.fall + WASP.down.struggle + WASP.down.right + WASP.down.leave + CHEER.after; // formation until a little after it is gone
  if (player) { player.points += WASP.bonus; game.emit({ type: 'wasp-bonus', id: player.id, points: WASP.bonus }); }
  for (const p of scouts(game)) p.swarmSlot = -1;
  w.swarm = 'none';
}
function leave(game) {
  game.wasp = null;
  for (const p of game.players.values()) p.caught = false;
  for (const p of scouts(game)) if (p.ko) { p.ko = false; p.stun = 1.4; p.ky = 3; }
  game.emit({ type: 'wasp-gone' });
}

// Player commands from the scene: 'gather' (X X X), 'formation' (X X X again), 'attack' (the big button).
export function waspCommand(game, command) {
  const w = game.wasp;
  if (!w || !WASP_FIGHT.includes(w.phase)) return false;
  const next = { gather: ['none', 'gathered'], formation: ['gathered', 'formation'], attack: ['formation', 'charging'] }[command];
  if (!next || w.swarm !== next[0]) return false;
  w.swarm = next[1]; w.swarmT = 0;
  if (command === 'gather') scouts(game).filter(p => !p.ko && !p.caught).forEach((p, i) => { p.swarmSlot = i; });
  game.emit({ type: `swarm-${next[1]}`, count: scouts(game).filter(p => p.swarmSlot >= 0).length });
  return true;
}
export const swarmSize = game => scouts(game).filter(p => p.swarmSlot >= 0 && !p.ko).length;
// Defenders arriving: every bee that can still fly joins the swarm, which charges at once.
export function joinSwarmAttack(game) {
  const w = game.wasp; if (!w) return;
  scouts(game).filter(p => !p.ko && !p.caught).forEach((p, i) => { p.swarmSlot = i; });
  if (w.swarm !== 'mobbing') { w.swarm = 'charging'; w.swarmT = 0; game.emit({ type: 'swarm-charging', count: swarmSize(game), defenders: true }); }
}

// Victory formation: rings of six around the player (like the goal party's honeycomb), slowly turning.
export const CHEER = Object.freeze({ after: 2.4, height: 1.3, ring: 1.35 });
function cheerSlot(i, spin) {
  const ring = i < 6 ? 1 : 2, k = i < 6 ? i : i - 6, n = ring === 1 ? 6 : 12, a = k / n * Math.PI * 2 + spin * (ring === 1 ? 1 : -0.7);
  return { x: Math.sin(a) * CHEER.ring * ring, z: Math.cos(a) * CHEER.ring * ring };
}
// Scout steering while the boss is around; returns true when it took over.
export function steerForWasp(game, p, dt) {
  const w = game.wasp;
  if (game.cheer > 0 && !p.ko && !p.caught) { // the wasp is beaten: everyone flies into formation around the player
    const player = playerOf(game), crew = scouts(game).filter(o => !o.ko && !o.caught), i = crew.indexOf(p);
    if (player && i >= 0) {
      const slot = cheerSlot(i, game.clock * 0.9), x = player.x + slot.x, y = player.y + CHEER.height + Math.sin(game.clock * 4 + i) * 0.15, z = player.z + slot.z;
      const dx = x - p.x, dy = y - p.y, dz = z - p.z, d = Math.hypot(dx, dz) || 1e-6, k = 1 - Math.exp(-dt * 2.5);
      p.input = { x: dx / d * Math.min(1, d), y: Math.max(-1, Math.min(1, dy * 1.5)), z: dz / d * Math.min(1, d), dash: d > 5 };
      p.x += dx * k; p.y += dy * k; p.z += dz * k; p.yaw = Math.atan2(player.x - p.x, player.z - p.z); p.stun = 0;
      return true;
    }
  }
  if (p.ko) { p.input = { x: 0, y: 0, z: 0, dash: false }; p.y = Math.max(WORLD.floor * 0.6, p.y - 7 * dt); return true; }
  if (p.caught && w) { // held in the mandibles, fighting back in vain
    const h = waspHead(w);
    p.input = { x: 0, y: 0, z: 0, dash: false }; p.x += (h.x - p.x) * Math.min(1, dt * 10); p.y += (h.y - 0.25 - p.y) * Math.min(1, dt * 10); p.z += (h.z - p.z) * Math.min(1, dt * 10);
    p.yaw = w.yaw + Math.PI; p.angry = 0.3; return true;
  }
  if (!w || p.swarmSlot < 0) return false;
  const player = playerOf(game), members = scouts(game).filter(o => o.swarmSlot >= 0 && !o.ko), n = members.length, i = Math.max(0, members.indexOf(p));
  let x, y, z;
  if (w.swarm === 'gathered' && player) { // a buzzing ball around the player
    const a = i / n * Math.PI * 2 + game.clock * 0.9;
    x = player.x + Math.sin(a) * WASP.swarm.radius; z = player.z + Math.cos(a) * WASP.swarm.radius; y = player.y + Math.sin(i * 1.7 + game.clock * 2) * 0.7;
  } else if (w.swarm === 'formation' && player) { // an arrowhead behind the player, pointing at the wasp
    const face = Math.atan2(w.x - player.x, w.z - player.z), fx = Math.sin(face), fz = Math.cos(face), row = Math.floor(i / 2) + 1, side = i % 2 ? 1 : -1;
    x = player.x - fx * row * 1.3 + fz * side * row * 1.05; z = player.z - fz * row * 1.3 - fx * side * row * 1.05; y = player.y + row * 0.25;
  } else if (w.swarm === 'charging') { x = w.x; y = w.y; z = w.z; } else { // mobbing: circling close and poking in and out
    const a = i / n * Math.PI * 2 + game.clock * 1.3, r = WASP.swarm.mob + Math.sin(game.clock * 9 + i * 2.1) * 0.35;
    x = w.x + Math.sin(a) * r; z = w.z + Math.cos(a) * r; y = w.y + ((i % 3) - 1) * 0.6;
  }
  if (p.stun) { p.input = { x: 0, y: 0, z: 0, dash: false }; return true; }
  const dx = x - p.x, dy = y - p.y, dz = z - p.z, d = Math.hypot(dx, dz) || 1e-6;
  p.input = { x: dx / d * Math.min(1, d), y: clamp(dy * 1.5, -1, 1), z: dz / d * Math.min(1, d), dash: d > 4 };
  const k = 1 - Math.exp(-dt * (w.swarm === 'charging' ? 1.6 : 3)); // tight formation: also pull straight to the slot
  p.x += dx * k; p.y += dy * k; p.z += dz * k;
  if (w.swarm !== 'gathered' && w.swarm !== 'formation') p.yaw = Math.atan2(w.x - p.x, w.z - p.z);
  return true;
}

export function tickWasp(game, dt) {
  if (game.result) return;
  if (game.cheer > 0) game.cheer = Math.max(0, game.cheer - dt);
  if (!game.wasp) {
    if (!game.waspDone && game.remaining <= game.waspAt && !game.cutscene) spawn(game);
    return;
  }
  const w = game.wasp, player = playerOf(game);
  w.t += dt; w.swarmT += dt; w.hitFlash = Math.max(0, w.hitFlash - dt);
  // --- entrance: up the cliff, then a flip to just above the treetops
  if (w.phase === 'climb') {
    w.y = -3.2 + 2.8 * ease(w.t / WASP.climb); // ends with the head and front claws over the edge (about 30 % showing)
    if (w.t >= WASP.climb) { w.sx = w.x; w.sz = w.z; phase(game, w, 'flip'); }
    return;
  }
  if (w.phase === 'flip') {
    const k = ease(w.t / WASP.flip), inward = 3.2 * k;
    w.x = w.sx - Math.sin(w.angle) * inward; w.z = w.sz - Math.cos(w.angle) * inward; w.y = -0.4 + (WASP.height + 0.4) * k + Math.sin(Math.PI * k) * 2.2;
    if (w.t >= WASP.flip) { phase(game, w, 'hunt'); w.rest = WASP.warmup; game.emit({ type: 'wasp-alarm', x: w.x, z: w.z }); } // a moment to read the alarm
    return;
  }
  // --- defeated: drops onto its back, kicks like a beetle, rights itself, flies away
  if (w.phase === 'fall') { w.y = Math.max(0, w.y - (2 + w.t * 14) * dt); if (w.t >= WASP.down.fall) phase(game, w, 'onBack'); return; }
  if (w.phase === 'onBack') { w.y = 0; if (w.t >= WASP.down.struggle) phase(game, w, 'rightItself'); return; }
  if (w.phase === 'rightItself') { if (w.t >= WASP.down.right) phase(game, w, 'flee'); return; }
  // Beaten: it reels off dizzily, slowly at first, then faster and faster over the rim and into the sky.
  if (w.phase === 'flee') { moveToward(w, Math.sin(w.angle) * 60, 16, Math.cos(w.angle) * 60, 3 + w.t * 6, dt); if (w.t >= WASP.down.leave) leave(game); return; }
  // --- the raid: kicks the hive in, then gorges on the honey that spills out
  if (w.phase === 'kick') { w.x *= 0.9; w.z *= 0.9; w.y += (WASP.perch - w.y) * Math.min(1, dt * 4); if (w.t >= WASP.raid.kick) { phase(game, w, 'eat'); game.emit({ type: 'hive-collapse', honey: game.honey }); w.honey0 = game.honey; } return; }
  if (w.phase === 'eat') {
    w.y += (1.6 - w.y) * Math.min(1, dt * 3);
    const want = Math.round(w.honey0 * WASP.raid.steal * clamp(w.t / WASP.raid.eat, 0, 1));
    if (want > w.stolen) { game.honey = Math.max(0, game.honey - (want - w.stolen)); w.stolen = want; game.waspStolen = want; }
    if (w.t >= WASP.raid.eat) phase(game, w, 'leave');
    return;
  }
  if (w.phase === 'leave') { moveToward(w, Math.sin(w.angle) * 60, 16, Math.cos(w.angle) * 60, 10, dt); if (w.t >= WASP.raid.leave) finishRaid(game); return; }

  // --- the fight
  // A player bee flying into it gets swatted away (unless it comes down on its head).
  if (player && !player.slam) {
    const dx = player.x - w.x, dy = player.y - w.y, dz = player.z - w.z, d = Math.hypot(dx, dy, dz);
    if (d < WASP.body && !player.stun) {
      const n = d || 1; player.kx += dx / n * 9; player.ky += 3; player.kz += dz / n * 9; player.stun = 0.6;
      game.emit({ type: 'wasp-swat', id: player.id, x: player.x, y: player.y, z: player.z });
    }
  }
  // Slams: the player dives butt-first onto its head.
  if (player?.input?.slam && slamReady(game, player)) { player.slam = WASP.slam.time; player.slamFrom = player.y; game.emit({ type: 'slam-start', id: player.id }); }
  if (player?.slam) {
    player.slam = Math.max(0, player.slam - dt);
    const h = waspHead(w), k = 1 - player.slam / WASP.slam.time;
    player.x += (h.x - player.x) * Math.min(1, dt * 14); player.z += (h.z - player.z) * Math.min(1, dt * 14);
    player.y = player.slamFrom + (h.y + 0.55 - player.slamFrom) * k * k;
    player.vx = player.vz = 0; player.vy = -12; player.kx = player.kz = 0; player.ky = 0;
    if (!player.slam) {
      w.hits++; w.hitFlash = 0.5; player.ky = WASP.slam.bounce; player.y = h.y + 0.6;
      game.emit({ type: 'wasp-hit', hits: w.hits, x: h.x, y: h.y + 0.4, z: h.z });
      if (w.hits >= WASP.hits) { defeat(game); return; }
    }
  }
  if (w.swarm === 'charging') { // the swarm flies in; once it arrives, the wasp is mobbed
    const n = scouts(game).filter(p => p.swarmSlot >= 0 && !p.ko);
    const arrived = n.length && n.filter(p => Math.hypot(p.x - w.x, p.y - w.y, p.z - w.z) < 3.2).length >= Math.ceil(n.length * 0.6);
    if (arrived || w.swarmT > WASP.ride + 1.5) { w.swarm = 'mobbing'; w.swarmT = 0; w.spell = spellFor(game); if (w.caughtId) release(game, w); phase(game, w, 'mobbed'); }
  }
  if (w.phase === 'mobbed') { // dazed: barely moves, drifts and wobbles
    w.x += Math.sin(game.clock * 1.7) * 0.4 * dt; w.z += Math.cos(game.clock * 1.3) * 0.4 * dt; w.y += (WASP.height - 1 - w.y) * Math.min(1, dt);
    if (swarmSize(game) === 0) { w.swarm = 'none'; phase(game, w, 'approach'); return; }
    if (w.t >= w.spell) { phase(game, w, 'shake'); free(game); }
    return;
  }
  if (w.phase === 'shake') { if (w.t >= WASP.shake) { w.steps++; w.goal = Math.max(WASP.hiveReach - 0.5, toHive(w) - WASP.step * clamp(6 / Math.max(6, swarmStrength(game)), 0.6, 1)); phase(game, w, 'advance'); } return; }
  if (w.phase === 'advance') { // a few metres closer to the hive, then the swarm is back on it
    const r = toHive(w) || 1, gx = w.x / r * w.goal, gz = w.z / r * w.goal;
    moveToward(w, gx, WASP.height - 0.5, gz, WASP.step / WASP.advance * 1.2, dt);
    if (toHive(w) <= WASP.hiveReach) { phase(game, w, 'kick'); return; }
    if (w.t >= WASP.advance) { if (swarmSize(game)) { w.swarm = 'mobbing'; w.spell = spellFor(game); phase(game, w, 'mobbed'); } else { w.swarm = 'none'; phase(game, w, 'approach'); } }
    return;
  }
  if (w.phase === 'approach') { // nothing left to hunt: straight for the honey
    moveToward(w, 0, WASP.perch, 0, WASP.cruise, dt);
    if (toHive(w) <= WASP.hiveReach) phase(game, w, 'kick');
    return;
  }
  // hunt: lunge at the nearest scout, hold it while it struggles, drop it, next one
  w.hunted += dt;
  if (w.caughtId) {
    const prey = game.players.get(w.caughtId);
    w.y += (Math.max(2.4, w.y) - w.y) * dt;
    // Defenders hold out longer in its mandibles.
    if (!prey || w.t >= WASP.struggle * (prey ? weight(prey) : 1)) { if (prey) knockOut(game, prey); w.caughtId = null; w.t = 0; w.rest = WASP.rest; }
    return;
  }
  if (w.rest > 0) { w.rest -= dt; w.y += (WASP.height - 0.6 - w.y) * Math.min(1, dt * 2); return; } // gloating between catches
  const prey = nearestPrey(game, w);
  if (!prey || w.hunted > WASP.huntFor) { phase(game, w, 'approach'); return; }
  const d = moveToward(w, prey.x, Math.max(1.4, prey.y), prey.z, WASP.lunge, dt);
  if (d < WASP.catch) {
    prey.caught = true; prey.swarmSlot = -1; w.caughtId = prey.id; w.t = 0;
    game.emit({ type: 'wasp-catch', id: prey.id, x: prey.x, y: prey.y, z: prey.z });
  }
}
function release(game, w) {
  const prey = game.players.get(w.caughtId);
  if (prey) { prey.caught = false; prey.stun = 1; prey.ky = 3; }
  w.caughtId = null;
}
