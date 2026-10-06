import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFlower, createHoneyDrop, createBumblebee, createBurst, createDizzyStars, createHiveModel } from '../../src/games/hive/features/models.js';

// Plain Node: no document, no canvas. Every model must build and animate regardless.
const triangles = object => { let total = 0; object.traverse(node => { const g = node.geometry; if (g) total += (g.index ? g.index.count : g.attributes.position.count) / 3 * (node.isInstancedMesh ? node.count : 1); }); return total; };
const named = (object, name) => { const found = []; object.traverse(node => node.name === name && found.push(node)); return found; };
const box = object => { object.updateMatrixWorld(true); return new THREE.Box3().setFromObject(object); };
const size = object => box(object).getSize(new THREE.Vector3());
const finite = object => { object.updateMatrixWorld(true); let ok = true; object.traverse(node => { for (const v of node.matrixWorld.elements) if (!Number.isFinite(v)) ok = false; }); return ok; };
const world = object => { object.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(object.matrixWorld); };
// Share of triangles whose winding faces away from `center` (1 = every face is outward).
function outward(geometry, center = new THREE.Vector3()) {
  const p = geometry.attributes.position, ix = geometry.index, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); let good = 0, total = 0;
  for (let i = 0; i < ix.count; i += 3) {
    a.fromBufferAttribute(p, ix.getX(i)); b.fromBufferAttribute(p, ix.getX(i + 1)); c.fromBufferAttribute(p, ix.getX(i + 2));
    const normal = b.clone().sub(a).cross(c.clone().sub(a)); if (normal.lengthSq() < 1e-12) continue;
    total++; if (normal.dot(a.add(b).add(c).divideScalar(3).sub(center)) > 0) good++;
  }
  return good / total;
}
function maxEmissive(object) { let max = 0; object.traverse(node => { for (const m of [node.material].flat()) if (m?.emissiveIntensity !== undefined && m.emissive?.getHex()) max = Math.max(max, m.emissiveIntensity); }); return max; }

test('models build without a DOM', () => { assert.equal(typeof document, 'undefined'); });

test('flowers: sturdy curved stem, layered head, honey drop slot above it, bounded triangle count', t => {
  const counts = [];
  for (const [height, seed] of [[0.6, 1], [1.4, 2], [2.6, 3], [3.2, 4], [3.3, 5], [4.8, 6], [4.8, 7]]) {
    const flower = createFlower({ color: '#e68f9e', height, seed }), { group } = flower;
    assert.equal(flower.headY, height); assert.ok(flower.nectarY > flower.headY); assert.equal(flower.nectarY, height + 0.8);
    assert.ok(named(group, 'stem').length === 1 && named(group, 'head').length === 1 && triangles(group) < 1500, `${height}/${seed}`); counts.push(triangles(group));
    const b = box(group); assert.ok(b.min.y > -0.1 && b.max.y > height && b.max.y < height + 1.3, `extent ${b.min.y}..${b.max.y}`);
    const head = size(named(group, 'head')[0]), stem = size(named(group, 'stem')[0]);
    assert.ok(Math.max(head.x, head.z) > 0.9 * (height > 3.2 ? 1.5 : 0.85), `head ${head.x}`); assert.ok(stem.y >= height * 0.95, 'stem reaches the head');
    assert.ok(flower.headRadius >= (height > 3.2 ? 0.8 : 0.5) && flower.headRadius <= (height > 3.2 ? 1.0 : 0.65), `radius ${flower.headRadius}`);
  }
  t.diagnostic(`flower triangles: ${counts.join(', ')}`);
});
test('flower variation is deterministic per seed and sways only a few degrees', () => {
  const positions = f => named(f.group, 'head')[0].geometry.attributes.position.array, a = createFlower({ height: 2, seed: 9 }), b = createFlower({ height: 2, seed: 9 }), c = createFlower({ height: 2, seed: 10 });
  assert.deepEqual(Array.from(positions(a)), Array.from(positions(b))); assert.notDeepEqual(Array.from(positions(a)), Array.from(positions(c)));
  const heads = new Set(Array.from({ length: 12 }, (_, i) => createFlower({ height: 1.5, seed: i }).group.getObjectByName('head').geometry.attributes.position.count)); assert.ok(heads.size > 1, 'petal counts vary');
  const rest = world(named(a.group, 'head')[0].parent), tops = [];
  for (let i = 0; i < 200; i++) { a.update(i * 0.05); tops.push(world(named(a.group, 'head')[0].parent).distanceTo(rest)); }
  assert.ok(Math.max(...tops) > 0.005 && Math.max(...tops) < 0.4, `sway ${Math.max(...tops)}`);
  assert.ok(finite(a.group));
});

