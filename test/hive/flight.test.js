import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, BOOST, FLOWERS, HEIST, RULES } from '../../src/games/hive/simulation.js';
import { WORLD, OBSTACLES, contact } from '../../src/games/hive/world.js';

const seeded = (seed = 7) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const events = (game, type) => game.events.filter(e => e.type === type);

test('the garden is larger, flowers grow at three heights, and nothing spawns inside an obstacle', () => {
  assert.equal(WORLD.radius, 28);
  const heights = FLOWERS.map(f => f.y);
  assert.ok(Math.min(...heights) < 2.2 && Math.max(...heights) > 4.2, 'low and tall nectar exists');
  for (const f of FLOWERS) for (const o of OBSTACLES.filter(o => o.kind !== 'flower')) assert.ok(contact(o, f.x, f.y, f.z).gap > 1, `flower ${f.id} is reachable`);
});
test('two bees flying into each other bump, separate, and report who hit whom', () => {
  const game = new Game({ bots: 0 }), bee = game.addPlayer(), scout = game.addPlayer(true);
  Object.assign(bee, { x: 10, y: 3, z: 0 }); Object.assign(scout, { x: 13, y: 3, z: 0, bot: true });
  scout.fume = 99; // Hovering scout: only the player moves.
  const bumps = [];
  for (let i = 0; i < 20; i++) { game.setInput(bee.id, { x: 1 }); game.tick(0.05); bumps.push(...events(game, 'bump')); }
  assert.equal(bumps.length, 1, 'one bump per pair within the cooldown');
  assert.equal(bumps[0].by, bee.id); assert.equal(bumps[0].victim, scout.id);
  assert.ok(Math.hypot(bee.x - scout.x, bee.y - scout.y, bee.z - scout.z) >= WORLD.beeRadius * 2 - 1e-6);
});
test('bees cannot fly through the hive or trees and bonk audibly', () => {
  const game = new Game({ bots: 0 }), bee = game.addPlayer(), thuds = [];
  Object.assign(bee, { x: 9, y: 2, z: 0 });
  for (let i = 0; i < 60; i++) {
    game.setInput(bee.id, { x: -1 }); game.tick(0.05); thuds.push(...events(game, 'thud'));
    assert.ok(Math.hypot(bee.x, bee.z) >= WORLD.hive.radius + WORLD.beeRadius - 1e-6);
  }
  assert.ok(thuds.some(t => t.kind === 'hive'));
  const tree = OBSTACLES.find(o => o.kind === 'tree' && o.shape === 'cylinder');
  Object.assign(bee, { x: tree.x + 4, y: 1.5, z: tree.z, kx: 0, ky: 0, kz: 0 });
  for (let i = 0; i < 60; i++) { game.setInput(bee.id, { x: -1 }); game.tick(0.05); assert.ok(contact(tree, bee.x, bee.y, bee.z).gap >= WORLD.beeRadius - 1e-6); }
});
test('boost lasts much longer and nectar pickups speed up its recharge', () => {
  const game = new Game({ bots: 0 }), bee = game.addPlayer();
  Object.assign(bee, { x: -20, y: 2, z: -5 });
  game.setInput(bee.id, { z: 1, dash: true }); game.tick(0.05);
  let boosted = 0;
  for (let t = 0; t < 4; t += 0.05) { game.setInput(bee.id, { z: 1 }); game.tick(0.05); if (game.boosting(bee)) boosted += 0.05; }
  assert.ok(boosted >= BOOST.duration - 0.15 && BOOST.duration >= 2.5, `boosted for ${boosted.toFixed(2)}s`);
  const waiting = bee.boost, flower = FLOWERS[3];
  Object.assign(bee, { x: flower.x, y: flower.y, z: flower.z }); game.tick(0.05);
  assert.ok(bee.boost < waiting - BOOST.refill + 0.1, 'collecting nectar refilled the boost');
});
test('the bumblebee is announced, arrives mid-round, knocks bees around, and the anger passes', () => {
  const game = new Game({ bots: 6, random: seeded(3) }), bee = game.addPlayer();
  const seen = [];
  let warnedAt = null, enteredAt = null, t = 0;
  while (t < 180 && !game.result) {
    game.setInput(bee.id, { x: 0 }); game.tick(0.05); t += 0.05;
    for (const e of game.events) seen.push({ ...e, t });
    if (warnedAt === null && events(game, 'bumble-warning').length) warnedAt = t;
    if (enteredAt === null && events(game, 'bumble-enter').length) enteredAt = t;
    // Park the bumblebee on a scout to force a collision.
    if (game.bumble?.mode === 'cross' && !seen.some(e => e.type === 'bumble-hit')) {
      const scout = game.players.get(1), buddy = game.players.get(2);
      Object.assign(game.bumble, { x: scout.x, y: scout.y, z: scout.z + 0.5 }); Object.assign(buddy, { x: scout.x + 3, y: scout.y, z: scout.z, stun: 0, angry: 0 });
    }
  }
  assert.ok(warnedAt !== null && enteredAt !== null, 'warning and arrival happened');
  assert.ok(Math.abs(enteredAt - warnedAt - 4) < 0.1, 'four seconds of warning');
  assert.ok(enteredAt > 30 && enteredAt < 120, `arrives mid-round (${enteredAt.toFixed(1)}s)`);
  const hit = seen.find(e => e.type === 'bumble-hit');
  assert.ok(hit, 'a bee got bumped');
  assert.equal(seen.filter(e => e.type === 'bumble-enter' && e.mode === 'cross').length, 1, 'one crossing per round');
  assert.ok(seen.filter(e => e.type === 'bumble-enter' && e.mode === 'heist').length <= 1, 'at most one raid per round');
  assert.ok(seen.some(e => e.type === 'upset' && e.t - hit.t < 0.1), 'nearby bees get upset');
  const victim = game.players.get(hit.id);
  assert.equal(victim.stun, 0); assert.equal(victim.angry, 0);
});
test('a bumblebee hit stuns, spills nectar, and flings the bee', () => {
  const game = new Game({ bots: 0 }), bee = game.addPlayer();
  Object.assign(bee, { x: 10, y: 3, z: 0, bag: 5 });
  game.bumble = { x: 9.2, y: 3, z: 0, yaw: Math.PI / 2, age: 1, retarget: 9, target: bee.id, lurch: 0, thud: 0, oops: 0, leaving: false, hits: 0, speed: 0 };
  game.bumbleDone = true; game.tick(0.05);
  assert.equal(events(game, 'bumble-hit')[0].spilled, 2); assert.equal(bee.bag, 3);
  assert.ok(bee.stun > 2 && Math.hypot(bee.kx, bee.kz) > 6);
  const before = bee.x; for (let i = 0; i < 10; i++) game.tick(0.05);
  assert.ok(bee.x > before + 1, 'flung away from the bumblebee');
});

