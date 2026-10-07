import * as THREE from 'three';
import { createShellFur } from './shell-fur.js';
import { GARDEN_PALETTE as palette } from '../palette.js';

// Procedural art for the hive game. No assets and no canvas/document access, so every model also builds in Node tests.
const TAU = Math.PI * 2, UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v)), lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - (1 - t) * (1 - t);
function rng(seed) { let a = (Math.imul((Math.floor(seed) | 0) + 1, 0x9e3779b1) ^ 0x85ebca6b) >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Geometry and materials are built once per module; the game clones nothing but groups.
const shared = new Map();
const once = (key, make) => { if (!shared.has(key)) shared.set(key, make()); return shared.get(key); };
const std = (color, extra = {}) => once(`std:${color}:${JSON.stringify(extra)}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra }));
const unlit = (color, extra = {}) => once(`basic:${color}:${JSON.stringify(extra)}`, () => new THREE.MeshBasicMaterial({ color, ...extra }));
const vertexMat = (roughness = 0.85) => std('#ffffff', { vertexColors: true, roughness });
function put(parent, geometry, material, x = 0, y = 0, z = 0, name = '') { const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; m.name = name; parent.add(m); return m; }
const dummy = new THREE.Object3D(), FORWARD = new THREE.Vector3(0, 0, 1), scratchN = new THREE.Vector3(), scratchQ = new THREE.Quaternion(), scratchS = new THREE.Quaternion();
const place = (x, y, z, rx, ry, rz, sx, sy = sx, sz = sx) => { dummy.position.set(x, y, z); dummy.rotation.set(rx, ry, rz); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); return dummy.matrix; };

// A soft radial gradient built from raw bytes: CanvasTexture would need a DOM.
const glowTexture = () => once('glow', () => {
  const n = 64, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2), a = Math.exp(-r * r * 5) * clamp(1 - r); data.set([255, 255, 255, Math.round(a * 255)], (y * n + x) * 4); }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; return t;
});
const glowSprite = (color, size, opacity) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity })); s.scale.setScalar(size); return s; };

// Low-poly spheres have a seam and pole duplicates; averaging normals over shared positions hides them after we deform the shape.
function weld(g) {
  const p = g.attributes.position, n = g.attributes.normal, sums = new Map(), key = i => `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
  for (let i = 0; i < p.count; i++) { const k = key(i), s = sums.get(k) ?? new THREE.Vector3(); s.add(new THREE.Vector3().fromBufferAttribute(n, i)); sums.set(k, s); }
  for (let i = 0; i < p.count; i++) { const s = sums.get(key(i)).clone().normalize(); n.setXYZ(i, s.x, s.y, s.z); }
  return g;
}
// Flowers are baked into two vertex-coloured meshes each, so ~30 of them cost ~60 draw calls instead of ~600.
class Baker {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; }
  add(geometry, matrix, color, paint) {
    const p = geometry.attributes.position, n = geometry.attributes.normal, base = this.pos.length / 3, nm = new THREE.Matrix3().getNormalMatrix(matrix), v = new THREE.Vector3(), w = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); c.copy(color); paint?.(v, c);
      w.copy(v).applyMatrix4(matrix); this.pos.push(w.x, w.y, w.z);
      w.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); this.nor.push(w.x, w.y, w.z); this.col.push(c.r, c.g, c.b);
    }
    const ix = geometry.index; for (let i = 0, count = ix ? ix.count : p.count; i < count; i++) this.idx.push(base + (ix ? ix.getX(i) : i));
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  }
}

// ---------------------------------------------------------------- flower
// Petals and leaves are unit-length lens shapes along +x; the cup, the curled tip and the midrib fold are baked in.
const petalGeometry = () => once('petal', () => {
  const g = new THREE.SphereGeometry(1, 6, 4); g.rotateZ(Math.PI / 2); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const u = (p.getX(i) + 1) / 2, z = p.getZ(i) * 0.5 * (0.6 + 0.8 * u); p.setXYZ(i, u, p.getY(i) * 0.09 + 0.2 * u * u + 0.3 * z * z, z); }
  g.computeVertexNormals(); return weld(g);
});
const leafGeometry = () => once('leaf', () => {
  const g = new THREE.SphereGeometry(1, 6, 4); g.rotateZ(Math.PI / 2); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const u = (p.getX(i) + 1) / 2, z = p.getZ(i) * 0.5 * (1.35 - 0.8 * u); p.setXYZ(i, u, p.getY(i) * 0.05 + 0.55 * Math.abs(z) - 0.32 * u * u, z); }
  g.computeVertexNormals(); return weld(g);
});
const domeGeometry = () => once('dome', () => new THREE.SphereGeometry(1, 10, 3, 0, TAU, 0, Math.PI / 2));
const pollenGeometry = () => once('pollen', () => new THREE.OctahedronGeometry(1, 0));

