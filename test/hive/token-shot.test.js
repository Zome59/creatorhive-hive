import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { game as hiveModule } from '../../src/games/hive/index.js';
import { Game } from '../../src/games/hive/simulation.js';
import { FLOWERS } from '../../src/games/hive/world.js';
import { BEE_ITEM } from '../../src/games/hive/features/bee-items.js';
import { STREAM_INFO } from '../../src/games/hive/world.js';

// The real scene with a mocked renderer; the camera is read from what gets rendered.
function mount() {
  const browserWindow = new Window(), previous = Object.fromEntries(['window', 'document', 'matchMedia'].map(key => [key, globalThis[key]]));
  globalThis.window = browserWindow; globalThis.document = browserWindow.document; globalThis.matchMedia = () => ({ matches: false });
  browserWindow.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {}, beginPath() {}, roundRect() {}, fill() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  let camera = null; const game = new Game({ bots: 3 });
  const hive = hiveModule.create({ renderer: { domElement: document.createElement('canvas'), render(s, c) { camera = c; } }, container, notify() {}, openDialog() {}, closeDialog() {}, game });
  hive.activate(); hive.resize(800, 600); hive.update(0.05, 0);
  const restore = () => { hive.deactivate(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } browserWindow.happyDOM.abort(); };
  return { hive, game, container, get camera() { return camera; }, restore };
}

test('a new bee token: the camera glides over to it and back while the round clock waits', () => {
  const m = mount();
  try {
    m.container.querySelector('#start').click();
    let t = 0; const step = (seconds = 0.05) => { for (let s = 0; s < seconds - 1e-9; s += 0.05) { t += 0.05; m.hive.update(0.05, t); } };
    step(10); // past the start flight
    const player = [...m.game.players.values()].find(p => !p.bot);
    const flower = FLOWERS.reduce((a, b) => Math.hypot(b.x - player.x, b.z - player.z) > Math.hypot(a.x - player.x, a.z - player.z) ? b : a);
    const at = { x: flower.x, y: flower.y + BEE_ITEM.lift, z: flower.z };
    m.game.beeItem = { ...at, life: BEE_ITEM.life, flower: flower.id }; m.game.emit({ type: 'bee-item', ...at });
    const toToken = () => Math.hypot(m.camera.position.x - at.x, m.camera.position.y - at.y, m.camera.position.z - at.z);
    const before = toToken();
    step(0.1); const clock = m.game.remaining;
    assert.equal(m.container.querySelector('#letterbox').hidden, false, 'letterbox while the camera shows the token');
    step(1.6);
    assert.ok(toToken() < 18 && toToken() < before - 8, `camera close to the token (${toToken().toFixed(1)} m, was ${before.toFixed(1)} m)`);
    step(1.6);
    assert.equal(m.game.remaining, clock, 'the round clock stood still during the ride');
    assert.ok(m.game.beeItem?.life > BEE_ITEM.life - 0.2, 'the token did not lose time either (only the frame it appeared in)');
    step(1);
    const toPlayer = Math.hypot(m.camera.position.x - player.x, m.camera.position.y - player.y, m.camera.position.z - player.z);
    assert.ok(Math.abs(toPlayer - 42) < 4, `back on your bee in the garden view (${toPlayer.toFixed(1)} m)`);
    assert.equal(m.container.querySelector('#letterbox').hidden, true); assert.equal(m.game.cutscene, 0);
    step(1); assert.ok(m.game.remaining < clock, 'the clock runs again');
  } finally { m.restore(); }
});

// A minimal Web Audio stand-in: records where the listener and the positioned sounds are placed.
function fakeAudio() {
  const param = (value = 0) => ({ value, setTargetAtTime(v) { this.value = v; }, setValueAtTime(v) { this.value = v; }, cancelScheduledValues() {}, exponentialRampToValueAtTime() {} });
  const node = extra => ({ out: [], connect(target) { this.out.push(target); }, disconnect() {}, ...extra });
  const made = { context: null, panners: [], sources: [] };
  class Context {
    constructor() { made.context = this; this.state = 'running'; this.currentTime = 0; this.destination = node(); this.listener = Object.fromEntries(['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'].map(k => [k, param()])); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    createGain() { return node({ gain: param(1) }); }
    createDynamicsCompressor() { return node({ threshold: param(), knee: param(), ratio: param() }); }
    createPanner() { const p = node({ positionX: param(), positionY: param(), positionZ: param() }); made.panners.push(p); return p; }
    createBufferSource() { const s = node({ playbackRate: param(1), start() {}, stop() {} }); made.sources.push(s); return s; }
    createOscillator() { return node({ frequency: param(), start() {}, stop() {} }); }
    decodeAudioData() { const data = new Float32Array(4410).fill(0.2); return Promise.resolve({ sampleRate: 44100, getChannelData: () => data }); }
  }
  return { Context, made };
}

test('landing screen: the ear sits in the garden where the tour looks, one bee buzzes up close, the waterfall stays far', async () => {
  const fake = fakeAudio(), saved = { AudioContext: globalThis.AudioContext, fetch: globalThis.fetch };
  globalThis.AudioContext = fake.Context; globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  const m = mount();
  try {
    let t = 0;
    for (let i = 0; i < 60; i++) { t += 0.05; m.hive.update(0.05, t); await new Promise(r => setTimeout(r, 0)); }
    const l = fake.made.context.listener, ear = { x: l.positionX.value, y: l.positionY.value, z: l.positionZ.value };
    const camera = m.camera.position;
    assert.ok(Math.hypot(camera.x, camera.z) > 30, 'the tour camera itself is far outside the island');
    assert.ok(Math.hypot(ear.x, ear.z) < 12, `the ear is in the garden (${Math.hypot(ear.x, ear.z).toFixed(1)} m from the hive)`);
    const positions = fake.made.panners.map(p => ({ x: p.positionX.value, y: p.positionY.value, z: p.positionZ.value }));
    assert.ok(positions.length >= 4, `the other bees and the water are positioned (${positions.length})`);
    // Looping sounds that are not positioned: the garden, the meadow mix, and the scout the tour follows, heard up close.
    const close = fake.made.sources.filter(s => s.loop && !s.out[0]?.out.some(n => n.positionX));
    assert.equal(close.length, 3, `garden, meadow and one close-up bee (${close.length} unpositioned loops)`);
    const lip = STREAM_INFO.lip;
    assert.ok(Math.hypot(lip.x - ear.x, lip.z - ear.z) > 20, 'the waterfall at the rim is far from the ear');
  } finally { m.restore(); globalThis.AudioContext = saved.AudioContext; globalThis.fetch = saved.fetch; }
});
