import { WORLD, OBSTACLES, contact } from '../world.js';

// A clumsy bumblebee visits twice per round. First it crosses the garden around the middle of the
// round and knocks bees around. Later it comes back, sits on the hive, and drinks honey until the
// player bumps it off. Each visit is announced `warning` seconds ahead, from the side where it enters.
export const BUMBLE = Object.freeze({ radius: 1, speed: 4.6, life: 22, spawn: [0.42, 0.58], reach: 9, warning: 4 });
// A power-boosting player can shove the crossing bumblebee away; each shove costs nectar.
export const SHOVE = Object.freeze({ cost: 2, push: 9, giveUp: 2 });
export const HEIST = Object.freeze({ spawn: [0.72, 0.82], gap: 6, roam: [4, 10], direct: 0.25, perch: Object.freeze({ x: 0, y: 5.05, z: 0 }), drain: 2.5, patience: 28, hits: 3, impact: 2.2 });
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// "Mid-round" means a share of the time or of the goal, whichever comes first, slightly randomized.
export function scheduleBumblebee(game, goal) {
  const share = ([min, max]) => min + game.random() * (max - min);
  game.bumbleAt = game.remaining * (1 - share(BUMBLE.spawn)); game.bumbleHoney = Math.round(goal * share(BUMBLE.spawn));
  game.heistAt = game.remaining * (1 - share(HEIST.spawn)); game.heistHoney = Math.round(goal * share(HEIST.spawn));
  game.bumbleDone = false; game.heistDone = false; game.bumbleWarn = 0; game.bumbleGone = 0;
  game.bumbleAngle = game.random() * Math.PI * 2; game.heistAngle = game.random() * Math.PI * 2;
}
function spawn(game, mode, at) {
  const angle = mode === 'heist' ? game.heistAngle : game.bumbleAngle;
  // It enters high above the treetops (clear sky behind it for the entrance shots), then drops in.
  game.bumble = { mode, phase: mode === 'heist' ? 'approach' : 'roam', x: Math.sin(angle) * (WORLD.radius + 3), y: 7, z: Math.cos(angle) * (WORLD.radius + 3),
    yaw: angle + Math.PI + (mode === 'heist' ? 0 : (game.random() - 0.5) * 0.6), age: 0, retarget: 1.5, target: null, lurch: 0, thud: 0, oops: 0, wobble: 0,
    leaving: false, hits: 0, speed: 0, knocks: 0, drained: 0, sip: 0, perched: 0, vx: 0, vy: 0, vz: 0, fall: 0, ...at };
  // On its raid it usually bumbles around the garden for a while, knocking bees over, before it heads for the honey.
  if (mode === 'heist') game.bumble.roamFor = game.random() < HEIST.direct ? 0 : HEIST.roam[0] + game.random() * (HEIST.roam[1] - HEIST.roam[0]);
  game.emit({ type: 'bumble-enter', mode, x: game.bumble.x, y: game.bumble.y, z: game.bumble.z });
}
// The landing tour lets a bumblebee charge straight into a group of scouts to show some action.
export function releaseBumblebee(game) {
  const scouts = [...game.players.values()].filter(p => p.bot && !p.stun);
  if (!scouts.length || game.bumble) return null;
  const crowd = p => scouts.filter(o => o !== p && Math.hypot(o.x - p.x, o.z - p.z) < 7).length;
  const target = scouts.reduce((best, p) => crowd(p) > crowd(best) ? p : best);
  // Start close with a run-up, so the charge lands before the scouts can dodge.
  const side = Math.atan2(target.x, target.z) + 1.2, x = target.x + Math.sin(side) * 3.6, z = target.z + Math.cos(side) * 3.6;
  spawn(game, 'cross', { x, y: Math.max(1.5, target.y), z, yaw: Math.atan2(target.x - x, target.z - z), target: target.id, retarget: 3.5, lurch: 1.4 });
  target.fume = 1.2; // Frozen in surprise, staring at it.
  return game.bumble;
}
function announce(game, mode) {
  const angle = mode === 'heist' ? game.heistAngle : game.bumbleAngle;
  game.bumbleWarn = BUMBLE.warning; game.bumbleMode = mode;
  game.emit({ type: 'bumble-warning', mode, seconds: BUMBLE.warning, angle, x: Math.sin(angle) * WORLD.radius, z: Math.cos(angle) * WORLD.radius });
}
function schedule(game, dt) {
  if (game.wasp) return; // no bumblebee visits while the wasp is on the island
  if (game.bumble) { game.bumbleGone = 0; return; }
  game.bumbleGone += dt;
  if (game.bumbleWarn) {
    game.bumbleWarn = Math.max(0, game.bumbleWarn - dt);
    if (!game.bumbleWarn) { game[game.bumbleMode === 'heist' ? 'heistDone' : 'bumbleDone'] = true; spawn(game, game.bumbleMode); }
  } else if (!game.bumbleDone) {
    if (game.remaining <= game.bumbleAt || game.honey >= game.bumbleHoney) announce(game, 'cross');
  } else if (!game.heistDone && game.bumbleGone >= HEIST.gap) {
    if (game.remaining <= game.heistAt || game.honey >= game.heistHoney) announce(game, 'heist');
  }
}
function pickTarget(game) {
  const bees = [...game.players.values()].filter(p => !p.stun);
  const player = bees.find(p => !p.bot);
  if (player && game.random() < 0.45) return player.id;
  return bees.length ? bees[Math.floor(game.random() * bees.length)].id : null;
}
function avoidObstacles(game, b) {
  for (const o of OBSTACLES) {
    if (Math.abs(b.x - o.x) > 6 || Math.abs(b.z - o.z) > 6 || game.toppled?.has(o.owner)) continue;
    const c = contact(o, b.x, b.y, b.z), overlap = BUMBLE.radius - c.gap;
    if (overlap <= 0) continue;
    b.x += c.nx * overlap; b.y += c.ny * overlap; b.z += c.nz * overlap;
    if (!b.thud) { b.thud = 1.2; b.oops = 0.5; game.emit({ type: 'bumble-thud', kind: o.kind, x: b.x - c.nx, y: b.y - c.ny, z: b.z - c.nz }); }
  }
}
function flyAway(game, b, dt) {
  b.yaw = wrap(b.yaw + clamp(wrap(Math.atan2(b.x, b.z) - b.yaw), -2 * dt, 2 * dt));
  b.speed = BUMBLE.speed * 1.3;
  b.x += Math.sin(b.yaw) * b.speed * dt; b.z += Math.cos(b.yaw) * b.speed * dt;
  b.y = clamp(b.y + clamp(6 - b.y, -1, 1) * 2 * dt, 1.2, 7.5);
  if (Math.hypot(b.x, b.z) > WORLD.radius + 5) { game.bumble = null; game.emit({ type: 'bumble-leave', mode: b.mode }); }
}

