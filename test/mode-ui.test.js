import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameHost } from '../src/game-host.js';
import { game as hiveModule } from '../src/games/hive/index.js';
import { RULES } from '../src/games/hive/simulation.js';
import { game as officeModule } from '../src/games/worker-bee/index.js';
import { Window } from 'happy-dom';

test('office replaces all garden overlays and switching back preserves the garden HUD state', () => {
  const browserWindow = new Window();
  const previous = Object.fromEntries(['window', 'document', 'matchMedia'].map(key => [key, globalThis[key]]));
  try {
    globalThis.window = browserWindow;
    globalThis.document = browserWindow.document;
    globalThis.matchMedia = () => ({ matches: true });
    browserWindow.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, roundRect() {}, fill() {} });

    document.body.innerHTML = '<div id="world"></div><div id="game-ui"></div><section id="controls"></section><nav></nav><section class="arena"></section>';
    const layer = document.getElementById('game-ui');
    const canvas = document.createElement('canvas'); document.getElementById('world').appendChild(canvas);
    const renderer = { domElement: canvas, render() {} };
    const host = createGameHost({ games: [hiveModule, officeModule], renderer, container: layer,
      controls: document.getElementById('controls'), navigation: document.querySelector('nav'), arena: document.querySelector('.arena'), notify() {}, openDialog() {}, closeDialog() {} });
    host.select('hive');
    const garden = document.getElementById('garden-ui');
    document.getElementById('start').click(); host.update(0.05, 0);
    const intro = document.getElementById('intro'), inventory = document.getElementById('flight-hud');
    assert.equal(layer.children.length, 1);
    assert.equal(document.querySelector('.office-ui'), null, 'inactive office UI must not appear in the garden');

    for (let visit = 0; visit < 3; visit++) {
      host.select('worker-bee');
      assert.equal(layer.children.length, 1);
      for (const selector of ['.arena-top', '.scene-label', '#timer', '#honey', '#flight-hud', '#touch-controls']) {
        assert.equal(document.querySelector(selector), null, `${selector} must not carry into the office`);
      }
      const officePanel = document.querySelector('.office-ui');
      assert.equal(officePanel.hidden, false);
      assert.match(officePanel.textContent, /WORKER BEE SIM/);
      assert.doesNotMatch(officePanel.textContent, /GARDEN_01|nectar drop-off|YOUR NECTAR/);
      officePanel.querySelector('[data-office="start"]').click();
      host.update(0.05, 0);
      assert.equal(officePanel.querySelector('[data-office="intro"]').hidden, true);
      assert.match(officePanel.querySelector('[data-office="task"]').textContent, /Sit at the report computer/);

      host.select('hive');
      assert.equal(document.querySelector('.office-ui'), null);
      assert.equal(document.getElementById('intro'), intro);
      assert.equal(intro.hidden, true, 'switching must not restart the garden');
      assert.equal(inventory.hidden, false, 'the active garden inventory must return');
      assert.equal(document.getElementById('timer').textContent, `${Math.floor(RULES.duration / 60)}:${String(RULES.duration % 60).padStart(2, '0')}`, 'the clock still shows the full round');
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
    browserWindow.happyDOM.abort();
  }
});