export function createFlower({ color = '#e68f9e', height = 1.5, seed = 1 } = {}) {
  const H = Math.max(0.2, +height || 0.2), big = H > 3.2, r = rng(seed), tint = new THREE.Color(color), hsl = {}; tint.getHSL(hsl);
  const group = new THREE.Group(), sway = new THREE.Group(), pivot = new THREE.Group(), head = new THREE.Group();
  group.add(sway); sway.add(pivot); pivot.add(head); pivot.position.y = H;
  const R = big ? 0.8 + 0.2 * r() : 0.5 + 0.07 * clamp((H - 0.6) / 2.6) + 0.04 * r();

  // Stem: a gentle S-curve that returns to x=z=0 so the honey drop floats exactly above the head.
  const lean = (0.05 + 0.04 * r()) * Math.sqrt(H), a0 = r() * TAU, dx = Math.cos(a0) * lean, dz = Math.sin(a0) * lean;
  const curve = new THREE.CatmullRomCurve3([[0, 0, 0], [dx * 0.6, H * 0.3, dz * 0.6], [dx, H * 0.62, dz], [dx * 0.45, H * 0.88, dz * 0.45], [0, H, 0]].map(p => new THREE.Vector3(...p)));
  const sr = 0.06 + 0.017 * H + (big ? 0.03 : 0), seg = big ? 16 : 10, radial = 6;
  const tube = new THREE.TubeGeometry(curve, seg, 1, radial, false), tp = tube.attributes.position, P = new THREE.Vector3(), V = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) { curve.getPointAt(i / seg, P); const s = sr * (1.3 - 0.4 * i / seg); for (let j = 0; j <= radial; j++) { const k = i * (radial + 1) + j; V.fromBufferAttribute(tp, k).sub(P).multiplyScalar(s).add(P); tp.setXYZ(k, V.x, V.y, V.z); } }
  const stemColor = new THREE.Color(palette.foliage[Math.floor(r() * palette.foliage.length)]).multiplyScalar(0.92), leafColor = stemColor.clone().offsetHSL(0.01, 0, 0.05);
  const stem = new Baker(); stem.add(tube, new THREE.Matrix4(), stemColor, (v, c) => c.multiplyScalar(0.8 + 0.2 * clamp(v.y / H)));
  const leaves = Math.max(big ? 2 : 1, 1 + Math.floor(r() * 3)); let la = r() * TAU;
  for (let i = 0; i < leaves; i++) {
    la += 2.1 + r() * 1.2; const t = lerp(0.14, 0.58, (i + r() * 0.7) / leaves), L = (0.38 + 0.2 * H) * (0.85 + 0.3 * r()); curve.getPointAt(t, P);
    stem.add(leafGeometry(), place(P.x + Math.cos(la) * sr * 0.8, P.y, P.z - Math.sin(la) * sr * 0.8, 0, -la, 0.15 + 0.5 * r(), L, L, L * (big ? 0.66 : 0.55)), leafColor, (v, c) => c.multiplyScalar(0.85 + 0.2 * v.x));
  }
  const stemMesh = new THREE.Mesh(stem.build(), vertexMat()); stemMesh.castShadow = stemMesh.receiveShadow = true; stemMesh.name = 'stem'; sway.add(stemMesh);
  curve.getTangentAt(1, V); const tilt = big ? 0.25 + 0.1 * r() : 0.08 * r(), ta = r() * TAU;
  V.lerp(UP, 0.35); V.x += Math.cos(ta) * tilt; V.z += Math.sin(ta) * tilt; head.quaternion.setFromUnitVectors(UP, V.normalize());

  // Head: outer petals in the given colour, a shorter, more cupped inner ring in a shifted tone, a domed centre with pollen dots.
  const N = big ? 7 + Math.floor(r() * 2) : 5 + Math.floor(r() * 4), wr = big ? 0.68 : clamp(4.82 / N, 0.4, 0.85), baked = new Baker();
  const b1 = big ? 0.36 : 0.12, l1 = big ? 0.78 : 1, t1 = big ? 0.12 : 0.32, b2 = big ? 0.34 : 0.3, l2 = big ? 0.5 : 0.5, t2 = big ? 0.3 : 0.45; // petal base radius / length / tilt for the two rings (x R)
  const outer = tint.clone(), inner = tint.clone().offsetHSL(0.012, 0.04, hsl.l > 0.62 ? -0.09 : 0.1);
  const eyeOuter = tint.clone().lerp(new THREE.Color('#fff2b8'), 0.4), eyeInner = inner.clone().lerp(new THREE.Color('#f6c94d'), 0.5);
  for (let k = 0; k < N; k++) {
    const a = (k + (r() - 0.5) * 0.25) * TAU / N, L = R * l1 * (0.95 + 0.1 * r()), c = outer.clone().offsetHSL((r() - 0.5) * 0.012, 0, (r() - 0.5) * 0.05);
    baked.add(petalGeometry(), place(Math.cos(a) * R * b1, 0, Math.sin(a) * R * b1, 0, -a, t1 + 0.14 * r(), L, L, L * wr), c, (v, col) => col.lerp(eyeOuter, 1 - smooth(0, 0.45, v.x)));
  }
  for (let k = 0; k < N; k++) {
    const a = (k + 0.5) * TAU / N, L = R * l2 * (0.94 + 0.12 * r()), c = inner.clone().offsetHSL((r() - 0.5) * 0.012, 0, (r() - 0.5) * 0.05);
    baked.add(petalGeometry(), place(Math.cos(a) * R * b2, R * 0.04, Math.sin(a) * R * b2, 0, -a, t2 + 0.15 * r(), L, L, L * clamp(wr * 1.05, 0.45, 0.95)), c, (v, col) => col.lerp(eyeInner, 1 - smooth(0, 0.45, v.x)));
  }
  const cr = R * (big ? 0.5 : 0.38), cy = R * 0.06, centre = new THREE.Color(big ? '#4e3220' : '#efae2a'), pollen = new THREE.Color(big ? '#d9a441' : '#ffe48a'), dots = big ? 28 : 12;
  baked.add(domeGeometry(), place(0, cy, 0, 0, 0, 0, cr, cr * 0.5, cr), centre);
  for (let i = 0; i < dots; i++) {
    const rr = Math.sqrt((i + 0.5) / dots) * 0.88, th = i * 2.39996, s = (big ? 0.036 : 0.03) * (0.8 + 0.4 * r());
    baked.add(pollenGeometry(), place(Math.cos(th) * rr * cr, cy + cr * 0.5 * Math.sqrt(1 - rr * rr) + 0.004, Math.sin(th) * rr * cr, 0, 0, 0, s), pollen);
  }
  const headMesh = new THREE.Mesh(baked.build(), vertexMat()); headMesh.castShadow = headMesh.receiveShadow = true; headMesh.name = 'head'; head.add(headMesh);

  const phase = r() * TAU;
  return {
    group, headY: H, nectarY: H + 0.8, headRadius: R,
    update(elapsed) {
      sway.rotation.set(Math.sin(elapsed * 0.8 + phase) * 0.012, 0, Math.sin(elapsed * 0.65 + phase * 1.3) * 0.016);
      pivot.rotation.set(Math.sin(elapsed * 1.1 + phase * 2) * 0.03, 0, Math.sin(elapsed * 0.9 + phase) * 0.04);
    },
  };
}

// ---------------------------------------------------------------- honey drop
const springOut = p => { const q = p - 1; return 1 + 3.2 * q ** 3 + 2.2 * q * q + 0.05 * Math.sin(p * 18) * (1 - p); }; // easeOutBack with a decaying wobble
const dropParts = () => once('drop', () => {
  // Round belly with a short, concave tail, ~0.2 wide and 0.45 tall, centred on the origin.
  const pts = [[0, -0.22], [0.1, -0.193], [0.173, -0.12], [0.2, -0.02], [0.181, 0.064], [0.141, 0.121], [0.112, 0.15], [0.082, 0.173], [0.055, 0.19], [0.03, 0.205], [0.012, 0.217], [0, 0.225]].map(([x, y]) => new THREE.Vector2(Math.max(x, 1e-4), y));
  return {
    geometry: new THREE.LatheGeometry(pts, 16), glint: new THREE.SphereGeometry(1, 6, 4), spark: new THREE.OctahedronGeometry(1, 0),
    material: new THREE.MeshPhysicalMaterial({ color: '#f6b21b', roughness: 0.15, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, ior: 1.45, emissive: '#e8781a', emissiveIntensity: 0.45 }),
    glintMaterial: new THREE.MeshBasicMaterial({ color: '#fff6d8', transparent: true, opacity: 0.8, depthWrite: false }), sparkMaterial: new THREE.MeshBasicMaterial({ color: '#ffe9a0' }),
  };
});
let dropCount = 0;