function raid(seed = 11) {
  const game = new Game({ bots: 6, random: seeded(seed) }), bee = game.addPlayer();
  Object.assign(game, { honey: 200, bumbleDone: true, bumbleGone: 10, heistAt: game.remaining + 1 });
  Object.assign(bee, { x: 20, y: 2, z: 0 });
  const seen = []; let t = 0;
  const run = (seconds, each = () => {}) => { for (let end = t + seconds; t < end; t += 0.05) { each(); game.tick(0.05); seen.push(...game.events.map(e => ({ ...e, t }))); } };
  return { game, bee, seen, run };
}
test('the bumblebee comes back to raid the hive, drains honey, and the scouts swarm it in vain', () => {
  const { game, seen, run } = raid();
  run(16);
  assert.ok(seen.some(e => e.type === 'bumble-warning' && e.mode === 'heist'), 'announced');
  assert.ok(seen.some(e => e.type === 'heist-perch'), 'sits on the hive');
  const b = game.bumble; assert.equal(b.phase, 'perched'); assert.deepEqual([b.x, b.y, b.z], [HEIST.perch.x, HEIST.perch.y, HEIST.perch.z]);
  const before = game.honey; run(4);
  assert.ok(before - game.honey >= 9 && before - game.honey <= 11, `drains about ${HEIST.drain}/s (${before - game.honey})`);
  const scouts = [...game.players.values()].filter(p => p.bot), near = scouts.filter(p => Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) < 4);
  assert.ok(near.length >= 4, `scouts swarm the thief (${near.length} close)`);
  assert.ok(seen.some(e => e.type === 'heist-poke'), 'scouts poke it'); assert.equal(b.knocks, 0); assert.equal(game.bumble.phase, 'perched', 'scouts alone cannot knock it off');
});
test('three bumps by the player knock the thief off the hive and stop the drain', () => {
  const { game, bee, seen, run } = raid(5);
  run(16);
  assert.equal(game.bumble.phase, 'perched');
  Object.assign(bee, { x: 3.5, y: HEIST.perch.y, z: 0, kx: 0, ky: 0, kz: 0 });
  // Keep ramming: each bounce sends the bee back, and every fresh bump counts.
  run(6, () => { if (game.bumble?.phase === 'perched') game.setInput(bee.id, { x: game.bumble.x - bee.x, y: game.bumble.y - bee.y, z: game.bumble.z - bee.z }); });
  const hits = seen.filter(e => e.type === 'heist-hit');
  assert.equal(hits.length, HEIST.hits, 'exactly three bumps were needed');
  assert.deepEqual(hits.map(h => h.hits), [1, 2, 3]);
  assert.ok(hits.every((h, i) => !i || h.t - hits[i - 1].t >= 0.45), 'one bump per bounce');
  const end = seen.find(e => e.type === 'heist-end');
  assert.ok(end?.rescued && end.by === bee.id, 'rescued by the player');
  const honey = game.honey; run(1.5); assert.equal(game.honey, honey, 'no more draining');
  run(14); assert.equal(game.bumble, null, 'it flew away');
  assert.ok(seen.some(e => e.type === 'bumble-leave' && e.mode === 'heist'));
});
test('an unchallenged thief leaves on its own with the honey it drank', () => {
  const { game, seen, run } = raid(9);
  run(16 + HEIST.patience + 1);
  const end = seen.find(e => e.type === 'heist-end');
  assert.ok(end && !end.rescued); assert.ok(Math.abs(end.drained - HEIST.drain * HEIST.patience) <= 2, `drained ${end.drained}`);
  assert.ok(game.honey >= 0);
});
test('the tour bumblebee charges straight into a group of scouts', async () => {
  const { releaseBumblebee } = await import('../../src/games/hive/features/bumblebee.js');
  const game = new Game({ bots: 6, random: seeded(2) });
  for (let i = 0; i < 100; i++) game.tick(0.05);
  const b = releaseBumblebee(game); assert.ok(b && b.mode === 'cross');
  assert.equal(releaseBumblebee(game), null, 'only one at a time');
  const hits = [];
  for (let i = 0; i < 80; i++) { game.tick(0.05); hits.push(...game.events.filter(e => e.type === 'bumble-hit')); }
  assert.ok(hits.length >= 1, `knocked ${hits.length} scouts within 4 s`);
});

