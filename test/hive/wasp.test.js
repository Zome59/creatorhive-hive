import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, RULES } from '../../src/games/hive/simulation.js';
import { WASP, waspHead } from '../../src/games/hive/features/wasp.js';

const seeded = (seed = 11) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// A round that has just reached the wasp's moment (no bumblebee in the way).
function boss({ bots = 6 } = {}) {
  const game = new Game({ bots, random: seeded() }), player = game.addPlayer();
  game.bumbleDone = game.heistDone = true;
  game.remaining = game.waspAt + 0.05;
  return { game, player };
}
const run = (game, seconds, each = () => {}) => { const seen = []; for (let t = 0; t < seconds; t += 0.05) { each(t); game.tick(0.05); seen.push(...game.events); } return seen; };
const types = events => events.map(e => e.type);

test('the wasp climbs over the rim near the end of the round, flips up, and only then raises the alarm', () => {
  const { game } = boss();
  assert.ok(game.waspAt >= WASP.spawnLeft - WASP.jitter && game.waspAt <= WASP.spawnLeft + WASP.jitter, `appears with ${game.waspAt.toFixed(1)} s left`);
  const climb = run(game, 0.2);
  assert.ok(types(climb).includes('wasp-climb')); assert.equal(game.wasp.phase, 'climb');
  assert.ok(game.cutscene > 0, 'the entrance plays as a cutscene');
  assert.ok(Math.hypot(game.wasp.x, game.wasp.z) > 30 && game.wasp.y < 0, 'below the rim at first');
  const entrance = run(game, WASP.climb + WASP.flip + 0.2);
  const order = types(entrance);
  assert.ok(order.indexOf('wasp-flip') < order.indexOf('wasp-alarm'), 'the alarm comes after the flip');
  assert.equal(game.wasp.phase, 'hunt'); assert.ok(game.wasp.y > 5, 'flies just above the treetops');
});

test('the clock stands still during the fight; the wasp catches scouts one after another and knocks them out', () => {
  const { game } = boss();
  run(game, WASP.climb + WASP.flip + 0.3);
  const left = game.remaining, events = run(game, 22);
  assert.equal(game.remaining, left, 'round clock frozen');
  const caught = events.filter(e => e.type === 'wasp-catch'), out = events.filter(e => e.type === 'wasp-ko');
  assert.ok(caught.length >= 2 && out.length >= 2, `${caught.length} caught, ${out.length} knocked out`);
  run(game, 0.8); // let the latest one finish its fall
  const ko = [...game.players.values()].filter(p => p.ko);
  assert.ok(ko.every(p => p.y < 1), 'knocked-out scouts lie on the ground');
});

test('X X X gathers the swarm, again forms the attack formation, the button attacks; the swarm mobs the wasp', () => {
  const { game, player } = boss();
  run(game, WASP.climb + WASP.flip + 0.3);
  assert.equal(game.waspCommand('formation'), false, 'commands only in order');
  assert.ok(game.waspCommand('gather')); assert.equal(game.wasp.swarm, 'gathered');
  run(game, 1.5, () => game.setInput(player.id, {}));
  const members = [...game.players.values()].filter(p => p.swarmSlot >= 0);
  assert.ok(members.length >= 1 && members.every(p => Math.hypot(p.x - player.x, p.z - player.z) < 5), 'the swarm buzzes around the player');
  assert.ok(game.waspCommand('formation')); assert.ok(game.waspCommand('attack')); assert.equal(game.wasp.swarm, 'charging');
  const events = run(game, WASP.ride + 2, () => game.setInput(player.id, {}));
  assert.ok(types(events).includes('wasp-mobbed'), 'the swarm arrives and the wasp is dazed');
});

test('it breaks free every few seconds, shakes the swarm off, and edges closer to the hive', () => {
  const { game, player } = boss();
  run(game, WASP.climb + WASP.flip + 0.3);
  game.waspCommand('gather'); game.waspCommand('formation'); game.waspCommand('attack');
  run(game, WASP.ride + 2, () => game.setInput(player.id, {}));
  const before = Math.hypot(game.wasp.x, game.wasp.z), events = run(game, 10, () => game.setInput(player.id, {}));
  assert.ok(types(events).includes('wasp-shake') && types(events).includes('wasp-advance'));
  assert.ok(Math.hypot(game.wasp.x, game.wasp.z) < before - 2, 'closer to the hive');
});

test('five butt slams from above defeat it: it falls on its back, struggles, rights itself, and flies off; scouts recover', () => {
  const { game, player } = boss();
  run(game, WASP.climb + WASP.flip + 0.3);
  const points = player.points, seen = [];
  for (let n = 0; n < WASP.hits && game.wasp?.phase !== 'fall'; n++) {
    const h = waspHead(game.wasp); Object.assign(player, { x: h.x, y: h.y + 3, z: h.z, stun: 0, kx: 0, ky: 0, kz: 0 });
    assert.ok(game.slamReady(player), 'hovering above the head');
    game.setInput(player.id, { slam: true }); game.tick(0.05); seen.push(...game.events);
    game.setInput(player.id, {}); seen.push(...run(game, WASP.slam.time + 0.1));
  }
  assert.equal(seen.filter(e => e.type === 'wasp-hit').length, WASP.hits);
  assert.equal(game.wasp.phase, 'fall'); assert.equal(player.points, points + WASP.bonus, 'bonus points');
  const after = run(game, WASP.down.fall + WASP.down.struggle + WASP.down.right + WASP.down.leave + 0.5);
  assert.deepEqual(types(after).filter(t => ['wasp-onBack', 'wasp-rightItself', 'wasp-flee', 'wasp-gone'].includes(t)), ['wasp-onBack', 'wasp-rightItself', 'wasp-flee', 'wasp-gone']);
  assert.equal(game.wasp, null); assert.ok([...game.players.values()].every(p => !p.ko), 'everyone back on their wings');
  assert.ok(game.cheer > 0, 'the victory formation lasts a little longer');
  const flying = [...game.players.values()].filter(p => p.bot);
  assert.ok(flying.every(p => !p.caught && Math.hypot(p.x - player.x, p.z - player.z) < 3.5), 'the scouts fly in formation around the player');
  const left = game.remaining; run(game, 1); assert.ok(game.remaining < left, 'the clock runs again');
});

