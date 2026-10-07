import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, RULES, FLOWERS, BOOST } from '../src/games/hive/simulation.js';
import { WORLD } from '../src/games/hive/world.js';

test('nectar collects at flowers, caps at eight, and scores only at the hive', () => {
  const game = new Game({ bots: 0 }); const bee = game.addPlayer();
  Object.assign(bee, { x: FLOWERS[0].x, y: FLOWERS[0].y, z: FLOWERS[0].z });
  for (let i = 0; i < 100; i++) game.tick(0.1);
  assert.equal(bee.bag, RULES.capacity); assert.equal(bee.score, 0); assert.equal(game.honey, 0);
  Object.assign(bee, { x: 0, y: 2, z: 3 }); game.tick(0.05);
  assert.equal(bee.bag, 0); assert.equal(bee.score, 8); assert.equal(game.honey, 8);
});
test('movement bounds, stale inputs, and invalid numeric inputs cannot corrupt the world', () => {
  const game = new Game({ bots: 0 }); const bee = game.addPlayer();
  game.setInput(bee.id, { x: Infinity, y: NaN, z: '100' }); game.tick(0.1);
  assert.equal(bee.y, 2); assert.ok(Number.isFinite(bee.x));
  for (let i = 0; i < 150; i++) { game.setInput(bee.id, { x: 1, y: 1, z: 1 }); game.tick(0.1); }
  assert.ok(Math.hypot(bee.x, bee.z) <= RULES.radius + 0.0001); assert.equal(bee.y, WORLD.ceiling);
  // Stale input stops the bee once any collision knockback has faded.
  for (let i = 0; i < 30; i++) game.tick(0.1);
  const x = bee.x; game.tick(0.1); assert.equal(bee.x, x);
});
test('boost has a cooldown and round victory resets inventory and scores', () => {
  const game = new Game({ bots: 0 }); const bee = game.addPlayer();
  game.setInput(bee.id, { x: 1, dash: true }); game.tick(0.05);
  assert.equal(bee.boost, BOOST.cooldown); game.tick(0.05); assert.ok(bee.boost < BOOST.cooldown);
  game.honey = RULES.goal; game.tick(0.05); assert.equal(game.result, 'complete');
  bee.bag = 5; bee.score = 50;
  for (let i = 0; i < 10 * RULES.break + 5; i++) game.tick(0.1);
  assert.equal(game.round, 2); assert.equal(game.result, null); assert.equal(game.honey, 0); assert.equal(bee.bag, 0); assert.equal(bee.score, 0);
});
test('time expiry finishes the round and scouts actually gather and deliver nectar', () => {
  const game = new Game();
  for (let i = 0; i < 600; i++) game.tick(0.1);
  assert.ok(game.honey > 0, 'AI should contribute to the mission');
  game.remaining = 0.01; game.tick(0.05); assert.equal(game.result, 'time');
});
test('all characters use generated aliases and transient simulation state', () => {
  const game = new Game(); const bee = game.addPlayer();
  assert.equal(bee.name, 'Bee 007');
  assert.ok([...game.players.values()].every(p => /^(Bee|Scout) \d+$/.test(p.name)));
  assert.equal(game.addPlayer(), bee, 'only one human player exists in this local world');
});
