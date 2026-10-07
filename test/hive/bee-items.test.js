import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, RULES, FLOWERS } from '../../src/games/hive/simulation.js';
import { BEE_ITEM } from '../../src/games/hive/features/bee-items.js';
import { WASP, swarmStrength } from '../../src/games/hive/features/wasp.js';

const seeded = (seed = 5) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const run = (game, seconds, each = () => {}) => { const seen = []; for (let t = 0; t < seconds; t += 0.05) { each(t); game.tick(0.05); seen.push(...game.events); } return seen; };

test('a bee token appears above a flower now and then; only the player picks it up, up to three; it fades if ignored', () => {
  const game = new Game({ bots: 0, random: seeded() }), player = game.addPlayer();
  game.waspDone = true; Object.assign(player, { x: 0, y: 8, z: 26 });
  const appear = run(game, BEE_ITEM.first[1] + 0.2, () => game.setInput(player.id, {}));
  const spawn = appear.find(e => e.type === 'bee-item');
  assert.ok(spawn && game.beeItem, 'appears within the first window');
  const flower = FLOWERS.find(f => f.x === game.beeItem.x && f.z === game.beeItem.z);
  assert.ok(flower && Math.abs(game.beeItem.y - flower.y - BEE_ITEM.lift) < 1e-9, 'floats right above a flower');
  const gone = run(game, BEE_ITEM.life + 0.2, () => game.setInput(player.id, {}));
  assert.ok(gone.some(e => e.type === 'bee-item-gone') && !game.beeItem, 'fades when nobody takes it');
  for (let n = 1; n <= BEE_ITEM.max + 1; n++) {
    game.beeItem = { x: 1, y: 3, z: 1, life: 10 }; Object.assign(player, { x: 1, y: 3, z: 1 });
    game.tick(0.05);
  }
  assert.equal(player.beeItems, BEE_ITEM.max, 'at most three tokens');
});

test('redeemed, five bees crawl out of the hive door, take off, and work like scouts until the round ends', () => {
  const game = new Game({ bots: 6, random: seeded() }), player = game.addPlayer();
  game.waspDone = true; player.beeItems = 1;
  const before = game.players.size, ids = game.redeemBeeItem();
  assert.equal(ids.length, BEE_ITEM.crew); assert.equal(game.players.size, before + BEE_ITEM.crew); assert.equal(player.beeItems, 0);
  const crew = ids.map(id => game.players.get(id));
  assert.ok(crew.every(p => p.bot && p.extra && !p.defender && p.name.startsWith('Helper')));
  assert.ok(crew.every(p => Math.hypot(p.x, p.z) < 3.4 && p.z > 2 && p.y < 1), 'start on the landing board in front of the door');
  run(game, BEE_ITEM.crawl + BEE_ITEM.stagger * BEE_ITEM.crew + 4);
  assert.ok(crew.every(p => !p.crawl && p.y > 1.2), 'all out and flying');
  assert.equal(game.redeemBeeItem(), null, 'no token, no bees');
  game.remaining = 0.01; game.tick(0.05); run(game, RULES.break + 0.2);
  assert.equal(game.players.size, before, 'reinforcements leave after the round');
});

test('during the wasp fight the five come as defenders: they charge with the swarm and count a third more', () => {
  const game = new Game({ bots: 6, random: seeded() }), player = game.addPlayer();
  game.bumbleDone = game.heistDone = true; game.remaining = game.waspAt + 0.05; player.beeItems = 1;
  run(game, WASP.climb + WASP.flip + 0.3);
  assert.equal(game.wasp.phase, 'hunt');
  const events = []; const ids = game.redeemBeeItem(); events.push(...game.events);
  const crew = ids.map(id => game.players.get(id));
  assert.ok(crew.every(p => p.defender && p.name.startsWith('Guard') && p.swarmSlot >= 0), 'defenders join the swarm');
  assert.equal(game.wasp.swarm, 'charging', 'the swarm attacks at once');
  const scouts = [...game.players.values()].filter(p => p.bot && !p.ko && !p.defender && p.swarmSlot >= 0).length;
  assert.ok(Math.abs(swarmStrength(game) - (scouts + BEE_ITEM.crew * 4 / 3)) < 1e-9, 'each defender counts 4/3');
  const seen = run(game, BEE_ITEM.crawl + BEE_ITEM.stagger * BEE_ITEM.crew + WASP.ride + 4, () => game.setInput(player.id, {}));
  assert.ok(seen.some(e => e.type === 'wasp-mobbed'), 'the wasp gets mobbed');
});
