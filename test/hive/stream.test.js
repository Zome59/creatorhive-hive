import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { STREAM, STREAM_INFO, STREAM_RULES, STREAM_Y, streamClearance, streamDistance, createStream } from '../../src/games/hive/features/stream.js';
import { WORLD, FLOWERS, TREES, BUSHES } from '../../src/games/hive/world.js';

// Plain Node: no document, no canvas. The brook builds with DataTextures only.
const triangles = object => { let total = 0; object.traverse(node => { const g = node.geometry; if (g) total += (g.index ? g.index.count : g.attributes.position.count) / 3 * (node.isInstancedMesh ? node.count : 1); }); return total; };
const named = (object, name) => { let found = null; object.traverse(node => { if (node.name === name) found = node; }); return found; };
const radius = p => Math.hypot(p.x, p.z);
const near = (list, x, z) => Math.min(...list.map(o => Math.hypot(o.x - x, o.z - z)));
const TILE_TOP = 0.095; // tallest hex-tile surface in scene.js: -0.35 + 0.07 + 0.375

test('the brook starts at a spring in the meadow and ends at the island rim', () => {
  assert.equal(typeof document, 'undefined');
  assert.ok(STREAM.length > 30 && STREAM.every(p => Number.isFinite(p.x) && Number.isFinite(p.z)));
  assert.ok(radius(STREAM[0]) >= 9 && radius(STREAM[0]) <= 15, `spring radius ${radius(STREAM[0]).toFixed(2)}`);
  assert.ok(radius(STREAM[0]) >= STREAM_RULES.springMin && radius(STREAM[0]) <= STREAM_RULES.springMax);
  assert.ok(radius(STREAM.at(-1)) >= 30 && radius(STREAM.at(-1)) <= WORLD.island + 2.5, `lip radius ${radius(STREAM.at(-1)).toFixed(2)}`);
  assert.ok(radius(STREAM.at(-1)) > radius(STREAM[0]) + 12, 'it runs outward across the meadow');
  assert.deepEqual(STREAM_INFO.lip, STREAM.at(-1)); assert.deepEqual(STREAM_INFO.spring, STREAM[0]);
  assert.ok(STREAM_INFO.length > 18 && STREAM_INFO.length < 40, `length ${STREAM_INFO.length}`);
  // The course is smooth: neighbouring segments turn by less than ~20 degrees.
  for (let i = 2; i < STREAM.length; i++) {
    const a = Math.atan2(STREAM[i - 1].z - STREAM[i - 2].z, STREAM[i - 1].x - STREAM[i - 2].x), b = Math.atan2(STREAM[i].z - STREAM[i - 1].z, STREAM[i].x - STREAM[i - 1].x);
    assert.ok(Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) < 0.35, `sharp turn at ${i}`);
  }
});

test('the course keeps its distance from flower stems, trees, and the hive', t => {
  const c = streamClearance();
  for (const p of STREAM) {
    assert.ok(radius(p) >= 5, 'outside the hive area');
    assert.ok(near(FLOWERS, p.x, p.z) >= STREAM_RULES.flowers, `flower within ${near(FLOWERS, p.x, p.z).toFixed(2)}`);
    assert.ok(near(TREES.filter(tree => tree.inside), p.x, p.z) >= STREAM_RULES.trees, 'inside tree too close');
  }
  assert.ok(c.flowers >= STREAM_RULES.flowers && c.trees >= STREAM_RULES.trees && c.allTrees >= STREAM_RULES.trees && c.hive >= 5, JSON.stringify(c));
  assert.equal(c.spring, radius(STREAM[0])); assert.equal(c.lip, radius(STREAM.at(-1)));
  t.diagnostic(`clearance: flowers ${c.flowers.toFixed(2)}, inside trees ${c.trees.toFixed(2)}, all trees ${c.allTrees.toFixed(2)}, hive ${c.hive.toFixed(2)}`);
  // Segments, not just samples: a flower placed right beside a segment midpoint is caught too.
  assert.ok(streamClearance([{ x: 0, z: 10 }, { x: 0, z: 20 }]).hive === 10);
  assert.ok(streamDistance(STREAM[20].x, STREAM[20].z) < 0 && streamDistance(STREAM[20].x + 8, STREAM[20].z + 8) > 3, 'in the water vs far away');
});

