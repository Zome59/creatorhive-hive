import * as THREE from 'three';
import { WORLD, FLOWERS, TREES, BUSHES, STREAM, STREAM_INFO, STREAM_RULES, STREAM_Y, STREAM_LENGTH as LENGTH, streamWidth as widthAt, streamDistance } from '../world.js';
// The route itself lives in world.js (static layout); re-exported here for the scene and tests.
export { STREAM, STREAM_INFO, STREAM_RULES, STREAM_Y, streamDistance, streamClearance } from '../world.js';

// A brook that springs up in the meadow, meanders to the rim of the floating island, and pours over the
// edge as a waterfall. Everything is procedural; textures are DataTextures (no canvas), so it also builds in Node.
//
//   STREAM            centre-line of the brook, spring -> island lip, computed once and deterministic
//   streamClearance() how far the centre-line stays from flowers, trees, and the hive
//   streamDistance()  distance from a point to the water's edge (for scene code that keeps grass/rocks off the water)
//   createStream()    { group, update(dt, elapsed), sources, stones, textures, stats, dispose }
//
// Four draw calls: brook ribbon, waterfall ribbon, instanced stones, one additive particle set (mist, splashes, sparkles).

const TAU = Math.PI * 2;
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------------------------------------------------
// Water textures (DataTexture, periodic, so they scroll seamlessly). Streaky ripples along the flow direction.

const hash = (x, y, s) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const wrap = (i, n) => ((i % n) + n) % n;
function noise(x, y, px, py, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = smooth(x - x0), fy = smooth(y - y0);
  const a = hash(wrap(x0, px), wrap(y0, py), seed), b = hash(wrap(x0 + 1, px), wrap(y0, py), seed), c = hash(wrap(x0, px), wrap(y0 + 1, py), seed), d = hash(wrap(x0 + 1, px), wrap(y0 + 1, py), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const mix = (a, b, t) => a + (b - a) * t;
const rgb = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

// u runs across the water, v along the flow. `along` is how many noise cells fit along one repeat (fewer = longer streaks).
function flowTextures({ seed, across, along, deep, mid, light, foam, edgeFoam, relief, contrast }) {
  const W = 64, H = 128, height = new Float32Array(W * H), color = new Uint8Array(W * H * 4), normal = new Uint8Array(W * H * 4);
  const [d, m, l, f] = [deep, mid, light, foam].map(rgb);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    height[y * W + x] = 0.5 * noise(u * across, v * along, across, along, seed) + 0.3 * noise(u * across * 2, v * along * 2, across * 2, along * 2, seed + 1) + 0.2 * noise(u * across * 4, v * along * 4, across * 4, along * 4, seed + 2);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, h = height[i], u = x / W, v = y / H;
    const streak = smooth((h - 0.55) / 0.3 * contrast), shade = smooth((0.42 - h) / 0.25);
    let c = [0, 1, 2].map(k => mix(mix(m[k], d[k], shade * 0.8), l[k], streak * 0.8));
    if (edgeFoam) { // patchy foam hugging both banks (the ribbon's +-1 columns sit at u = 0.13 and 0.87)
      const band = Math.exp(-(((Math.abs(u - 0.5) - 0.37) / 0.05) ** 2)), patch = smooth((noise(u * 12 + 3, v * 5, 12, 5, seed + 7) - 0.4) / 0.35);
      c = c.map((value, k) => mix(value, f[k], band * patch * 0.9));
    }
    color.set([c[0], c[1], c[2], 255], i * 4);
    const hx = height[y * W + wrap(x + 1, W)] - height[y * W + wrap(x - 1, W)], hy = height[wrap(y + 1, H) * W + x] - height[wrap(y - 1, H) * W + x];
    const nx = -hx * relief, ny = -hy * relief, nz = 1, len = Math.hypot(nx, ny, nz);
    normal.set([(nx / len * 0.5 + 0.5) * 255, (ny / len * 0.5 + 0.5) * 255, (nz / len * 0.5 + 0.5) * 255, 255], i * 4);
  }
  const make = (data, srgb) => {
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
  };
  return { map: make(color, true), normal: make(normal, false) };
}
function softDot() {
  const S = 32, data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const r = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2), a = smooth(1 - r) ** 1.4; data.set([255, 255, 255, a * 255], (y * S + x) * 4); }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.LinearFilter; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
}