export function createHoneyDrop() {
  const part = dropParts(), phase = dropCount++ * 1.9, group = new THREE.Group(), body = new THREE.Group(), spin = new THREE.Group();
  body.name = 'drop-body'; body.add(spin);
  const drop = put(spin, part.geometry, part.material, 0, 0, 0, 'drop'); drop.castShadow = drop.receiveShadow = false;
  // Two glints on the surface; they turn with the drop so the shine slides across it.
  for (const [yaw, y, rx, rz, sx, sy] of [[-0.6, 0.05, -0.45, 0.35, 0.05, 0.085], [0.7, -0.1, 0.25, 0, 0.022, 0.022]]) {
    const pivot = new THREE.Group(); pivot.rotation.y = yaw; spin.add(pivot);
    const g = put(pivot, part.glint, part.glintMaterial, 0, y, Math.sqrt(Math.max(0, 0.2 * 0.2 - (y + 0.02) ** 2)) + 0.003); g.rotation.set(rx, 0, rz); g.scale.set(sx, sy, 0.015); g.castShadow = g.receiveShadow = false;
  }
  const glow = glowSprite('#ffbf3a', 1.4, 0.55); glow.position.z = -0.02; body.add(glow);
  // The sparkles live outside `body` so they keep their size while the drop pops; one instanced mesh = one draw call per drop.
  const sparks = new THREE.InstancedMesh(part.spark, part.sparkMaterial, 5); sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); sparks.frustumCulled = false; sparks.name = 'sparkles'; group.add(body, sparks);
  const bits = Array.from({ length: 5 }, (_, i) => ({ a: i * TAU / 5 + phase, w: (1.4 + 0.2 * i) * (i % 2 ? -1 : 1), r: 0.34 + 0.03 * i, s: 0.03 + 0.012 * (i % 3), up: (i % 2 ? 0.5 : -0.2) + 0.1 * i }));
  let mode = 'idle', t = 0, k = 1, from = 1, burst = 0, was = true, seen = false;
  return {
    group,
    update(dt, elapsed, available = true) {
      dt = Math.max(0, dt || 0);
      if (!seen) { seen = true; if (!available) { mode = 'hidden'; k = 0; was = false; } }
      if (available !== was) { was = available; t = 0; from = k; mode = available ? 'grow' : 'pop'; }
      if (mode === 'pop') {
        t += dt; const p = t / 0.24; k = p >= 1 ? 0 : from * (p < 0.4 ? 1 + 0.4 * easeOut(p / 0.4) : 1.4 * (1 - ((p - 0.4) / 0.6) ** 2));
        burst = Math.min(1, t / 0.35); if (t >= 0.35) mode = 'hidden';
      } else if (mode === 'grow') { t += dt; const p = Math.min(1, t / 0.5); k = p >= 1 ? 1 : from + (1 - from) * springOut(p); burst = 0; if (p >= 1) mode = 'idle'; }
      group.visible = mode !== 'hidden';
      if (mode === 'hidden') { body.scale.setScalar(0); return; }
      const bob = Math.sin(elapsed * 2.2 + phase) * 0.12, pulse = 0.5 + 0.5 * Math.sin(elapsed * 3.1 + phase);
      body.position.y = bob; body.scale.setScalar(Math.max(0, k)); body.rotation.z = Math.sin(elapsed * 1.3 + phase) * 0.08; spin.rotation.y = elapsed * 0.9 + phase;
      glow.material.opacity = (0.4 + 0.2 * pulse) * clamp(k, 0, 1.4); glow.scale.setScalar(1.4 * (1 + 0.08 * pulse));
      const fly = easeOut(burst), size = mode === 'pop' ? (1 - burst) * 2 : Math.min(1, k);
      bits.forEach((b, i) => {
        const a = elapsed * b.w + b.a, rr = b.r + fly * 1.1;
        dummy.position.set(Math.cos(a) * rr, bob * 0.7 + Math.sin(elapsed * 1.9 + b.a) * 0.2 + fly * b.up, Math.sin(a) * rr);
        dummy.rotation.set(elapsed * 2 + b.a, elapsed * 3, 0); dummy.scale.setScalar(b.s * (0.45 + 0.55 * Math.abs(Math.sin(elapsed * 3.3 + b.a * 2.1))) * size); dummy.updateMatrix(); sparks.setMatrixAt(i, dummy.matrix);
      });
      sparks.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- bumblebee
// Every shape is baked at its final proportions, so nothing on the bee needs a non-uniform scale: normals, shading and silhouettes stay
// clean from 2 units away. The torso is one smooth revolved surface (analytic normals, soft colour bands, a fine felt grain), the fur is a
// dense, even layer of small soft tufts that stand on the surface normal, and the face parts are ellipsoids oriented to the skull.
const BEE = { yellow: new THREE.Color('#f2c230'), black: new THREE.Color('#2d2a26'), white: new THREE.Color('#f3eee0') };
const BEE_BANDS = [BEE.white, BEE.black, BEE.yellow, BEE.black, BEE.yellow], BEE_CUTS = [-0.8, -0.45, -0.05, 0.42], BEE_BLEND = 0.055;
const beeBand = (z, out) => { out.copy(BEE_BANDS[0]); BEE_CUTS.forEach((c, k) => out.lerp(BEE_BANDS[k + 1], smooth(c - BEE_BLEND, c + BEE_BLEND, z))); return out; };
const beeShade = ny => 0.8 + 0.2 * smooth(-0.85, 0.35, ny); // a little occlusion: the belly is a touch darker than the back
const BEE_SKULL = new THREE.Color('#35302a');
const BEE_Z0 = -1.02, BEE_Z1 = 0.78, BEE_KY = 0.94, BEE_HEAD = new THREE.Vector3(0.44, 0.4, 0.38), BEE_HEAD_AT = new THREE.Vector3(0, -0.04, 0.84), TUFT_INSET = 0.03, SWELL = 0.05;
// Round abdomen + chubby thorax as one smooth surface: r(z)^2 is the 4-norm blend of two ellipse lobes, so there is no waist and no crease.
const beeLobe = (z, c, h, R) => { const q = (z - c) / h; return q * q < 1 ? R * R * (1 - q * q) : 0; };
const beeLobeD = (z, c, h, R) => { const q = (z - c) / h; return q * q < 1 ? -2 * R * R * q / h : 0; };
const beeF = z => Math.hypot(beeLobe(z, -0.32, 0.7, 0.62), beeLobe(z, 0.26, 0.52, 0.58));
function beeSurface(z, phi, pos, nor) {
  const a = beeLobe(z, -0.32, 0.7, 0.62), b = beeLobe(z, 0.26, 0.52, 0.58), f = Math.hypot(a, b), r = Math.sqrt(f), x = r * Math.cos(phi), y = r * BEE_KY * Math.sin(phi); pos.set(x, y, z);
  if (f < 1e-9) return nor.set(0, 0, z < -0.3 ? -1 : 1);
  const df = (a * beeLobeD(z, -0.32, 0.7, 0.62) + b * beeLobeD(z, 0.26, 0.52, 0.58)) / f; // gradient of x^2 + (y/KY)^2 - f(z)
  return nor.set(x, y / (BEE_KY * BEE_KY), -df / 2).normalize();
}
// A unit sphere stretched to the radii (a, b, c) with exact normals. Baked, so the mesh itself keeps scale 1.
const beeEllipsoid = (a, b, c, w = 24, h = 16) => once(`bee:ellipsoid:${a},${b},${c},${w},${h}`, () => {
  const g = new THREE.SphereGeometry(1, w, h), p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, x * a, y * b, z * c); v.set(x / a, y / b, z / c).normalize(); n.setXYZ(i, v.x, v.y, v.z); }
  g.computeBoundingSphere(); g.computeBoundingBox(); return g;
});
const beeSkullGeometry = () => once('bee:skull', () => { const g = beeEllipsoid(BEE_HEAD.x, BEE_HEAD.y, BEE_HEAD.z, 36, 24).clone(), n = g.attributes.normal, col = new Float32Array(n.count * 3), c = new THREE.Color(); for (let i = 0; i < n.count; i++) { c.copy(BEE_SKULL).multiplyScalar(beeShade(n.getY(i))); c.toArray(col, i * 3); } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g; });
const beeBall = (w = 10, h = 7) => once(`bee:ball:${w},${h}`, () => new THREE.SphereGeometry(1, w, h));
// Point on an ellipsoid with radii `rad` in direction `d`, and the outward normal there.
const beeOnEllipsoid = (d, rad, at, nor) => { d.normalize(); const k = 1 / Math.hypot(d.x / rad.x, d.y / rad.y, d.z / rad.z); at.copy(d).multiplyScalar(k); return nor.set(at.x / (rad.x * rad.x), at.y / (rad.y * rad.y), at.z / (rad.z * rad.z)).normalize(); };

