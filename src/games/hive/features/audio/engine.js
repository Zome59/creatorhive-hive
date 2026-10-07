import { HIVE_SOUNDS, MIXER, MIX_MAX, soundFiles } from './manifest.js';

const BASE = import.meta.env?.BASE_URL ?? '/';
const SETTINGS = new Map(HIVE_SOUNDS.map(sound => [sound.name, sound]));
// Inverse distance model: full volume within REF of the player bee, then falling off smoothly.
export const SPATIAL = Object.freeze({ ref: 2, rolloff: 2, max: 80 }); // gentle: bees get louder as they near, without jumping out
export const distanceGain = d => SPATIAL.ref / (SPATIAL.ref + SPATIAL.rolloff * (Math.min(Math.max(d, SPATIAL.ref), SPATIAL.max) - SPATIAL.ref));

// Encoder padding can leave a few silent samples at the ends of an MP3; loops skip them.
export function loopBounds(buffer, threshold = 0.003) {
  const data = buffer.getChannelData(0), rate = buffer.sampleRate;
  let start = 0, end = data.length - 1;
  while (start < end && Math.abs(data[start]) < threshold) start++;
  while (end > start && Math.abs(data[end]) < threshold) end--;
  return { start: start / rate, end: (end + 1) / rate };
}

function defaultContext() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  return Context ? new Context({ latencyHint: 'interactive' }) : null;
}
async function defaultLoad(file) {
  const response = await fetch(`${BASE}games/hive/audio/${file}.mp3`);
  if (!response.ok) throw new Error(`${file}: ${response.status}`);
  return response.arrayBuffer();
}