// ---------------------------------------------------------------------------------------------------------
// Ribbons: seven vertices across (soft bank fringe, shallow edge, middle, deep centre, and back). The fringe
// fades out, the edges are darker, so the brook looks gently sunken into the meadow.

const CROSS = [-1.35, -1, -0.55, 0, 0.55, 1, 1.35];
const SHADE = [[0.5, 0.5, 0.44, 0], [0.62, 0.8, 0.82, 0.82], [0.86, 0.94, 0.96, 1], [1, 1, 1, 1], [0.86, 0.94, 0.96, 1], [0.62, 0.8, 0.82, 0.82], [0.5, 0.5, 0.44, 0]];
// rows: { x, y, z, hw, v, nx, ny, nz, alpha, tint, sx, sz }; (sx, sz) is the unit vector across the water at that row.
function ribbon(rows) {
  const cols = CROSS.length, n = rows.length, pos = new Float32Array(n * cols * 3), nor = new Float32Array(n * cols * 3), uv = new Float32Array(n * cols * 2), col = new Float32Array(n * cols * 4);
  rows.forEach((r, i) => CROSS.forEach((m, j) => {
    const k = i * cols + j, shade = SHADE[j];
    pos.set([r.x + r.sx * m * r.hw, r.y, r.z + r.sz * m * r.hw], k * 3); nor.set([r.nx, r.ny, r.nz], k * 3); uv.set([(m + CROSS[cols - 1]) / (2 * CROSS[cols - 1]), r.v], k * 2);
    col.set([shade[0] * r.tint, shade[1] * r.tint, shade[2] * r.tint, shade[3] * r.alpha], k * 4);
  }));
  // Wind the triangles to face the same way as the surface normal (checked on the first quad).
  const e1 = [0, 1, 2].map(k => pos[cols * 3 + k] - pos[k]), e2 = [0, 1, 2].map(k => pos[3 + k] - pos[k]);
  const facing = (e1[1] * e2[2] - e1[2] * e2[1]) * rows[0].nx + (e1[2] * e2[0] - e1[0] * e2[2]) * rows[0].ny + (e1[0] * e2[1] - e1[1] * e2[0]) * rows[0].nz > 0;
  const index = [];
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < cols - 1; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; index.push(...(facing ? [a, c, b, b, c, d] : [a, b, c, b, d, c])); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setIndex(index); g.computeBoundingSphere(); return g;
}

const STONE_COLORS = ['#aaa79a', '#92968c', '#b5aa93', '#9e9a8c', '#bdb4a0', '#85897f', '#a79f8a'];
const WATER = { // base colours (sRGB)
  brook: { deep: '#1d5d88', mid: '#2f84b8', light: '#7cc3dc', foam: '#e8f5f2' },
  fall: { deep: '#3d92c0', mid: '#62b2d9', light: '#e8f7fb', foam: '#ffffff' },
};