test('enough nectar charges a power boost that is used up by the next boost', async () => {
  const { POWER } = await import('../../src/games/hive/simulation.js');
  const game = new Game({ bots: 0 }), bee = game.addPlayer(), ready = [];
  for (let i = 0; i < POWER.need; i++) {
    const f = FLOWERS[i * 4]; Object.assign(bee, { x: f.x, y: f.y, z: f.z, collect: 0 }); game.tick(0.05);
    ready.push(...game.events.filter(e => e.type === 'power-ready'));
  }
  assert.equal(ready.length, 1); assert.equal(bee.powered, true);
  Object.assign(bee, { x: 20, y: 6, z: 0 });
  game.setInput(bee.id, { z: 1, dash: true }); game.tick(0.05);
  assert.ok(game.powerBoosting(bee));
  for (let t = 0; t < BOOST.duration + 0.2; t += 0.05) { game.setInput(bee.id, { z: 0.01 }); game.tick(0.05); }
  assert.equal(bee.powered, false, 'used up'); assert.equal(bee.power, 0);
});
test('a power boost smashes through trees, which stand up again a moment later', async () => {
  const { POWER } = await import('../../src/games/hive/simulation.js');
  const game = new Game({ bots: 0 }), bee = game.addPlayer(), tree = OBSTACLES.find(o => o.kind === 'tree' && o.shape === 'cylinder');
  const charge = () => Object.assign(bee, { x: tree.x + 5, y: 1.5, z: tree.z, powered: true, boost: 0, kx: 0, ky: 0, kz: 0 });
  charge(); const seen = [];
  for (let i = 0; i < 20; i++) { game.setInput(bee.id, { x: -1, dash: i === 0 }); game.tick(0.05); seen.push(...game.events); }
  const topple = seen.find(e => e.type === 'topple');
  assert.ok(topple && topple.owner === tree.owner && topple.kind === 'tree', 'tree knocked over');
  assert.ok(bee.x < tree.x - 1, 'flew straight through');
  for (let t = 0; t < POWER.topple + POWER.rise + 0.2; t += 0.05) { game.setInput(bee.id, { x: 0.01 }); game.tick(0.05); seen.push(...game.events); }
  assert.ok(seen.some(e => e.type === 'restore' && e.owner === tree.owner), 'stands up again'); assert.equal(game.toppled.size, 0);
  // Without power the same tree blocks and only bonks.
  Object.assign(bee, { x: tree.x + 5, y: 1.5, z: tree.z, powered: false, boost: 0 }); const later = [];
  for (let i = 0; i < 20; i++) { game.setInput(bee.id, { x: -1, dash: i === 0 }); game.tick(0.05); later.push(...game.events); assert.ok(contact(tree, bee.x, bee.y, bee.z).gap >= WORLD.beeRadius - 1e-6); }
  assert.ok(!later.some(e => e.type === 'topple'));
});
test('a power bump sends the other bee much farther than a normal bump', () => {
  const push = powered => {
    const game = new Game({ bots: 0 }), bee = game.addPlayer(), scout = game.addPlayer(true);
    Object.assign(bee, { x: 10, y: 3, z: 0, powered }); Object.assign(scout, { x: 12.5, y: 3, z: 0, fume: 99 });
    let bump;
    for (let i = 0; i < 20 && !bump; i++) { game.setInput(bee.id, { x: 1, dash: i === 0 }); game.tick(0.05); bump = game.events.find(e => e.type === 'bump'); }
    const start = scout.x; for (let i = 0; i < 20; i++) game.tick(0.05);
    return { bump, flown: scout.x - start, stunned: scout.stun };
  };
  const normal = push(false), power = push(true);
  assert.ok(power.bump.power && !normal.bump.power);
  assert.ok(power.flown > normal.flown * 2.5, `${power.flown.toFixed(1)} vs ${normal.flown.toFixed(1)}`);
});
test('a power boost shoves the crossing bumblebee away for 2 nectar per shove', async () => {
  const { SHOVE } = await import('../../src/games/hive/simulation.js');
  const shove = bag => {
    const game = new Game({ bots: 0 }), bee = game.addPlayer();
    Object.assign(game, { bumbleDone: true, heistDone: true });
    game.bumble = { mode: 'cross', phase: 'roam', x: 10, y: 3, z: 0, yaw: -Math.PI / 2, age: 1, retarget: 9, target: null, lurch: 0, thud: 0, oops: 0, wobble: 0, leaving: false, hits: 0, speed: 0, knocks: 0, px: 0, pz: 0 };
    Object.assign(bee, { x: 8.4, y: 3, z: 0, bag, powered: true, boost: BOOST.cooldown });
    const seen = []; for (let i = 0; i < 4; i++) { game.setInput(bee.id, { x: 1 }); game.tick(0.05); seen.push(...game.events); }
    return { game, bee, seen };
  };
  const strong = shove(5);
  const event = strong.seen.find(e => e.type === 'bumble-shoved');
  assert.ok(event, 'shoved'); assert.equal(strong.bee.bag, 5 - SHOVE.cost); assert.equal(event.shoves, 1, 'one shove left');
  assert.equal(strong.bee.stun, 0, 'the player is not knocked'); assert.ok(strong.game.bumble.px > 5, 'bumblebee pushed away');
  const broke = shove(1);
  assert.ok(!broke.seen.some(e => e.type === 'bumble-shoved') && broke.seen.some(e => e.type === 'bumble-hit'), 'without nectar the bumblebee wins');
});

