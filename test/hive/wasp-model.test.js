import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWasp, WASP } from '../../src/games/hive/features/wasp-model.js';
import { createBumblebee } from '../../src/games/hive/features/models.js';

// Plain Node: no document, no canvas, no WebGL. The boss wasp must build, pose and animate regardless.
const MODES = ['fly', 'climb', 'flip', 'attack', 'confused', 'shake', 'onBack', 'rightItself', 'standing', 'kick', 'eat'];
const box = object => { object.updateMatrixWorld(true); return new THREE.Box3().setFromObject(object); };
const meshes = object => { const out = []; object.traverse(node => node.isMesh && out.push(node)); return out; };
const triangles = object => meshes(object).reduce((sum, m) => sum + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
const finite = object => { object.updateMatrixWorld(true); let ok = true; object.traverse(node => { for (const v of node.matrixWorld.elements) if (!Number.isFinite(v)) ok = false; }); return ok; };
const world = object => { object.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(object.matrixWorld); };
// Steps a wasp through `seconds` of one mode at `fps`, with the mode time t counted from `t0`. Returns the final elapsed time.
const play = (wasp, mode, seconds, { from = 0, t0 = 0, fps = 60, speed = 5, each } = {}) => {
  let e = from; for (let i = 1; i <= Math.round(seconds * fps); i++) { e += 1 / fps; wasp.update(1 / fps, e, { mode, t: t0 + i / fps, speed }); each?.(e); } return e;
};
// The whole pose as one vector: inner body offset and rotation plus every bone's rotation.
const pose = wasp => { const v = [...wasp.parts.body.position.toArray(), wasp.parts.body.rotation.x, wasp.parts.body.rotation.y, wasp.parts.body.rotation.z]; wasp.group.traverse(n => { if (n.isBone) v.push(n.rotation.x, n.rotation.y, n.rotation.z); }); return v; };
const distance = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
// Lowest point of the chitin in group space, with skinning applied (precise, not the cached bounding box).
const lowest = wasp => { wasp.group.updateMatrixWorld(true); const m = wasp.group.getObjectByName('wasp-chitin'), v = new THREE.Vector3(); let low = Infinity; for (let i = 0; i < m.geometry.attributes.position.count; i++) low = Math.min(low, m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).y); return low; };

test('wasp builds in Node without a DOM or WebGL and exposes its parts', () => {
  assert.equal(typeof document, 'undefined');
  const wasp = createWasp(), { parts } = wasp;
  assert.ok(wasp.group.isGroup && typeof wasp.update === 'function' && typeof wasp.hit === 'function');
  for (const key of ['body', 'head', 'abdomen', 'stinger', 'crown']) assert.ok(parts[key]?.isObject3D, key);
  for (const [key, n] of [['legs', 6], ['feet', 6], ['wings', 2], ['mandibles', 2], ['antennae', 2], ['eyes', 2]]) { assert.equal(parts[key].length, n, key); assert.ok(parts[key].every(p => p.isObject3D), key); }
  assert.ok(Object.isFrozen(WASP)); for (const key of ['length', 'groundClearance', 'climbEdgeZ']) assert.ok(Number.isFinite(WASP[key]) && WASP[key] > 0, key);
  for (const key of ['headOffset', 'stingerOffset']) assert.ok(['x', 'y', 'z'].every(k => Number.isFinite(WASP[key][k])), key);
  assert.deepEqual([...WASP.modes].sort(), [...MODES].sort());
  // Glossy chitin, glossy eyes; the chitin is one skinned mesh on the same skeleton as the eyes and glints.
  const chitin = wasp.group.getObjectByName('wasp-chitin'), eyes = wasp.group.getObjectByName('wasp-eyes');
  assert.ok(chitin.isSkinnedMesh && chitin.material.isMeshPhysicalMaterial && chitin.material.clearcoat === 1 && chitin.material.vertexColors);
  assert.ok(eyes.isSkinnedMesh && eyes.material.isMeshPhysicalMaterial && eyes.material.roughness <= 0.1 && eyes.skeleton === chitin.skeleton);
});

