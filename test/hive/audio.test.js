import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readFileSync } from 'node:fs';
import { HIVE_SOUNDS, MIXER, soundFiles } from '../../src/games/hive/features/audio/manifest.js';
import { createHiveAudio, distanceGain, loopBounds } from '../../src/games/hive/features/audio/engine.js';
import { createSoundscape } from '../../src/games/hive/features/audio/soundscape.js';
import { Game } from '../../src/games/hive/simulation.js';

const files = HIVE_SOUNDS.flatMap(soundFiles);
test('every sound file exists, is a small MP3, and the set stays within budget', () => {
  let effects = 0, music = 0;
  for (const sound of HIVE_SOUNDS) for (const file of soundFiles(sound)) {
    const path = new URL(`../../public/games/hive/audio/${file}.mp3`, import.meta.url), size = statSync(path).size;
    const head = readFileSync(path).subarray(0, 3);
    assert.ok(head.toString('latin1') === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0), `${file} is MP3`);
    // Effects stay tiny; the two music loops are larger and load only when played.
    if (sound.bus === 'music') { music += size; assert.ok(sound.lazy && size < 700 * 1024, `${file} under 700 KiB and lazy`); }
    else { effects += size; assert.ok(size < 80 * 1024, `${file} under 80 KiB`); }
  }
  assert.ok(effects < 400 * 1024, `effects ${(effects / 1024).toFixed(0)} KiB`); assert.ok(music < 1400 * 1024, `music ${(music / 1024).toFixed(0)} KiB`);
  assert.equal(soundFiles(HIVE_SOUNDS.find(s => s.name === 'grumble')).length, 3, 'three gibberish voices');
});
test('no API key or remote audio URL is part of the game code', () => {
  for (const file of ['engine.js', 'manifest.js', 'soundscape.js']) {
    const source = readFileSync(new URL(`../../src/games/hive/features/audio/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /runware|api[_-]?key|https?:\/\//i);
  }
});
test('other bees get quieter with distance from the player bee', () => {
  assert.equal(distanceGain(0.5), 1); assert.ok(distanceGain(3) > distanceGain(8) && distanceGain(8) > distanceGain(25) && distanceGain(25) > 0);
});

// Minimal fake Web Audio context that records nodes.
function fakeContext() {
  const param = value => ({ value, setTargetAtTime(v) { this.value = v; }, setValueAtTime(v) { this.value = v; }, cancelScheduledValues() {} });
  const node = extra => ({ connect() {}, disconnect() {}, ...extra });
  const made = { sources: [], panners: [] };
  const context = { currentTime: 0, state: 'running', destination: {}, made,
    listener: { positionX: param(0), positionY: param(0), positionZ: param(0), forwardX: param(0), forwardY: param(0), forwardZ: param(-1), upX: param(0), upY: param(1), upZ: param(0) },
    createGain: () => { const g = node({ gain: param(1) }); (made.gains ??= []).push(g); return g; }, createDynamicsCompressor: () => node({ threshold: param(0), knee: param(0), ratio: param(0) }),
    createPanner: () => { const p = node({ positionX: param(0), positionY: param(0), positionZ: param(0) }); made.panners.push(p); return p; },
    createBufferSource: () => { const s = node({ playbackRate: param(1), start() { this.started = true; }, stop() { this.stopped = true; } }); made.sources.push(s); return s; },
    createOscillator: () => node({ frequency: param(0), start() {}, stop() {} }),
    decodeAudioData: async () => ({ sampleRate: 100, duration: 1, getChannelData: () => Float32Array.from({ length: 100 }, (_, i) => (i < 3 ? 0 : 0.5)) }),
    resume: async () => {}, suspend: async () => {} };
  return context;
}
test('loops follow every bee, the bumblebee loop only exists while it flies, and muting stops playback', async () => {
  const context = fakeContext(), audio = createHiveAudio({ createContext: () => context, load: async () => new ArrayBuffer(8), random: () => 0.5 });
  audio.setEnabled(true); await new Promise(resolve => setTimeout(resolve, 10));
  const game = new Game({ bots: 3 }), player = game.addPlayer(), soundscape = createSoundscape(audio);
  soundscape.frame(game, player, 0.05, { listener: { x: 0, y: 2, z: 0, yaw: 0 } });
  const loops = context.made.sources.filter(s => s.loop);
  assert.equal(loops.length, 5, 'four bee buzzes plus garden ambience'); assert.ok(loops.every(s => s.loopStart > 0), 'loops skip encoder padding');
  game.bumble = { x: 5, y: 3, z: 5, yaw: 0, speed: 4, age: 1 };
  soundscape.frame(game, player, 0.05, {}); assert.equal(context.made.sources.filter(s => s.loop).length, 6);
  game.bumble = null; soundscape.frame(game, player, 0.05, {});
  assert.equal(context.made.sources.filter(s => s.loop && !s.stopped).length, 5);
  // A scout zipping past close to the player triggers the fly-by.
  const scout = game.players.get(1); Object.assign(scout, { x: player.x + 4, y: player.y, z: player.z, vx: -9, vy: 0, vz: 0 });
  soundscape.frame(game, player, 0.05, {}); const before = context.made.sources.length;
  Object.assign(scout, { x: player.x + 1 }); soundscape.frame(game, player, 0.05, {});
  assert.equal(context.made.sources.length, before + 1, 'pass-by played');
  audio.setEnabled(false); assert.equal(audio.play('bump', { x: 0, y: 0, z: 0 }), false);
  assert.ok(loopBounds({ sampleRate: 100, getChannelData: () => Float32Array.from([0, 0, 0.5, 0.5, 0]) }).start > 0);
});

test('the sound mixer scales master and each channel, clamps levels, and resets to default', async () => {
  const context = fakeContext(), audio = createHiveAudio({ createContext: () => context, load: async () => new ArrayBuffer(8), random: () => 0.5 });
  audio.setEnabled(true); await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(HIVE_SOUNDS.every(sound => MIXER.some(channel => channel.id === sound.bus)), 'every sound has a mixer channel');
  const [master, ...buses] = context.made.gains;
  assert.equal(buses.length >= MIXER.length - 1, true, 'one gain per channel');
  audio.setLevel('master', 0.5); assert.ok(Math.abs(master.gain.value - 0.85 * 0.5) < 1e-9);
  audio.setLevel('effects', 0.4); assert.equal(audio.level('effects'), 0.4);
  assert.ok(buses.some(bus => bus.gain.value === 0.4), 'effects channel gain follows the slider');
  audio.setLevel('voices', 9); assert.equal(audio.level('voices'), 1.5, 'clamped to 150 %');
  audio.setLevel('nope', 0.2); assert.equal(audio.level('nope'), 1);
  audio.resetLevels(); assert.ok(MIXER.every(channel => audio.level(channel.id) === 1)); assert.ok(Math.abs(master.gain.value - 0.85) < 1e-9);
});