test('honey drop: glossy gold teardrop with additive glow and sparkles', t => {
  const { group } = createHoneyDrop(), drop = named(group, 'drop')[0], sprite = group.getObjectByProperty('isSprite', true);
  assert.ok(triangles(group) < 800); t.diagnostic(`honey drop triangles: ${triangles(group)}`);
  assert.ok(drop.material.isMeshPhysicalMaterial && drop.material.clearcoat === 1 && drop.material.roughness <= 0.2 && drop.material.emissiveIntensity <= 0.8);
  assert.equal(sprite.material.blending, THREE.AdditiveBlending); assert.equal(sprite.material.depthWrite, false); assert.ok(sprite.material.map.isDataTexture && sprite.material.map.colorSpace === THREE.SRGBColorSpace);
  const d = size(drop); assert.ok(d.y > 0.4 && d.y < 0.5 && d.x > 0.35 && d.x < 0.46, `drop ${d.x}x${d.y}`);
  assert.ok(group.children[1].isInstancedMesh && group.children[1].count === 5, 'five sparkles in one draw call');
});
test('honey drop bobs, pops within 0.25s, hides, then springs back with an overshoot', () => {
  const { group, update } = createHoneyDrop(), body = group.getObjectByName('drop-body'); let elapsed = 0, ys = [];
  const step = (available, dt = 1 / 60) => { elapsed += dt; update(dt, elapsed, available); };
  for (let i = 0; i < 180; i++) { step(true); ys.push(body.position.y); assert.equal(body.scale.x, 1); assert.ok(group.visible); }
  assert.ok(Math.max(...ys) > 0.1 && Math.max(...ys) <= 0.12 + 1e-9 && Math.min(...ys) < -0.1 && Math.min(...ys) >= -0.12 - 1e-9, 'bob is +-0.12');
  let peak = 0, far = 0, shrunkAt = null, t = 0; const m = new THREE.Matrix4();
  for (let i = 0; i < 30; i++) { step(false); t += 1 / 60; peak = Math.max(peak, body.scale.x); if (shrunkAt === null && body.scale.x === 0) shrunkAt = t; for (let k = 0; k < 5; k++) { group.children[1].getMatrixAt(k, m); far = Math.max(far, Math.hypot(m.elements[12], m.elements[14])); } }
  assert.ok(peak > 1.3 && peak <= 1.41, `pop peak ${peak}`); assert.ok(shrunkAt <= 0.26, `gone after ${shrunkAt}`); assert.ok(far > 1, `sparkles fly out ${far}`);
  assert.equal(group.visible, false); assert.equal(body.scale.x, 0);
  for (let i = 0; i < 60; i++) { step(false); assert.equal(group.visible, false); }
  let high = 0, first = null; for (let i = 0; i < 45; i++) { step(true); if (first === null) first = body.scale.x; high = Math.max(high, body.scale.x); if (i === 1) assert.ok(group.visible && body.scale.x > 0 && body.scale.x < 1); }
  assert.ok(first < 0.5, 'starts small'); assert.ok(high > 1.05 && high < 1.3, `overshoot ${high}`); assert.ok(Math.abs(body.scale.x - 1) < 1e-9); assert.ok(finite(group));
});
test('honey drop hit mid-pop regrows from its current size, and a drop that starts unavailable never pops', () => {
  const { group, update } = createHoneyDrop(), body = group.getObjectByName('drop-body'); let e = 0; const step = (a, dt = 1 / 60) => update(dt, e += dt, a);
  step(true); step(false); step(false); step(false); const mid = body.scale.x; step(true); assert.ok(body.scale.x > 0 && Math.abs(body.scale.x - mid) < 0.5);
  for (let i = 0; i < 60; i++) step(true); assert.equal(body.scale.x, 1);
  const cold = createHoneyDrop(); cold.update(1 / 60, 0, false); assert.equal(cold.group.visible, false); cold.update(1 / 60, 1 / 60, false); assert.equal(cold.group.visible, false);
});