const beeBodyGeometry = () => once('bee:body', () => {
  const N = 44, S = 44, W = S + 1, pos = [], nor = [], col = [], uv = [], idx = [], morph = [], rad = [], p = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
  for (let k = 0; k <= N; k++) {
    const z = lerp(BEE_Z0, BEE_Z1, (1 - Math.cos(Math.PI * k / N)) / 2); beeBand(z, c); rad.push(beeF(z));
    for (let j = 0; j <= S; j++) { // one extra vertex closes the seam, so the fur grain texture wraps cleanly
      beeSurface(z, j / S * TAU, p, n); const shade = beeShade(n.y), grow = SWELL * smooth(0.1, -0.4, z); // the morph target lets the abdomen swell while it gulps
      pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); col.push(c.r * shade, c.g * shade, c.b * shade); morph.push(n.x * grow, n.y * grow, n.z * grow); uv.push(j / S * BEE_GRAIN_U, (z - BEE_Z0) * BEE_GRAIN_V);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < S; j++) {
    const A = i * W + j, B = A + 1, D = A + W, C = D + 1; // the two pole rings collapse to a point: skip their zero-area triangles
    if (rad[i] > 0) idx.push(A, B, C); if (rad[i + 1] > 0) idx.push(A, C, D);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.morphAttributes.position = [new THREE.Float32BufferAttribute(morph, 3)]; g.morphTargetsRelative = true; g.computeBoundingSphere(); g.computeBoundingBox(); return g;
});
// Fine fur grain as a bump map built from raw bytes (no canvas): short strands that run along the body, wrapping in both directions.
const BEE_GRAIN_U = 14, BEE_GRAIN_V = 5;
const beeGrain = () => once('bee:grain', () => {
  const n = 128, height = new Float32Array(n * n), r = rng(11), data = new Uint8Array(n * n * 4), wrap = i => ((i % n) + n) % n;
  for (let i = 0; i < 1100; i++) { // each strand: a slightly wavy streak along v that fades in and out
    const x0 = r() * n, y0 = r() * n, len = 6 + r() * 12, width = 0.9 + r() * 0.9, strength = (0.4 + 0.6 * r()) * 0.35;
    for (let t = 0; t <= len; t += 0.5) for (let dx = -2; dx <= 2; dx++) { const k = Math.max(0, 1 - Math.abs(dx) / (width + 0.5)); if (k > 0) height[wrap(Math.floor(y0 + t)) * n + wrap(Math.floor(x0 + dx + 0.5 * Math.sin(t * 0.4 + i)))] += strength * Math.sin(Math.PI * t / len) * k; }
  }
  let max = 0; for (const v of height) max = Math.max(max, v);
  for (let i = 0; i < n * n; i++) { const v = Math.round(255 * Math.min(1, height[i] / max * 1.6)); data.set([v, v, v, 255], i * 4); }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
});
// Torso and tufts share one material family (soft sheen, same colours); the torso and its fur also share the felt grain, so a tuft
// continues the surface it grows from instead of reading as a separate tile.
const beeFurMaterial = (grain = true) => once(`bee:fur:${grain}`, () => grain ? new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.92, bumpMap: beeGrain(), bumpScale: 0.5, sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color('#fff1d6') }) : new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.9 }));