export function tickBumblebee(game, dt) {
  schedule(game, dt);
  const b = game.bumble;
  if (!b) return;
  b.age += dt; b.retarget -= dt;
  for (const key of ['lurch', 'thud', 'oops', 'wobble']) b[key] = Math.max(0, b[key] - dt);
  if (b.mode === 'heist') return tickHeist(game, b, dt);
  if (b.age > BUMBLE.life) b.leaving = true;
  if (b.leaving) { avoidObstacles(game, b); return flyAway(game, b, dt); }
  roam(game, b, dt);
}
// Clumsy flight toward a bee it picked (often the player), knocking over every bee it touches.
function roam(game, b, dt) {
  if (b.retarget <= 0) { b.target = pickTarget(game); b.retarget = 2.6 + game.random() * 2; if (game.random() < 0.3) b.lurch = 0.9; }
  const target = game.players.get(b.target);
  const desired = target ? Math.atan2(target.x - b.x, target.z - b.z) : Math.atan2(-b.x, -b.z);
  // Limited turning plus a wobble makes the flight path clumsy and dodgeable.
  b.yaw = wrap(b.yaw + clamp(wrap(desired - b.yaw), -1.5 * dt, 1.5 * dt) + Math.sin(b.age * 2.1) * 0.9 * dt);
  b.speed = BUMBLE.speed * (b.lurch ? 1.75 : 1) * (b.oops ? 0.4 : 1);
  b.x += Math.sin(b.yaw) * b.speed * dt; b.z += Math.cos(b.yaw) * b.speed * dt;
  if (b.px || b.pz) { b.x += b.px * dt; b.z += b.pz * dt; const fade = Math.exp(-dt * 2.4); b.px *= fade; b.pz *= fade; }
  const altitude = game.cutscene ? 6.8 : (target ? target.y : 3.5) + Math.sin(b.age * 1.7) * 0.9;
  b.y = clamp(b.y + clamp(altitude - b.y, -1, 1) * 2.2 * dt, 1.2, 7.5);
  avoidObstacles(game, b);
  for (const p of game.players.values()) {
    const dx = p.x - b.x, dy = p.y - b.y, dz = p.z - b.z, d = Math.hypot(dx, dy, dz);
    if (d >= BUMBLE.radius + WORLD.beeRadius || p.stun || (game.cutscene && !p.bot)) continue;
    const nx = d ? dx / d : 0, ny = d ? dy / d : 1, nz = d ? dz / d : 0;
    if (p.poke) continue;
    if (!p.bot && game.powerBoosting(p) && p.bag >= SHOVE.cost) { // Power shove: the bumblebee goes flying instead.
      p.bag -= SHOVE.cost; p.poke = 0.6; p.kx += nx * 2; p.kz += nz * 2;
      b.px = -nx * SHOVE.push; b.pz = -nz * SHOVE.push; b.y = Math.min(7.5, b.y + 0.6); b.oops = 1.2; b.shoved = (b.shoved ?? 0) + 1;
      if (b.shoved >= SHOVE.giveUp) b.leaving = true;
      game.emit({ type: 'bumble-shoved', id: p.id, cost: SHOVE.cost, shoves: Math.floor(p.bag / SHOVE.cost), leaving: b.leaving, x: b.x + nx, y: b.y, z: b.z + nz });
      continue;
    }
    p.kx = nx * 8 + Math.sin(b.yaw) * 4; p.ky = 3.5 + ny * 2; p.kz = nz * 8 + Math.cos(b.yaw) * 4;
    p.stun = 2.4; p.angry = 4.5; p.fume = 0;
    const spilled = Math.min(p.bag, 2); p.bag -= spilled;
    b.hits++; b.oops = 0.6;
    game.emit({ type: 'bumble-hit', id: p.id, spilled, x: p.x, y: p.y, z: p.z });
    for (const other of game.players.values()) {
      if (other === p || other.stun || other.angry || Math.hypot(other.x - p.x, other.z - p.z) > BUMBLE.reach) continue;
      other.angry = 3 + game.random() * 1.5;
      if (other.bot) other.fume = 1.3 + game.random() * 0.9;
      game.emit({ type: 'upset', id: other.id });
    }
  }
}