test('createStream builds a brook, a waterfall, stones, and spray, within the draw and triangle budget', t => {
  const stream = createStream(), { group } = stream;
  const meshes = []; group.traverse(node => { if (node.isMesh || node.isPoints) meshes.push(node); });
  assert.ok(group.isGroup && meshes.length >= 4 && meshes.length <= 6, `${meshes.length} draw calls`);
  for (const name of ['stream-brook', 'stream-waterfall', 'stream-stones', 'stream-spray']) assert.ok(named(group, name), name);
  assert.ok(named(group, 'stream-stones').isInstancedMesh);
  assert.equal(stream.stats.drawCalls, meshes.length);
  // Textures come from computed bytes: no canvas needed.
  for (const m of [named(group, 'stream-brook'), named(group, 'stream-waterfall')]) { assert.ok(m.material.map.isDataTexture && m.material.normalMap.isDataTexture); assert.ok(m.material.transparent && m.material.opacity > 0.8 && m.material.opacity < 1); }
  const total = triangles(group); assert.ok(total > 1000 && total < 8000, `${total} triangles`);
  t.diagnostic(`stream: ${Math.round(total)} triangles, ${meshes.length} draw calls, ${stream.stones.length} stones`);
  stream.dispose();
});

test('the brook lies just above the tiles and faces up; the waterfall hangs off the island side from the lip', () => {
  const { group } = createStream(), brook = named(group, 'stream-brook').geometry, fall = named(group, 'stream-waterfall').geometry;
  const p = brook.attributes.position;
  let low = Infinity, high = -Infinity; for (let i = 0; i < p.count; i++) { low = Math.min(low, p.getY(i)); high = Math.max(high, p.getY(i)); }
  assert.ok(STREAM_Y > TILE_TOP && STREAM_Y < 0.12 && low > TILE_TOP && high < 0.12, `brook y ${low}..${high}`);
  // Every triangle's normal points up (no back faces from above), colours carry an alpha fringe, UVs run along the flow.
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(); let up = 0, flat = 0;
  const ix = brook.index;
  for (let i = 0; i < ix.count; i += 3) { a.fromBufferAttribute(p, ix.getX(i)); b.fromBufferAttribute(p, ix.getX(i + 1)); c.fromBufferAttribute(p, ix.getX(i + 2)); n.copy(b).sub(a).cross(c.clone().sub(a)); if (n.lengthSq() < 1e-14) { flat++; continue; } if (n.y > 0) up++; else assert.fail('a brook triangle faces down'); }
  assert.ok(up > 300 && flat < 30);
  assert.equal(brook.attributes.color.itemSize, 4); assert.ok(brook.attributes.uv.getY(brook.attributes.uv.count - 1) > brook.attributes.uv.getY(0), 'v grows downstream');
  // The first brook row is the (rounded, point-like) spring; the last brook row meets the first waterfall row at the lip.
  const lastRow = brook.attributes.position.count - 7, mid = lastRow + 3, ux = STREAM_INFO.exit.x, uz = STREAM_INFO.exit.z;
  const lip = STREAM_INFO.lip;
  assert.ok(Math.hypot(p.getX(mid) - lip.x, p.getZ(mid) - lip.z) < 1e-3, 'the brook ends at the lip');
  const f = fall.attributes.position; let fy = Infinity, out = -Infinity, back = Infinity, side = 0;
  for (let i = 0; i < f.count; i++) { const along = (f.getX(i) - lip.x) * ux + (f.getZ(i) - lip.z) * uz; fy = Math.min(fy, f.getY(i)); out = Math.max(out, along); back = Math.min(back, along); side = Math.max(side, Math.abs(-(f.getX(i) - lip.x) * uz + (f.getZ(i) - lip.z) * ux)); }
  assert.ok(fy < -8.5 && fy > -10, `fall bottom ${fy}`); assert.ok(Math.abs(f.getY(3) - STREAM_Y) < 1e-6, 'the fall starts at the water surface');
  assert.ok(back > -1e-6 && out > 0.5 && out < 2.5, `the fall curves out ${out.toFixed(2)} from the lip`);
  assert.ok(side < 1.35 * 0.8 * 1.4, `fall width ${side}`);
  assert.ok(Math.hypot(f.getX(3) - lip.x, f.getZ(3) - lip.z) < 0.1, 'top row sits on the lip');
  // Fades toward the bottom.
  const alpha = fall.attributes.color, top = alpha.getW(3), bottom = alpha.getW(alpha.count - 4); assert.ok(top > 0.8 && bottom < 0.2, `alpha ${top} -> ${bottom}`);
});

