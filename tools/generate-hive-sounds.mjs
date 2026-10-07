// Regenerates Honey Retrieval's sound effects. Development tool only; the game never calls an API.
//
//   RUNWARE_API_KEY=... node tools/generate-hive-sounds.mjs            fetch missing raw clips, then encode
//   RUNWARE_API_KEY=... node tools/generate-hive-sounds.mjs --explore buzz --seeds 1,3,5
//   node tools/generate-hive-sounds.mjs --encode-only                  re-encode from cached raw clips
//   node tools/generate-hive-sounds.mjs --encode-only --only buzz,pass  limit to some files
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
const MUSIC = 'minimax:music@2.6'; // MiniMax Music 2.6 for the two background tracks
const INSTRUMENTAL = { instrumental: true };

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
  // A soft two-note "uh-oh" chime over the bumblebee drone swelling in; synthesized, no whistle.
  alarm: { from: 'bumble', chime: { notes: [[0, 698.46], [0.2, 587.33], [0.66, 698.46], [0.86, 587.33]], length: 1.8 } },
  slurp: { seed: 155, duration: 3, max: 1.3, prompt: 'Comedic cartoon slurping sound: a big fuzzy character greedily sucks thick honey through a tiny straw, one wet gurgling slurp with a happy little gulp at the end, about one second, then complete silence, isolated, no music, no speech.' },
  // Background music: generated once, cut to a seamless loop, stereo, played quietly on the music channel.
  'music-synthwave': { model: MUSIC, seed: 301, settings: INSTRUMENTAL, music: { from: 6, length: 70 }, prompt: 'Warm, mellow instrumental synthwave for a cozy video game set in a sunny flower garden full of bees: steady relaxed groove around 100 BPM, soft gated drums, round analog bass, shimmering arpeggiated synths, dreamy pads, retro 1980s feel, positive and laid back, consistent energy without breaks or big drops, no vocals.' },
  // Pure nature, no instruments: a summer meadow mixed locally from short field-recording-style layers.
  'music-meadow': { scape: { length: 80, bed: [401, 402, 403, 404], birds: [411, 412, 413, 414], brook: [421, 422] } },
  'meadow-bed': { duration: 10, prompt: 'Peaceful summer meadow ambience: a very soft warm breeze through tall grass, faint distant crickets and grasshoppers, calm and continuous, natural field recording, no birds, no water, no music, no voices.' },
  'meadow-birds': { duration: 10, prompt: 'A few summer songbirds chirping and singing in a meadow nearby, short cheerful phrases with quiet pauses in between, natural field recording, soft breeze, no music, no voices.' },
  'meadow-brook': { duration: 10, prompt: 'A small gentle brook babbling over pebbles in a meadow, soft continuous trickling water, calm natural field recording, no birds, no music, no voices.' },
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
  const recipe = RECIPES[name], taskUUID = randomUUID();
  const call = async tasks => {
    const response = await fetch('https://api.runware.ai/v1', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(tasks) });
    const body = await response.json();
    if (!response.ok || body.errors?.length) throw new Error(`${name}: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
    return body;
  };
  // Music can take longer than the synchronous limit, so it is submitted async and polled.
  const music = recipe.model === MUSIC;
  let body = await call([{ taskType: 'audioInference', taskUUID, model: recipe.model ?? MODEL, positivePrompt: recipe.prompt, ...(recipe.duration ? { duration: recipe.duration } : {}), ...(recipe.model && recipe.model !== MUSIC ? {} : { seed }), ...(recipe.settings ? { settings: recipe.settings } : {}), ...(music ? { deliveryMethod: 'async' } : {}), outputFormat: 'WAV', numberResults: 1 }]);
  for (let tries = 0; music && !body.data?.some(item => item.audioURL) && tries < 120; tries++) {
    await new Promise(done => setTimeout(done, 5000));
    body = await call([{ taskType: 'getResponse', taskUUID }]);
  }
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
function chime(drone, { notes, length }) {
  const size = Math.round(length * RATE), bell = new Float32Array(size);
  for (const [at, f] of notes) for (let i = Math.round(at * RATE); i < size; i++) {
    const t = i / RATE - at, env = Math.min(1, t / 0.005) * Math.exp(-t / 0.3);
    if (t > 0.05 && env < 1e-4) break;
    // Marimba-like: fundamental plus a quickly fading fourth partial; no pitch glide.
    bell[i] += env * (Math.sin(2 * Math.PI * f * t) + 0.22 * Math.sin(2 * Math.PI * 4 * f * t) * Math.exp(-t / 0.05));
  }
  const level = rms(bell.filter(x => Math.abs(x) > 0.05)), hum = rms(drone) || 1, out = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const t = i / size, swell = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 1.5;
    out[i] = bell[i] + drone[i % drone.length] / hum * level * 0.4 * swell;
  }
  const fade = Math.round(RATE * 0.15); for (let i = 0; i < fade; i++) out[size - 1 - i] *= i / fade;
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
function encode(name, samples, channels = 1) {
  const temp = resolve(cache, `${name}.f32`);
  writeFileSync(temp, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', String(channels), '-i', temp, '-c:a', 'libmp3lame', '-b:a', '64k', '-map_metadata', '-1', resolve(output, `${name}.mp3`)]);
  rmSync(temp);
}
// Summer meadow: a grass-and-crickets bed chained from several clips, a brook that drifts in and out,
// and a few short bird phrases placed left and right. Built a little longer than the loop, then crossfaded.
function soundscape({ length, bed, birds, brook }) {
  const clip = (name, seed) => decode(resolve(cache, `${name}-${seed}.wav`));
  const size = Math.round((length + 3) * RATE), out = new Float32Array(size * 2), fade = Math.round(2 * RATE);
  const bedClips = bed.map(seed => clip('meadow-bed', seed)), bedLevel = 10 ** (-26 / 20);
  let at = 0, k = 0;
  while (at < size) {
    const c = bedClips[[0, 1, 2, 3, 2, 0, 3, 1][k++ % 8] % bedClips.length], scale = bedLevel / Math.max(1e-6, rms(c));
    for (let i = 0; i < c.length && at + i < size; i++) {
      const w = i < fade ? Math.sin(Math.PI / 2 * i / fade) : i > c.length - fade ? Math.sin(Math.PI / 2 * (c.length - i) / fade) : 1;
      out[(at + i) * 2] += c[i] * scale * w; out[(at + i) * 2 + 1] += c[Math.max(0, i - 13)] * scale * w; // a few samples apart: wide, soft stereo
    }
    at += c.length - fade;
  }
  const brookClips = brook.map(seed => clip('meadow-brook', seed)), brookLevel = 10 ** (-29 / 20), brookRms = brookClips.map(c => Math.max(1e-6, rms(c)));
  for (let i = 0; i < size; i++) {
    const t = i / RATE, swell = Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 16) / 34)))) ** 1.5; // audible from about 16 s to 50 s
    if (!swell) continue;
    const n = Math.floor(i / (8 * RATE)) % brookClips.length, c = brookClips[n], v = c[i % c.length] / brookRms[n] * brookLevel * swell;
    out[i * 2] += v * 0.8; out[i * 2 + 1] += v * 0.55;
  }
  // Birds only now and then: four short phrases, alternating left and right.
  const birdClips = birds.map(seed => clip('meadow-birds', seed)), birdLevel = 10 ** (-27 / 20), phrase = Math.round(4.5 * RATE), skip = Math.round(0.5 * RATE);
  [[6, -0.5], [26, 0.45], [47, -0.25], [66, 0.5]].forEach(([start, pan], n) => {
    const c = birdClips[n % birdClips.length], part = c.subarray(skip, skip + phrase), scale = birdLevel / Math.max(1e-6, rms(part)), from = Math.round(start * RATE), soft = Math.round(0.6 * RATE);
    for (let i = 0; i < part.length && from + i < size; i++) {
      const w = Math.min(1, i / soft, (part.length - i) / soft) * part[i] * scale;
      out[(from + i) * 2] += w * (1 - Math.max(0, pan)); out[(from + i) * 2 + 1] += w * (1 + Math.min(0, pan));
    }
  });
  return loopStereo(out, { from: 0, length });
}
function loopStereo(all, { from, length }) {
  const frames = all.length / 2, start = Math.round(from * RATE), size = Math.round(length * RATE), fade = Math.round(3 * RATE);
  if (start + size + fade > frames) throw new Error('loop window exceeds the audio');
  const out = all.slice(start * 2, (start + size) * 2);
  for (let i = 0; i < fade; i++) {
    const t = i / fade * Math.PI / 2;
    for (let c = 0; c < 2; c++) out[i * 2 + c] = out[i * 2 + c] * Math.sin(t) + all[(start + size + i) * 2 + c] * Math.cos(t);
  }
  const scale = 10 ** (-20 / 20) / Math.max(1e-6, rms(out));
  let peak = 0; for (const x of out) peak = Math.max(peak, Math.abs(x * scale));
  return out.map(x => x * scale * (peak > 0.89 ? 0.89 / peak : 1));
}
// Music stays stereo: a long window with a 3 s equal-power crossfade so it loops without a seam.
function musicLoop(file, { from, length }) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '2', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4), frames = all.length / 2;
  const start = Math.round(from * RATE), size = Math.round(length * RATE), fade = Math.round(3 * RATE);
  if (start + size + fade > frames) throw new Error(`${file}: track too short for the loop window`);
  const out = all.slice(start * 2, (start + size) * 2);
  for (let i = 0; i < fade; i++) {
    const t = i / fade * Math.PI / 2;
    for (let c = 0; c < 2; c++) out[i * 2 + c] = out[i * 2 + c] * Math.sin(t) + all[(start + size + i) * 2 + c] * Math.cos(t);
  }
  const scale = 10 ** (-20 / 20) / Math.max(1e-6, rms(out));
  let peak = 0; for (const x of out) peak = Math.max(peak, Math.abs(x * scale));
  return out.map(x => x * scale * (peak > 0.89 ? 0.89 / peak : 1));
}

mkdirSync(cache, { recursive: true }); mkdirSync(output, { recursive: true });
const explore = option('--explore');
if (explore) {
  const seeds = (option('--seeds') ?? '1,3').split(',').map(Number);
  await Promise.all(seeds.map(seed => generate(explore, seed)));
  console.log(`${explore}: candidates in ${cache}`);
} else {
  const only = option('--only')?.split(','), names = HIVE_SOUNDS.flatMap(soundFiles).filter(name => !only || only.includes(name));
  for (const name of names) if (!RECIPES[name]) throw new Error(`${name}: missing recipe`);
  const layers = names.flatMap(name => Object.entries(RECIPES[name].scape ?? {}).filter(([key]) => key !== 'length').flatMap(([key, seeds]) => seeds.map(seed => [`meadow-${key}`, seed])));
  if (!flag('--encode-only')) await Promise.all([...names.filter(name => !RECIPES[name].from && !RECIPES[name].scape).map(name => generate(name, RECIPES[name].seed)), ...layers.map(([name, seed]) => generate(name, seed))]);
  const finished = new Map();
  for (const name of names) {
    const recipe = RECIPES[name];
    if (recipe.from) { encode(name, recipe.chime ? level(chime(finished.get(recipe.from), recipe.chime), -17) : flyby(finished.get(recipe.from), recipe.flyby)); console.log(`${name}: derived from ${recipe.from}`); continue; }
    if (recipe.scape) { encode(name, soundscape(recipe.scape), 2); console.log(`${name}: ${(readFileSync(resolve(output, `${name}.mp3`)).length / 1024).toFixed(1)} KiB`); continue; }
    if (recipe.music) { encode(name, musicLoop(resolve(cache, `${name}-${recipe.seed}.wav`), recipe.music), 2); console.log(`${name}: ${(readFileSync(resolve(output, `${name}.mp3`)).length / 1024).toFixed(1)} KiB`); continue; }
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
