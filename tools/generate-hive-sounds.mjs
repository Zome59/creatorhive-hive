// Regenerates Honey Retrieval's sound effects. Development tool only; the game never calls an API.
//
//   RUNWARE_API_KEY=... node tools/generate-hive-sounds.mjs            fetch missing raw clips, then encode
//   RUNWARE_API_KEY=... node tools/generate-hive-sounds.mjs --explore buzz --seeds 1,3,5
//   node tools/generate-hive-sounds.mjs --encode-only                  re-encode from cached raw clips
//
// The key is read from the environment and never written anywhere. Raw WAV downloads stay in the
// git-ignored `.cache/hive-sounds/`; only the small, processed MP3 files in public/ are committed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { HIVE_SOUNDS, soundFiles } from '../src/games/hive/features/audio/manifest.js';

const root = resolve(import.meta.dirname, '..');
const cache = resolve(root, '.cache/hive-sounds');
const output = resolve(root, 'public/games/hive/audio');
const RATE = 44100;
const MODEL = 'mirelo:1@1'; // Mirelo SFX 1.5, text-to-audio, via Runware
const VOICE = 'bytedance:seed-audio@1.0'; // Seed Audio 1.0 for the comic gibberish voices

// Prompts are part of the asset source. `seed` picks the candidate used in the game.
export const RECIPES = {
  // AI buzz clips are noisy; a clean synthesized wingbeat tone carries the bzzzz, the clip adds a hint of texture.
  buzz: { seed: 21, duration: 4, loop: { from: 0.6, length: 2.4 }, tone: { f0: 228, tilt: 0.85, drift: 0.015, flutter: 0.006, tremolo: 0.1, texture: 0.12 }, prompt: 'Seamless steady close-up honeybee wing buzz hovering in place right in front of the microphone, continuous mid-pitched bzzzz hum around 230 Hz, warm, rounded and friendly, constant loudness and pitch for the whole duration, no pauses, dry studio recording, isolated, no background ambience, no music, no speech.' },
  bumble: { seed: 31, duration: 5, loop: { from: 0.8, length: 3.2 }, tone: { f0: 118, tilt: 1.05, drift: 0.03, flutter: 0.01, tremolo: 0.16, texture: 0.1 }, prompt: 'Seamless steady close-up big fuzzy bumblebee hovering, deep heavy low droning wing hum around 120 Hz with a lazy slight wobble, warm and round, constant loudness for the whole duration, no pauses, dry studio recording, isolated, no background ambience, no music, no speech.' },
  garden: { seed: 44, duration: 10, loop: { from: 1, length: 7 }, prompt: 'Very quiet, calm outdoor meadow room tone: a soft, gentle breeze and light rustling of grass, nothing else, no birds, no insects, no animals, no water, even and continuous, no music, no speech.' },
  // The fly-by is derived from the buzz: a Doppler pitch glide and a swell, so it matches the bees exactly.
  pass: { from: 'buzz', flyby: { length: 1.25, peak: 0.42 } }, // uses the finished buzz loop
  bump: { seed: 61, duration: 2, max: 0.8, prompt: 'Cartoon collision sound effect: two small, soft, round fuzzy insects bump into each other in mid-air, one short comedic rubbery boink bounce with a tiny squeak, very short and punchy, playful, then complete silence, isolated, no music, no speech.' },
  thud: { seed: 71, duration: 2, max: 0.8, prompt: 'Cartoon sound effect: a small bee bonks its head into a wooden tree trunk, one short hollow wooden bonk thud with a little springy wobble, comedic and soft, then complete silence, isolated, no music, no speech.' },
  collect: { seed: 85, duration: 2, max: 0.9, prompt: 'Bright cheerful video game pickup sound: a sticky golden honey droplet is collected, one short liquid bloop followed by a tiny sparkling twinkle, sweet and satisfying, under one second, then complete silence, isolated, no music, no speech.' },
  deliver: { seed: 91, duration: 3, max: 1.8, prompt: 'Satisfying video game reward sound: golden honey pours into a wooden beehive, a short gooey glugging drip splash followed by a warm sparkling magical shimmer, about one and a half seconds, then complete silence, isolated, no music, no speech.' },
  boost: { seed: 101, duration: 2, max: 1, prompt: 'Quick energetic whoosh: a tiny bee suddenly darts forward, short airy swoosh with a rising zippy wing buzz, under one second, then complete silence, isolated, no music, no speech.' },
  crash: { seed: 111, duration: 2, max: 1.3, prompt: 'Big cartoon crash sound effect: a large fluffy bumblebee clumsily slams into a small bee, one heavy soft whump impact with a comedic springy boing wobble, then complete silence, isolated, no music, no speech.' },
  'grumble-1': { model: VOICE, seed: 201, pitch: 1.18, max: 1.7, prompt: 'A tiny cartoon bee character with a squeaky, high-pitched, fast nasal voice grumbles angrily under its breath, saying only made-up comic gibberish: "Grrmbl-frazzle-snatz! Bzzt!" No real words, comedic mock cursing like in a children\'s cartoon, one short burst of about one and a half seconds, close dry studio recording, no music, no background sounds.' },
  'grumble-2': { model: VOICE, seed: 212, pitch: 1.18, max: 1.7, prompt: 'A tiny cartoon bee character with a squeaky, high-pitched, fast nasal voice splutters indignantly, saying only made-up comic gibberish: "Hnngh! Blibber-flumph, pfft!" No real words, comedic mock cursing like in a children\'s cartoon, one short burst of about one and a half seconds, close dry studio recording, no music, no background sounds.' },
  'grumble-3': { model: VOICE, seed: 203, pitch: 1.18, max: 1.7, prompt: 'A tiny cartoon bee character with a squeaky, high-pitched, fast nasal voice shouts in outrage, saying only made-up comic gibberish: "Oi! Zzzrk-a-dooflin! Bah!" No real words, comedic mock cursing like in a children\'s cartoon, one short burst of about one and a half seconds, close dry studio recording, no music, no background sounds.' },
  alarm: { seed: 131, duration: 3, max: 1.8, prompt: 'Short comedic cartoon warning sound effect: a goofy descending slide whistle followed by one bouncy rubber bike horn honk, about one and a half seconds, then complete silence, isolated, no speech.' },
  dizzy: { seed: 145, duration: 2, max: 1.4, prompt: 'Cartoon dizzy sound effect: little twittering chirps and twinkling sparkles circling the head of a stunned character, whimsical and short, about one second, then complete silence, isolated, no music, no speech.' },
};

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