test('wasp is about 1.4x the bumblebee, faces +Z and is centred on its body', t => {
  const wasp = createWasp(), size = box(wasp.group).getSize(new THREE.Vector3()), bee = box(createBumblebee().group).getSize(new THREE.Vector3()), ratio = size.z / bee.z;
  t.diagnostic(`wasp ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}, bumblebee length ${bee.z.toFixed(2)}, ratio ${ratio.toFixed(3)}`);
  assert.ok(ratio >= 1.35 && ratio <= 1.55, `ratio ${ratio}`);
  assert.ok(Math.abs(size.z - WASP.length) < 0.05, `WASP.length ${WASP.length} vs ${size.z}`);
  assert.ok(size.z > size.x * 1.6, 'long and slender, not round');
  const head = world(wasp.parts.head), tip = world(wasp.parts.stinger), centre = box(wasp.group).getCenter(new THREE.Vector3());
  assert.ok(head.z > 0.5 && tip.z < -1.8, `head ${head.z}, stinger ${tip.z}`); assert.ok(Math.abs(centre.z) < 0.3 && Math.abs(centre.x) < 0.02, `centre ${centre.toArray()}`); // the origin sits in the thorax, between the legs
  assert.ok(Math.abs(tip.z - WASP.stingerOffset.z) < 0.02 && Math.abs(tip.y - WASP.stingerOffset.y) < 0.02, 'stingerOffset');
});

test('wasp stays within the budget: <= 30000 triangles and <= 28 meshes (draw calls)', t => {
  const wasp = createWasp(), n = meshes(wasp.group).length, tris = triangles(wasp.group);
  t.diagnostic(`${tris} triangles in ${n} meshes`);
  assert.ok(tris <= 30000, `${tris} triangles`); assert.ok(n <= 28, `${n} meshes`);
});

test('wasp is deterministic: two instances have identical geometry and rest pose', () => {
  const a = createWasp(), b = createWasp(), ma = meshes(a.group), mb = meshes(b.group);
  assert.equal(ma.length, mb.length);
  ma.forEach((m, i) => {
    const g = m.geometry, h = mb[i].geometry; assert.equal(m.name, mb[i].name);
    for (const name of Object.keys(g.attributes)) assert.deepEqual(Array.from(g.attributes[name].array), Array.from(h.attributes[name].array), `${m.name}.${name}`);
    assert.deepEqual(Array.from(g.index.array), Array.from(h.index.array), `${m.name} index`);
  });
  assert.deepEqual(pose(a), pose(b));
});

test('every mode animates 3 s without NaN, moves only the inner parts and never the group', t => {
  for (const mode of MODES) {
    const wasp = createWasp(), poses = [];
    play(wasp, mode, 3, { each: () => poses.push(pose(wasp)) });
    assert.ok(finite(wasp.group), `${mode}: finite world matrices`);
    assert.deepEqual(wasp.group.position.toArray(), [0, 0, 0], mode); assert.deepEqual(wasp.group.rotation.toArray().slice(0, 3), [0, 0, 0], mode); assert.deepEqual(wasp.group.scale.toArray(), [1, 1, 1], mode);
    const motion = Math.max(...poses.map(p => distance(p, poses[0])));
    assert.ok(motion > 0.15, `${mode} moves (${motion})`); assert.equal(wasp.mode, mode);
  }
  const wasp = createWasp(); wasp.update(0.016, 1, undefined); wasp.update(0.016, 1.016, { mode: 'nonsense' }); wasp.update(NaN, NaN, null); assert.ok(finite(wasp.group), 'tolerates missing or bad state');
});

test('switching modes blends over a few frames instead of snapping', () => {
  for (const [a, b] of [['fly', 'standing'], ['standing', 'kick'], ['standing', 'eat'], ['climb', 'flip'], ['fly', 'attack'], ['attack', 'confused'], ['fly', 'shake'], ['shake', 'fly'], ['onBack', 'rightItself'], ['flip', 'standing']]) {
    // Three identical wasps: one switches (blends), one stays in mode a, and a fresh one starts directly in mode b (an unblended snap).
    const wasp = createWasp(), stay = createWasp(), snap = createWasp(); let e = play(wasp, a, 1.2); play(stay, a, 1.2);
    e += 1 / 60; wasp.update(1 / 60, e, { mode: b, t: 1 / 60, speed: 5 }); stay.update(1 / 60, e, { mode: a, t: 1.2 + 1 / 60, speed: 5 }); snap.update(1 / 60, e, { mode: b, t: 1 / 60, speed: 5 });
    const total = distance(pose(snap), pose(stay)), jump = distance(pose(wasp), pose(stay));
    assert.ok(total > 0.2, `${a} -> ${b} differ (${total})`); assert.ok(jump < 0.35 * total, `${a} -> ${b}: first frame covers ${(jump / total * 100).toFixed(0)} % of the change`);
    play(wasp, b, 0.35, { from: e, t0: 1 / 60 }); play(snap, b, 0.35, { from: e, t0: 1 / 60 }); const left = distance(pose(wasp), pose(snap));
    assert.ok(left < 0.15 * total + 0.05, `${a} -> ${b}: blended within 0.35 s (${left.toFixed(3)} of ${total.toFixed(3)} left)`);
  }
});