test('a heavier load slows the bee progressively, and bigger deliveries score more points', async () => {
  const { LOAD, loadFactor, deliveryPoints } = await import('../../src/games/hive/simulation.js');
  assert.equal(loadFactor(LOAD.heavy - 1), 1, 'no penalty below half a bag');
  const steps = [4, 5, 6, 7, 8].map(loadFactor);
  assert.ok(steps.every((f, i) => !i || f < steps[i - 1]), 'slower with every drop');
  assert.ok(1 - steps[0] >= 0.04 && 1 - steps[0] <= 0.08, 'noticeable at half');
  assert.ok(1 - steps.at(-1) >= 0.2 && 1 - steps.at(-1) <= 0.3, 'strongest when full, but not crippling');
  assert.ok(steps[4] - steps[3] < steps[1] - steps[0] - 0 || (steps[3] - steps[4]) > (steps[0] - steps[1]), 'the slowdown accelerates');
  const flight = bag => { const game = new Game({ bots: 0 }), bee = game.addPlayer(); Object.assign(bee, { x: -20, y: 2, z: -5, bag }); for (let i = 0; i < 20; i++) { game.setInput(bee.id, { z: 1 }); game.tick(0.05); } return bee.z + 5; };
  assert.ok(flight(8) < flight(2) * 0.8, 'a full bag flies clearly slower');
  assert.deepEqual(deliveryPoints(3), { points: 30, bonus: 1 }); assert.deepEqual(deliveryPoints(6), { points: 90, bonus: 1.5 }); assert.deepEqual(deliveryPoints(8), { points: 160, bonus: 2 });
  const game = new Game({ bots: 0 }), bee = game.addPlayer();
  Object.assign(bee, { x: 0, y: 2, z: 3, bag: 8 }); game.tick(0.05);
  assert.equal(bee.points, 160); assert.ok(game.events.some(e => e.type === 'deliver' && e.points === 160 && e.bonus === 2));
  game.honey = RULES.goal; game.tick(0.05); assert.equal(game.best, 160); assert.equal(game.newBest, true);
  for (let i = 0; i < 125; i++) game.tick(0.1);
  assert.equal(bee.points, 0, 'points reset each round'); assert.equal(game.best, 160, 'best kept for the session');
});