async function generate(name, seed) {
  const target = resolve(cache, `${name}-${seed}.wav`);
  if (existsSync(target)) return target;
  const key = process.env.RUNWARE_API_KEY;
  if (!key) throw new Error('Set RUNWARE_API_KEY in the environment (never pass it as an argument or commit it).');
  const recipe = RECIPES[name];
  const response = await fetch('https://api.runware.ai/v1', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ taskType: 'audioInference', taskUUID: randomUUID(), model: recipe.model ?? MODEL, positivePrompt: recipe.prompt, ...(recipe.duration ? { duration: recipe.duration } : {}), ...(recipe.model ? {} : { seed }), outputFormat: 'WAV', numberResults: 1 }]),
  });
  const body = await response.json();
  if (!response.ok || body.errors?.length) throw new Error(`${name}: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
  // Seed Audio has no seed parameter, so its `seed` is only the local candidate label.
  for (const result of (body.data ?? []).slice(0, 1)) {
    const audio = await fetch(result.audioURL);
    if (!audio.ok) throw new Error(`${name}: download failed (${audio.status})`);
    writeFileSync(target, Buffer.from(await audio.arrayBuffer()));
  }
  if (!existsSync(target)) throw new Error(`${name}: no result for seed ${seed}`);
  return target;
}

function decode(file, pitch = 1) {
  // A pitch above 1 also speeds the clip up, which turns a small voice into a bee-sized one.
  const filter = pitch === 1 ? [] : ['-af', `asetrate=${Math.round(RATE * pitch)},aresample=${RATE}`];
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, ...filter, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}
const rms = samples => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / Math.max(1, samples.length));
// Levels by the loudest 400 ms window (close to momentary loudness), then limits peaks to about -1 dBFS.
function level(samples, targetDb) {
  const window = Math.min(samples.length, Math.round(RATE * 0.4)), step = Math.round(RATE * 0.05);
  let loudest = 0; for (let i = 0; i + window <= samples.length; i += step) loudest = Math.max(loudest, rms(samples.subarray(i, i + window)));
  const scale = 10 ** (targetDb / 20) / Math.max(1e-6, loudest);
  let peak = 0; for (const x of samples) peak = Math.max(peak, Math.abs(x * scale));
  const limit = peak > 0.89 ? 0.89 / peak : 1;
  return samples.map(x => x * scale * limit);
}
// Trims to the main event using a 20 ms energy envelope, so stray clicks before it are skipped.
function oneShot(samples, max) {
  const frame = Math.round(RATE * 0.02), energy = [];
  for (let i = 0; i + frame <= samples.length; i += frame) energy.push(rms(samples.subarray(i, i + frame)));
  const loudest = Math.max(...energy), first = energy.findIndex(e => e > loudest * 0.12);
  let last = energy.length - 1; while (last > first && energy[last] < loudest * 0.04) last--;
  const start = Math.max(0, first * frame - Math.round(RATE * 0.01));
  const end = Math.min((last + 2) * frame, start + Math.round(RATE * max), samples.length);
  const out = samples.slice(start, end), fadeIn = Math.round(RATE * 0.004), fadeOut = Math.min(Math.round(RATE * 0.12), out.length >> 2);
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i++) out[out.length - 1 - i] *= Math.sin(Math.PI / 2 * i / fadeOut);
  return level(out, -16);
}
function flyby(samples, { length, peak }) {
  const size = Math.round(length * RATE), out = new Float32Array(size);
  let position = 0;
  for (let i = 0; i < size; i++) {
    const t = i / size, passed = 1 / (1 + Math.exp(-(t - peak) * 16));
    position += 1.16 - 0.34 * passed; // Higher while approaching, lower while leaving.
    const k = Math.floor(position), frac = position - k, a = samples[k % samples.length], b = samples[(k + 1) % samples.length];
    const swell = Math.exp(-(((t - peak) / (t < peak ? 0.2 : 0.3)) ** 2));
    out[i] = (a + (b - a) * frac) * swell;
  }
  return level(out, -18);
}
// A bee's wings make a buzzing tone: a harmonic stack with slow pitch drift, fast flutter, and a
// gentle swell. Every modulation completes whole cycles per period, so the tone repeats seamlessly.
function tone(period, total, { f0, tilt, drift, flutter, tremolo }) {
  const size = Math.round(period * RATE), one = new Float32Array(size);
  const cycles = hz => Math.max(1, Math.round(hz * period)) / period;
  const slow = cycles(0.7), fast = cycles(9), swell = cycles(1.3), wobble = cycles(4.7), base = cycles(f0);
  let phase = 0, noise = 0, seed = 11;
  for (let i = 0; i < size; i++) {
    const w = 2 * Math.PI * i / RATE;
    phase += 2 * Math.PI * base * (1 + drift * Math.sin(w * slow) + flutter * Math.sin(w * fast)) / RATE;
    let sample = 0;
    for (let k = 1; k <= 18; k++) sample += Math.sin(k * phase + k * k * 0.37) / k ** tilt * (k >= 2 && k <= 4 ? 1.35 : 1);
    seed = (seed * 1664525 + 1013904223) >>> 0; noise = noise * 0.92 + (seed / 2147483648 - 1) * 0.08;
    one[i] = (sample * 0.28 + noise * 0.08) * (1 + tremolo * Math.sin(w * swell) + tremolo * 0.4 * Math.sin(w * wobble));
  }
  // Soft low-pass keeps upper harmonics gentle; run it over a lead-in period so the result is periodic.
  const out = new Float32Array(Math.round(total * RATE));
  let y = 0; for (let i = 0; i < size; i++) y += (one[i] - y) * 0.42;
  for (let i = 0; i < out.length; i++) { y += (one[i % size] - y) * 0.42; out[i] = y; }
  return out;
}
function blend(main, texture, amount) {
  const out = new Float32Array(main.length), a = rms(main), b = rms(texture.subarray(0, main.length)) || 1;
  for (let i = 0; i < out.length; i++) out[i] = main[i] / a + (texture[i % texture.length] / b) * amount;
  return out;
}
function loop(samples, { from, length }) {
  const start = Math.round(from * RATE), size = Math.round(length * RATE), fade = Math.round(0.35 * RATE);
  if (start + size + fade > samples.length) throw new Error('loop window exceeds clip');
  const out = samples.slice(start, start + size);
  // Equal-power crossfade of the tail into the head makes the loop seamless.
  for (let i = 0; i < fade; i++) { const t = i / fade * Math.PI / 2; out[i] = out[i] * Math.sin(t) + samples[start + size + i] * Math.cos(t); }
  return level(out, -18);
}
function encode(name, samples) {
  const temp = resolve(cache, `${name}.f32`);
  writeFileSync(temp, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', temp, '-c:a', 'libmp3lame', '-b:a', '64k', '-map_metadata', '-1', resolve(output, `${name}.mp3`)]);
  rmSync(temp);
}

mkdirSync(cache, { recursive: true }); mkdirSync(output, { recursive: true });
const explore = option('--explore');
if (explore) {
  const seeds = (option('--seeds') ?? '1,3').split(',').map(Number);
  await Promise.all(seeds.map(seed => generate(explore, seed)));
  console.log(`${explore}: candidates in ${cache}`);
} else {
  const names = HIVE_SOUNDS.flatMap(soundFiles);
  for (const name of names) if (!RECIPES[name]) throw new Error(`${name}: missing recipe`);
  if (!flag('--encode-only')) await Promise.all(names.filter(name => !RECIPES[name].from).map(name => generate(name, RECIPES[name].seed)));
  const finished = new Map();
  for (const name of names) {
    const recipe = RECIPES[name];
    if (recipe.from) { encode(name, flyby(finished.get(recipe.from), recipe.flyby)); continue; }
    let samples = decode(resolve(cache, `${name}-${recipe.seed}.wav`), recipe.pitch);
    if (recipe.tone) {
      const { from, length } = recipe.loop, texture = samples.slice(Math.round(from * RATE));
      samples = blend(tone(length, length + 0.6, recipe.tone), texture, recipe.tone.texture);
      recipe.loop = { from: 0, length };
    }
    const result = recipe.loop ? loop(samples, recipe.loop) : oneShot(samples, recipe.max);
    finished.set(name, result); encode(name, result);
    console.log(`${name}: ${(readFileSync(resolve(output, `${name}.mp3`)).length / 1024).toFixed(1)} KiB`);
  }
}
