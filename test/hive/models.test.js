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
  assert.ok(triangles(group) < 20000); t.diagnostic(`bumblebee triangles: ${triangles(group)}`);
  assert.ok(s.x > 1.2 && s.x < 2.2 && s.y > 1.2 && s.y < 2.0 && s.z > 2 && s.z < 3, `size ${s.x} ${s.y} ${s.z}`);
  const eyes = [...named(group, 'eye-1'), ...named(group, 'eye1')]; assert.equal(eyes.length, 2);
  for (const eye of eyes) assert.ok(world(eye).z > 0.8, 'eyes face forward (+Z)'); assert.ok(world(eyes[0]).x * world(eyes[1]).x < 0);
  assert.ok(outward(named(group, 'bee-body')[0].geometry, new THREE.Vector3(0, 0, -0.12)) > 0.97, 'body faces outward');
  const fur = [...named(group, 'bee-fur'), ...named(group, 'bee-head-fur')]; assert.equal(fur.length, 2); assert.ok(fur.reduce((n, m) => n + m.userData.tufts, 0) >= 500, 'fur tufts');
  assert.ok(named(group, 'bee-body')[0].material.vertexColors); assert.ok(maxEmissive(group) <= 0.8);
});
test('bumblebee is built from clean geometry: smooth finely-segmented body, uniform scales, unit normals, tidy fur', () => {
  const { group } = createBumblebee(); group.updateMatrixWorld(true);
  // Nothing is stretched by its mesh transform: body, head, eyes, fur, wings and limbs are baked at their final proportions. Only the proboscis (a straight tube whose length is its scale) may differ.
  const stretched = []; group.traverse(n => { if (n.isMesh && !n.name.startsWith('proboscis') && (Math.abs(n.scale.x - n.scale.y) > 1e-9 || Math.abs(n.scale.y - n.scale.z) > 1e-9)) stretched.push(n.name || n.geometry.type); });
  assert.deepEqual(stretched, [], 'no non-uniformly scaled meshes');
  for (const name of ['bee-body', 'head', 'bee-fur', 'bee-head-fur', 'eye-1', 'eye1', 'snout']) for (const m of named(group, name)) assert.deepEqual(m.scale.toArray(), [1, 1, 1], `${name} keeps scale 1`);
  const bodyMesh = named(group, 'bee-body')[0], g = bodyMesh.geometry, n = g.attributes.normal, p = g.attributes.position;
  assert.ok(p.count >= 40 * 40, `body is finely segmented (${p.count} vertices)`); assert.ok(g.attributes.uv && g.attributes.color && g.index);
  for (const m of [bodyMesh, ...named(group, 'bee-fur'), ...named(group, 'bee-head-fur'), ...named(group, 'head')]) { const nn = m.geometry.attributes.normal; let worst = 0; for (let i = 0; i < nn.count; i++) worst = Math.max(worst, Math.abs(Math.hypot(nn.getX(i), nn.getY(i), nn.getZ(i)) - 1)); assert.ok(worst < 1e-3, `${m.name} normals are unit length (${worst})`); }
  // No crease between thorax and abdomen: normals of neighbouring rings (45 vertices per ring, one extra closes the seam) turn by only a few degrees.
  const a = new THREE.Vector3(), b = new THREE.Vector3(), W = 45; let turn = 0; for (let ring = 2; ring < 42; ring++) { a.fromBufferAttribute(n, ring * W + 7); b.fromBufferAttribute(n, (ring + 1) * W + 7); turn = Math.max(turn, a.angleTo(b)); }
  assert.ok(turn < 0.3, `rings turn by at most ${turn} rad`);
  // Fur: each tuft is a small cone (6 base vertices + apex) of about the same size, buried in the body, standing on the surface normal.
  const fur = named(group, 'bee-fur')[0], T = 7, fp = fur.geometry.attributes.position, count = fur.userData.tufts; assert.ok(count > 600 && fur.geometry.attributes.uv && !fur.castShadow && !fur.receiveShadow);
  const base = new THREE.Vector3(), apex = new THREE.Vector3(), axis = new THREE.Vector3(), v = new THREE.Vector3(), nv = new THREE.Vector3(), heights = []; let aligned = 0, buried = 0;
  for (let i = 0; i < count; i++) {
    apex.fromBufferAttribute(fp, i * T + 6); base.set(0, 0, 0); for (let k = 0; k < 6; k++) base.add(v.fromBufferAttribute(fp, i * T + k)); base.divideScalar(6); axis.copy(apex).sub(base); heights.push(axis.length()); axis.normalize();
    let best = 0, bestD = Infinity; for (let k = 0; k < p.count; k++) { const d = v.fromBufferAttribute(p, k).distanceToSquared(base); if (d < bestD) { bestD = d; best = k; } }
    nv.fromBufferAttribute(n, best); if (axis.dot(nv) > 0.9) aligned++; if (v.fromBufferAttribute(p, best).sub(base).dot(nv) > 0) buried++;
  }
  const mean = heights.reduce((x, y) => x + y) / count; assert.ok(heights.every(h => h > mean * 0.7 && h < mean * 1.3), 'tufts are uniform in size'); assert.ok(mean > 0.05 && mean < 0.12, `tuft height ${mean}`);
  assert.ok(aligned / count > 0.97, `tufts follow the surface normal (${aligned}/${count})`); assert.ok(buried / count > 0.97, `tuft bases are buried in the body (${buried}/${count})`);
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

// Handles to the animated parts of a bumblebee, found by structure and name (the same way the animation test above finds the wings).
const beeParts = bee => {
  const group = bee.group, body = group.children[0], head = named(group, 'bee-head')[0], knee = hip => hip.children.find(c => c.isGroup), tipOf = antenna => antenna.children.find(c => c.isGroup);
  const antennae = head.children.filter(c => c.isGroup && c.name !== 'proboscis');
  return { group, body, head, torso: named(group, 'bee-body')[0], fur: named(group, 'bee-fur')[0], prob: named(group, 'proboscis')[0], tube: named(group, 'proboscis-tube')[0], tip: named(group, 'proboscis-tip')[0], eyes: [...named(group, 'eye-1'), ...named(group, 'eye1')], antennae, antennaTips: antennae.map(tipOf),
    hinges: body.children.filter(c => c.isGroup && c.position.y > 0.5), hips: body.children.filter(c => c.isGroup && c.position.y < -0.3), knees: body.children.filter(c => c.isGroup && c.position.y < -0.3).map(knee) };
};
// Steps a bee `seconds` at `fps`, starting at elapsed `from`; `each(elapsed)` runs after every update. Returns the final elapsed time.
const play = (bee, state, seconds, from = 0, fps = 30, each) => { let e = from; for (let i = 0; i < Math.round(seconds * fps); i++) { e += 1 / fps; bee.update(1 / fps, e, state); each?.(e); } return e; };
const mean = values => values.reduce((a, b) => a + b, 0) / values.length, spread = values => Math.max(...values) - Math.min(...values);
const legPose = p => [...p.hips.flatMap(h => [h.rotation.x, h.rotation.z]), ...p.knees.flatMap(k => [k.rotation.x, k.rotation.z])];

test('bumblebee proboscis: hidden unless perched and sucking, then it hangs straight down from the mouth and pulses', () => {
  const rest = createBumblebee(), r = beeParts(rest), before = size(rest.group).toArray();
  assert.ok(r.prob && r.tube && r.tip && r.prob.parent === r.head); assert.equal(r.prob.visible, false, 'starts hidden'); assert.equal(r.torso.morphTargetInfluences[0], 0);
  for (const state of [{}, { speed: 12 }, { stunned: true }, { perched: true }, { sucking: true }, { flailing: true, sucking: true }, { perched: true, sucking: true, flailing: true }]) { const bee = createBumblebee(), p = beeParts(bee); play(bee, state, 3); assert.equal(p.prob.visible, false, `hidden for ${JSON.stringify(state)}`); }
  assert.deepEqual(size(rest.group).toArray(), before, 'a hidden proboscis adds nothing to the bounding box');
  const bee = createBumblebee(), p = beeParts(bee), lengths = []; let e = play(bee, { perched: true, sucking: true }, 5 / 30); assert.equal(p.prob.visible, true, 'visible after a few updates');
  e = play(bee, { perched: true, sucking: true }, 3, e); bee.group.updateMatrixWorld(true); const mouth = world(p.prob), tip = world(p.tip), hang = tip.clone().sub(mouth).normalize();
  assert.ok(p.tube.scale.y > 0.4 && p.tube.scale.y < 1, `length ${p.tube.scale.y}`); assert.ok(hang.y < -0.95, `hangs straight down whatever the head does: ${hang.toArray()}`); assert.ok(tip.y < mouth.y - 0.4 && mouth.y < -0.5, `mouth ${mouth.y}, tip ${tip.y}`);
  assert.ok(p.tube.material === p.tip.material && !p.tube.castShadow && !p.tip.castShadow);
  play(bee, { perched: true, sucking: true }, 2, e, 30, () => lengths.push(p.tube.scale.y)); assert.ok(spread(lengths) > 0.04, `the proboscis pulses (${spread(lengths)})`);
  play(bee, { perched: true }, 4, e + 2); assert.equal(p.prob.visible, false, 'hidden again once it stops sucking');
});

test('bumblebee perched pose settles lower, head down, legs gripping outward, wings folded, blended in without snapping', () => {
  const idle = createBumblebee(), i = beeParts(idle), sit = createBumblebee(), s = beeParts(sit), yIdle = [], pitchIdle = [], steps = []; let prev = null;
  play(idle, {}, 4, 0, 30, () => { yIdle.push(i.body.position.y); pitchIdle.push(i.body.rotation.x); });
  play(sit, { perched: true }, 4, 0, 30, () => { const now = [s.body.position.y, s.body.rotation.x]; if (prev) steps.push(Math.abs(now[0] - prev[0]), Math.abs(now[1] - prev[1])); prev = now; });
  assert.ok(s.body.position.y < mean(yIdle) - 0.12, `settles lower: ${s.body.position.y} vs ${mean(yIdle)}`); assert.ok(s.body.rotation.x > mean(pitchIdle) + 0.2, `head down: ${s.body.rotation.x}`);
  assert.ok(s.hinges.every((h, k) => Math.abs(h.rotation.y) > Math.abs(i.hinges[k].rotation.y) + 0.5), 'wings sweep back'); assert.ok(s.hips.every((h, k) => Math.abs(h.rotation.z) > Math.abs(i.hips[k].rotation.z) + 0.15), 'legs reach outward');
  assert.ok(s.hips[0].rotation.x < s.hips[2].rotation.x - 0.4, 'front legs reach forward of the rear legs'); assert.ok(Math.max(...steps) < 0.04, `no snapping, biggest frame-to-frame step ${Math.max(...steps)}`);
  const flap = (bee, p, state) => { const zs = []; play(bee, state, 2, 10, 30, () => zs.push(p.hinges[1].rotation.z)); return spread(zs); }; assert.ok(flap(sit, s, { perched: true }) < 0.4 * flap(idle, i, {}), 'perched wings only rest or flutter slowly');
  const mid = createBumblebee(), m = beeParts(mid); play(mid, { perched: true }, 0.15, 0, 60); assert.ok(m.body.rotation.x > 0.02 && m.body.rotation.x < s.body.rotation.x - 0.05, `pose weight is partway after 0.15 s (${m.body.rotation.x})`);
  const off = createBumblebee(), o = beeParts(off); let e = play(off, { perched: true }, 3); assert.ok(o.body.position.y < -0.12); play(off, {}, 4, e); assert.ok(Math.abs(o.body.position.y) < 0.12 && o.body.rotation.x < 0.3, 'flies off again');
});

test('bumblebee drinking: abdomen gulps at about 1.5 Hz as a real surface swell, antennae twitch', () => {
  const gulp = createBumblebee(), g = beeParts(gulp), calm = createBumblebee(), c = beeParts(calm), swell = [], twitch = [], still = []; play(gulp, { perched: true, sucking: true }, 3); play(calm, { perched: true }, 3);
  play(gulp, { perched: true, sucking: true }, 4, 3, 120, () => { swell.push(g.torso.morphTargetInfluences[0]); twitch.push(g.antennae[0].rotation.x + g.antennaTips[0].rotation.x); assert.equal(g.fur.morphTargetInfluences[0], g.torso.morphTargetInfluences[0], 'the fur swells with the body'); });
  play(calm, { perched: true }, 4, 3, 120, () => still.push(c.antennae[0].rotation.x + c.antennaTips[0].rotation.x));
  let peaks = 0; for (let k = 1; k < swell.length - 1; k++) if (swell[k] > swell[k - 1] && swell[k] >= swell[k + 1] && swell[k] > 0.5) peaks++;
  assert.ok(peaks >= 5 && peaks <= 7, `${peaks} gulps in 4 s`); assert.ok(Math.max(...swell) > 0.9 && Math.min(...swell) < 0.3 && Math.min(...swell) >= 0, `swell ${Math.min(...swell)}..${Math.max(...swell)}`); assert.ok(spread(twitch) > spread(still) + 0.15, 'antennae twitch while drinking');
  const rear = (influence) => { g.torso.morphTargetInfluences[0] = influence; let widest = 0; const v = new THREE.Vector3(); for (let k = 0; k < g.torso.geometry.attributes.position.count; k++) { g.torso.getVertexPosition(k, v); if (v.z < -0.5) widest = Math.max(widest, Math.hypot(v.x, v.y)); } return widest; };
  const relaxed = rear(0), swollen = rear(1); assert.ok(swollen > relaxed + 0.04 && swollen < relaxed + 0.07, `abdomen grows ${swollen - relaxed}`);
  const furTop = fur => { fur.morphTargetInfluences[0] = 1; const v = new THREE.Vector3(); let max = 0; for (let k = 0; k < fur.geometry.attributes.position.count; k++) { fur.getVertexPosition(k, v); if (v.z < -0.5) max = Math.max(max, Math.hypot(v.x, v.y)); } return max; };
  g.fur.morphTargetInfluences[0] = 0; const furRelaxed = (() => { let max = 0; const v = new THREE.Vector3(); for (let k = 0; k < g.fur.geometry.attributes.position.count; k++) { g.fur.getVertexPosition(k, v); if (v.z < -0.5) max = Math.max(max, Math.hypot(v.x, v.y)); } return max; })(); assert.ok(furTop(g.fur) > furRelaxed + 0.04, 'fur tufts move out with the abdomen');
});

test('bumblebee flailing: legs and antennae thrash, wings buzz, eyes stay, eases in and cancels the perch', () => {
  const quiet = createBumblebee(), q = beeParts(quiet), wild = createBumblebee(), w = beeParts(wild), eyes = w.eyes.map(x => x.position.clone()), eyeTurns = w.eyes.map(x => x.quaternion.clone()); let legDiff = 0, antDiff = 0, frames = 0, t = 0;
  for (let k = 0; k < 90; k++) { t += 1 / 30; quiet.update(1 / 30, t, {}); wild.update(1 / 30, t, { flailing: true }); if (k >= 15) { const a = legPose(q), b = legPose(w); legDiff += mean(a.map((x, j) => Math.abs(x - b[j]))); antDiff += Math.abs(q.antennae[0].rotation.x - w.antennae[0].rotation.x) + Math.abs(q.antennae[1].rotation.z - w.antennae[1].rotation.z); frames++; } }
  assert.ok(legDiff / frames > 0.3, `flailing legs differ from idle by ${legDiff / frames} rad on average`); assert.ok(antDiff / frames > 0.15, `antennae flail ${antDiff / frames}`);
  const crossings = (bee, p, state) => { let n = 0, prev = null; play(bee, state, 1, 20, 240, () => { const z = p.hinges[1].rotation.z; if (prev !== null && Math.sign(z - 0.5) !== Math.sign(prev - 0.5)) n++; prev = z; }); return n; };
  const buzz = crossings(wild, w, { flailing: true }), flutter = crossings(quiet, q, {}); assert.ok(buzz >= 24 && buzz > flutter * 1.2, `wings buzz faster than idle (${buzz} vs ${flutter} crossings per second)`); assert.ok(w.eyes.every((x, k) => x.position.distanceTo(eyes[k]) < 1e-9 && x.quaternion.angleTo(eyeTurns[k]) < 1e-9), 'eyes stay put');
  const early = createBumblebee(), ea = beeParts(early); play(early, {}, 1); const rest = legPose(ea); play(early, { flailing: true }, 1 / 30, 1); assert.ok(mean(legPose(ea).map((x, j) => Math.abs(x - rest[j]))) < 0.2, 'flailing eases in instead of snapping');
  const hit = createBumblebee(), h = beeParts(hit); play(hit, { perched: true, sucking: true }, 3); assert.equal(h.prob.visible, true); play(hit, { perched: true, sucking: true, flailing: true }, 2, 3); assert.equal(h.prob.visible, false, 'knocked off: the proboscis retracts'); assert.ok(h.body.position.y > -0.1, 'and the body leaves its perch pose');
});

test('bumblebee update stays backwards compatible, finite, and never moves the group', () => {
  const bees = [{}, { speed: 12 }, { stunned: true }, { perched: true }, { perched: true, sucking: true }, { flailing: true }, undefined, null].map(state => { const bee = createBumblebee(); play(bee, state, 3); return bee; });
  for (const bee of bees) { assert.ok(finite(bee.group)); assert.deepEqual(bee.group.position.toArray(), [0, 0, 0]); assert.deepEqual(bee.group.rotation.toArray().slice(0, 3), [0, 0, 0]); assert.deepEqual(bee.group.scale.toArray(), [1, 1, 1]); }
  const x = createBumblebee(), y = createBumblebee(), px = beeParts(x), py = beeParts(y); x.update(0.03, 2); x.update(0.03, 2.03, null); y.update(0.03, 2, {}); y.update(0.03, 2.03, { speed: 0, stunned: false, perched: false, sucking: false, flailing: false });
  assert.deepEqual(px.body.rotation.toArray().slice(0, 3), py.body.rotation.toArray().slice(0, 3)); assert.equal(px.body.position.y, py.body.position.y); assert.deepEqual(legPose(px), legPose(py));
  x.update(0, 3, { perched: true, sucking: true, speed: -5 }); x.update(NaN, 3, { perched: true }); x.update(-1, 3, { flailing: true }); assert.ok(finite(x.group)); assert.deepEqual(x.group.position.toArray(), [0, 0, 0]);
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
