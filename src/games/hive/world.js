// Static garden layout shared by the simulation (collisions, nectar) and the scene (models).
export const WORLD = Object.freeze({ radius: 28, island: 31, floor: 0.7, ceiling: 8.5, beeRadius: 0.42,
  hive: Object.freeze({ radius: 2.3, height: 4.2, deliver: 3.6 }) });

let seed = 1307;
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const far = (list, x, z, gap) => list.every(p => Math.hypot(p.x - x, p.z - z) >= gap);

// A few trees stand inside the field to weave around; the rest ring the island edge as scenery.
export const TREES = [];
for (let i = 0; i < 7; i++) {
  const angle = i * Math.PI * 2 / 7 + 0.35 + random() * 0.3, radius = 13 + (i % 3) * 4.5 + random() * 2;
  const height = 1.7 + (i * 0.381966) % 1 * 2.4 + random() * 0.8; // spread from small trees to tall ones
  TREES.push({ id: i, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, height, canopy: 1.35 + random() * 0.35, inside: true });
}
for (let i = 0; i < 16; i++) {
  const angle = i * Math.PI * 2 / 16 + 0.12, radius = 29.6 + random() * 0.8;
  TREES.push({ id: TREES.length, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, height: 1.4 + random() * 3.4, canopy: 1 + random() * 0.4, inside: false });
}

// Flowers come in three heights so altitude control matters: meadow, mid, and tall sunflowers.
export const FLOWERS = [];
for (let attempt = 0; FLOWERS.length < 28 && attempt < 4000; attempt++) {
  const angle = random() * Math.PI * 2, radius = 6.5 + Math.sqrt(random()) * 19.5;
  const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
  if (!far(FLOWERS, x, z, 3.4) || !far(TREES, x, z, 3.6)) continue;
  const tier = FLOWERS.length % 3, height = [0.55 + random() * 0.8, 1.6 + random() * 1.3, 3.3 + random() * 1.9][tier]; // varied within each tier
  FLOWERS.push({ id: FLOWERS.length, x, z, height, head: tier === 2 ? 0.9 : 0.55, y: height + 0.8, color: FLOWERS.length });
}

// ---------------------------------------------------------------------------------------------------------
// The brook: part of the static layout, so bushes and stones can keep clear of it. Rendered by features/stream.js.
// Water surface: the tallest hex-tile top is 0.095 (see scene.js), the honey-flood overlay sits at 0.12.
export const STREAM_Y = 0.104;
export const STREAM_RULES = Object.freeze({ flowers: 1.6, trees: 2.4, hive: 5, springMin: 10, springMax: 14 });
const TILE = 1.7, STEP_X = Math.sqrt(3) * TILE, STEP_Z = 2.55; // the island's hex tiles, as built in scene.js

const TAU = Math.PI * 2;
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

// ---------------------------------------------------------------------------------------------------------
// Route. The brook runs along a (nearly) radial line with a gentle sinusoidal meander. The route is searched
// over angle, spring radius, and meander side for the largest clearance from flowers, trees, and the hive.

// Only the outer ring of tiles matters for the rim.
const RIM_TILES = [];
for (let q = -13; q <= 13; q++) for (let r = -13; r <= 13; r++) {
  const x = STEP_X * (q + r / 2), z = STEP_Z * r, d = Math.hypot(x, z);
  if (d <= WORLD.island + 0.6 && d >= WORLD.island - 6) RIM_TILES.push({ x, z });
}
// How far the tile tops reach along the ray at angle `theta`, offset sideways by `lateral`.
function lipRadius(theta, lateral) {
  const ux = Math.cos(theta), uz = Math.sin(theta); let best = 0;
  for (const t of RIM_TILES) {
    const side = -t.x * uz + t.z * ux - lateral;
    if (side > -TILE && side < TILE) best = Math.max(best, t.x * ux + t.z * uz + Math.sqrt(TILE * TILE - side * side));
  }
  return best;
}
function lipSpread(theta) { let lo = Infinity, hi = 0; for (let l = -0.8; l <= 0.801; l += 0.1) { const r = lipRadius(theta, l); lo = Math.min(lo, r); hi = Math.max(hi, r); } return hi - lo; }

