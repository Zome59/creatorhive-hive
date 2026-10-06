import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import * as THREE from 'three';
import { LINES, createPicker } from '../../src/games/hive/features/speech/lines.js';
import { createReactions } from '../../src/games/hive/features/speech/reactions.js';
import { createBubbles } from '../../src/games/hive/features/speech/bubbles.js';
import { Game } from '../../src/games/hive/simulation.js';

test('comic lines are English, short, and never repeat back to back', () => {
  for (const list of Object.values(LINES)) for (const line of list) assert.ok(line.length > 1 && line.length <= 40 && !/[äöüß]/i.test(line), line);
  assert.ok(LINES.victim.includes('Too much honey for breakfast?'));
  const pick = createPicker(); let previous;
  for (let i = 0; i < 200; i++) { const line = pick(LINES.victim); assert.notEqual(line, previous); previous = line; }
});
test('scouts talk back after bumps while the player bee stays quiet', () => {
  const game = new Game({ bots: 2 }), player = game.addPlayer(), react = createReactions({ random: () => 0.1 });
  const scout = game.players.get(1);
  const said = react([{ type: 'bump', by: player.id, victim: scout.id, impact: 3, x: 1, y: 2, z: 1 }], game);
  assert.ok(said.some(a => a.kind === 'pow'));
  const speech = said.filter(a => a.kind === 'say');
  assert.deepEqual(speech.map(a => a.id), [scout.id]); assert.ok(speech[0].voice);
  const scouts = react([{ type: 'bump', by: 1, victim: 2, impact: 3, x: 1, y: 2, z: 1 }], game).filter(a => a.kind === 'say');
  assert.deepEqual(scouts.map(a => a.id), [2, 1], 'victim complains, then the other scout replies');
  assert.ok(scouts[1].delay > (scouts[0].delay ?? 0));
});
test('upset reactions to the bumblebee are rate limited', () => {
  const game = new Game({ bots: 6 }), react = createReactions({ random: () => 0.3 });
  const said = react([1, 2, 3, 4, 5, 6].map(id => ({ type: 'upset', id })), game).filter(a => a.kind === 'say');
  assert.ok(said.length >= 2 && said.length <= 4);
  assert.ok(said.every(a => a.style === 'shout'));
});
test('speech bubbles follow their speaker on screen and expire', () => {
  const window = new Window(), previous = globalThis.document; globalThis.document = window.document;
  try {
    const layer = document.createElement('div'), bubbles = createBubbles(layer);
    const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100); camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const position = new THREE.Vector3(1, 0, 0);
    bubbles.say(7, 'Watch it, buddy!');
    bubbles.update(0.016, camera, 800, 400, () => position);
    const anchor = layer.querySelector('.bubble-anchor');
    assert.equal(anchor.textContent, 'Watch it, buddy!'); assert.equal(anchor.hidden, false);
    const first = anchor.style.transform; position.x = -2; bubbles.update(0.016, camera, 800, 400, () => position);
    assert.notEqual(anchor.style.transform, first);
    bubbles.say(7, 'Replaced!'); bubbles.update(0.016, camera, 800, 400, () => position);
    assert.equal(layer.querySelectorAll('.bubble-anchor').length, 1, 'one bubble per speaker');
    for (let i = 0; i < 300; i++) bubbles.update(0.05, camera, 800, 400, () => position);
    assert.equal(layer.children.length, 0);
    bubbles.say(8, '<b>not html</b>'); bubbles.update(0.016, camera, 800, 400, () => position);
    assert.equal(layer.querySelector('b'), null, 'text is never parsed as HTML');
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; window.happyDOM.abort(); }
});