export function createStream() {
  const group = new THREE.Group(); group.name = 'stream';
  const curve = new THREE.CatmullRomCurve3(STREAM.map(p => new THREE.Vector3(p.x, STREAM_Y, p.z)), false, 'centripetal'); curve.arcLengthDivisions = 600;
  const arc = curve.getLength(), at = s => curve.getPointAt(Math.min(1, Math.max(0, s / arc))), tangent = s => curve.getTangentAt(Math.min(1, Math.max(0, s / arc)));
  const ux = STREAM_INFO.exit.x, uz = STREAM_INFO.exit.z, sideX = -uz, sideZ = ux, lip = STREAM_INFO.lip;
  const BROOK_TILE = 3.2, FALL_TILE = 2.6;

  // --- brook ribbon: rows closer together at the rounded spring end
  const brookRows = [], sample = [0, 0.04, 0.1, 0.18, 0.28, 0.4, 0.54, 0.68];
  for (let s = 0.9; s < arc - 0.2; s += 0.42) sample.push(s);
  sample.push(arc);
  for (const s of sample) {
    const p = at(s), t = tangent(s);
    brookRows.push({ x: p.x, y: STREAM_Y, z: p.z, hw: widthAt(s / arc * LENGTH) / 2, v: s / BROOK_TILE, nx: 0, ny: 1, nz: 0, alpha: 1, tint: 1, sx: -t.z, sz: t.x });
  }
  const brookGeometry = ribbon(brookRows);

  // --- waterfall ribbon: a free-fall parabola leaving the lip, from the water surface down to y = -9.
  const FALL = { rows: 24, depth: 9, push: 0.9, g: 9.8 }, fallRows = [], hwLip = widthAt(LENGTH) / 2;
  for (let k = 0; k <= FALL.rows; k++) {
    const f = k / FALL.rows, drop = FALL.depth * f * f, out = 0.04 + FALL.push * Math.sqrt(2 * drop / FALL.g), a = 1 - 0.1 * f - 0.9 * smooth((f - 0.3) / 0.7), white = 1 + 0.08 * f;
    fallRows.push({ x: lip.x + ux * out, y: STREAM_Y - drop, z: lip.z + uz * out, hw: hwLip * (1 + 0.22 * f), v: 0, nx: 0, ny: 1, nz: 0, alpha: a, tint: white, sx: sideX, sz: sideZ, out });
  }
  for (let k = 0; k < fallRows.length; k++) { // normals from the fall direction, and v from arc length
    const r = fallRows[k], p = fallRows[Math.min(k + 1, fallRows.length - 1)], q = fallRows[Math.max(k - 1, 0)];
    const du = p.out - q.out, dy = p.y - q.y, len = Math.hypot(du, dy) || 1; // along the fall (outward, down)
    r.nx = ux * (-dy / len); r.ny = du / len; r.nz = uz * (-dy / len);
    r.v = k ? fallRows[k - 1].v + Math.hypot(r.out - fallRows[k - 1].out, r.y - fallRows[k - 1].y) / FALL_TILE : 0;
  }
  const fallGeometry = ribbon(fallRows);

  // --- materials and textures
  const brookTex = flowTextures({ seed: 11, across: 7, along: 3, ...WATER.brook, edgeFoam: true, relief: 5, contrast: 1 });
  const fallTex = flowTextures({ seed: 23, across: 9, along: 2, ...WATER.fall, edgeFoam: false, relief: 4, contrast: 1.2 });
  const water = (tex, extra) => new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex.map, normalMap: tex.normal, normalScale: new THREE.Vector2(0.45, 0.45), vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...extra });
  const brookMaterial = water(brookTex, { opacity: 0.88, roughness: 0.16, emissive: '#16587a', emissiveIntensity: 0.22 });
  const fallMaterial = water(fallTex, { opacity: 0.94, roughness: 0.3, emissive: '#3a8fb4', emissiveIntensity: 0.3, side: THREE.DoubleSide });
  const brook = new THREE.Mesh(brookGeometry, brookMaterial); brook.name = 'stream-brook'; brook.receiveShadow = true; brook.renderOrder = 1;
  const fall = new THREE.Mesh(fallGeometry, fallMaterial); fall.name = 'stream-waterfall'; fall.receiveShadow = true; fall.renderOrder = 2;
  group.add(brook, fall);

  // --- stones
  const rand = rng(8821), stones = [];
  const clear = (x, z, flowerGap = 1, treeGap = 1.1) => Math.hypot(x, z) >= STREAM_RULES.hive + 0.2 && Math.hypot(x, z) <= 29.2 && FLOWERS.every(f => Math.hypot(f.x - x, f.z - z) >= flowerGap) && TREES.every(t => Math.hypot(t.x - x, t.z - z) >= treeGap) && BUSHES.every(b => Math.hypot(b.x - x, b.z - z) >= b.size + 0.5);
  const addStone = (kind, x, z, size, lift = 0.35) => {
    const sx = size * (0.85 + 0.3 * rand()), sy = size * (0.42 + 0.3 * rand()), sz = size * (0.85 + 0.3 * rand());
    stones.push({ kind, x, y: (kind === 'bed' ? STREAM_Y - 0.02 : 0.04) + sy * lift * 1.6, z, radius: Math.max(sx, sz), sx, sy, sz, yaw: rand() * TAU, tilt: (rand() - 0.5) * 0.35, color: STONE_COLORS[Math.floor(rand() * STONE_COLORS.length)] });
  };
  for (let s = 1.2 + rand() * 0.4; s < arc - 1.4; s += 0.8 + rand() * 0.5) for (const side of [-1, 1]) { // along both banks, about every unit
    const along = s + (rand() - 0.5) * 0.5, p = at(along), t = tangent(along), hw = widthAt(along / arc * LENGTH) / 2, off = side * (hw * (0.95 + 0.3 * rand()) + 0.1 + 0.35 * rand());
    const x = p.x - t.z * off, z = p.z + t.x * off;
    if (clear(x, z)) addStone('bank', x, z, 0.13 + rand() * 0.15);
  }
  { // a ring of larger stones around the back of the spring
    const p = at(0.9), t = tangent(0.9), base = Math.atan2(-t.z, -t.x);
    for (let i = 0; i < 8; i++) { const a = base + (i / 7 - 0.5) * 2.6, r = 0.95 + rand() * 0.3, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r; if (clear(x, z)) addStone('spring', x, z, 0.2 + rand() * 0.14); }
  }
  for (let i = 0; i < 8; i++) { // a few stones breaking the surface
    const s = 2.2 + (arc - 5) * (i + rand() * 0.6) / 8, p = at(s), t = tangent(s), hw = widthAt(s / arc * LENGTH) / 2, off = (rand() - 0.5) * hw * 0.8;
    addStone('bed', p.x - t.z * off, p.z + t.x * off, 0.1 + rand() * 0.08, 0.2);
  }
  for (let made = 0, tries = 0; made < 40 && tries < 4000; tries++) { // scattered over the meadow, often in small groups
    const a = rand() * TAU, r = 6 + Math.sqrt(rand()) * 23, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    if (!clear(cx, cz) || streamDistance(cx, cz) < 1.2) continue;
    for (let n = 1 + Math.floor(rand() * 3); n > 0 && made < 40; n--) {
      const x = cx + (rand() - 0.5) * 1.0, z = cz + (rand() - 0.5) * 1.0;
      if (clear(x, z) && streamDistance(x, z) > 0.9) { addStone('meadow', x, z, 0.17 + rand() * 0.3); made++; }
    }
  }
  const stoneGeometry = new THREE.DodecahedronGeometry(1, 0), sp = stoneGeometry.attributes.position, normals = new Float32Array(sp.array.length);
  for (let i = 0; i < sp.count; i++) { const l = Math.hypot(sp.getX(i), sp.getY(i), sp.getZ(i)) || 1; normals.set([sp.getX(i) / l, sp.getY(i) / l, sp.getZ(i) / l], i * 3); }
  stoneGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); // soft pebble shading on a low-poly silhouette
  const stoneMesh = new THREE.InstancedMesh(stoneGeometry, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }), stones.length);
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  stones.forEach((s, i) => { dummy.position.set(s.x, s.y, s.z); dummy.rotation.set(s.tilt, s.yaw, -s.tilt * 0.7); dummy.scale.set(s.sx, s.sy, s.sz); dummy.updateMatrix(); stoneMesh.setMatrixAt(i, dummy.matrix); stoneMesh.setColorAt(i, tint.set(s.color)); });
  stoneMesh.name = 'stream-stones'; stoneMesh.castShadow = stoneMesh.receiveShadow = true; group.add(stoneMesh);

  // --- spray: mist where the fall dissolves, splashes at the lip, sparkles on the brook (one additive Points set)
  const MIST = 28, SPLASH = 14, SPARK = 14, N = MIST + SPLASH + SPARK, bottom = fallRows[fallRows.length - 1];
  const P = new Float32Array(N * 3), C = new Float32Array(N * 4), S = new Float32Array(N).fill(1), V = new Float32Array(N * 3), age = new Float32Array(N), life = new Float32Array(N), base = new Float32Array(N), phase = new Float32Array(N), speed = new Float32Array(N);
  const hwBottom = bottom.hw, flick = rng(515);
  const respawn = i => {
    const r = flick;
    if (i < MIST) {
      const out = r() * 1.6, side = (r() - 0.5) * hwBottom * 3.2;
      P.set([bottom.x + ux * out + sideX * side, bottom.y + (r() - 0.3) * 0.9, bottom.z + uz * out + sideZ * side], i * 3);
      const drift = 0.2 + r() * 0.4, lateral = (r() - 0.5) * 0.35; V.set([ux * drift + sideX * lateral, 0.18 + r() * 0.3, uz * drift + sideZ * lateral], i * 3);
      life[i] = 2.8 + r() * 2.2; base[i] = 3.5 + r() * 2.5;
    } else {
      const side = (r() - 0.5) * hwLip * 1.6, out = 0.9 + r() * 1.1;
      P.set([lip.x + ux * 0.1 + sideX * side, STREAM_Y + 0.05, lip.z + uz * 0.1 + sideZ * side], i * 3);
      V.set([ux * out + sideX * (r() - 0.5) * 0.8, 0.5 + r() * 1.3, uz * out + sideZ * (r() - 0.5) * 0.8], i * 3);
      life[i] = 0.5 + r() * 0.45; base[i] = 0.55 + r() * 0.45;
    }
  };
  for (let i = 0; i < MIST + SPLASH; i++) { respawn(i); age[i] = flick() * life[i]; C.set(i < MIST ? [0.72, 0.88, 1, 0] : [1, 1, 1, 0], i * 4); }
  for (let i = MIST + SPLASH; i < N; i++) { // sparkles stay put
    const s = 0.8 + flick() * (arc - 1.6), p = at(s), t = tangent(s), off = (flick() - 0.5) * widthAt(s / arc * LENGTH) * 0.6;
    P.set([p.x - t.z * off, STREAM_Y + 0.05, p.z + t.x * off], i * 3); base[i] = 0.5 + flick() * 0.4; phase[i] = flick() * TAU; speed[i] = 1.3 + flick() * 1.8; S[i] = base[i]; C.set([1, 0.98, 0.86, 0], i * 4);
  }
  const sprayGeometry = new THREE.BufferGeometry();
  sprayGeometry.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage)); sprayGeometry.setAttribute('color', new THREE.BufferAttribute(C, 4).setUsage(THREE.DynamicDrawUsage)); sprayGeometry.setAttribute('aSize', new THREE.BufferAttribute(S, 1).setUsage(THREE.DynamicDrawUsage));
  const dot = softDot(), sprayMaterial = new THREE.PointsMaterial({ map: dot, size: 1, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  sprayMaterial.onBeforeCompile = shader => { shader.vertexShader = 'attribute float aSize;\n' + shader.vertexShader.replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;'); };
  sprayMaterial.customProgramCacheKey = () => 'hive-stream-spray';
  const spray = new THREE.Points(sprayGeometry, sprayMaterial); spray.name = 'stream-spray'; spray.frustumCulled = false; spray.renderOrder = 3; group.add(spray);

  // --- sound sources: the middle of the brook and the lip of the waterfall
  const mid = at(arc / 2), sources = [{ x: mid.x, y: STREAM_Y, z: mid.z, kind: 'brook' }, { x: lip.x, y: STREAM_Y, z: lip.z, kind: 'waterfall' }];

  let clock = 0;
  function update(dt = 0, elapsed) {
    const step = Math.min(Math.max(dt, 0), 0.1), t = Number.isFinite(elapsed) ? elapsed : (clock += step);
    // Flow: the textures scroll along the water; the fall runs faster.
    brookTex.map.offset.set(Math.sin(t * 0.37) * 0.02, -(t * 0.24) % 1); brookTex.normal.offset.copy(brookTex.map.offset);
    fallTex.map.offset.set(Math.sin(t * 0.5) * 0.015, -(t * 0.85) % 1); fallTex.normal.offset.copy(fallTex.map.offset);
    for (let i = 0; i < N; i++) {
      const i3 = i * 3, i4 = i * 4;
      if (i < MIST + SPLASH) {
        if (step > 0) {
          age[i] += step;
          if (age[i] >= life[i]) { respawn(i); age[i] = 0; }
          if (i >= MIST) V[i3 + 1] -= 7 * step;
          P[i3] += V[i3] * step; P[i3 + 1] += V[i3 + 1] * step; P[i3 + 2] += V[i3 + 2] * step;
        }
        const x = Math.min(1, age[i] / life[i]);
        if (i < MIST) { C[i4 + 3] = Math.sin(Math.PI * x) ** 1.4 * 0.1; S[i] = base[i] * (1 + 0.9 * x); } else { C[i4 + 3] = (1 - x) * 0.5; S[i] = base[i] * (1 - 0.3 * x); }
      } else C[i4 + 3] = Math.max(0, Math.sin(t * speed[i] + phase[i])) ** 8 * 0.7;
    }
    sprayGeometry.attributes.position.needsUpdate = sprayGeometry.attributes.color.needsUpdate = sprayGeometry.attributes.aSize.needsUpdate = true;
  }
  update(0, 0);

  const triangles = group.children.reduce((sum, o) => { const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3; return sum + (o.isInstancedMesh ? n * o.count : o.isPoints ? 0 : n); }, 0);
  function dispose() {
    group.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    for (const t of [brookTex.map, brookTex.normal, fallTex.map, fallTex.normal, dot]) t.dispose();
  }
  return { group, update, sources, stones, textures: { brook: brookTex.map, waterfall: fallTex.map }, stats: { triangles: Math.round(triangles), drawCalls: group.children.length }, dispose };
}
