import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../src/games/hive/simulation.js';
import { createDemo, DEMO } from '../../src/games/hive/features/demo.js';

// Runs the demo on the bare simulation (no scene, so no camera cutscenes) and records what happened.
function run(seed) {
  let s = seed; const random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const game = new Game({ random }); game.reset(); game.round = 1;
  const player = game.addPlayer(), demo = createDemo(game, player, { random }), seen = new Set(), mine = new Set();
  let t = 0;
  while (!demo.done && t < 100) {
    game.setInput(player.id, demo.update(0.05)); game.tick(0.05); demo.observe(game.events); t += 0.05;
    for (const e of game.events) { seen.add(e.type === 'round-end' ? `round-end:${e.result}` : e.type); if (e.id === player.id) mine.add(e.type); }
  }
  return { plan: demo.plan, t, seen, mine, done: demo.done };
}

test('the demo shows every kind of event within about a minute, in a random order, and ends by itself', () => {
  const runs = [1, 2, 3, 4, 5, 6, 7, 8].map(run);
  for (const r of runs) {
    const where = `seed plan ${JSON.stringify(r.plan)}`;
    assert.ok(r.done && r.t < 75, `${where}: ended after ${r.t.toFixed(1)} s`);
    for (const type of ['bee-item', 'bee-item-collect', 'bee-reinforce', 'topple', 'rain-start', 'wilt', 'deliver', 'wasp-climb', 'wasp-alarm', 'swarm-gathered', 'wasp-hit'])
      assert.ok(r.seen.has(type), `${where}: ${type}`);
    for (const type of ['turbo', 'boost', 'collect', 'deliver']) assert.ok(r.mine.has(type), `${where}: the player's bee showed ${type}`);
    assert.ok(r.seen.has(r.plan.missions.includes('heist') ? 'heist-end' : 'bumble-enter'), `${where}: the bumblebee visited`);
    if (r.plan.ending === 'victory') for (const type of ['wasp-fall', 'wasp-flee', 'wasp-gone', 'round-end:complete']) assert.ok(r.seen.has(type), `${where}: ${type}`);
    else for (const type of ['wasp-kick', 'hive-collapse', 'wasp-wasted', 'round-end:wasted']) assert.ok(r.seen.has(type), `${where}: ${type}`);
  }
  // Randomized: different orders, both bumblebee visits, both endings, with and without defenders.
  assert.ok(new Set(runs.map(r => r.plan.missions.join())).size >= 3, 'the order changes');
  assert.ok(runs.some(r => r.plan.missions.includes('cross')) && runs.some(r => r.plan.missions.includes('heist')), 'both bumblebee visits');
  assert.ok(runs.some(r => r.plan.ending === 'victory') && runs.some(r => r.plan.ending === 'wasted'), 'both endings');
  assert.ok(runs.some(r => r.plan.defenders) && runs.some(r => r.plan.ending === 'victory' && !r.plan.defenders), 'with and without defenders');
  assert.ok(DEMO.cap > 75, 'a hard stop stays behind the normal end');
});

test('in the game: the demo button plays it with a badge, then returns to the landing screen without touching scores', async () => {
  const { Window } = await import('happy-dom');
  const { game: hiveModule } = await import('../../src/games/hive/index.js');
  const browserWindow = new Window(), previous = Object.fromEntries(['window', 'document', 'matchMedia'].map(key => [key, globalThis[key]]));
  globalThis.window = browserWindow; globalThis.document = browserWindow.document; globalThis.matchMedia = () => ({ matches: false });
  browserWindow.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {}, beginPath() {}, roundRect() {}, fill() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const game = new Game({ bots: 4 }); game.best = 1234; let dialogs = 0;
  const hive = hiveModule.create({ renderer: { domElement: document.createElement('canvas'), render() {} }, container, notify() {}, openDialog() { dialogs++; }, closeDialog() {}, game });
  try {
    hive.activate(); hive.resize(800, 600);
    const $ = id => container.querySelector(`#${id}`);
    container.querySelector('#demo').click();
    assert.equal($('demo-badge').hidden, false, 'the demo badge shows');
    assert.equal($('intro').hidden, true);
    const labels = new Set(); let t = 0, wasp = false, ended = -1;
    for (let i = 0; i < 1100 && ended < 0; i++) {
      t += 0.1; hive.update(0.1, t);
      labels.add($('demo-label').textContent); wasp ||= !!game.wasp;
      if (!$('intro').hidden) ended = t;
    }
    assert.ok(ended > 40 && ended < 95, `the demo ended by itself after ${ended.toFixed(0)} s`);
    assert.ok(wasp, 'the wasp came'); assert.ok(labels.size >= 5, `the badge named what happened (${[...labels].join(', ')})`);
    assert.equal($('demo-badge').hidden, true); assert.equal($('flight-hud').hidden, true); assert.equal($('tour-caption').hidden, false);
    assert.ok([...game.players.values()].every(p => p.bot), 'the demo bee is gone');
    assert.equal(game.round, 1); assert.equal(game.best, 1234, 'the session best is untouched'); assert.equal(dialogs, 0, 'no highscore table');
    // Esc ends a running demo at once.
    container.querySelector('#demo').click(); for (let i = 0; i < 30; i++) { t += 0.1; hive.update(0.1, t); }
    document.dispatchEvent(new browserWindow.KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    assert.equal($('intro').hidden, false, 'Esc returns to the landing screen');
  } finally { hive.deactivate(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } browserWindow.happyDOM.abort(); }
});