test('standing plants the claws at -groundClearance; on its back the wasp rests on the same ground', () => {
  const standing = createWasp(); play(standing, 'standing', 1.5);
  for (const foot of standing.parts.feet) assert.ok(Math.abs(world(foot).y + WASP.groundClearance) < 0.01, `foot at ${world(foot).y}`);
  assert.ok(Math.abs(lowest(standing) + WASP.groundClearance) < 0.03, `nothing sinks into the ground (${lowest(standing)})`);
  const back = createWasp(); play(back, 'onBack', 1.5);
  assert.ok(Math.abs(Math.abs(back.parts.body.rotation.z) - Math.PI) < 0.15, 'belly up');
  assert.ok(Math.abs(lowest(back) + WASP.groundClearance) < 0.06, `back rests on the ground (${lowest(back)})`);
  assert.ok(back.parts.feet.every(f => world(f).y > -WASP.groundClearance + 0.4), 'legs in the air');
  // rightItself ends on its feet, in the standing pose, so the scene can switch to 'standing' at 1.2 s without a pop.
  const up = createWasp(); let e = play(up, 'onBack', 1); e = play(up, 'rightItself', 1.25, { from: e });
  for (const foot of up.parts.feet) assert.ok(Math.abs(world(foot).y + WASP.groundClearance) < 0.03, `landed foot at ${world(foot).y}`);
  const p = pose(up); up.update(1 / 60, e + 1 / 60, { mode: 'standing', t: 0 }); assert.ok(distance(pose(up), p) < 0.2, 'seamless hand-over to standing');
});

test('climbing: the front claws hook over the cliff edge at climbEdgeZ; the rest grip the face', () => {
  const wasp = createWasp(); let hooked = 0;
  play(wasp, 'climb', 3, { each: () => { for (const k of [0, 3]) { const f = world(wasp.parts.feet[k]); if (Math.abs(f.z - WASP.climbEdgeZ) < 0.15 && f.y < -WASP.groundClearance) hooked++; } } });
  assert.ok(hooked > 100, `front claws hooked over the edge for ${hooked} frames`);
  const mid = world(wasp.parts.feet[1]); assert.ok(mid.z < WASP.climbEdgeZ && mid.y > -WASP.groundClearance - 0.02, 'middle legs stay on the face below the edge');
});

test('hit() squashes the head, which springs back within 0.6 s', () => {
  const wasp = createWasp(), head = wasp.parts.head; let e = play(wasp, 'standing', 1);
  wasp.hit(); wasp.update(1 / 60, e += 1 / 60, { mode: 'standing', t: 1 }); assert.ok(head.scale.y < 0.8 && head.scale.x > 1.1, `squashed ${head.scale.toArray()}`);
  let peak = 0; play(wasp, 'standing', 0.6 - 1 / 60, { from: e, t0: 1, each: () => { peak = Math.max(peak, Math.abs(head.scale.y - 1)); } });
  assert.ok(peak > 0.2); for (const s of head.scale.toArray()) assert.ok(Math.abs(s - 1) < 0.02, `recovered ${head.scale.toArray()}`);
  assert.ok(finite(wasp.group));
});

test('flying wings beat fast and show a blur; standing wings lie folded along the back', () => {
  const wasp = createWasp(), hinge = wasp.parts.wings[1], flaps = []; play(wasp, 'fly', 1, { each: () => flaps.push(hinge.rotation.z) });
  const blur = wasp.group.getObjectByName('wasp-wing-blur');
  assert.ok(Math.max(...flaps.slice(30)) - Math.min(...flaps.slice(30)) > 1, 'big wing beat'); assert.ok(blur.visible && blur.material.opacity > 0.5, 'blur disc');
  const rest = createWasp(); play(rest, 'standing', 4); rest.group.updateMatrixWorld(true); // between two of its occasional wing flicks
  const wing = rest.parts.wings[1].getObjectByName('wasp-wing'), tip = new THREE.Vector3(2, 0, 0).applyMatrix4(wing.matrixWorld);
  assert.ok(tip.z < WASP.stingerOffset.z + 0.6 && tip.y > 0, `folded wing reaches back to about the gaster tip (${tip.toArray().map(v => v.toFixed(2))})`);
  assert.ok(!rest.group.getObjectByName('wasp-wing-blur').visible || rest.group.getObjectByName('wasp-wing-blur').material.opacity < 0.05);
});