test('bumblebee: big, chubby, faces +Z, fuzzy, within the triangle budget', t => {
  const bee = createBumblebee(), { group } = bee, s = size(group);
  assert.ok(triangles(group) < 15000); t.diagnostic(`bumblebee triangles: ${triangles(group)}`);
  assert.ok(s.x > 1.2 && s.x < 2.2 && s.y > 1.2 && s.y < 2.0 && s.z > 2 && s.z < 3, `size ${s.x} ${s.y} ${s.z}`);
  const eyes = [...named(group, 'eye-1'), ...named(group, 'eye1')]; assert.equal(eyes.length, 2);
  for (const eye of eyes) assert.ok(world(eye).z > 0.8, 'eyes face forward (+Z)'); assert.ok(world(eyes[0]).x * world(eyes[1]).x < 0);
  assert.ok(outward(named(group, 'bee-body')[0].geometry, new THREE.Vector3(0, 0, -0.12)) > 0.97, 'body faces outward');
  const fur = []; group.traverse(n => n.isInstancedMesh && fur.push(n)); assert.ok(fur.length >= 2 && fur.reduce((n, m) => n + m.count, 0) >= 500, 'fur instances');
  assert.ok(named(group, 'bee-body')[0].material.vertexColors); assert.ok(maxEmissive(group) <= 0.8);
});
test('bumblebee animates children only: wings flap, speed sways, stun wobbles, position untouched', () => {
  const run = (state, seconds = 4) => {
    const bee = createBumblebee(), body = bee.group.children[0], wings = bee.group.children[0].children.filter(c => c.isGroup && c.position.y > 0.5), roll = [], pitch = [], flap = []; let e = 0;
    for (let i = 0; i < seconds * 30; i++) { e += 1 / 30; bee.update(1 / 30, e, state); roll.push(Math.abs(body.rotation.z)); pitch.push(body.rotation.x); flap.push(wings[1].rotation.z); }
    assert.ok(finite(bee.group)); assert.deepEqual(bee.group.position.toArray(), [0, 0, 0]); assert.deepEqual(bee.group.rotation.toArray().slice(0, 3), [0, 0, 0]); assert.equal(wings.length, 2);
    return { roll: Math.max(...roll), pitch: pitch.reduce((a, b) => a + b) / pitch.length, flap: Math.max(...flap) - Math.min(...flap) };
  };
  const idle = run(), fast = run({ speed: 12 }), dizzy = run({ stunned: true }), bare = run(undefined);
  assert.ok(idle.flap > 0.5, `flap ${idle.flap}`); assert.ok(fast.pitch > idle.pitch + 0.1, 'leans into speed'); assert.ok(dizzy.roll > idle.roll * 3 && dizzy.roll > 0.2, `dizzy ${dizzy.roll} vs ${idle.roll}`);
  assert.ok(dizzy.flap < idle.flap, 'stunned wings flap lazily'); assert.ok(bare.flap > 0.5);
  const bee = createBumblebee(); bee.update(0.016, 1, null); bee.update(0, 1, { speed: 0, stunned: true });
});