// Second visit: fly to the hive, sit on top, and drink honey. Scouts swarm and poke it, but only
// the player's bumps (HEIST.hits of them) knock it off.
export const heistActive = game => game.bumble?.mode === 'heist' && (game.bumble.phase === 'perched' || (game.bumble.phase === 'approach' && !(game.bumble.roamFor > 0)));
function tickHeist(game, b, dt) {
  const perch = HEIST.perch;
  if (b.phase === 'approach' && b.roamFor > 0) { b.roamFor -= dt; roam(game, b, dt); return; }
  if (b.phase === 'approach') {
    const dx = perch.x - b.x, dz = perch.z - b.z, flat = Math.hypot(dx, dz);
    b.yaw = wrap(b.yaw + clamp(wrap(Math.atan2(dx, dz) - b.yaw), -2.5 * dt, 2.5 * dt) + Math.sin(b.age * 2.1) * 0.35 * dt);
    b.speed = Math.min(BUMBLE.speed * 1.1, flat * 1.6 + 0.6);
    const step = Math.min(flat, b.speed * dt);
    b.x += Math.sin(b.yaw) * step; b.z += Math.cos(b.yaw) * step;
    // Stay above the hive until right over it, then settle down onto the top.
    const altitude = flat > 2.5 ? perch.y + 1.6 : perch.y;
    b.y += clamp(altitude - b.y, -1, 1) * 2.4 * dt;
    if (flat < 0.4 && Math.abs(b.y - perch.y) < 0.25) {
      Object.assign(b, { phase: 'perched', x: perch.x, y: perch.y, z: perch.z, speed: 0 });
      game.emit({ type: 'heist-perch', x: b.x, y: b.y, z: b.z });
    }
  } else if (b.phase === 'perched') {
    b.perched += dt; b.sip += HEIST.drain * dt;
    while (b.sip >= 1) {
      b.sip--;
      if (game.honey > 0) { game.honey--; b.drained++; game.emit({ type: 'heist-drain', drained: b.drained, x: b.x, y: b.y, z: b.z }); }
    }
    if (b.perched > HEIST.patience) { b.phase = 'leaving'; game.emit({ type: 'heist-end', rescued: false, drained: b.drained }); }
  } else if (b.phase === 'falling') {
    b.fall += dt; b.vy -= 11 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.y < 1.5 || b.fall > 1.6) { b.y = Math.max(b.y, 1.5); b.phase = 'leaving'; b.yaw = Math.atan2(b.x, b.z); }
  } else { avoidObstacles(game, b); return flyAway(game, b, dt); }
  for (const p of game.players.values()) {
    const dx = p.x - b.x, dy = p.y - b.y, dz = p.z - b.z, d = Math.hypot(dx, dy, dz), gap = BUMBLE.radius + WORLD.beeRadius;
    if (d >= gap) continue;
    const nx = d ? dx / d : 0, ny = d ? dy / d : 1, nz = d ? dz / d : 0, impact = -(p.vx * nx + p.vy * ny + p.vz * nz);
    // The bumblebee is heavy: bees bounce off it.
    p.x = b.x + nx * gap; p.y = b.y + ny * gap; p.z = b.z + nz * gap;
    const bounce = 2 + Math.max(0, impact) * 0.6; p.kx += nx * bounce; p.ky += ny * bounce * 0.6; p.kz += nz * bounce;
    if (b.phase !== 'perched' || p.poke) continue;
    if (p.bot) {
      if (impact > 1.2) { p.poke = 1.2; b.wobble = Math.max(b.wobble, 0.3); game.emit({ type: 'heist-poke', id: p.id, x: p.x - nx * WORLD.beeRadius, y: p.y - ny * WORLD.beeRadius, z: p.z - nz * WORLD.beeRadius }); }
    } else if (impact > HEIST.impact) {
      // A counted bump throws the player back so the next one needs a fresh run-up.
      // A power boost counts as two bumps.
      p.poke = 0.45; p.recoil = 0.4; p.kx += nx * 6; p.ky += 1.5; p.kz += nz * 6; b.knocks += game.powerBoosting(p) ? 2 : 1; b.wobble = 0.8;
      game.emit({ type: 'heist-hit', id: p.id, hits: b.knocks, needed: HEIST.hits, x: p.x - nx * WORLD.beeRadius, y: p.y - ny * WORLD.beeRadius, z: p.z - nz * WORLD.beeRadius });
      if (b.knocks >= HEIST.hits) {
        Object.assign(b, { phase: 'falling', vx: -nx * 5, vy: 2.5, vz: -nz * 5, fall: 0 });
        game.emit({ type: 'heist-end', rescued: true, by: p.id, drained: b.drained, x: b.x, y: b.y, z: b.z });
      }
    }
  }
}
