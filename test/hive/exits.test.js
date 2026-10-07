import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { game as hiveModule } from '../../src/games/hive/index.js';
import { Game } from '../../src/games/hive/simulation.js';
import { releaseBumblebee } from '../../src/games/hive/features/bumblebee.js';

// Runs the real scene with a mocked renderer and finds the bumblebee model by its named head.
function mount() {
  const browserWindow = new Window(), previous = Object.fromEntries(['window', 'document', 'matchMedia'].map(key => [key, globalThis[key]]));
  globalThis.window = browserWindow; globalThis.document = browserWindow.document; globalThis.matchMedia = () => ({ matches: false });
  browserWindow.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {}, beginPath() {}, roundRect() {}, fill() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  let scene = null; const game = new Game({ bots: 3 });
  const hive = hiveModule.create({ renderer: { domElement: document.createElement('canvas'), render(s) { scene = s; } }, container, notify() {}, openDialog() {}, closeDialog() {}, game });
  hive.activate(); hive.resize(800, 600); hive.update(0.05, 0);
  const restore = () => { hive.deactivate(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } browserWindow.happyDOM.abort(); };
  return { hive, game, container, get scene() { return scene; }, restore };
}
const rootOf = (scene, name) => { let found = null; scene.traverse(o => { if (!found && o.name === name) found = o; }); while (found && found.parent !== scene) found = found.parent; return found; };

test('the bumblebee does not vanish when it leaves: it shrinks and fades over about a second', () => {
  const { hive, game, container, scene, restore } = mount();
  try {
    container.querySelector('#start').click();
    let t = 0; const step = () => { t += 0.05; hive.update(0.05, t); };
    for (let i = 0; i < 4; i++) step();
    releaseBumblebee(game); for (let i = 0; i < 10; i++) step();
    const model = rootOf(scene, 'bee-head');
    assert.ok(model && model.visible, 'the bumblebee is on screen');
    Object.assign(game.bumble, { x: 32.9, y: 4, z: 0, yaw: Math.PI / 2, leaving: true });
    const frames = [];
    for (let i = 0; i < 40; i++) { step(); frames.push({ sim: !!game.bumble, visible: model.visible, scale: model.scale.x }); }
    const after = frames.filter(f => !f.sim);
    assert.ok(after.length > 20, 'the simulation let it go');
    const fading = after.filter(f => f.visible && f.scale < 0.98 && f.scale > 0.02);
    assert.ok(fading.length >= 10, `still visible and shrinking for a while after leaving (${fading.length} frames)`);
    assert.equal(after.at(-1).visible, false, 'gone in the end'); assert.equal(model.scale.x, 1, 'reset for its next visit');
  } finally { restore(); }
});

test('beating the wasp shows HIVE DEFENDED while the scouts fly in formation; losing the hive fades into WASTED', async () => {
  const { WASP, waspHead } = await import('../../src/games/hive/features/wasp.js');
  const win = mount();
  try {
    const { hive, game, container } = win;
    container.querySelector('#start').click();
    let t = 0; const step = (n = 1) => { for (let i = 0; i < n; i++) { t += 0.05; hive.update(0.05, t); } };
    const key = code => { document.dispatchEvent(new window.KeyboardEvent('keydown', { code, bubbles: true })); document.dispatchEvent(new window.KeyboardEvent('keyup', { code, bubbles: true })); };
    key('KeyW'); step(4);
    game.bumbleDone = game.heistDone = true; game.remaining = game.waspAt + 0.05;
    step(Math.ceil((WASP.climb + WASP.flip + 0.4) / 0.05));
    assert.equal(game.wasp.phase, 'hunt'); assert.equal(container.querySelector('#boss-bar').hidden, false, 'boss bar after the alarm');
    const player = [...game.players.values()].find(p => !p.bot);
    game.wasp.hits = WASP.hits - 1;
    const h = waspHead(game.wasp); Object.assign(player, { x: h.x, y: h.y + 2.5, z: h.z, stun: 0 });
    step(); key('Space'); step(Math.ceil((WASP.slam.time + 0.2) / 0.05));
    assert.equal(game.wasp.phase, 'fall', 'the fifth slam knocks it down');
    step(Math.ceil((WASP.down.fall + WASP.down.struggle + WASP.down.right + 0.5) / 0.05));
    assert.equal(game.wasp.phase, 'flee');
    assert.equal(container.querySelector('#victory').hidden, false, 'HIVE DEFENDED is up');
    assert.match(container.querySelector('#victory-text').textContent, /\+150/);
    step(Math.ceil(5 / 0.05));
    assert.equal(container.querySelector('#victory').hidden, true, 'and goes again');
  } finally { win.restore(); }
  const lose = mount();
  try {
    const { hive, game, container } = lose;
    container.querySelector('#start').click();
    let t = 0; const step = (n = 1) => { for (let i = 0; i < n; i++) { t += 0.05; hive.update(0.05, t); } };
    document.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyW', bubbles: true })); step(4);
    for (const p of game.players.values()) if (p.bot) game.players.delete(p.id); // nobody left to hunt: it heads straight for the honey
    game.honey = 200; game.bumbleDone = game.heistDone = true; game.remaining = game.waspAt + 0.05;
    for (let i = 0; i < 1600 && !game.result; i++) step();
    assert.equal(game.result, 'wasted');
    step(Math.ceil(1.6 / 0.05));
    assert.equal(container.querySelector('#wasted').hidden, false, 'WASTED fades in');
  } finally { lose.restore(); }
});
