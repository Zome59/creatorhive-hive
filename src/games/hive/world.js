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
  const height = 2.3 + random() * 1.6;
  TREES.push({ id: i, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, height, canopy: 1.35 + random() * 0.35, inside: true });
}
for (let i = 0; i < 16; i++) {
  const angle = i * Math.PI * 2 / 16 + 0.12, radius = 29.6 + random() * 0.8;
  TREES.push({ id: TREES.length, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, height: 1.9 + random() * 1.9, canopy: 1 + random() * 0.4, inside: false });
}

// Flowers come in three heights so altitude control matters: meadow, mid, and tall sunflowers.
export const FLOWERS = [];
for (let attempt = 0; FLOWERS.length < 28 && attempt < 4000; attempt++) {
  const angle = random() * Math.PI * 2, radius = 6.5 + Math.sqrt(random()) * 19.5;
  const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
  if (!far(FLOWERS, x, z, 3.4) || !far(TREES, x, z, 3.6)) continue;
  const tier = FLOWERS.length % 3, height = [0.7 + random() * 0.5, 1.7 + random() * 0.9, 3.5 + random() * 1.2][tier];
  FLOWERS.push({ id: FLOWERS.length, x, z, height, head: tier === 2 ? 0.9 : 0.55, y: height + 0.8, color: FLOWERS.length });
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