// A tuft is a small, soft cone (0.052 base radius, 0.074 tall). Its normals lean strongly towards the hair axis so it shades like the body under
// it, its base is buried in the surface, and all tufts of a mesh are baked into one geometry (positions, normals, colours, uvs, morph).
const TUFT = { r: 0.052, h: 0.074, sides: 6, lean: 0.9 };
const beeTuftTemplate = () => once('bee:tuft', () => {
  const R = TUFT.sides, pos = [], nor = [], col = [], idx = [], v = new THREE.Vector3(), slope = Math.atan2(TUFT.r, TUFT.h);
  for (let j = 0; j < R; j++) { const th = j / R * TAU, cs = Math.cos(th), sn = Math.sin(th); pos.push(cs * TUFT.r, 0, sn * TUFT.r); v.set(cs * Math.cos(slope), Math.sin(slope), sn * Math.cos(slope)).lerp(UP, TUFT.lean).normalize(); nor.push(v.x, v.y, v.z); col.push(0.94); }
  pos.push(0, TUFT.h, 0); nor.push(0, 1, 0); col.push(1);
  for (let j = 0; j < R; j++) idx.push(j, R, (j + 1) % R);
  return { pos, nor, col, idx, n: R + 1 };
});
const beeJitter = new THREE.Euler(), beeQ = new THREE.Quaternion(), beeQ2 = new THREE.Quaternion(), beeV = new THREE.Vector3(), beeN = new THREE.Vector3();
// pos/nor: the surface point and its normal; the tuft stands on the normal give or take a few degrees, with a random spin and one uniform scale.
function beeTuft(r, pos, nor, color, s, w = 0) {
  beeQ.setFromUnitVectors(UP, nor); beeQ.multiply(beeQ2.setFromEuler(beeJitter.set((r() - 0.5) * 0.24, r() * TAU, (r() - 0.5) * 0.24)));
  return { pos: pos.clone(), nor: nor.clone(), q: beeQ.clone(), s, color, w };
}
// Bakes all tufts into one geometry. `grain` gives them the torso's texture coordinates (continuous with the torso, whatever the seam does);
// `w` is each tuft's share of the abdomen swell, stored as a morph target exactly like the torso's.
function beeFurGeometry(entries, grain) {
  const T = beeTuftTemplate(), n = entries.length * T.n, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = grain ? new Float32Array(n * 2) : null, morph = new Float32Array(n * 3), idx = [], c = new THREE.Color();
  entries.forEach((e, k) => {
    const base = k * T.n, phiC = Math.atan2(e.pos.y / BEE_KY, e.pos.x), delta = SWELL * e.w;
    for (let i = 0; i < T.n; i++) {
      const o = (base + i) * 3; beeV.set(T.pos[i * 3], T.pos[i * 3 + 1], T.pos[i * 3 + 2]).multiplyScalar(e.s).applyQuaternion(e.q).add(e.pos).addScaledVector(e.nor, -TUFT_INSET); pos.set([beeV.x, beeV.y, beeV.z], o);
      beeN.set(T.nor[i * 3], T.nor[i * 3 + 1], T.nor[i * 3 + 2]).applyQuaternion(e.q); nor.set([beeN.x, beeN.y, beeN.z], o);
      c.copy(e.color).multiplyScalar(T.col[i]); col.set([c.r, c.g, c.b], o); morph.set([e.nor.x * delta, e.nor.y * delta, e.nor.z * delta], o);
      if (uv) { const dPhi = Math.atan2(Math.sin(Math.atan2(beeV.y / BEE_KY, beeV.x) - phiC), Math.cos(Math.atan2(beeV.y / BEE_KY, beeV.x) - phiC)); uv[(base + i) * 2] = ((phiC + TAU) % TAU + dPhi) / TAU * BEE_GRAIN_U; uv[(base + i) * 2 + 1] = (beeV.z - BEE_Z0) * BEE_GRAIN_V; }
    }
    for (const i of T.idx) idx.push(base + i);
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.morphAttributes.position = [new THREE.BufferAttribute(morph, 3)]; g.morphTargetsRelative = true; g.computeBoundingSphere(); g.computeBoundingBox();
  g.userData.tufts = entries.length; return g;
}
function beeFurMesh(geometry, material, name) {
  const m = new THREE.Mesh(geometry, material); m.name = name; m.castShadow = m.receiveShadow = false; m.userData.tufts = geometry.userData.tufts; return m; // too fine for the shadow map: the smooth torso under it casts the (clean) shadow
}
function beeBodyFur(r, gap = 0.09) {
  const out = [], M = 400, zs = [], ss = [0], pos = new THREE.Vector3(), nor = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i <= M; i++) { const z = lerp(BEE_Z0, 0.62, i / M); zs.push(z); if (i) ss.push(ss[i - 1] + Math.hypot(z - zs[i - 1], Math.sqrt(beeF(z)) - Math.sqrt(beeF(zs[i - 1])))); } // arc length along the profile, so rows are evenly spaced on the surface
  const add = (z, phi) => {
    z = Math.max(BEE_Z0, z); beeSurface(z, phi, pos, nor); beeBand(z, c); const k = beeShade(nor.y) * (0.98 + 0.04 * r());
    out.push(beeTuft(r, pos, nor, c.clone().multiplyScalar(k), 0.82 + 0.4 * r(), smooth(0.1, -0.4, z)));
  };
  for (let k = 0, s = gap * 0.5; s < ss[M]; k++, s += gap * 0.88) { // rows slightly closer than the in-row gap, each shifted by the golden angle
    let i = 1; while (i < M && ss[i] < s) i++; const z = lerp(zs[i - 1], zs[i], (s - ss[i - 1]) / ((ss[i] - ss[i - 1]) || 1)), n = Math.max(1, Math.round(TAU * Math.sqrt(beeF(z)) * (1 + BEE_KY) / 2 / gap)), off = k * 2.39996;
    for (let j = 0; j < n; j++) add(z + (r() - 0.5) * gap * 0.15, off + (j + (r() - 0.5) * 0.25) / n * TAU);
  }
  add(BEE_Z0, 0); // the pole itself
  return out;
}
function beeHeadFur(r) {
  const out = [], d = new THREE.Vector3(), at = new THREE.Vector3(), nor = new THREE.Vector3(), c = new THREE.Color(), N = 420;
  for (let i = 0; i < N; i++) {
    const y = 1 - 2 * (i + 0.5) / N, rad = Math.sqrt(1 - y * y), th = i * 2.39996; d.set(Math.cos(th) * rad, y, Math.sin(th) * rad);
    if ((d.z > 0.3 && d.y < 0.78) || d.y < -0.5 || d.z < -0.35) continue; // face (eyes, cheeks, snout), chin and the part buried in the thorax stay bare
    beeOnEllipsoid(d, BEE_HEAD, at, nor); c.copy(BEE_SKULL).multiplyScalar((0.98 + 0.04 * r()) * beeShade(nor.y));
    out.push(beeTuft(r, at, nor, c.clone(), 0.75 + 0.3 * r()));
  }
  return out;
}

const beeLimbs = () => once('bee:limbs', () => ({
  upper: new THREE.CylinderGeometry(0.062, 0.052, 0.22, 8, 1).translate(0, -0.11, 0), lower: new THREE.CylinderGeometry(0.05, 0.038, 0.2, 8, 1).translate(0, -0.1, 0),
  stalk1: new THREE.CylinderGeometry(0.02, 0.03, 0.3, 8, 1).translate(0, 0.15, 0), stalk2: new THREE.CylinderGeometry(0.014, 0.02, 0.22, 8, 1).translate(0, 0.11, 0),
  tongue: new THREE.CylinderGeometry(0.034, 0.016, 1, 8, 1).translate(0, -0.5, 0),
}));
// A smooth leaf-shaped wing outline (curved edges, rounded root and tip) lying flat in the xz plane, root at the origin, reaching along +x for side=1.
const beeWingGeometry = side => once(`bee:wing${side}`, () => {
  const P = pts => pts.map(([x, y]) => [x * side, y]), s = new THREE.Shape(), seg = [[[0.12, -0.12], [0.45, -0.17], [0.66, -0.1]], [[0.8, -0.05], [0.85, 0.07], [0.72, 0.14]], [[0.55, 0.26], [0.22, 0.24], [0.02, 0.1]], [[-0.03, 0.07], [-0.03, 0.03], [0, 0.02]]];
  s.moveTo(0, 0.02); for (const c of seg) { const [[a, b], [d, e], [f, g]] = P(c); s.bezierCurveTo(a, b, d, e, f, g); }
  const g = new THREE.ShapeGeometry(s, 14); g.rotateX(-Math.PI / 2); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
});

export function createBumblebee() {
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  const felt = beeFurMaterial(true), plain = beeFurMaterial(false), dark = std('#2d2a26', { roughness: 0.9 }), joint = std('#3a352f', { roughness: 0.85 }), L = beeLimbs();
  const torso = put(body, beeBodyGeometry(), felt, 0, 0, 0, 'bee-body'); torso.receiveShadow = false; torso.morphTargetInfluences[0] = 0;
  const torsoFur = beeFurMesh(once('bee:fur-torso', () => beeFurGeometry(beeBodyFur(rng(7)), true)), felt, 'bee-fur'); body.add(torsoFur);
  // Shell fur over the torso; the scene lowers the layer count with distance (level of detail).
  const shellFur = createShellFur(beeBodyGeometry(), { layers: 32, length: 0.12, density: [16, 10], rootShade: 0.45, droop: 0.25 }); body.add(shellFur);

  const head = new THREE.Group(); head.name = 'bee-head'; head.position.copy(BEE_HEAD_AT); body.add(head);
  const skull = put(head, beeSkullGeometry(), plain, 0, 0, 0, 'head'); skull.receiveShadow = false; head.add(beeFurMesh(once('bee:fur-head', () => beeFurGeometry(beeHeadFur(rng(8)), false)), plain, 'bee-head-fur'));
  const eyeMat = once('eye', () => new THREE.MeshPhysicalMaterial({ color: '#141216', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 })), dot = unlit('#ffffff'), pink = std('#f29a8a', { transparent: true, opacity: 0.5, depthWrite: false });
  const EYE = new THREE.Vector3(0.17, 0.2, 0.14), at = new THREE.Vector3(), nor = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1);
  for (const side of [-1, 1]) {
    // The eye is an ellipsoid whose short axis points along the skull normal, sunk 12% into the head: one clean, even rim all around.
    beeOnEllipsoid(new THREE.Vector3(side * 0.5, 0.22, 0.84), BEE_HEAD, at, nor);
    const eye = put(head, beeEllipsoid(EYE.x, EYE.y, EYE.z, 28, 18), eyeMat, at.x * 0.88, at.y * 0.88, at.z * 0.88, `eye${side}`); eye.quaternion.setFromUnitVectors(up, nor); eye.castShadow = false;
    const unturn = eye.quaternion.clone().invert(); // glints are placed in head space so both eyes catch the light from the same side
    for (const [d, s] of [[new THREE.Vector3(-0.35, 0.55, 0.75), 0.04], [new THREE.Vector3(0.4, -0.35, 0.85), 0.021]]) { const q = new THREE.Vector3(), n = beeOnEllipsoid(d.applyQuaternion(unturn), EYE, q, new THREE.Vector3()); const g = put(eye, beeBall(8, 6), dot, q.x + n.x * 0.004, q.y + n.y * 0.004, q.z + n.z * 0.004); g.scale.setScalar(s); g.castShadow = g.receiveShadow = false; }
    beeOnEllipsoid(new THREE.Vector3(side * 0.78, -0.18, 0.6), BEE_HEAD, at, nor);
    const cheek = put(head, beeEllipsoid(0.085, 0.056, 0.022, 14, 8), pink, at.x * 0.99, at.y * 0.99, at.z * 0.99); cheek.quaternion.setFromUnitVectors(up, nor); cheek.castShadow = false;
  }
  put(head, beeEllipsoid(0.11, 0.075, 0.075, 16, 10), std('#5a4634'), 0, -0.14, 0.345, 'snout');
  // The proboscis hangs from under the snout; it is only shown while the bee drinks. Its length is the one scale it needs.
  const proboscis = new THREE.Group(); proboscis.name = 'proboscis'; proboscis.position.set(0, -0.19, 0.38); proboscis.visible = false; head.add(proboscis);
  const tongue = std('#c9803c', { roughness: 0.55 }), tube = put(proboscis, L.tongue, tongue, 0, 0, 0, 'proboscis-tube'), tip = put(proboscis, beeBall(10, 8), tongue, 0, 0, 0, 'proboscis-tip'); tube.castShadow = tip.castShadow = false; tube.scale.y = 0.01; tip.scale.setScalar(0.03);

  const antennae = [-1, 1].map(side => {
    const base = new THREE.Group(), tipG = new THREE.Group(); base.position.set(side * 0.145, 0.31, 0.16); base.rotation.set(0.35, 0, -side * 0.45); head.add(base);
    put(base, L.stalk1, dark); tipG.position.y = 0.3; tipG.rotation.x = 0.8; base.add(tipG);
    put(tipG, beeBall(10, 8), dark, 0, 0, 0).scale.setScalar(0.024); put(tipG, L.stalk2, dark); put(tipG, beeBall(12, 9), dark, 0, 0.23, 0).scale.setScalar(0.055); return { base, tip: tipG, side };
  });

  // Wings are comically small on purpose; each one hinges at its root on top of the thorax.
  const wingMat = std('#eef7ff', { transparent: true, opacity: 0.55, roughness: 0.2, depthWrite: false, side: THREE.DoubleSide });
  const wings = [-1, 1].map(side => { const hinge = new THREE.Group(); hinge.position.set(side * 0.16, 0.56, 0.12); body.add(hinge); put(hinge, beeWingGeometry(side), wingMat, 0, 0, 0, 'wing').castShadow = false; return { hinge, side }; });

  const legs = [];
  for (const side of [-1, 1]) [0.52, 0.12, -0.3].forEach((z, i) => {
    const hip = new THREE.Group(), knee = new THREE.Group(); hip.position.set(side * 0.3, -0.4, z); hip.rotation.z = side * 0.7; body.add(hip);
    put(hip, L.upper, dark); knee.position.y = -0.22; knee.rotation.z = -side * 0.9; hip.add(knee); put(knee, beeBall(8, 6), joint, 0, 0, 0).scale.setScalar(0.056); put(knee, L.lower, dark); put(knee, beeBall(8, 6), joint, 0, -0.2, 0).scale.setScalar(0.064); legs.push({ hip, knee, side, i });
  });

  // Pose weights ease towards their targets, so switching between flying, perching, drinking and flailing never snaps.
  let stun = 0, perch = 0, drink = 0, flail = 0, swell = 0; const ease = (w, to, dt, rate) => w + (to - w) * (1 - Math.exp(-dt * rate)), sway = new THREE.Euler();
  return {
    fur: shellFur,
    group,
    update(dt, elapsed, state) {
      const { speed = 0, stunned = false, perched = false, sucking = false, flailing = false } = state || {}, e = elapsed; dt = Math.max(0, dt || 0);
      stun = ease(stun, stunned ? 1 : 0, dt, 8); flail = ease(flail, flailing ? 1 : 0, dt, 10); perch = ease(perch, perched && !flailing ? 1 : 0, dt, 3.5); drink = ease(drink, perched && sucking && !flailing ? 1 : 0, dt, 5);
      const mv = clamp(speed / 6, 0, 2) * (1 - perch), m = Math.min(1, mv), amp = (0.35 + 0.65 * m) * (1 - 0.5 * perch), sk = drink * perch;
      const gulpAt = Math.sin(Math.PI * 1.5 * e), gulp = sk * (0.12 + 0.88 * gulpAt * gulpAt), pump = Math.sin(TAU * 1.5 * e); // one gulp every 2/3 s
      body.position.y = lerp(Math.sin(e * 3.3) * (0.05 + 0.03 * m), -0.2 + Math.sin(e * 1.7) * 0.022, perch) - 0.1 * stun + Math.sin(e * 11) * 0.05 * flail;
      body.rotation.set(0.16 * m + Math.sin(e * 2.7 + 1) * 0.05 * amp + Math.sin(e * 5.3) * 0.22 * stun + perch * (0.3 + Math.sin(e * 1.7 + 0.6) * 0.012) - 0.03 * gulp + Math.sin(e * 7.7) * 0.25 * flail, Math.sin(e * 1.7) * 0.05 * amp + Math.sin(e * 4.1) * 0.3 * stun + Math.sin(e * 6.1) * 0.2 * flail, Math.sin(e * 2.1) * 0.06 * amp + Math.sin(e * 6.4) * 0.35 * stun + Math.sin(e * 8.3) * 0.3 * flail);
      head.rotation.set(Math.sin(e * 3.3 - 0.8) * 0.07 * amp - 0.05 * m - 0.1 * perch + 0.07 * gulp, 0, Math.sin(e * 7) * 0.3 * stun + Math.sin(e * 9.3) * 0.2 * flail);
      // Gulp: the abdomen swells (morph target + the tufts riding on it), the proboscis pumps and hangs straight down whatever the head does.
      if (Math.abs(gulp - swell) > 1e-3) { swell = gulp; torso.morphTargetInfluences[0] = torsoFur.morphTargetInfluences[0] = swell; }
      proboscis.visible = sk > 0.01;
      if (proboscis.visible) {
        const len = 0.72 * easeOut(sk) * (1 + 0.09 * pump), bulge = 1 + 0.25 * Math.max(0, pump); proboscis.quaternion.copy(beeQ.copy(body.quaternion).multiply(head.quaternion).invert()).multiply(beeQ2.setFromEuler(sway.set(0.1 + 0.05 * pump, 0, Math.sin(e * 1.1) * 0.04)));
        tube.scale.set(bulge, Math.max(0.01, len), bulge); tip.position.y = -len; tip.scale.setScalar(0.03 * bulge);
      }
      const flap = lerp(lerp(Math.sin(e * 60), Math.sin(e * 17) * 0.55, stun), Math.sin(e * 83) * 1.2, flail);
      for (const w of wings) w.hinge.rotation.set(0, w.side * (lerp(0.4, 1.15, perch) + 0.3 * flail * Math.sin(e * 9)), w.side * lerp(0.5 + 0.55 * flap, 0.16 + 0.05 * Math.sin(e * 1.9 + w.side) + 0.05 * sk * pump, perch)); // sweep back, flap about the fore-aft axis; perched they rest folded back
      for (const a of antennae) {
        const s = a.side, twitch = sk * Math.sin(e * 12 + s * 2), wild = flail * Math.sin(e * 15 + s * 3);
        a.base.rotation.set(0.35 + Math.sin(e * 5 + s) * 0.12 * amp + 0.5 * stun + 0.15 * perch + 0.2 * twitch + 0.7 * wild, 0, -s * (0.45 + Math.sin(e * 4 + s * 2) * 0.1 * amp + 0.2 * stun + 0.14 * sk * Math.sin(e * 9.5 + s) + 0.55 * flail * Math.sin(e * 13 + s)));
        a.tip.rotation.x = 0.8 + Math.sin(e * 6 + s) * 0.12 + 0.4 * stun + 0.18 * sk * Math.sin(e * 14 + s) + 0.7 * flail * Math.sin(e * 17 + s);
      }
      const reach = [-0.42, -0.05, 0.32];
      for (const l of legs) {
        const s = l.side, ph = e * 4.2 + l.i * 1.1 + s * 0.8, i = l.i; // perched legs reach down and outward, front ones forward, rear ones back, and hold on
        const fx = Math.sin(ph) * 0.2 * amp + 0.35 * m + Math.sin(e * 3 + i) * 0.3 * stun, px = reach[i] + Math.sin(e * 1.3 + i) * 0.02 + 0.05 * gulp * (i - 1);
        const fz = 0.7 + Math.sin(e * 3.1 + i) * 0.08, pz = 0.98 + 0.03 * gulp, kx = Math.sin(ph + 1.5) * 0.15 * amp, kz = 0.9 - 0.25 * m, pk = 0.62 + 0.06 * gulp;
        l.hip.rotation.set(lerp(lerp(fx, px, perch), Math.sin(e * 11 + i * 1.9 + s * 2.3), flail), 0, s * lerp(lerp(fz, pz, perch), 0.9 + Math.sin(e * 9 + i * 2.1) * 0.6, flail));
        l.knee.rotation.set(lerp(lerp(kx, 0.04 * gulp, perch), Math.sin(e * 13 + i * 1.3 + s) * 0.6, flail), 0, -s * lerp(lerp(kz, pk, perch), 0.9 + Math.sin(e * 10 + i + s) * 0.6, flail));
      }
    },
  };
}

