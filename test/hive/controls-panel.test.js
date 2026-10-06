import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { game as hiveModule } from '../../src/games/hive/index.js';

test('the side controls panel lists altitude keys, lights held keys, follows the view, and toggles with H', () => {
  const browserWindow = new Window(), previous = Object.fromEntries(['window', 'document', 'matchMedia'].map(key => [key, globalThis[key]]));
  try {
    globalThis.window = browserWindow; globalThis.document = browserWindow.document; globalThis.matchMedia = () => ({ matches: false });
    browserWindow.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {}, beginPath() {}, roundRect() {}, fill() {} });
    const container = document.createElement('div'); document.body.appendChild(container);
    const hive = hiveModule.create({ renderer: { domElement: document.createElement('canvas'), render() {} }, container, notify() {}, openDialog() {}, closeDialog() {} });
    hive.activate(); hive.resize(800, 600);
    const panel = container.querySelector('#controls-panel'), press = (type, code) => document.dispatchEvent(new browserWindow.KeyboardEvent(type, { code }));
    assert.equal(panel.hidden, false, 'visible by default on desktop');
    assert.match(panel.textContent, /▲ Up\s*SPACE/); assert.match(panel.textContent, /▼ Down\s*C/);
    assert.equal(panel.querySelectorAll('.altitude-row kbd').length, 2, 'exactly one key per direction');
    assert.equal(panel.querySelectorAll('.altitude-row').length, 2);
    press('keydown', 'KeyH'); assert.equal(panel.hidden, true);
    container.querySelector('#controls-toggle').click(); assert.equal(panel.hidden, false);
    container.querySelector('#start').click(); hive.update(0.05, 0);
    press('keydown', 'Space');
    assert.ok(panel.querySelector('kbd[data-k="Space"]').classList.contains('held'));
    assert.ok(container.querySelector('.alt-keys kbd[data-k="Space"]').classList.contains('held'), 'the HUD altitude hint lights up too');
    press('keyup', 'Space'); assert.equal(panel.querySelector('kbd[data-k="Space"]').classList.contains('held'), false);
    press('keydown', 'KeyV'); press('keyup', 'KeyV');
    assert.match(panel.textContent, /where you look/); assert.match(panel.textContent, /Garden view/);
    // Sound mixer: master plus channels, a reset button, and sliders that don't steer the bee.
    const sliders = [...panel.querySelectorAll('input[type="range"][data-bus]')];
    assert.deepEqual(sliders.map(s => s.dataset.bus), ['master', 'bees', 'own', 'bumblebee', 'voices', 'effects', 'ambience', 'music']);
    assert.deepEqual([...panel.querySelectorAll('#music-track option')].map(o => o.textContent), ['Synthwave', 'Chill-out', 'Off']);
    const effects = sliders.find(s => s.dataset.bus === 'effects');
    effects.value = '40'; effects.dispatchEvent(new browserWindow.Event('input'));
    assert.equal(effects.nextElementSibling.textContent, '40%');
    effects.dispatchEvent(new browserWindow.KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    assert.equal(panel.querySelector('kbd[data-k="Space"]').classList.contains('held'), false, 'keys on a slider do not fly the bee');
    container.querySelector('#mixer-reset').click();
    assert.ok(sliders.every(s => s.value === '100' && s.nextElementSibling.textContent === '100%'));
    container.querySelector('#controls-close').click(); assert.equal(panel.hidden, true);
    hive.deactivate();
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    browserWindow.happyDOM.abort();
  }
});