test('burst pool never grows: overflow reuses the oldest slots and everything dies out', () => {
  const scene = new THREE.Scene(), burst = createBurst(scene, { max: 64 }), { mesh } = burst, matrices = mesh.instanceMatrix.array, colors = mesh.instanceColor.array;
  assert.equal(scene.children.length, 1); assert.equal(scene.children[0], mesh); assert.equal(mesh.frustumCulled, false); assert.equal(mesh.count, 64); assert.equal(burst.alive, 0);
  for (let i = 0; i < 50; i++) burst.emit(new THREE.Vector3(i, 1, 0), { count: 18 });
  assert.equal(burst.alive, 64); assert.equal(mesh.count, 64); assert.equal(scene.children.length, 1); assert.equal(mesh.instanceMatrix.array, matrices); assert.equal(mesh.instanceColor.array, colors); assert.equal(matrices.length, 64 * 16);
  burst.emit({ x: 0, y: 0, z: 0 }, { count: 10000 }); assert.equal(burst.alive, 64);
  burst.update(0.1); assert.ok(burst.alive > 0 && matrices.every(Number.isFinite));
  for (let i = 0; i < 100; i++) burst.update(1 / 60);
  assert.equal(burst.alive, 0); for (let i = 0; i < 64; i++) assert.ok(matrices[i * 16] === 0 || Object.is(matrices[i * 16], -0), 'dead slots are scaled to zero');
  for (let frame = 0; frame < 2000; frame++) { if (frame % 3 === 0) burst.emit({ x: 0, y: 2, z: 0 }, { count: 7, life: 0.4 }); burst.update(1 / 60); assert.ok(burst.alive <= 64); }
  assert.equal(scene.children.length, 1); assert.equal(mesh.instanceMatrix.array.length, 64 * 16);
});
test('burst particles obey colour, gravity, spread and shrink with age', () => {
  const scene = new THREE.Scene(), burst = createBurst(scene, { max: 32 }), { mesh } = burst, m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  burst.emit({ x: 1, y: 5, z: 2 }, { count: 1, speed: 0, gravity: -10, color: '#ff0000', size: 0.2, life: 1 }); mesh.getMatrixAt(0, m); m.decompose(p, q, s); assert.deepEqual([p.x, p.y, p.z], [1, 5, 2]);
  const grown = []; for (let i = 0; i < 20; i++) { burst.update(0.05); mesh.getMatrixAt(0, m); m.decompose(p, q, s); grown.push(s.x); }
  assert.ok(p.y < 5 && p.x === 1 && p.z === 2, 'falls straight down'); assert.ok(grown.at(-1) < Math.max(...grown), 'shrinks towards the end of its life'); assert.ok(mesh.instanceColor.array[0] > 0.5 && mesh.instanceColor.array[1] < 0.2);
  const up = createBurst(new THREE.Scene(), { max: 64 }); up.emit({ x: 0, y: 0, z: 0 }, { count: 40, speed: 3, spread: 0, gravity: 0 }); up.update(0.1);
  for (let i = 0; i < 40; i++) { up.mesh.getMatrixAt(i, m); m.decompose(p, q, s); assert.ok(p.y > 0.1 && Math.hypot(p.x, p.z) < 1e-6, 'spread 0 fires straight up'); }
  const ball = createBurst(new THREE.Scene(), { max: 64 }); ball.emit({ x: 0, y: 0, z: 0 }, { count: 60, speed: 3, spread: 1, gravity: 0 }); ball.update(0.1); let below = 0, above = 0;
  for (let i = 0; i < 60; i++) { ball.mesh.getMatrixAt(i, m); m.decompose(p, q, s); if (p.y < 0) below++; else above++; } assert.ok(below > 10 && above > 10, 'spread 1 is a full sphere');
});

test('dizzy stars: three yellow stars circling at ~0.45 and bobbing', t => {
  const { group, update } = createDizzyStars(), stars = group.children;
  assert.equal(stars.length, 3); assert.ok(stars.every(s => s.isMesh && s.material.emissiveIntensity <= 0.8)); assert.ok(triangles(group) < 1000); t.diagnostic(`dizzy stars triangles: ${triangles(group)}`);
  const start = stars.map(s => s.position.clone()); let moved = 0, ys = [];
  for (let i = 1; i <= 60; i++) { update(i / 30); for (const [k, s] of stars.entries()) { assert.ok(Math.abs(Math.hypot(s.position.x, s.position.z) - 0.45) < 1e-9); ys.push(s.position.y); moved = Math.max(moved, s.position.distanceTo(start[k])); } }
  assert.ok(moved > 0.5 && Math.max(...ys) - Math.min(...ys) > 0.04 && Math.max(...ys) < 0.1); assert.ok(finite(group));
  const [a, b] = [stars[0].position.clone(), stars[1].position.clone()]; assert.ok(a.distanceTo(b) > 0.5, 'stars are spread around the ring');
});