// ---------------------------------------------------------------- burst particles
// Unlit octahedra with darker undersides read as little crystals without needing any lights.
const gemGeometry = () => once('gem-geometry', () => {
  const g = new THREE.OctahedronGeometry(1, 0), n = g.attributes.normal, c = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) c.fill(0.62 + 0.38 * clamp(0.5 + 0.5 * (n.getY(i) * 0.8 + n.getX(i) * 0.4)), i * 3, i * 3 + 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g;
});
export function createBurst(scene, { max = 240 } = {}) {
  max = Math.max(1, Math.floor(max));
  const mesh = new THREE.InstancedMesh(gemGeometry(), once('gem', () => new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })), max), rand = rng(max + 11);
  const pos = new Float32Array(max * 3), vel = new Float32Array(max * 3), rot = new Float32Array(max * 3), spin = new Float32Array(max * 3), life = new Float32Array(max), span = new Float32Array(max), size = new Float32Array(max), grav = new Float32Array(max);
  const c = new THREE.Color(), d = new THREE.Vector3(); let cursor = 0, alive = 0;
  const write = (i, s) => { dummy.position.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); dummy.rotation.set(rot[i * 3], rot[i * 3 + 1], rot[i * 3 + 2]); dummy.scale.setScalar(s); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); };
  for (let i = 0; i < max; i++) { write(i, 0); mesh.setColorAt(i, c.set('#ffffff')); }
  mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = false; mesh.name = 'burst'; scene.add(mesh);
  return {
    mesh,
    get alive() { return alive; },
    emit(at, { color = '#ffd35a', count = 18, speed = 2.5, size: s = 0.12, gravity = -3, life: l = 0.8, spread = 1 } = {}) {
      // The ring cursor reuses the oldest slot when the pool is full, so nothing is ever allocated or dropped silently.
      for (let n = Math.min(Math.max(0, count | 0), max); n > 0; n--) {
        const i = cursor; cursor = (cursor + 1) % max; if (life[i] <= 0) alive++;
        const u = rand() * 2 - 1, th = rand() * TAU, q = Math.sqrt(1 - u * u); d.set(q * Math.cos(th) * spread, u * spread + (1 - spread), q * Math.sin(th) * spread).normalize().multiplyScalar(speed * (0.55 + 0.45 * rand()));
        pos[i * 3] = at.x; pos[i * 3 + 1] = at.y; pos[i * 3 + 2] = at.z; vel[i * 3] = d.x; vel[i * 3 + 1] = d.y; vel[i * 3 + 2] = d.z;
        for (let k = 0; k < 3; k++) { rot[i * 3 + k] = rand() * TAU; spin[i * 3 + k] = (rand() - 0.5) * 10; }
        life[i] = span[i] = l * (0.75 + 0.25 * rand()); size[i] = s * (0.7 + 0.6 * rand()); grav[i] = gravity;
        mesh.setColorAt(i, c.set(color).offsetHSL(0, 0, (rand() - 0.5) * 0.12)); write(i, size[i] * 0.3);
      }
      mesh.instanceColor.needsUpdate = true; mesh.instanceMatrix.needsUpdate = true;
    },
    update(dt) {
      if (!alive || !(dt > 0)) return;
      const drag = Math.exp(-1.5 * dt);
      for (let i = 0; i < max; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt; if (life[i] <= 0) { alive--; write(i, 0); continue; }
        vel[i * 3 + 1] += grav[i] * dt;
        for (let k = 0; k < 3; k++) { vel[i * 3 + k] *= drag; pos[i * 3 + k] += vel[i * 3 + k] * dt; rot[i * 3 + k] += spin[i * 3 + k] * dt; }
        const p = life[i] / span[i]; write(i, size[i] * Math.min(1, (1 - p) * 8 + 0.3) * Math.sqrt(p));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- dizzy stars
const starGeometry = () => once('star', () => {
  const s = new THREE.Shape(); for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + k * Math.PI / 5, rad = k % 2 ? 0.085 : 0.19; k ? s.lineTo(Math.cos(a) * rad, Math.sin(a) * rad) : s.moveTo(Math.cos(a) * rad, Math.sin(a) * rad); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 }); g.center(); return g;
});

export function createDizzyStars() {
  const group = new THREE.Group(), material = std('#ffd23a', { emissive: '#ffb000', emissiveIntensity: 0.6, roughness: 0.5 });
  const stars = [0, 1, 2].map(i => { const m = put(group, starGeometry(), material); m.castShadow = false; return { m, a: i * TAU / 3 }; });
  const update = elapsed => {
    for (const s of stars) {
      const a = elapsed * 2.6 + s.a; s.m.position.set(Math.cos(a) * 0.45, Math.sin(elapsed * 3 + s.a * 2) * 0.04, Math.sin(a) * 0.45);
      // Lie almost flat (tilted slightly outward) so the star never turns edge-on to a camera looking down at the bee, and spin in place.
      scratchN.set(Math.cos(a) * 0.34, 0.94, Math.sin(a) * 0.34).normalize(); scratchQ.setFromUnitVectors(FORWARD, scratchN); s.m.quaternion.copy(scratchQ).multiply(scratchS.setFromAxisAngle(FORWARD, elapsed * 3 + s.a));
    }
  };
  update(0); // already in place if the scene shows the group before its first update
  return { group, update };
}

// ---------------------------------------------------------------- hive
// The skep: outer crest radius R(y), 2.2 at the base, closing to a flat dome at y=3.9; collision assumes a cylinder of 2.3.
const skepRadius = y => 2.2 * Math.pow(Math.max(0, 1 - Math.pow(clamp((y - 0.3) / 3.6), 2.4)), 0.55);
const skepProfile = () => once('skep', () => {
  const pts = [], K = 400; let total = 0;
  for (let k = 0; k <= K; k++) { const y = 0.3 + 3.6 * k / K, r = skepRadius(y); if (k) total += Math.hypot(r - pts[k - 1].r, y - pts[k - 1].y); pts.push({ r, y, s: total }); }
  return { pts, total };
});
function skepAt(s) { // point and outward normal (in the r/y plane) at arc length s
  const { pts } = skepProfile(); let k = 1; while (k < pts.length - 1 && pts[k].s < s) k++;
  const a = pts[k - 1], b = pts[k], t = (s - a.s) / Math.max(1e-6, b.s - a.s), len = Math.hypot(b.r - a.r, b.y - a.y) || 1;
  return { r: lerp(a.r, b.r, t), y: lerp(a.y, b.y, t), nr: (b.y - a.y) / len, ny: -(b.r - a.r) / len };
}
function coilGeometry(Rc, tr, tint, k, r) {
  const radial = 6, tubular = 26, g = new THREE.TorusGeometry(Rc, tr, radial, tubular); g.rotateX(Math.PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color(), jitter = Array.from({ length: (tubular + 1) * (radial + 1) }, () => r());
  for (let i = 0; i < p.count; i++) {
    const dy = p.getY(i) / tr, ring = i % (tubular + 1), j = Math.floor(i / (tubular + 1));
    c.copy(tint).multiplyScalar((0.8 + 0.2 * smooth(-1, 1, dy)) * (0.95 + 0.05 * Math.sin(j * 2.1 + k) + 0.04 * (jitter[(ring % tubular) + j * (tubular + 1)] - 0.5)));
    c.toArray(col, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
}
// A honey streak is a puffy ribbon draped over the dome (wide at the cap, thin neck, round bulb), expressed relative to its top
// vertex so scaling the mesh in y lengthens it downward.
function dripGeometry(th, yTop, L, wTop) {
  const rb = 0.14, wNeck = 0.085, rows = 22, cols = 6, pos = [], idx = [], top = new THREE.Vector3(Math.sin(th) * skepRadius(yTop), yTop, Math.cos(th) * skepRadius(yTop));
  const width = d => Math.max(lerp(wTop, wNeck, smooth(0, 0.5 * L, d)) * (1 - smooth(L - rb, L - 0.02, d)), Math.sqrt(Math.max(0, rb * rb - (d - (L - rb)) ** 2)));
  for (let i = 0; i <= rows; i++) {
    const d = L * (1 - Math.pow(1 - i / rows, 1.5)), y = yTop - d, R = skepRadius(y), dR = (skepRadius(y + 0.01) - skepRadius(y - 0.01)) / 0.02, nr = 1 / Math.hypot(1, dR), w = width(d);
    for (let j = 0; j <= cols; j++) {
      const u = j / cols * 2 - 1, a = th + u * w / Math.max(R, 0.3), lift = 0.012 + 0.5 * w * Math.sqrt(1 - u * u) + 0.02 * (1 - u * u), rr = R + lift * nr, yy = y + lift * -dR * nr;
      pos.push(Math.sin(a) * rr - top.x, yy - top.y, Math.cos(a) * rr - top.z);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const A = i * (cols + 1) + j, B = A + 1, D = A + cols + 1, C = D + 1; idx.push(A, C, B, A, D, C); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); g.userData.top = top; return g;
}
const archShape = (w, h, y0, shape = new THREE.Shape()) => { shape.moveTo(-w, y0); shape.lineTo(-w, y0 + h - w); shape.absarc(0, y0 + h - w, w, Math.PI, 0, true); shape.lineTo(w, y0); shape.lineTo(-w, y0); return shape; };

export function createHiveModel() {
  const group = new THREE.Group(), r = rng(3), straw = vertexMat(0.9), honey = once('honey', () => new THREE.MeshPhysicalMaterial({ color: '#ee9a12', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, emissive: '#b8520a', emissiveIntensity: 0.3 }));
  const wood = std('#8e6a3e', { roughness: 0.9 });
  put(group, new THREE.CylinderGeometry(3.02, 3.07, 0.1, 32), std('#6f5230', { roughness: 0.95 }), 0, 0.05, 0, 'plinth');
  put(group, new THREE.CylinderGeometry(2.95, 3, 0.2, 32), wood, 0, 0.2, 0, 'base');

  const skep = new THREE.Group(); skep.name = 'skep'; group.add(skep);
  const { total } = skepProfile(), tr = 0.3, count = Math.round(total / 0.5); let topY = 0;
  for (let i = 0; i < count; i++) {
    const s = skepAt((i + 0.5) * total / count), Rc = s.r - s.nr * tr, yc = s.y - s.ny * tr; if (Rc < tr + 0.06) continue;
    put(skep, coilGeometry(Rc, tr, new THREE.Color(i % 2 ? '#dba537' : '#edbb4f'), i, r), straw, 0, yc, 0, 'coil'); topY = Math.max(topY, yc + tr);
  }
  const cap = put(skep, once('cap', () => new THREE.SphereGeometry(1, 16, 6, 0, TAU, 0, Math.PI / 2)), honey, 0, topY - 0.14, 0, 'honey-cap'); cap.scale.set(0.82, 0.22, 0.82);
  const knot = put(skep, once('knot', () => new THREE.SphereGeometry(1, 10, 6)), std('#e8b948', { roughness: 0.9 }), 0, topY + 0.02, 0, 'knot'); knot.scale.set(0.3, 0.24, 0.3);
  const strand = once('strand', () => new THREE.ConeGeometry(0.07, 0.3, 5).translate(0, 0.15, 0));
  for (let i = 0; i < 5; i++) { const a = i * TAU / 5, m = put(skep, strand, std('#e8b948'), Math.cos(a) * 0.1, topY + 0.1, Math.sin(a) * 0.1, 'strand'); m.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4); }

  // Entrance: a raised straw frame with a dark recessed arch, plus a little landing board.
  const entrance = new THREE.Group(); entrance.name = 'entrance'; group.add(entrance);
  const frameShape = archShape(0.62, 1.12, 0.38); frameShape.holes.push(archShape(0.45, 0.9, 0.45, new THREE.Path()));
  const frame = put(entrance, new THREE.ExtrudeGeometry(frameShape, { depth: 0.16, bevelEnabled: false }), std('#c9922c', { roughness: 0.9 }), 0, 0, 2.04, 'frame');
  put(entrance, new THREE.ExtrudeGeometry(archShape(0.45, 0.9, 0.45), { depth: 0.3, bevelEnabled: false }), std('#241609', { roughness: 1 }), 0, 0, 1.87, 'hole');
  put(entrance, new THREE.BoxGeometry(1.1, 0.07, 0.55), std('#a9763e', { roughness: 0.9 }), 0, 0.335, 2.4, 'landing');
  frame.receiveShadow = true;

  // Honey runs down the dome in flattened streaks, each hanging from its top so it can slowly lengthen.
  const drips = [], capY = topY - 0.14;
  for (const [th, len, w] of [[0.25, 2.1, 0.17], [0.95, 1.3, 0.15], [-0.6, 1.6, 0.16], [1.75, 1.0, 0.15], [-1.5, 1.2, 0.14], [0.62, 0.75, 0.13]]) {
    const g = dripGeometry(th, capY + 0.03, len, w), m = put(skep, g, honey, g.userData.top.x, g.userData.top.y, g.userData.top.z, 'drip'); m.castShadow = false; drips.push(m);
  }

  const ringMaterial = new THREE.MeshStandardMaterial({ color: '#fff2a3', roughness: 0.8, emissive: '#f1cb5e', emissiveIntensity: 0.5 });
  const ring = put(group, new THREE.TorusGeometry(3.2, 0.05, 8, 64), ringMaterial, 0, 0.22, 0, 'ring'); ring.rotation.x = -Math.PI / 2; ring.castShadow = false;
  const beacon = put(group, new THREE.OctahedronGeometry(0.32), std('#ffe49c', { emissive: '#f9c75d', emissiveIntensity: 0.7 }), 0, 4.8, 0, 'beacon'); beacon.castShadow = false;
  const halo = glowSprite('#ffd05a', 2.2, 0.4); beacon.add(halo);

  return {
    group, ring, beacon,
    update(elapsed, highlight = 0) {
      const h = clamp(+highlight || 0), s = Math.sin(elapsed * 2);
      ring.scale.setScalar(1 + s * (0.025 + 0.095 * h)); ringMaterial.emissiveIntensity = 0.5 + 0.3 * h * (0.6 + 0.4 * Math.sin(elapsed * 8));
      beacon.rotation.y = elapsed * 0.6; beacon.position.y = 4.8 + s * 0.15; beacon.scale.setScalar(1 + 0.35 * h); halo.material.opacity = 0.35 + 0.15 * Math.sin(elapsed * 3) + 0.2 * h;
      drips.forEach((d, i) => { d.scale.y = 1 + 0.07 * (0.5 + 0.5 * Math.sin(elapsed * 0.5 + i * 1.9)); });
    },
  };
}