const SMOOTH_RIM = 0.3; // largest allowed difference in rim radius across the width of the water at the lip
const BEND_T = [0, 0.24, 0.5, 0.74, 0.9, 1], BEND_L = [0, 0.8, -1.0, 0.8, 0, 0]; // sideways offset at the control points; the last stretch runs straight out
function bend(t) {
  let i = 0; while (i < BEND_T.length - 2 && t > BEND_T[i + 1]) i++;
  const k = 0.5 - 0.5 * Math.cos(Math.PI * smooth((t - BEND_T[i]) / (BEND_T[i + 1] - BEND_T[i])));
  return BEND_L[i] + (BEND_L[i + 1] - BEND_L[i]) * k;
}
function trace(theta, r0, sign, rEnd, count) {
  const ux = Math.cos(theta), uz = Math.sin(theta), out = new Float64Array(count * 2 + 2);
  for (let i = 0; i <= count; i++) { const t = i / count, r = r0 + (rEnd - r0) * t, l = sign * bend(t); out[i * 2] = ux * r - uz * l; out[i * 2 + 1] = uz * r + ux * l; }
  return out;
}
// Smallest margin over the required distances (positive = every rule is met), measured at the points.
const BROOK_KEEPOUT = [FLOWERS.map(f => [f.x, f.z, STREAM_RULES.flowers]), TREES.map(t => [t.x, t.z, STREAM_RULES.trees])].flat();
function margin(flat) {
  let m = Infinity;
  for (const [ox, oz, gap] of BROOK_KEEPOUT) {
    let near = Infinity;
    for (let i = 0; i < flat.length; i += 2) { const dx = flat[i] - ox, dz = flat[i + 1] - oz; near = Math.min(near, dx * dx + dz * dz); }
    m = Math.min(m, Math.sqrt(near) - gap);
  }
  for (let i = 0; i < flat.length; i += 2) m = Math.min(m, Math.hypot(flat[i], flat[i + 1]) - STREAM_RULES.hive);
  return m;
}

const SEGMENTS = 64;
const ROUTE = (() => {
  // Candidates: every 1.5 degrees, three spring radii, both meander sides. The hex-tile rim is only smooth (no notches
  // at the lip) along a few directions, so those are preferred; among them the route with the largest clearance wins.
  const all = [];
  for (let deg = 0; deg < 360; deg += 1.5) {
    const theta = deg * Math.PI / 180, spread = lipSpread(theta); if (spread > SMOOTH_RIM) continue;
    const rEnd = lipRadius(theta, 0);
    for (const r0 of [10.5, 12, 13.5]) for (const sign of [1, -1]) all.push({ theta, r0, sign, rEnd, spread, m: margin(trace(theta, r0, sign, rEnd, SEGMENTS)) });
  }
  let best = all.reduce((a, b) => (b.m > a.m ? b : a));
  // Fine-tune the spring radius and the angle around the winner.
  for (let d = -1.5; d <= 1.501; d += 0.25) for (let dr = -1; dr <= 1.001; dr += 0.25) {
    const theta = best.theta + d * Math.PI / 180, spread = lipSpread(theta), r0 = best.r0 + dr;
    if (spread > SMOOTH_RIM || r0 < STREAM_RULES.springMin || r0 > STREAM_RULES.springMax) continue;
    const rEnd = lipRadius(theta, 0), m = margin(trace(theta, r0, best.sign, rEnd, SEGMENTS));
    if (m > best.m + 1e-9) best = { theta, r0, sign: best.sign, rEnd, spread, m };
  }
  return best;
})();

const FLAT = trace(ROUTE.theta, ROUTE.r0, ROUTE.sign, ROUTE.rEnd, SEGMENTS);
/** Centre-line of the brook from the spring (index 0) to the island lip (last), as frozen {x, z} points. */
export const STREAM = Object.freeze(Array.from({ length: SEGMENTS + 1 }, (_, i) => Object.freeze({ x: FLAT[i * 2], z: FLAT[i * 2 + 1] })));
const ARC = (() => { const s = [0]; for (let i = 1; i < STREAM.length; i++) s.push(s[i - 1] + Math.hypot(STREAM[i].x - STREAM[i - 1].x, STREAM[i].z - STREAM[i - 1].z)); return s; })();
const LENGTH = ARC[ARC.length - 1];
export const STREAM_LENGTH = LENGTH;
/** Where the brook starts and ends, and the direction in which it leaves the island. */
export const STREAM_INFO = Object.freeze({ spring: STREAM[0], lip: STREAM[STREAM.length - 1], exit: Object.freeze({ x: Math.cos(ROUTE.theta), z: Math.sin(ROUTE.theta) }), angle: ROUTE.theta, length: LENGTH, rimSpread: ROUTE.spread });

// Width of the water at distance `s` from the spring: a rounded spring pool, then a runnel widening to the lip.
const CAP = 0.8;
export function streamWidth(s) { return widthAt(s); }
function widthAt(s) {
  const k = Math.min(1, s / LENGTH), body = 1.1 + 0.5 * (0.6 * k + 0.4 * smooth(k));
  const pool = 0.4 * Math.exp(-(((s - 0.95) / 0.7) ** 2)), cap = s >= CAP ? 1 : Math.sqrt(Math.max(0, 1 - ((CAP - s) / CAP) ** 2));
  return Math.max(0.02, (body + pool) * cap);
}
const HALF = ARC.map(s => widthAt(s) / 2);