test('the water flows: update scrolls the textures and animates the spray without reallocating', () => {
  const stream = createStream(), brook = named(stream.group, 'stream-brook').material.map, fall = named(stream.group, 'stream-waterfall').material.map, spray = named(stream.group, 'stream-spray').geometry;
  const before = { brook: brook.offset.y, fall: fall.offset.y, normal: named(stream.group, 'stream-brook').material.normalMap.offset.y };
  const positions = spray.attributes.position.array, colors = spray.attributes.color.array, sizes = spray.attributes.aSize.array, snapshot = Float32Array.from(positions);
  for (let i = 1; i <= 600; i++) stream.update(1 / 60, i / 60);
  assert.notEqual(brook.offset.y, before.brook); assert.notEqual(fall.offset.y, before.fall); assert.notEqual(named(stream.group, 'stream-brook').material.normalMap.offset.y, before.normal);
  assert.ok(Math.abs(fall.offset.y) !== Math.abs(brook.offset.y) && Math.abs(brook.offset.y) < 1 && Math.abs(fall.offset.y) < 1, 'offsets stay wrapped');
  assert.ok(positions === spray.attributes.position.array && colors === spray.attributes.color.array && sizes === spray.attributes.aSize.array, 'same buffers every frame');
  assert.ok(positions.some((v, i) => v !== snapshot[i]), 'the spray moved'); assert.ok([...positions, ...colors, ...sizes].every(Number.isFinite));
  assert.ok(colors.some((v, i) => i % 4 === 3 && v > 0.05), 'some spray is visible'); assert.ok(sizes.every(v => v > 0));
  // Without an elapsed time the module keeps its own clock; a zero or negative dt never breaks anything.
  const sample = fall.offset.y; stream.update(0.016); stream.update(0); stream.update(-1); assert.notEqual(fall.offset.y, sample); assert.ok(Number.isFinite(fall.offset.y));
  stream.dispose();
});

test('sound sources: one at the middle of the brook, one at the waterfall lip', () => {
  const { sources } = createStream(), brook = sources.find(s => s.kind === 'brook'), fall = sources.find(s => s.kind === 'waterfall');
  assert.equal(sources.length, 2); assert.ok(brook && fall);
  assert.ok(streamDistance(brook.x, brook.z) < 0, 'the brook source is on the water');
  const i = STREAM.findIndex(p => Math.hypot(p.x - brook.x, p.z - brook.z) < 0.6); assert.ok(i > STREAM.length * 0.3 && i < STREAM.length * 0.7, `middle index ${i}`);
  assert.deepEqual([fall.x, fall.z], [STREAM_INFO.lip.x, STREAM_INFO.lip.z]); assert.ok(fall.y <= 0.2 && brook.y <= 0.2);
});

test('stones are decorative: banks, spring, stream bed, and meadow, clear of flowers and the hive', t => {
  const { stones } = createStream(), count = kind => stones.filter(s => s.kind === kind).length;
  assert.ok(count('meadow') === 40 && count('bank') >= 20 && count('spring') >= 4, `${count('meadow')} meadow, ${count('bank')} bank`);
  for (const s of stones) {
    assert.ok([s.x, s.y, s.z, s.radius].every(Number.isFinite) && s.radius > 0.05 && s.radius < 0.6, JSON.stringify(s));
    assert.ok(radius(s) >= 5, `${s.kind} stone inside the hive area`);
    assert.ok(near(FLOWERS, s.x, s.z) >= 1, `${s.kind} stone ${near(FLOWERS, s.x, s.z).toFixed(2)} from a flower`);
    assert.ok(s.y > 0 && s.y < 0.5, `stone height ${s.y}`);
  }
  for (const s of stones.filter(s => s.kind === 'meadow')) { assert.ok(radius(s) >= 6 - 0.6 && radius(s) <= 29.5); assert.ok(streamDistance(s.x, s.z) > 0.8, 'meadow stone in the water'); }
  const banks = stones.filter(s => s.kind === 'bank'); assert.ok(banks.every(s => streamDistance(s.x, s.z) < 1.2 && streamDistance(s.x, s.z) > -1.2), 'bank stones hug the water');
  t.diagnostic(`stones: ${stones.length}`);
});

test('the module is deterministic: two streams are identical', () => {
  const a = createStream(), b = createStream();
  assert.deepEqual(a.stones, b.stones); assert.deepEqual(a.sources, b.sources);
  const pa = named(a.group, 'stream-brook').geometry.attributes.position.array, pb = named(b.group, 'stream-brook').geometry.attributes.position.array;
  assert.deepEqual(Array.from(pa), Array.from(pb));
  a.dispose(); b.dispose();
});

test('the brook routes around the bushes', () => {
  for (const b of BUSHES) assert.ok(streamDistance(b.x, b.z) > b.size, `bush ${b.id} stands ${streamDistance(b.x, b.z).toFixed(2)} from the water`);
});