test('a slam needs the player above the head; flying into the wasp gets you swatted', () => {
  const { game, player } = boss();
  run(game, WASP.climb + WASP.flip + 0.3);
  const h = waspHead(game.wasp);
  Object.assign(player, { x: h.x + 4, y: h.y + 3, z: h.z }); assert.equal(game.slamReady(player), false, 'too far to the side');
  Object.assign(player, { x: game.wasp.x, y: game.wasp.y, z: game.wasp.z + 0.5, stun: 0 });
  const events = run(game, 0.1, () => game.setInput(player.id, {}));
  assert.ok(types(events).includes('wasp-swat') && player.stun > 0);
});

test('if it reaches the hive it kicks it in, eats most of the honey, and the round is wasted', () => {
  const { game } = boss({ bots: 0 });
  game.honey = 200;
  const events = []; // with no scouts it heads straight for the honey
  for (let t = 0; t < 60 && !game.result; t += 0.05) { game.tick(0.05); events.push(...game.events); }
  const order = types(events);
  for (const step of ['wasp-approach', 'wasp-kick', 'hive-collapse', 'wasp-eat', 'wasp-leave', 'wasp-wasted', 'round-end']) assert.ok(order.includes(step), step);
  assert.equal(game.result, 'wasted');
  assert.ok(game.honey <= 200 * (1 - WASP.raid.steal) + 1, `honey left ${game.honey}`);
});

test('no wasp after the goal is reached, and a new round schedules it again', () => {
  const { game } = boss();
  game.honey = RULES.goal; game.tick(0.05);
  assert.equal(game.result, 'complete'); run(game, 5); assert.equal(game.wasp, null);
  game.reset(); assert.equal(game.waspDone, false); assert.equal(game.wasp, null);
});

test('with the wasp switched off the round is 3:30 for 400 nectar and no wasp appears', async () => {
  const { MODES } = await import('../../src/games/hive/simulation.js');
  const game = new Game({ bots: 6, random: seeded(), boss: false }); game.addPlayer();
  assert.equal(game.duration, MODES.classic.duration); assert.equal(game.goal, MODES.classic.goal); assert.equal(game.remaining, 210);
  game.bumbleDone = game.heistDone = true; game.remaining = 20; run(game, 15); assert.equal(game.wasp, null, 'no boss');
  game.setBoss(true); game.restartClock(); assert.equal(game.remaining, 240); assert.equal(game.goal, 450); assert.equal(game.waspDone, false);
});

test('the knock-out shot looks past trees: a view through a canopy is swapped for a clear one', async () => {
  const { clearShot } = await import('../../src/games/hive/features/wasp-boss.js');
  const { TREES, OBSTACLES, contact } = await import('../../src/games/hive/world.js');
  const tree = TREES.find(t => t.inside), w = { x: tree.x + 2.5, z: tree.z };
  const through = Math.atan2(tree.x - w.x, tree.z - w.z); // straight through the trunk and the canopy
  const blocked = a => { const ex = w.x + Math.sin(a) * 8, ez = w.z + Math.cos(a) * 8; for (let k = 1; k < 12; k++) { const t = k / 12, x = ex + (w.x - ex) * t, y = 3.6 + (0.8 - 3.6) * t, z = ez + (w.z - ez) * t; if (OBSTACLES.some(o => o.kind !== 'hive' && contact(o, x, y, z).gap < 0.5)) return true; } return false; };
  assert.ok(blocked(through), 'the preferred view is blocked (positive control)');
  const a = clearShot(w, through);
  assert.ok(!blocked(a), 'the chosen view is clear'); assert.notEqual(a, through);
});

test('the wasp climbs up between the rim trees, and the climb camera has a clear view of the edge', async () => {
  const { betweenRimTrees, WASP } = await import('../../src/games/hive/features/wasp.js');
  const { climbEye, lineClear } = await import('../../src/games/hive/features/wasp-boss.js');
  const { TREES } = await import('../../src/games/hive/world.js');
  const rim = TREES.filter(t => !t.inside);
  for (let k = 0; k < 64; k++) {
    const a = betweenRimTrees(k / 64 * Math.PI * 2), x = Math.sin(a) * WASP.rim, z = Math.cos(a) * WASP.rim;
    const nearest = Math.min(...rim.map(t => Math.hypot(t.x - x, t.z - z)));
    assert.ok(nearest > 2.5, `climb spot ${a.toFixed(2)} is ${nearest.toFixed(1)} m from the nearest rim tree`);
    const eye = climbEye(a);
    assert.ok(lineClear(eye, { x, y: 0.4, z }), `clear view of the edge at ${a.toFixed(2)}`);
  }
});