test('hive: same footprint as the old cylinder, entrance towards +Z, glowing ring and beacon', t => {
  const { group, ring, beacon, update } = createHiveModel(), skep = named(group, 'skep')[0], b = box(skep), base = box(named(group, 'base')[0]);
  assert.ok(triangles(group) < 8000); t.diagnostic(`hive triangles: ${triangles(group)}`);
  assert.ok(Math.max(b.max.x, b.max.z, -b.min.x, -b.min.z) <= 2.3 && Math.max(b.max.x, -b.min.x) > 2.1, `radius ${b.max.x}`); assert.ok(b.max.y <= 4.21 && b.max.y > 3.8 && b.min.y >= 0.2, `skep y ${b.min.y}..${b.max.y}`);
  assert.ok(Math.abs(base.max.y - 0.3) < 1e-6 && base.min.y >= 0 && base.max.x > 2.95 && base.max.x < 3.1);
  assert.ok(named(skep, 'coil').length >= 6 && named(group, 'coil').every(c => c.material.vertexColors), 'stacked straw rings');
  const door = box(named(group, 'entrance')[0]); assert.ok(door.min.z > 1.8 && Math.abs((door.min.x + door.max.x) / 2) < 0.01 && door.min.y > 0.2 && door.max.y > 1.3 && door.max.y < 1.6, `entrance ${door.min.toArray()} ${door.max.toArray()}`);
  assert.ok(named(group, 'hole').length === 1); assert.ok(named(group, 'drip').length >= 4);
  assert.equal(ring.parent, group); assert.equal(beacon.parent, group); assert.equal(ring.geometry.parameters.radius, 3.2); assert.equal(ring.position.y, 0.22); assert.ok(Math.abs(ring.rotation.x + Math.PI / 2) < 1e-9); assert.equal(ring.material.emissive.getHexString(), 'f1cb5e');
  for (const drip of named(group, 'drip')) { const g = drip.geometry, p = g.attributes.position, n = g.attributes.normal; let good = 0; for (let i = 0; i < p.count; i++) if (n.getX(i) * (p.getX(i) + drip.position.x) + n.getZ(i) * (p.getZ(i) + drip.position.z) > 0) good++; assert.ok(good / p.count > 0.9, 'drips face outward'); }
  assert.ok(maxEmissive(group) <= 0.8);
  let scaleAt = h => { let max = 1, min = 1, tops = []; for (let i = 0; i < 400; i++) { update(i * 0.02, h); max = Math.max(max, ring.scale.x); min = Math.min(min, ring.scale.x); tops.push(beacon.position.y); assert.ok(ring.material.emissiveIntensity <= 0.8 + 1e-9); } return { max, min, tops }; };
  const calm = scaleAt(0), loud = scaleAt(1);
  assert.ok(calm.max > 1.02 && calm.max < 1.03 && calm.min < 0.98); assert.ok(loud.max > 1.1 && loud.max < 1.13, `highlight ${loud.max}`); assert.ok(Math.min(...calm.tops) > 4.5 && Math.max(...calm.tops) < 5.1);
  const drips = named(group, 'drip'); update(0, 0); const lengths = drips.map(d => d.scale.y); update(3, 0); assert.ok(drips.some((d, i) => d.scale.y !== lengths[i]) && drips.every(d => d.scale.y >= 1 && d.scale.y <= 1.07 + 1e-9), 'drips stretch slowly');
  update(5, 0.5); assert.ok(finite(group));
});