function segmentDistance(px, pz, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}
/** Distance from (x, z) to the water's edge: 0 or less means the point is in the water. Includes the soft bank (1.35x width). */
export function streamDistance(x, z) {
  let best = Infinity;
  for (let i = 1; i < STREAM.length; i++) {
    if (Math.hypot(x - STREAM[i].x, z - STREAM[i].z) > 6) continue; // cheap reject: segments are about 0.35 long
    best = Math.min(best, segmentDistance(x, z, STREAM[i - 1], STREAM[i]) - Math.max(HALF[i - 1], HALF[i]) * 1.35);
  }
  return best;
}
/** Minimum distances from the centre-line (measured along the segments) to flowers, inside trees, all trees, and the hive centre. */
export function streamClearance(points = STREAM) {
  const nearest = list => { let d = Infinity; for (const o of list) for (let i = 1; i < points.length; i++) d = Math.min(d, segmentDistance(o.x, o.z, points[i - 1], points[i])); return d; };
  const hive = Math.min(...points.map(p => Math.hypot(p.x, p.z)));
  return { flowers: nearest(FLOWERS), trees: nearest(TREES.filter(t => t.inside)), allTrees: nearest(TREES), hive, spring: Math.hypot(points[0].x, points[0].z), lip: Math.hypot(points[points.length - 1].x, points[points.length - 1].z) };
}


// Low round bushes dot the meadow: solid, but below most flight paths, and clear of the brook.
export const BUSHES = [];
for (let attempt = 0; BUSHES.length < 14 && attempt < 4000; attempt++) {
  const angle = random() * Math.PI * 2, radius = 7 + Math.sqrt(random()) * 19.5;
  const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius, size = 0.7 + random() * 0.5;
  if (!far(FLOWERS, x, z, 2.3) || !far(TREES, x, z, 2.8) || !far(BUSHES, x, z, 3.4) || streamDistance(x, z) < size + 0.9) continue;
  BUSHES.push({ id: BUSHES.length, x, z, size, height: size * 1.25 });
}

// Simple collision volumes. Cylinders stand on the ground; spheres float (canopies, flower heads).
// `owner` names the tree or flower, so a toppled one can be ignored until it stands up again.
export const OBSTACLES = Object.freeze([
  { kind: 'hive', owner: 'hive', shape: 'cylinder', x: 0, z: 0, r: WORLD.hive.radius, bottom: 0, top: WORLD.hive.height },
  ...TREES.filter(t => t.inside).flatMap(t => [
    { kind: 'tree', owner: `tree:${t.id}`, shape: 'cylinder', x: t.x, z: t.z, r: 0.32, bottom: 0, top: t.height + 0.4 },
    { kind: 'tree', owner: `tree:${t.id}`, shape: 'sphere', x: t.x, y: t.height + 0.9, z: t.z, r: t.canopy },
  ]),
  ...FLOWERS.flatMap(f => [
    { kind: 'flower', owner: `flower:${f.id}`, shape: 'cylinder', x: f.x, z: f.z, r: f.head > 0.6 ? 0.16 : 0.1, bottom: 0, top: f.height },
    { kind: 'flower', owner: `flower:${f.id}`, shape: 'sphere', x: f.x, y: f.height, z: f.z, r: f.head * 0.8 },
  ]),
  ...BUSHES.map(b => ({ kind: 'bush', owner: `bush:${b.id}`, shape: 'sphere', x: b.x, y: b.size * 0.45, z: b.z, r: b.size * 0.95 })),
]);

// Closest surface point of an obstacle to a position, as a push-out normal and separation.
export function contact(o, x, y, z) {
  if (o.shape === 'sphere') {
    const dx = x - o.x, dy = y - o.y, dz = z - o.z, d = Math.hypot(dx, dy, dz) || 1e-6;
    return { nx: dx / d, ny: dy / d, nz: dz / d, gap: d - o.r };
  }
  const dx = x - o.x, dz = z - o.z, h = Math.hypot(dx, dz) || 1e-6;
  if (y >= o.bottom && y <= o.top) return { nx: dx / h, ny: 0, nz: dz / h, gap: h - o.r };
  const cy = y > o.top ? o.top : o.bottom, inside = h <= o.r;
  const px = inside ? x : o.x + dx / h * o.r, pz = inside ? z : o.z + dz / h * o.r;
  const ex = x - px, ey = y - cy, ez = z - pz, d = Math.hypot(ex, ey, ez) || 1e-6;
  return { nx: ex / d, ny: ey / d, nz: ez / d, gap: d };
}
