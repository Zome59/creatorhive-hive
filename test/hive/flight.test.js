import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, BOOST, FLOWERS } from '../../src/games/hive/simulation.js';
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
    if (game.bumble && !seen.some(e => e.type === 'bumble-hit')) { const scout = game.players.get(1); Object.assign(game.bumble, { x: scout.x, y: scout.y, z: scout.z + 0.5 }); }
  }
  assert.ok(warnedAt !== null && enteredAt !== null, 'warning and arrival happened');
  assert.ok(Math.abs(enteredAt - warnedAt - 4) < 0.1, 'four seconds of warning');
  assert.ok(enteredAt > 30 && enteredAt < 120, `arrives mid-round (${enteredAt.toFixed(1)}s)`);
  const hit = seen.find(e => e.type === 'bumble-hit');
  assert.ok(hit, 'a bee got bumped');
  assert.ok(seen.filter(e => e.type === 'bumble-enter').length === 1, 'one bumblebee per round');
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