// Created on the first play gesture. Loops are keyed (one buzz per bee); one-shots are fire-and-forget.
export function createHiveAudio({ createContext = defaultContext, load = defaultLoad, random = Math.random } = {}) {
  let context = null, master, enabled = false, running = false, volume = 1.8, mix = 1;
  const buffers = new Map(), loops = new Map(), voices = new Set(), buses = new Map(), requested = new Set();
  const levels = new Map(MIXER.map(channel => [channel.id, 1]));
  const output = bus => buses.get(bus) ?? master;
  // Sliders follow the ear: the gain is the slider squared (50 % ≈ -12 dB, 150 % ≈ +7 dB).
  const gainOf = level => level * level;
  function setup() {
    if (context) return context;
    try {
      context = createContext(); if (!context) return null;
      master = context.createGain(); master.gain.value = 0;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -6; compressor.knee.value = 8; compressor.ratio.value = 3; // only catches peaks, so the sliders keep their effect
      master.connect(compressor); compressor.connect(context.destination);
      // One gain per mixer channel, all feeding the master (whose level is the master slider).
      for (const channel of MIXER) if (channel.id !== 'master') { const bus = context.createGain(); bus.gain.value = gainOf(levels.get(channel.id)); bus.connect(master); buses.set(channel.id, bus); }
    } catch { context = null; master = null; return null; } // No Web Audio: the game stays silent.
    for (const file of HIVE_SOUNDS.filter(sound => !sound.lazy).flatMap(soundFiles)) fetchFile(file);
    return context;
  }
  function fetchFile(file) {
    if (requested.has(file)) return; requested.add(file);
    Promise.resolve().then(() => load(file)).then(data => context.decodeAudioData(data)).then(buffer => buffers.set(file, buffer)).catch(() => requested.delete(file));
  }
  function buffer(name) {
    const sound = SETTINGS.get(name); if (!sound) return null;
    if (sound.lazy) soundFiles(sound).forEach(fetchFile); // Big files (music) load on first use.
    const files = soundFiles(sound).filter(file => buffers.has(file));
    return files.length ? buffers.get(files[Math.floor(random() * files.length)]) : null;
  }
  function panner() {
    const node = context.createPanner();
    // Plain stereo panning: HRTF colours every sound by direction and makes the buzz sound muffled and filtered.
    Object.assign(node, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: SPATIAL.ref, rolloffFactor: SPATIAL.rolloff, maxDistance: SPATIAL.max });
    return node;
  }
  function place(node, { x, y, z }, smooth = true) {
    if (node.positionX) {
      const t = context.currentTime;
      for (const [param, value] of [[node.positionX, x], [node.positionY, y], [node.positionZ, z]]) smooth ? param.setTargetAtTime(value, t, 0.03) : param.setValueAtTime(value, t);
    } else node.setPosition(x, y, z);
  }
  // `mix` scales everything (quiet on the landing screen); `fade` is the time constant of the change.
  function apply(fade = 0.05) {
    if (!master) return;
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setTargetAtTime(enabled ? volume * gainOf(levels.get('master')) * mix : 0, context.currentTime, fade);
  }
  function stopLoop(key) {
    const loop = loops.get(key); if (!loop) return;
    try { loop.source.stop(); } catch {}
    loop.source.disconnect(); loop.gain.disconnect(); loop.panner?.disconnect(); loops.delete(key);
  }
  return {
    get enabled() { return enabled; },
    // True once the browser actually lets the sound play (some block it until the first click or key).
    get playing() { return !!context && context.state === 'running'; },
    get ready() { return buffers.size > 0; },
    level(id) { return levels.get(id) ?? 1; },
    // Mixer slider: 0 (silent) to MIX_MAX; applies immediately and to sounds created later.
    setLevel(id, value) {
      if (!levels.has(id) || !Number.isFinite(value)) return;
      levels.set(id, Math.max(0, Math.min(MIX_MAX, value)));
      if (id === 'master') apply();
      else if (buses.has(id)) buses.get(id).gain.setTargetAtTime(gainOf(levels.get(id)), context.currentTime, 0.03);
    },
    resetLevels() { for (const id of levels.keys()) this.setLevel(id, 1); },
    // Overall scale with a soft transition, e.g. 0.3 on the landing screen fading to 1 when play starts.
    setMix(value, seconds = 0.6) { mix = Math.max(0, Math.min(1, value)); apply(Math.max(0.01, seconds / 3)); },
    // Must be called from a user gesture the first time so browsers allow playback.
    setEnabled(value) {
      enabled = !!value;
      if (enabled && setup()) { running = true; Promise.resolve(context.resume()).catch(() => {}); }
      apply();
    },
    suspend() { running = false; if (context) Promise.resolve(context.suspend()).catch(() => {}); },
    resume() { if (enabled && context) { running = true; Promise.resolve(context.resume()).catch(() => {}); } },
    listen({ x, y, z, yaw, pitch = 0 }) {
      if (!context || !running) return;
      const l = context.listener, fx = Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = Math.cos(yaw) * Math.cos(pitch), t = context.currentTime;
      if (l.positionX) {
        for (const [param, value] of [[l.positionX, x], [l.positionY, y], [l.positionZ, z], [l.forwardX, fx], [l.forwardY, fy], [l.forwardZ, fz], [l.upX, 0], [l.upY, 1], [l.upZ, 0]]) param.setTargetAtTime(value, t, 0.03);
      } else { l.setPosition(x, y, z); l.setOrientation(fx, fy, fz, 0, 1, 0); }
    },
    play(name, at = null, { gain = 1, rate = 1, delay = 0, bus } = {}) {
      if (!enabled || !running || !context || voices.size > 28) return false;
      const data = buffer(name); if (!data) return false;
      const source = context.createBufferSource(), level = context.createGain(), node = at ? panner() : null;
      source.buffer = data; source.playbackRate.value = rate * (0.95 + random() * 0.1);
      level.gain.value = gain * SETTINGS.get(name).gain;
      source.connect(level);
      const target = output(bus ?? SETTINGS.get(name).bus);
      if (node) { place(node, at, false); level.connect(node); node.connect(target); } else level.connect(target);
      const voice = { source }; voices.add(voice);
      source.onended = () => { voices.delete(voice); source.disconnect(); level.disconnect(); node?.disconnect(); };
      source.start(context.currentTime + delay);
      return true;
    },
    // Creates the loop on first use, then updates its position, volume, and pitch every frame.
    loop(key, name, { x, y, z, gain = 1, rate = 1, spatial = true, bus } = {}) {
      if (!enabled || !running || !context) return false;
      let loop = loops.get(key);
      if (!loop) {
        const data = buffer(name); if (!data) return false;
        const source = context.createBufferSource(), level = context.createGain(), node = spatial ? panner() : null, bounds = loopBounds(data);
        Object.assign(source, { buffer: data, loop: true, loopStart: bounds.start, loopEnd: bounds.end });
        level.gain.value = 0; source.connect(level);
        const target = output(bus ?? SETTINGS.get(name).bus);
        if (node) { place(node, { x, y, z }, false); level.connect(node); node.connect(target); } else level.connect(target);
        source.start(0, bounds.start + random() * (bounds.end - bounds.start));
        loop = { source, gain: level, panner: node, name }; loops.set(key, loop);
      }
      const t = context.currentTime;
      loop.gain.gain.setTargetAtTime(gain * SETTINGS.get(name).gain, t, 0.08);
      loop.source.playbackRate.setTargetAtTime(rate, t, 0.08);
      if (loop.panner) place(loop.panner, { x, y, z });
      return true;
    },
    // Stops every loop whose key was not refreshed this frame (bees that left, the bumblebee).
    keep(keys) { for (const key of [...loops.keys()]) if (!keys.has(key)) stopLoop(key); },
    // Short synthesized chime for round results; no file needed.
    chime(frequency = 880) {
      if (!enabled || !running || !context) return;
      const oscillator = context.createOscillator(), level = context.createGain(), t = context.currentTime;
      oscillator.frequency.value = frequency; oscillator.connect(level); level.connect(master);
      level.gain.setValueAtTime(0.06, t); level.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      oscillator.start(t); oscillator.stop(t + 0.4);
    },
    stopAll() { for (const key of [...loops.keys()]) stopLoop(key); for (const voice of [...voices]) { try { voice.source.stop(); } catch {} } },
  };
}
