import * as THREE from 'three';

// The boss of Honey Retrieval: a big, glossy and thoroughly cross wasp. Built like the bumblebee in models.js (procedural, no assets, no
// DOM, so it builds in Node tests): smooth baked surfaces, glossy eyes with glints, legs on hip/knee/ankle joints, eased pose weights.
//
// Draw calls: all chitin (body, head, brows, mandibles, antennae, legs, stinger) is ONE skinned mesh; the eyes and their glints are two
// more skinned meshes on the same skeleton; the wings are two plain meshes on hinges and the wing blur two translucent fans. 7 in total.
// The warning pattern (bands, arrows, spots, the face mark) is painted into a small texture atlas built from raw bytes, so its edges stay
// crisp however the mesh is tessellated; everything else is vertex colour. The gaster bends smoothly over five bones (it curls under to
// sting, pumps and wriggles) and every leg is a three-bone chain that a small analytic IK plants on the ground or the cliff.
const TAU = Math.PI * 2, PI = Math.PI, Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v)), lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const band = (v, a, b, soft) => smooth(a - soft, a + soft, v) * (1 - smooth(b - soft, b + soft, v));
const bump = (v, c, w) => { const q = (v - c) / w; return q * q < 1 ? (1 - q * q) ** 2 : 0; };
const blob = (x, y, rx, ry, soft = 0.15) => 1 - smooth(1 - soft, 1 + soft, Math.hypot(x / rx, y / ry)); // a filled ellipse with a thin soft edge
const cap = (s, c) => { const u = Math.min(1, Math.max(0, s) / c); return Math.sqrt(u * (2 - u)); }; // a round end over the first `c` of a tube
const ease = (w, to, dt, rate) => w + (to - w) * (1 - Math.exp(-dt * rate));
const shared = new Map(), once = (key, make) => { if (!shared.has(key)) shared.set(key, make()); return shared.get(key); };
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mirror = (v, side) => V(v.x * side, v.y, v.z);

const INK = {
  yellow: new THREE.Color('#ffd21a'), gold: new THREE.Color('#f5b414'), orange: new THREE.Color('#e8820e'), amber: new THREE.Color('#a8561a'),
  black: new THREE.Color('#141116'), brown: new THREE.Color('#2a1a12'), sting: new THREE.Color('#4a160e'), eye: new THREE.Color('#0c0a0f'), eyeRed: new THREE.Color('#8e0c13'),
  ocellus: new THREE.Color('#4a1a0e'), white: new THREE.Color('#ffffff'),
};

// ---------------------------------------------------------------- layout (body space: thorax at the origin, head towards +Z, up +Y)
const GC = 0.52; // ground clearance: standing, the feet are this far below the group origin
const EDGE_Z = 0.5; // climbing: the front claws hook over a cliff edge at this local z (head and front legs above it, ~30 % of the wasp)
const NECK_AT = V(0, 0.1, 0.72), HEAD_AT = V(0, 0.13, 0.99), HEAD_R = V(0.52, 0.4, 0.29);
const JOINT_Z = [-0.12, -0.3, -0.68, -1.05, -1.42], STING_Z = -1.76; // petiole + four gaster bones, then the stinger
const WING_AT = V(0.17, 0.3, 0.36), SIDES = [-1, 1];
const TH = { z: 0.22, h: 0.5, r: 0.31, ky: 0.86 }, GASTER = { front: -0.28, tip: -1.8, r: 0.45, ky: 0.88 }, PETIOLE = { from: -0.36, to: -0.12, r: 0.085 }, NECK = { from: 0.35, to: 0.9, r: 0.15 };
const TERGITES = [0, 0.14, 0.32, 0.48, 0.63, 0.77, 0.89, 1]; // plate edges along the gaster, 0 = front, 1 = tip
const LEG_SPEC = [ // per pair, right side (x mirrors): hip, frame yaw (+ forward), femur/tibia/tarsus lengths and radii, standing foot (x, z), claw size
  { hip: [0.14, -0.17, 0.52], yaw: 0.85, len: [0.34, 0.36, 0.3], rad: [0.044, 0.034, 0.025], foot: [0.6, 0.95], claw: 1.4 },
  { hip: [0.18, -0.19, 0.24], yaw: -0.15, len: [0.38, 0.4, 0.32], rad: [0.046, 0.035, 0.026], foot: [0.8, 0.14], claw: 1.1 },
  { hip: [0.16, -0.14, 0.0], yaw: -0.85, len: [0.44, 0.48, 0.36], rad: [0.048, 0.037, 0.027], foot: [0.72, -0.64], claw: 1.1 },
];
const LEG_SIDE = [-1, -1, -1, 1, 1, 1], LEG_PAIR = [0, 1, 2, 0, 1, 2];
for (const spec of LEG_SPEC) { const len = 0.085 * spec.claw; spec.tip = [spec.len[2] + 0.2 * spec.rad[2] + 0.582 * len, -0.664 * len]; } // claw tip in the tarsus' frame: feet stand on their claws

// The trunk is one surface of revolution around a gently drooping centre line: a compact, humped thorax, a short pinched petiole and a
// long gaster that tapers like a cone to a sharp point. The lobes join with a soft 5-norm, so the waist is narrow but never creased.
const gasterS = z => (GASTER.front - z) / (GASTER.front - GASTER.tip);
const tergite = s => { let k = 0; while (k < TERGITES.length - 2 && s >= TERGITES[k + 1]) k++; return k; };
function ridge(s) { if (s <= 0 || s >= 1) return 0; const k = tergite(s), u = (s - TERGITES[k]) / (TERGITES[k + 1] - TERGITES[k]); return 0.045 * u * u * (1 - smooth(0.76, 1, u)); }
function bodyRadius(z) {
  const q = (z - TH.z) / TH.h, thorax = q * q < 1 ? TH.r * Math.sqrt(1 - q * q) * (1 + 0.12 * q) : 0;
  const nq = (z - NECK.from) / (NECK.to - NECK.from), neck = nq > 0 && nq < 1 ? NECK.r * Math.sqrt(1 - nq ** 4) : 0;
  const pet = z > PETIOLE.from && z < PETIOLE.to ? PETIOLE.r : 0, s = gasterS(z);
  const gaster = s > 0 && s < 1 ? GASTER.r * 2.1 * s ** 0.32 * (1 - s) ** 1.05 * (1 + ridge(s)) : 0;
  return (thorax ** 5 + neck ** 5 + pet ** 5 + gaster ** 5) ** 0.2;
}
function centreY(z) { const u = clamp((-0.4 - z) / 1.46); return 0.06 + 0.03 * smooth(0.5, 0.85, z) - 0.06 * smooth(-0.12, -0.4, z) - 0.1 * u * u; }
const bodyKy = z => lerp(TH.ky, GASTER.ky, smooth(-0.2, -0.45, z)) * (1 + 0.06 * bump(z, 0.3, 0.32)); // the scutum humps a little
const Z0 = GASTER.tip, Z1 = NECK.to;
const THORAX_TOP = (() => { let top = 0; for (let z = -0.2; z < 0.7; z += 0.01) top = Math.max(top, centreY(z) + bodyRadius(z) * bodyKy(z)); return top; })();
const BACK_Y = THORAX_TOP + 0.01 - GC; // on its back the body is lifted so the top of the thorax rests on the ground

// ---------------------------------------------------------------- geometry helpers
function weld(g) { // averages normals over shared positions (seams and poles), as in models.js
  const p = g.attributes.position, n = g.attributes.normal, sums = new Map(), key = i => `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
  for (let i = 0; i < p.count; i++) { const k = key(i), s = sums.get(k) ?? V(); s.add(V().fromBufferAttribute(n, i)); sums.set(k, s); }
  for (let i = 0; i < p.count; i++) { const s = sums.get(key(i)).clone().normalize(); n.setXYZ(i, s.x, s.y, s.z); }
  return g;
}
const ellipsoid = (a, b, c, w = 24, h = 16) => once(`wasp:ellipsoid:${a},${b},${c},${w},${h}`, () => { // exact normals, as the bumblebee's
  const g = new THREE.SphereGeometry(1, w, h), p = g.attributes.position, n = g.attributes.normal, v = V();
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, x * a, y * b, z * c); v.set(x / a, y / b, z / c).normalize(); n.setXYZ(i, v.x, v.y, v.z); }
  return g;
});
// A closed tube around a centre line. at(s) is the centre for s in [0, 1], size(s) the half-widths along the frame normal and binormal; the
// frame starts from `up` (or follows normal(s)) and is carried along by parallel transport. Both ends close to one pole vertex, uv = (s, angle).
function sweep({ at, size, normal = null, rings = 16, sides = 8, up = Y }) {
  const P = [], T = [], N = [], pos = [], uv = [], idx = [], n = V(), b = V(), v = V(), q = new THREE.Quaternion();
  for (let i = 0; i <= rings; i++) P.push(at(i / rings, V()));
  for (let i = 0; i <= rings; i++) T.push(V().subVectors(P[Math.min(rings, i + 1)], P[Math.max(0, i - 1)]).normalize());
  for (let i = 0; i <= rings; i++) {
    if (normal) normal(i / rings, n); else if (i === 0) n.copy(up); else n.applyQuaternion(q.setFromUnitVectors(T[i - 1], T[i]));
    n.addScaledVector(T[i], -n.dot(T[i])); if (n.lengthSq() < 1e-10) n.set(T[i].y, -T[i].x, 0); n.normalize(); N.push(n.clone());
  }
  pos.push(P[0].x, P[0].y, P[0].z); uv.push(0, 0);
  for (let i = 1; i < rings; i++) {
    const s = i / rings, [ra, rb] = size(s); b.crossVectors(T[i], N[i]);
    for (let j = 0; j < sides; j++) { const th = j / sides * TAU; v.copy(P[i]).addScaledVector(N[i], Math.cos(th) * ra).addScaledVector(b, Math.sin(th) * rb); pos.push(v.x, v.y, v.z); uv.push(s, j / sides); }
  }
  pos.push(P[rings].x, P[rings].y, P[rings].z); uv.push(1, 0);
  const ring = (i, j) => 1 + (i - 1) * sides + (j % sides), end = 1 + (rings - 1) * sides;
  for (let j = 0; j < sides; j++) idx.push(0, ring(1, j + 1), ring(1, j), ring(rings - 1, j), ring(rings - 1, j + 1), end);
  for (let i = 1; i < rings - 1; i++) for (let j = 0; j < sides; j++) { const A = ring(i, j), B = ring(i, j + 1), C = ring(i + 1, j + 1), D = ring(i + 1, j); idx.push(A, B, C, A, C, D); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
// Bakes pieces into one skinned geometry: positions, normals, colours, atlas uvs, up to four bone weights and an optional swell morph.
const WHITE_UV = [0.75, 484 / 512];
class SkinBaker {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; this.si = []; this.sw = []; this.mor = []; this.idx = []; this.morph = false; }
  add(g, { matrix = null, bone = 0, weigh = null, color = INK.black, paint = null, swell = null, uv = null }) {
    const p = g.attributes.position, n = g.attributes.normal, base = this.pos.length / 3, nm = matrix && new THREE.Matrix3().getNormalMatrix(matrix);
    const lp = V(), ln = V(), wp = V(), wn = V(), c = new THREE.Color(), si = [0, 0, 0, 0], sw = [0, 0, 0, 0], st = [0, 0];
    for (let i = 0; i < p.count; i++) {
      lp.fromBufferAttribute(p, i); ln.fromBufferAttribute(n, i); wp.copy(lp); wn.copy(ln); if (matrix) { wp.applyMatrix4(matrix); wn.applyMatrix3(nm).normalize(); }
      if (paint) paint(i, lp, wn, c); else c.copy(color);
      si.fill(0); sw.fill(0); if (weigh) weigh(wp, si, sw, i); else { si[0] = bone; sw[0] = 1; }
      const d = swell ? swell(wp, wn) : 0; if (d) this.morph = true;
      if (uv) uv(i, lp, st); else { st[0] = WHITE_UV[0]; st[1] = WHITE_UV[1]; }
      this.pos.push(wp.x, wp.y, wp.z); this.nor.push(wn.x, wn.y, wn.z); this.col.push(c.r, c.g, c.b); this.uv.push(st[0], st[1]); this.si.push(...si); this.sw.push(...sw); this.mor.push(wn.x * d, wn.y * d, wn.z * d);
    }
    const ix = g.index; for (let i = 0, count = ix ? ix.count : p.count; i < count; i++) this.idx.push(base + (ix ? ix.getX(i) : i));
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4)); g.setIndex(this.idx);
    if (this.morph) { g.morphAttributes.position = [new THREE.Float32BufferAttribute(this.mor, 3)]; g.morphTargetsRelative = true; }
    g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  }
}
const shadeOf = ny => 0.8 + 0.2 * smooth(-0.85, 0.35, ny); // the belly sits a touch darker than the back, as on the bumblebee

// ---------------------------------------------------------------- head
// A wasp's head, not a ball: wide, flat front to back and shield-shaped from the front (broad across the eyes, narrowing to the jaws), with
// a slightly hollow face plate and a raised clypeus above the mandibles. Parts are placed on it by direction from the head centre.
const clypeusMask = d => blob(d.x, d.y + 0.43, 0.27 - 0.06 * clamp((-0.3 - d.y) / 0.3), 0.21, 0.22);
function skull(d, out) {
  const shield = 1 - 0.3 * smooth(0.2, -1, d.y);
  let z = d.z * HEAD_R.z;
  if (z > 0) {
    z -= 0.5 * (z - 0.16) * smooth(0.16, HEAD_R.z, z); // a flat face plate
    z -= 0.03 * Math.exp(-(d.x * d.x) / 0.1 - ((d.y - 0.08) ** 2) / 0.12) * smooth(0.3, 0.8, d.z); // hollowed a little between the eyes
    z += 0.04 * clypeusMask(d) * smooth(0.4, 0.8, d.z);
  }
  return out.set(d.x * HEAD_R.x * shield, d.y * HEAD_R.y, z);
}
const skP1 = V(), skP2 = V(), skT1 = V(), skT2 = V(), skD = V();
function skullAt(dir, p, n) { // point (relative to the head centre) and outward normal for a direction
  skD.copy(dir).normalize(); skull(skD, p);
  skT1.crossVectors(Math.abs(skD.y) < 0.9 ? Y : Z, skD).normalize(); skT2.crossVectors(skD, skT1);
  skull(skP1.copy(skD).addScaledVector(skT1, 1e-3).normalize(), skP1).sub(p); skull(skP2.copy(skD).addScaledVector(skT2, 1e-3).normalize(), skP2).sub(p);
  n.crossVectors(skP1, skP2).normalize(); if (n.dot(p) < 0) n.negate(); return p;
}
// Big kidney-shaped compound eyes that wrap round the sides, notched on the inside where the antennae sit. Each eye lives in a small
// chart around its centre direction (a: towards the face, b: up); its outline is an ellipse with a notch, its surface a glossy dome that
// rises out of the skull, so eye and head meet in one clean rim.
const EYE = { centre: V(0.86, 0.08, 0.5), A: 0.5, B: 0.72, notch: 0.3, notchAt: 0.3, notchW: 0.4, bulge: 0.07 };
const eyeChart = side => once(`wasp:eye-chart${side}`, () => {
  const c = mirror(EYE.centre, side).normalize(), e2 = Y.clone().addScaledVector(c, -c.y).normalize(), e1 = V().crossVectors(e2, c).multiplyScalar(-side).normalize();
  return { c, e1, e2, side };
});
const eyeRadius = alpha => { const da = Math.atan2(Math.sin(alpha - EYE.notchAt), Math.cos(alpha - EYE.notchAt)); return (1 - EYE.notch * Math.exp(-((da / EYE.notchW) ** 2))) / Math.hypot(Math.cos(alpha) / EYE.A, Math.sin(alpha) / EYE.B); };
const chartDir = (ch, a, b, out) => out.copy(ch.c).addScaledVector(ch.e1, a).addScaledVector(ch.e2, b).normalize();
const chartTmp = V(), chartP = V(), chartN = V(), chartD = V();
function toChart(ch, d, out) { const k = d.dot(ch.c); if (k < 0.2) return null; chartTmp.copy(d).divideScalar(k).sub(ch.c); out.a = chartTmp.dot(ch.e1); out.b = chartTmp.dot(ch.e2); return out; }
function eyePoint(ch, a, b, out) { // the eye surface over chart point (a, b)
  const r = Math.hypot(a, b), rho = r / eyeRadius(Math.atan2(b, a)), h = 0.004 + EYE.bulge * Math.max(0, 1 - rho * rho) ** 0.6;
  skullAt(chartDir(ch, a, b, chartD), chartP, chartN); return out.copy(chartP).addScaledVector(chartN, h);
}
const eyeGeometry = side => once(`wasp:eye${side}`, () => {
  const ch = eyeChart(side), Rn = 13, Sn = 44, pos = [], col = [], idx = [], p = V(), c = new THREE.Color();
  const push = (a, b, rho) => { eyePoint(ch, a, b, p); pos.push(p.x, p.y, p.z); c.copy(INK.eye).lerp(INK.eyeRed, 0.7 * smooth(-0.25, -0.8, b / EYE.B) * (1 - 0.7 * smooth(0.7, 1, rho))); col.push(c.r, c.g, c.b); };
  push(0, 0, 0);
  for (let i = 1; i <= Rn; i++) { const rho = (i / Rn) ** 0.85; for (let j = 0; j < Sn; j++) { const al = j / Sn * TAU, r = rho * eyeRadius(al); push(r * Math.cos(al), r * Math.sin(al), rho); } }
  const at = (i, j) => 1 + (i - 1) * Sn + (j % Sn);
  for (let j = 0; j < Sn; j++) idx.push(0, at(1, j), at(1, j + 1));
  for (let i = 1; i < Rn; i++) for (let j = 0; j < Sn; j++) idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  const a = V().fromArray(pos, 0), b = V().fromArray(pos, at(1, 0) * 3), e = V().fromArray(pos, at(1, 1) * 3);
  if (b.sub(a).cross(e.sub(a)).dot(ch.c) < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]; // wind outwards
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
});
function eyeFrame(side) { // bone at the eye's centre on the skull: z along the skull normal, y up the eye (squinting scales y)
  const ch = eyeChart(side), p = V(), n = V(); skullAt(ch.c, p, n);
  const y = ch.e2.clone().addScaledVector(n, -ch.e2.dot(n)).normalize(), x = V().crossVectors(y, n);
  return { at: p, q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n)) };
}
// Brows: thick, glossy bars that run from low between the eyes to high above their outer corners and slice across the top of each eye.
const BROW = { inner: V(0.07, 0.2, 1), outer: V(0.9, 0.6, 0.25) }; // head directions
const browDir = (side, s, out) => out.copy(mirror(BROW.inner, side).normalize()).lerp(mirror(BROW.outer, side).normalize(), s).normalize().addScaledVector(Y, 0.07 * Math.sin(PI * s)).normalize();
const browGeometry = side => once(`wasp:brow${side}`, () => {
  const d = V(), p = V(), n = V();
  return sweep({
    at: (s, o) => { skullAt(browDir(side, s, d), p, n); return o.copy(p).addScaledVector(n, 0.03); }, normal: (s, o) => { skullAt(browDir(side, s, d), p, o); return o; },
    size: s => { const k = cap(s, 0.07) * (1 - s) ** 0.6 * (0.75 + 0.25 * Math.sin(PI * Math.min(1, s * 1.6))); return [0.048 * Math.max(0.45, k) * Math.min(1, (1 - s) * 5), 0.066 * k]; }, rings: 22, sides: 10,
  });
});
const SOCKET_DIR = V(0.16, 0.0, 1), MANDIBLE_DIR = V(0.3, -0.66, 0.7), OCELLI = [V(0, 0.9, 0.42), V(0.14, 0.93, 0.32), V(-0.14, 0.93, 0.32)];
const frameQ = z => { const y = Y.clone().addScaledVector(z, -z.y).normalize(), x = V().crossVectors(y, z); return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)); };

// ---------------------------------------------------------------- the pattern atlas (1024 x 512, raw bytes, no canvas)
// Left half: the trunk, unrolled (u around, v along z). Right half: the head (its sphere uvs). Top-right block: plain white for every
// other piece, which keeps its vertex colour. A 4-texel gutter wraps or clamps so mipmaps never bleed between the parts.
const bodyUV = (z, phi, out) => { out[0] = (4 + phi / TAU * 504) / 1024; out[1] = (4 + clamp((z - Z0) / (Z1 - Z0)) * 504) / 512; return out; };
const headUV = (u, w, out) => { out[0] = (516 + u * 504) / 1024; out[1] = (4 + w * 440) / 512; return out; };
// Jet thorax with a yellow collar, a flash under each wing and yellow spots behind; the gaster in bold lemon bands whose black fronts
// point back in a sharp arrow along the top, with a black dot either side (the classic warning pattern).
function bodyPaint(z, phi, out) {
  const up = Math.sin(phi), side = Math.cos(phi), across = Math.abs(side); let yel = 0;
  if (z > -0.25) {
    yel += band(z, 0.52, 0.6, 0.008) * band(up, -0.35, 0.86, 0.04) * (1 - blob(z - 0.6, up - 0.95, 0.12, 0.3)); // pronotum collar, open on top
    yel += blob(z - 0.36, Math.atan2(up, across) - 0.95, 0.09, 0.07); // two short stripes on the scutum
    for (const [cz, ca, rz, ra] of [[0.0, 1.12, 0.05, 0.16], [-0.1, 1.05, 0.035, 0.12], [-0.17, 0.55, 0.04, 0.13]]) yel += blob(z - cz, Math.atan2(up, across) - ca, rz, ra); // scutellum, postscutellum, propodeum spots
    yel += blob(z - 0.3, up + 0.12, 0.08, 0.22) * smooth(0.75, 0.85, across); // flash below the wing
  }
  const s = gasterS(z);
  if (s > 0) {
    const k = tergite(s), a = TERGITES[k], b = TERGITES[k + 1], u = (s - a) / (b - a), soft = 0.003 / (b - a), da = Math.abs(Math.atan2(side, up));
    const edge = (k === 0 ? 0.62 : k >= 6 ? 0.12 : 0.36) + (k >= 1 && k <= 5 ? 0.42 * Math.max(0, 1 - da / 0.36) ** 1.2 : 0) + (k >= 1 ? 0.06 * Math.max(0, 1 - Math.abs(da - PI) / 0.8) : 0);
    let y = smooth(edge - soft, edge + soft, u);
    if (k >= 1 && k <= 5) y *= 1 - blob(da - 1.0, u - 0.62, 0.22, 0.17, 0.12);
    yel = Math.max(yel, y * (1 - smooth(0.975, 0.985, s)));
  }
  return out.copy(INK.yellow).lerp(INK.gold, smooth(0.1, -0.8, up) * 0.6).lerp(INK.black, 1 - clamp(yel));
}
// Lemon face plate below a black crown, a black anchor down the middle (the brows finish it into a sharp V on top), black eye rims,
// yellow cheeks behind the eyes, a clypeus outlined in amber and a dark mouth.
const eyeHit = { a: 0, b: 0 };
function eyeOutline(d) { // distance outside the nearer eye's outline in chart units (negative inside), and that eye's chart
  let best = 9, chart = null;
  for (const side of SIDES) { const ch = eyeChart(side); if (!toChart(ch, d, eyeHit)) continue; const r = Math.hypot(eyeHit.a, eyeHit.b), dist = r - eyeRadius(Math.atan2(eyeHit.b, eyeHit.a)); if (dist < best) { best = dist; chart = { a: eyeHit.a, b: eyeHit.b, side }; } }
  return { dist: best, chart };
}
function headPaint(d, out) {
  const ax = Math.abs(d.x), { dist, chart } = eyeOutline(d);
  let face = smooth(0.3, 0.45, d.z) * (1 - smooth(0.2, 0.25, d.y - 0.4 * ax)); // the face plate: below the brow line, between the eyes
  const half = 0.018 + 0.07 * smooth(-0.3, 0.24, d.y); face *= 1 - (1 - smooth(half - 0.012, half + 0.012, ax)) * band(d.y, -0.3, 0.4, 0.012); // the black anchor, tapering down
  const arrow = clamp((d.y + 0.42) / 0.16); face *= 1 - (1 - smooth(0.085 * arrow - 0.012, 0.085 * arrow + 0.012, ax)) * band(d.y, -0.42, -0.26, 0.01); // ending in a downward arrowhead
  const cheek = chart ? band(dist, 0.04, 0.2, 0.012) * smooth(0.15, -0.05, chart.a) * band(chart.b, -0.62, 0.5, 0.05) : 0; // the yellow gena frames the back of each eye
  out.copy(INK.black).lerp(INK.yellow, clamp(face + cheek));
  out.lerp(INK.gold, 0.5 * band(clypeusMask(d), 0.1, 0.4, 0.06) * smooth(-0.6, -0.5, d.y) * smooth(0.3, 0.45, d.z)); // a faint rim where the clypeus rises
  out.lerp(INK.brown, smooth(-0.62, -0.67, d.y) * smooth(0.2, 0.4, d.z)); // mouth
  out.lerp(INK.black, 1 - smooth(0.012, 0.03, dist)); // eye rims (and under the eyes, seen only when they squint)
  out.lerp(INK.brown, blob(ax - SOCKET_DIR.x, d.y - SOCKET_DIR.y, 0.065, 0.065, 0.2) * smooth(0.5, 0.8, d.z)); // antenna sockets
  return out;
}
const atlasTexture = () => once('wasp:atlas', () => {
  const W = 1024, H = 512, data = new Uint8Array(W * H * 4), c = new THREE.Color(), d = V(), put = (x, y) => { const o = (y * W + x) * 4; data[o] = Math.round(clamp(c.r) ** (1 / 2.2) * 255); data[o + 1] = Math.round(clamp(c.g) ** (1 / 2.2) * 255); data[o + 2] = Math.round(clamp(c.b) ** (1 / 2.2) * 255); data[o + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < 512; x++) { const u = (((x - 4 + 0.5) / 504) % 1 + 1) % 1, t = clamp((y - 4 + 0.5) / 504); bodyPaint(lerp(Z0, Z1, t), u * TAU, c); put(x, y); }
  for (let y = 0; y < H; y++) for (let x = 512; x < W; x++) {
    if (y >= 452) { c.copy(INK.white); put(x, y); continue; }
    const u = (((x - 516 + 0.5) / 504) % 1 + 1) % 1, w = clamp((y - 4 + 0.5) / 440), th = (1 - w) * PI; d.set(-Math.cos(th), -Math.sin(u * TAU) * Math.sin(th), -Math.cos(u * TAU) * Math.sin(th)); headPaint(d, c); put(x, y);
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true; return t;
});
// The head mesh: a sphere whose poles sit at the temples and whose seam runs down the back, pushed out to the skull shape.
const headGeometry = () => once('wasp:head', () => {
  const g = new THREE.SphereGeometry(1, 52, 40); g.rotateZ(PI / 2); g.rotateX(PI / 2);
  const p = g.attributes.position, d = V(), v = V();
  for (let i = 0; i < p.count; i++) { d.fromBufferAttribute(p, i).normalize(); skull(d, v); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return weld(g);
});

// ---------------------------------------------------------------- antennae, mandibles, stinger, legs (all in their bone's local space)
// Antennae are short and elbowed like a wasp's: a stout scape up the face, then the flagellum bent forward and curling down at the tip.
const SCAPE = 0.24, FLAG = 0.46, FLAG_SPLIT = 0.5, FLAG_CURL = 1.0;
const flagAngle = s => FLAG_CURL * Math.max(0, s) ** 1.6;
function flagPoint(s, out) { let y = 0, z = 0; const n = 32, ds = s / n; for (let i = 0; i < n; i++) { const a = flagAngle((i + 0.5) * ds); y += Math.cos(a) * ds; z += Math.sin(a) * ds; } return out.set(0, y * FLAG, z * FLAG); }
const ANT_REST = side => ({ scape: [0.05, 0, -side * 0.22], elbow: [0.62, 0, -side * 0.42] });
const scapeGeometry = () => once('wasp:scape', () => sweep({ at: (s, o) => o.set(0, lerp(-0.03, SCAPE + 0.02, s), 0), size: s => { const r = lerp(0.034, 0.03, s) * cap(s, 0.12) * cap(1 - s, 0.12); return [r, r]; }, rings: 10, sides: 8, up: Z }));
const flagellumGeometry = () => once('wasp:flagellum', () => sweep({
  at: (s, o) => flagPoint(lerp(-0.03, 1, s), o), up: Z, rings: 34, sides: 8,
  size: s => { const r = lerp(0.027, 0.02, s) * (0.9 + 0.1 * Math.cos(TAU * s * 10)) * cap(s, 0.05) * cap(1 - s, 0.05); return [r, r]; },
}));
const MANDIBLE = side => [V(0, 0, -0.02), V(side * 0.07, -0.05, 0.16), V(-side * 0.13, -0.08, 0.24)];
const bezier = ([a, b, c], s, o) => o.set(0, 0, 0).addScaledVector(a, (1 - s) ** 2).addScaledVector(b, 2 * s * (1 - s)).addScaledVector(c, s * s);
const mandibleSize = s => { const k = cap(s, 0.1) * (1 - s) ** 0.55; return [0.058 * k, 0.032 * k]; };
const mandibleGeometry = side => once(`wasp:mandible${side}`, () => { const P = MANDIBLE(side); return sweep({ at: (s, o) => bezier(P, s, o), size: mandibleSize, rings: 20, sides: 9, up: Y }); });
const toothGeometry = (h, r = 0.016) => once(`wasp:tooth${h},${r}`, () => new THREE.ConeGeometry(r, h, 7, 1).translate(0, h / 2, 0));
const STING_DIR = V(0, -0.22, -1).normalize(), STING_LEN = 0.31;
const stingerGeometry = () => once('wasp:stinger', () => sweep({
  at: (s, o) => o.copy(STING_DIR).multiplyScalar(lerp(-0.14, STING_LEN, s)).addScaledVector(Y, -0.05 * s * s), up: Y, rings: 20, sides: 9,
  size: s => { const r = (s < 0.3 ? lerp(0.07, 0.04, smooth(0, 0.3, s)) : 0.04 * ((1 - s) / 0.7) ** 1.1) * cap(s, 0.06); return [r, r]; },
}));
// A leg segment: a slightly bulging tube along +X from the joint, rounded at both ends so neighbours overlap like ball joints.
const segmentGeometry = (len, r0, r1, bulge, beads = 0) => once(`wasp:segment:${len},${r0},${r1},${bulge},${beads}`, () => {
  const x0 = -r0 * 0.7, x1 = len + r1 * 0.6, L = x1 - x0;
  return sweep({
    at: (s, o) => o.set(lerp(x0, x1, s), 0, 0), up: Y, rings: beads ? 22 : 12, sides: 8,
    size: s => { const x = clamp(lerp(x0, x1, s) / len); let r = lerp(r0, r1, x) * (1 + bulge * Math.sin(PI * x)); if (beads) r *= 0.8 + 0.2 * Math.abs(Math.sin(PI * x * beads)) ** 0.6; r *= cap(s, r0 / L) * cap(1 - s, r1 / L); return [r, r]; },
  });
});
const clawGeometry = (size, k) => once(`wasp:claw${size}:${k}`, () => {
  const len = 0.085 * size, pt = (s, o) => { let x = 0, y = 0; const n = 12; for (let i = 0; i < n; i++) { const a = 1.7 * (i + 0.5) / n * s; x += Math.cos(a) * s / n; y -= Math.sin(a) * s / n; } return o.set(x * len, y * len, k * 0.3 * s * len); };
  return sweep({ at: pt, up: Z, rings: 7, sides: 5, size: s => { const r = 0.015 * size * (1 - s) ** 0.85 * cap(s, 0.15); return [r, r]; } });
});

// ---------------------------------------------------------------- wings
// Long, narrow, smoky-amber wings: one mesh per side holds the forewing and the shorter hindwing (hooked together, as on real wasps).
// At rest they lie folded lengthwise along the back to about the tip of the gaster; colour, veins, stigma and the smoky leading edge
// come from a small RGBA texture (forewing in the upper half, hindwing in the lower half).
const WINGS = [{ L: 2.1, W: 0.44, z: 0.0, y: 0.0, sweep: 0.03, tex: [0.51, 0.99] }, { L: 1.42, W: 0.31, z: -0.1, y: -0.016, sweep: -0.05, tex: [0.01, 0.49] }];
const wingWidth = (u, W) => W * (0.16 + 0.84 * smooth(0, 0.45, u)) * Math.sqrt(Math.max(0, 1 - smooth(0.5, 1, u)));
const wingGeometry = side => once(`wasp:wing${side}`, () => {
  const pos = [], uv = [], idx = [], U = 26, Vn = 6;
  for (const w of WINGS) {
    const base = pos.length / 3;
    for (let i = 0; i <= U; i++) for (let j = 0; j <= Vn; j++) {
      const u = i / U, v = j / Vn, width = wingWidth(u, w.W), zc = w.z + w.sweep * u, z = lerp(zc + width * 0.36, zc - width * 0.64, v);
      pos.push(side * u * w.L, w.y + 0.025 * Math.sin(PI * v) * u + 0.035 * u * u, z); uv.push(u, lerp(w.tex[0], w.tex[1], 1 - v));
    }
    for (let i = 0; i < U; i++) for (let j = 0; j < Vn; j++) { const a = base + i * (Vn + 1) + j, b = a + Vn + 1; side > 0 ? idx.push(a, a + 1, b + 1, a, b + 1, b) : idx.push(a, b + 1, a + 1, a, b, b + 1); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
});
const WING_VEINS = [ // polylines in (u along the wing, v from the leading edge) with a width in texels
  [[[0, 0.03], [0.6, 0.035]], 3.4], [[[0.02, 0.2], [0.3, 0.14], [0.56, 0.1]], 2.3], [[[0.62, 0.1], [0.78, 0.24], [0.93, 0.12]], 1.6],
  [[[0.02, 0.42], [0.3, 0.36], [0.55, 0.43], [0.8, 0.53]], 1.8], [[[0.03, 0.64], [0.28, 0.62], [0.5, 0.72], [0.72, 0.84]], 1.6], [[[0.02, 0.86], [0.25, 0.92]], 1.4],
  [[[0.3, 0.14], [0.3, 0.62]], 1.5], [[[0.45, 0.12], [0.48, 0.4], [0.5, 0.72]], 1.4], [[[0.56, 0.1], [0.62, 0.45], [0.66, 0.78]], 1.3], [[[0.74, 0.18], [0.76, 0.5]], 1.2],
];
const HIND_VEINS = [[[[0, 0.04], [0.55, 0.07]], 2.6], [[[0.02, 0.3], [0.45, 0.27]], 1.6], [[[0.03, 0.56], [0.5, 0.62]], 1.5], [[[0.3, 0.06], [0.32, 0.58]], 1.3]];
const wingTexture = () => once('wasp:wing-texture', () => {
  const W = 256, H = 128, half = H / 2, data = new Uint8Array(W * H * 4), membrane = new THREE.Color('#e0a548'), smoke = new THREE.Color('#7a4a1c'), vein = new THREE.Color('#3a220d'), c = new THREE.Color();
  const dist = (px, py, line, sx, sy) => { let best = 1e9; for (let k = 1; k < line.length; k++) { const ax = line[k - 1][0] * sx, ay = line[k - 1][1] * sy, bx = line[k][0] * sx, by = line[k][1] * sy, dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)); best = Math.min(best, Math.hypot(px - ax - dx * t, py - ay - dy * t)); } return best; };
  for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) {
    const fore = row >= half, tv = (row + 0.5) / H, [t0, t1] = fore ? WINGS[0].tex : WINGS[1].tex, v = clamp(1 - (tv - t0) / (t1 - t0)), u = (col + 0.5) / W;
    const sx = W, sy = half * 0.96, px = u * sx, py = v * sy;
    let a = 0.42 + 0.14 * u + 0.2 * (1 - v) * smooth(0.25, 0.9, u); c.copy(membrane).lerp(smoke, 0.2 + 0.5 * smooth(0.5, 1, u) * (0.45 + 0.55 * (1 - v)) + 0.25 * (1 - smooth(0, 0.25, v)));
    let ink = 0; for (const [line, w] of fore ? WING_VEINS : HIND_VEINS) ink = Math.max(ink, 1 - smooth(w * 0.5, w * 0.5 + 1.1, dist(px, py, line, sx, sy)));
    ink *= 1 - 0.85 * smooth(0.72, 0.95, u);
    if (fore) ink = Math.max(ink, 1 - smooth(0.85, 1.15, Math.hypot((u - 0.6) / 0.06, (v - 0.065) / 0.065))); // the stigma
    ink = Math.max(ink, 0.85 * smooth(0.95, 0.985, v), 0.7 * smooth(0.965, 0.99, u)); // a fine dark rim keeps the outline readable
    c.lerp(vein, ink); a = lerp(a, 0.95, ink);
    const o = (row * W + col) * 4; data[o] = Math.round(c.r ** (1 / 2.2) * 255); data[o + 1] = Math.round(c.g ** (1 / 2.2) * 255); data[o + 2] = Math.round(c.b ** (1 / 2.2) * 255); data[o + 3] = Math.round(clamp(a) * 255);
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
});
// The blur fan: the area a flapping forewing sweeps, brighter where the stroke turns (the wing spends longest there).
const BLUR_ARC = 0.78;
const blurGeometry = side => once(`wasp:blur${side}`, () => {
  const pos = [], col = [], idx = [], A = 14, R = 7, L = WINGS[0].L, tint = new THREE.Color('#ecc47c');
  for (let i = 0; i <= A; i++) for (let j = 0; j <= R; j++) {
    const f = i / A * 2 - 1, phi = f * BLUR_ARC, rho = lerp(0.12, L, j / R), r = rho / L;
    pos.push(side * rho * Math.cos(phi), rho * Math.sin(phi), -0.06 * r);
    col.push(tint.r, tint.g, tint.b, 0.42 * (0.45 + 0.55 * f * f) * smooth(0.06, 0.45, r) * (1 - smooth(0.8, 1, r)) * (1 - smooth(0.82, 1, Math.abs(f))));
  }
  for (let i = 0; i < A; i++) for (let j = 0; j < R; j++) { const a = i * (R + 1) + j, b = a + R + 1; idx.push(a, b, b + 1, a, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx); g.computeVertexNormals(); return g;
});

// ---------------------------------------------------------------- skeleton
// Analytic leg IK in the leg's own frame (x out from the hip, y up): the hip yaws towards the target, then femur and tibia solve a
// two-bone chain (knee up) to the ankle, and the tarsus keeps the given slope; the target is where the claws touch.
function solveLeg(spec, x, y, z, tilt, out, o = 0) {
  const [L1, L2] = spec.len, Le = Math.hypot(spec.tip[0], spec.tip[1]), te = tilt + Math.atan2(spec.tip[1], spec.tip[0]), a = Math.atan2(-z, x), u = Math.hypot(x, z), ax = u - Le * Math.cos(te), ay = y - Le * Math.sin(te);
  const D = clamp(Math.hypot(ax, ay), Math.abs(L1 - L2) + 0.03, L1 + L2 - 0.004), phi = Math.atan2(ay, ax);
  const t1 = phi + Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1)), t2 = Math.atan2(D * Math.sin(phi) - L1 * Math.sin(t1), D * Math.cos(phi) - L1 * Math.cos(t1));
  out[o] = a; out[o + 1] = t1; out[o + 2] = t2 - t1; out[o + 3] = tilt - t2; return out;
}
function buildRig() {
  const bones = [], make = (name, parent, at) => { const b = new THREE.Bone(); b.name = name; if (at) b.position.copy(at); parent?.add(b); bones.push(b); return b; };
  const root = make('wasp-thorax'), head = make('wasp-head', root, NECK_AT), inHead = v => v.clone().add(HEAD_AT).sub(NECK_AT);
  const chain = []; let parent = root, from = V();
  JOINT_Z.forEach((z, k) => { const at = V(0, centreY(z), z); chain.push(parent = make(k ? `wasp-gaster${k}` : 'wasp-petiole', parent, at.clone().sub(from))); from = at; });
  const stinger = make('wasp-stinger', parent, V(0, centreY(STING_Z), STING_Z).sub(from));
  const eyes = [], brows = [], mandibles = [], antennae = [], p = V(), n = V();
  for (const side of SIDES) {
    const f = eyeFrame(side), eye = make(`wasp-eye${side}`, head, inHead(f.at)); eye.quaternion.copy(f.q); eyes.push(eye);
    const socket = make(`wasp-brow-socket${side}`, head, inHead(V())); socket.quaternion.copy(frameQ(browDir(side, 0.5, V()))); brows.push(make(`wasp-brow${side}`, socket));
    skullAt(mirror(MANDIBLE_DIR, side), p, n); mandibles.push(make(`wasp-mandible${side}`, head, inHead(p.multiplyScalar(0.94))));
    skullAt(mirror(SOCKET_DIR, side), p, n); const rest = ANT_REST(side), scape = make(`wasp-antenna${side}`, head, inHead(p.addScaledVector(n, -0.01))); scape.rotation.set(...rest.scape);
    const f1 = make(`wasp-flagellum${side}`, scape, V(0, SCAPE, 0)); f1.rotation.set(...rest.elbow);
    const f2 = make(`wasp-flagellum-tip${side}`, f1, flagPoint(FLAG_SPLIT, V())); f2.rotation.x = flagAngle(FLAG_SPLIT);
    antennae.push({ scape, f1, f2, side });
  }
  const legs = [];
  for (const side of SIDES) LEG_SPEC.forEach((spec, pair) => {
    const frame = make(`wasp-coxa${side}${pair}`, root, V(side * spec.hip[0], spec.hip[1], spec.hip[2])); frame.rotation.y = side > 0 ? -spec.yaw : PI + spec.yaw;
    const hip = make(`wasp-femur${side}${pair}`, frame); hip.rotation.order = 'YZX';
    const knee = make(`wasp-tibia${side}${pair}`, hip, V(spec.len[0], 0, 0)), ankle = make(`wasp-tarsus${side}${pair}`, knee, V(spec.len[1], 0, 0));
    legs.push({ side, pair, spec, frame, hip, knee, ankle });
  });
  root.updateMatrixWorld(true);
  const angles = [0, 0, 0, 0], v = V();
  for (const leg of legs) { // the bind pose is the standing pose
    leg.frameInverse = leg.frame.matrix.clone().invert(); v.set(leg.side * leg.spec.foot[0], -GC, leg.spec.foot[1]).applyMatrix4(leg.frameInverse);
    solveLeg(leg.spec, v.x, v.y, v.z, -0.5, angles); leg.hip.rotation.set(0, angles[0], angles[1]); leg.knee.rotation.z = angles[2]; leg.ankle.rotation.z = angles[3];
  }
  root.updateMatrixWorld(true);
  return { root, bones, head, chain, stinger, eyes, brows, mandibles, antennae, legs };
}

// ---------------------------------------------------------------- the baked meshes
function bodyGeometry() {
  const M = 3000, zs = [], acc = [0], N = 104, S = 36, rings = [];
  for (let i = 0; i <= M; i++) zs.push(lerp(Z0, Z1, i / M));
  for (let i = 1; i <= M; i++) { const a = zs[i - 1], b = zs[i], d = Math.hypot(b - a, bodyRadius(b) - bodyRadius(a), centreY(b) - centreY(a)); acc.push(acc[i - 1] + d * (1 + 0.5 * smooth(-0.2, -0.4, (a + b) / 2))); } // rings by arc length, denser on the gaster plates
  for (let k = 0; k <= N; k++) { const target = acc[M] * k / N; let i = 1; while (i < M && acc[i] < target) i++; rings.push(lerp(zs[i - 1], zs[i], (target - acc[i - 1]) / ((acc[i] - acc[i - 1]) || 1))); }
  const pos = [0, centreY(Z0), Z0], phis = [0], idx = [];
  for (let k = 1; k < N; k++) { const z = rings[k], r = bodyRadius(z), c = centreY(z), ky = bodyKy(z); for (let j = 0; j <= S; j++) { const phi = j / S * TAU; pos.push(r * Math.cos(phi), c + r * ky * Math.sin(phi), z); phis.push(phi); } } // one extra column closes the seam for the atlas
  pos.push(0, centreY(Z1), Z1); phis.push(0);
  const ring = (k, j) => 1 + (k - 1) * (S + 1) + j, end = 1 + (N - 1) * (S + 1);
  for (let j = 0; j < S; j++) idx.push(0, ring(1, j + 1), ring(1, j), ring(N - 1, j), ring(N - 1, j + 1), end);
  for (let k = 1; k < N - 1; k++) for (let j = 0; j < S; j++) { const A = ring(k, j), B = ring(k, j + 1), C = ring(k + 1, j + 1), D = ring(k + 1, j); idx.push(A, B, C, A, C, D); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); weld(g); g.userData.phi = phis; return g;
}
const bodyWeights = (root, head, chain) => { const B = [root, ...chain], half = [0.06, 0.08, 0.15, 0.15, 0.13]; return (p, si, sw) => {
  const z = p.z;
  if (z > 0.5) { const t = smooth(0.6, 0.8, z); si[0] = root; sw[0] = 1 - t; si[1] = head; sw[1] = t; return; }
  for (let k = 0; k < JOINT_Z.length; k++) if (Math.abs(z - JOINT_Z[k]) < half[k]) { const t = smooth(JOINT_Z[k] + half[k], JOINT_Z[k] - half[k], z); si[0] = B[k]; sw[0] = 1 - t; si[1] = B[k + 1]; sw[1] = t; return; }
  let n = 0; while (n < JOINT_Z.length && z < JOINT_Z[n]) n++; si[0] = B[n]; sw[0] = 1;
}; };

const waspGeometry = () => once('wasp:geometry', () => {
  const rig = buildRig(), I = new Map(rig.bones.map((b, i) => [b, i])), M = b => b.matrixWorld, chitin = new SkinBaker(), eyes = new SkinBaker(), glints = new SkinBaker();
  const local = (x, y, z, q = null, s = 1) => new THREE.Matrix4().compose(V(x, y, z), q ?? new THREE.Quaternion(), V(s, s, s)), at = (bone, m) => M(bone).clone().multiply(m);
  const toHead = new THREE.Matrix4().makeTranslation(HEAD_AT.x, HEAD_AT.y, HEAD_AT.z), p = V(), n = V(), grey = (wn, out) => out.setScalar(shadeOf(wn.y));
  const tint = fn => (i, lp, wn, out) => fn(i, lp, wn, out).multiplyScalar(0.9 + 0.1 * smooth(-0.8, 0.5, wn.y));

  // Trunk: thorax, petiole and gaster as one skinned surface, coloured by the atlas; the gaster swells (morph target) when it pumps.
  const body = bodyGeometry(), phi = body.userData.phi;
  chitin.add(body, {
    weigh: bodyWeights(I.get(rig.root), I.get(rig.head), rig.chain.map(b => I.get(b))), paint: (i, lp, wn, out) => grey(wn, out), uv: (i, lp, out) => bodyUV(lp.z, phi[i], out),
    swell: wp => 0.04 * smooth(-0.3, -0.6, wp.z) * (1 - smooth(-1.45, -1.8, wp.z)),
  });
  for (const side of SIDES) chitin.add(ellipsoid(0.05, 0.03, 0.075, 12, 8), { matrix: local(side * (WING_AT.x + 0.01), WING_AT.y + 0.02, WING_AT.z + 0.03, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -side * 0.35))), bone: I.get(rig.root), color: INK.yellow }); // tegulae over the wing roots

  // Head (atlas-painted), brows, ocelli.
  const head = headGeometry(), huv = head.attributes.uv;
  chitin.add(head, { matrix: toHead, bone: I.get(rig.head), paint: (i, lp, wn, out) => grey(wn, out), uv: (i, lp, out) => headUV(huv.getX(i), huv.getY(i), out) });
  rig.brows.forEach((brow, k) => chitin.add(browGeometry(SIDES[k]), { matrix: toHead, bone: I.get(brow), color: INK.black }));
  for (const o of OCELLI) { skullAt(o, p, n); eyes.add(ellipsoid(0.026, 0.026, 0.018, 10, 8), { matrix: local(HEAD_AT.x + p.x * 0.99, HEAD_AT.y + p.y * 0.99, HEAD_AT.z + p.z * 0.99, frameQ(n.clone())), bone: I.get(rig.head), color: INK.ocellus }); }

  // Eyes and their glints: every eye catches the light from the same side (white glints high, a small red one low down).
  rig.eyes.forEach((eye, k) => {
    const side = SIDES[k], ch = eyeChart(side), q = V(), q1 = V(), q2 = V(), gn = V();
    eyes.add(eyeGeometry(side), { matrix: toHead, bone: I.get(eye), paint: (i, lp, wn, out) => out.fromBufferAttribute(eyeGeometry(side).attributes.color, i) });
    for (const [a, b, s, hex] of [[side * 0.06, 0.1, 0.05, '#ffffff'], [side * -0.14, -0.2, 0.024, '#ffffff'], [side * 0.02, -0.4, 0.028, '#ff3a24']]) {
      eyePoint(ch, a, b, q); eyePoint(ch, a + 0.01, b, q1); eyePoint(ch, a, b + 0.01, q2); gn.crossVectors(q1.sub(q), q2.sub(q)).normalize(); if (gn.dot(ch.c) < 0) gn.negate();
      glints.add(ellipsoid(1, 0.75, 0.3, 16, 10), { matrix: toHead.clone().multiply(local(q.x + gn.x * 0.004, q.y + gn.y * 0.004, q.z + gn.z * 0.004, new THREE.Quaternion().setFromUnitVectors(Z, gn), s)), bone: I.get(eye), color: new THREE.Color(hex) });
    }
  });

  // Mandibles: curved yellow blades with black, toothed tips.
  rig.mandibles.forEach((m, k) => {
    const side = SIDES[k], P = MANDIBLE(side), mg = mandibleGeometry(side), mu = mg.attributes.uv;
    chitin.add(mg, { matrix: M(m), bone: I.get(m), paint: tint((i, lp, wn, out) => { const s = mu.getX(i); return out.copy(INK.yellow).lerp(INK.orange, smooth(0.3, 0.5, s)).lerp(INK.black, smooth(0.52, 0.68, s)); }) });
    const o = V(), o2 = V(), T = V(), b = V(), dirT = V();
    for (const [s, h] of [[0.42, 0.05], [0.58, 0.046], [0.74, 0.036]]) {
      bezier(P, s, o); bezier(P, s + 0.01, o2); T.subVectors(o2, o).normalize(); b.crossVectors(T, Y).multiplyScalar(side).normalize(); // b: the inner (concave) side
      dirT.copy(b).addScaledVector(T, 0.45).addScaledVector(Y, -0.15).normalize(); o.addScaledVector(b, mandibleSize(s)[1] * 0.55);
      chitin.add(toothGeometry(h), { matrix: at(m, local(o.x, o.y, o.z, new THREE.Quaternion().setFromUnitVectors(Y, dirT))), bone: I.get(m), color: INK.black });
    }
  });

  // Antennae: a black scape with a gold front stripe and a knobbly black flagellum that bends smoothly across its two bones.
  rig.antennae.forEach(a => {
    const scape = scapeGeometry(), fl = flagellumGeometry(), sUv = scape.attributes.uv, fUv = fl.attributes.uv, f1 = I.get(a.f1), f2 = I.get(a.f2);
    chitin.add(scape, { matrix: M(a.scape), bone: I.get(a.scape), paint: (i, lp, wn, out) => out.copy(INK.black).lerp(INK.gold, 0.7 * smooth(0.5, 0.9, Math.cos(sUv.getY(i) * TAU)) * smooth(0.25, 0.45, sUv.getX(i))) }); // black, a thin gold stripe up the front
    chitin.add(ellipsoid(0.04, 0.04, 0.04, 10, 7), { matrix: M(a.f1), bone: f1, color: INK.brown });
    chitin.add(fl, { matrix: M(a.f1), weigh: (wp, si, sw, i) => { const t = smooth(FLAG_SPLIT - 0.1, FLAG_SPLIT + 0.1, fUv.getX(i)); si[0] = f1; sw[0] = 1 - t; si[1] = f2; sw[1] = t; }, paint: (i, lp, wn, out) => out.copy(INK.black).lerp(INK.amber, 0.15 * smooth(0.2, -0.7, Math.cos(fUv.getY(i) * TAU)) * smooth(0.15, 0.4, fUv.getX(i))) });
  });

  // Stinger: a black sheath and a dark red-brown, needle-sharp lancet.
  const sting = stingerGeometry(), stUv = sting.attributes.uv;
  chitin.add(sting, { matrix: M(rig.stinger), bone: I.get(rig.stinger), paint: (i, lp, wn, out) => out.copy(INK.black).lerp(INK.sting, smooth(0.28, 0.42, stUv.getX(i))).lerp(INK.black, 0.4 * smooth(0.8, 1, stUv.getX(i))) });

  // Legs: black coxa and femur base, lemon femur and tibia with orange knees, an orange beaded tarsus, dark hooked claws.
  for (const leg of rig.legs) {
    const { spec } = leg, [L1, L2, L3] = spec.len, [r0, r1, r2] = spec.rad;
    const coxa = once(`wasp:coxa`, () => sweep({ at: (s, o) => o.set(lerp(-0.12, 0.05, s), lerp(0.07, 0, s), 0), size: s => { const r = 0.058 * cap(s, 0.2) * cap(1 - s, 0.25); return [r, r]; }, rings: 7, sides: 8 }));
    chitin.add(coxa, { matrix: M(leg.frame), bone: I.get(leg.frame), color: INK.black });
    const femur = segmentGeometry(L1, r0, r1 * 1.05, 0.14), tibia = segmentGeometry(L2, r1, r2 * 1.15, 0.06), tarsus = segmentGeometry(L3, r2, r2 * 0.75, 0, 5);
    const fu = femur.attributes.uv, tu = tibia.attributes.uv, au = tarsus.attributes.uv;
    chitin.add(femur, { matrix: M(leg.hip), bone: I.get(leg.hip), paint: tint((i, lp, wn, out) => out.copy(INK.black).lerp(INK.yellow, smooth(0.4, 0.5, fu.getX(i))).lerp(INK.orange, smooth(0.85, 0.97, fu.getX(i)))) });
    chitin.add(tibia, { matrix: M(leg.knee), bone: I.get(leg.knee), paint: tint((i, lp, wn, out) => out.copy(INK.orange).lerp(INK.yellow, smooth(0.06, 0.16, tu.getX(i))).lerp(INK.gold, smooth(0.7, 1, tu.getX(i)))) });
    for (const k of [-1, 1]) chitin.add(toothGeometry(0.045, 0.013), { matrix: at(leg.knee, local(L2 - 0.01, -r2 * 0.6, k * r2 * 0.5, new THREE.Quaternion().setFromUnitVectors(Y, V(0.85, -0.45, k * 0.2).normalize()))), bone: I.get(leg.knee), color: INK.orange });
    chitin.add(tarsus, { matrix: M(leg.ankle), bone: I.get(leg.ankle), paint: tint((i, lp, wn, out) => { const x = au.getX(i), bead = Math.abs(Math.sin(PI * clamp(x * 1.08 - 0.04) * 5)); return out.copy(INK.gold).lerp(INK.orange, smooth(0.3, 1, x)).multiplyScalar(0.8 + 0.2 * bead); }) });
    for (const k of [-1, 1]) chitin.add(clawGeometry(spec.claw, k), { matrix: at(leg.ankle, local(L3 + r2 * 0.2, 0, 0)), bone: I.get(leg.ankle), color: INK.brown });
  }
  return { rig, chitin: chitin.build(), eyes: eyes.build(), glints: glints.build() };
});

// ---------------------------------------------------------------- materials
const chitinMaterial = () => once('wasp:chitin', () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: atlasTexture(), vertexColors: true, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1 }));
const eyeMaterial = () => once('wasp:eye', () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 }));
const glintMaterial = () => once('wasp:glint', () => new THREE.MeshBasicMaterial({ vertexColors: true }));

// ---------------------------------------------------------------- poses
// Every mode writes a full pose (body offset, joint angles, wing settings) into a channel array; modes are blended by eased weights.
// Legs either take joint angles directly or a foot target in group space (solved by IK against the blended body pose), or a mix of both.
let channelCount = 0; const channels = n => (channelCount += n) - n;
const BP = channels(3), BR = channels(3), HR = channels(3), MAND = channels(2), ANT = channels(10), BROWS = channels(4), EYES = channels(2), GAST = channels(10);
const PUMP = channels(1), STING = channels(1), WING = channels(6), WAMP = channels(1), WHZ = channels(1), BLUR = channels(1), FOLD = channels(1), LEG = channels(24), CHANNELS = channelCount;
const antenna = (q, si, x, y, z, f1, f2) => { const o = ANT + 5 * si; q[o] = x; q[o + 1] = y; q[o + 2] = z; q[o + 3] = f1; q[o + 4] = f2; };
const brow = (q, si, tilt, drop) => { q[BROWS + 2 * si] = tilt; q[BROWS + 2 * si + 1] = drop; };
const wing = (q, si, pitch, sweepBack, flap) => { const o = WING + 3 * si; q[o] = pitch; q[o + 1] = sweepBack; q[o + 2] = flap; };
const leg = (q, k, forward, lift, knee, ankle) => { const o = LEG + 4 * k; q[o] = -LEG_SIDE[k] * forward; q[o + 1] = lift; q[o + 2] = knee; q[o + 3] = ankle; };
const foot = (ik, k, x, y, z, tilt = -0.5, mix = 1) => { ik.pos[3 * k] = LEG_SIDE[k] * x; ik.pos[3 * k + 1] = y; ik.pos[3 * k + 2] = z; ik.tilt[k] = tilt; ik.mix[k] = mix; };
const gaster = (q, pet, curl, amp = 0, phase = 0, sway = 0, swayPhase = 0) => { q[GAST] = pet; for (let j = 0; j < 4; j++) { q[GAST + 2 + j] = curl + amp * Math.sin(phase - j * 0.6); q[GAST + 6 + j] = sway * Math.sin(swayPhase - j * 0.8); } q[GAST + 1] = sway * 0.5 * Math.sin(swayPhase + 0.8); };
const stand = (ik, k, tilt = -0.5) => { const s = LEG_SPEC[LEG_PAIR[k]]; foot(ik, k, s.foot[0], -GC, s.foot[1], tilt); };
const FOLDED = 1.47, TENT = 0.8; // wing sweep at rest (lying along the back) and how much folded wings tent
const DANGLE = [[0.5, -0.35, -1.2, -0.5], [0.05, -0.5, -0.9, -0.4], [-0.4, -0.55, -0.6, -0.3]]; // forward, lift, knee, ankle per pair, legs hanging in flight
const TUCK = [0.9, 0.2, -0.5], REACH = [0.6, 0.1, -0.4], PAW = [5.3, 3.3, 2.6], CYCLE = [0.5, 0, -0.5], STING_CURL = [0.4, 0.45, 0.5, 0.45]; // per pair / per gaster bone

const POSES = {
  fly(q, ik, t, e, speed) {
    const m = clamp(speed / 8);
    q[BP + 1] = 0.07 * Math.sin(e * 2.4); q[BR] = 0.06 + 0.22 * m + 0.03 * Math.sin(e * 2.4 - 0.8); q[BR + 1] = 0.05 * Math.sin(e * 1.1); q[BR + 2] = 0.05 * Math.sin(e * 1.7);
    q[HR] = -0.05 - 0.14 * m + 0.04 * Math.sin(e * 2.4 - 1.6); q[HR + 1] = 0.12 * Math.sin(e * 0.9);
    for (let si = 0; si < 2; si++) {
      const s = SIDES[si]; q[MAND + si] = 0.14 + 0.08 * Math.sin(e * 5 + si);
      antenna(q, si, 0.4 + 0.06 * Math.sin(e * 4 + s), 0, 0.06 * Math.sin(e * 2.6 + s), -0.35 + 0.08 * Math.sin(e * 3.3 + s), -0.2 - 0.15 * m);
      wing(q, si, 0, 0.32 + 0.22 * m, 0.2); brow(q, si, 0, 0.05);
    }
    q[WAMP] = 0.72; q[WHZ] = 27; q[BLUR] = 1; q[FOLD] = 0; q[PUMP] = 0.5 + 0.5 * Math.sin(e * 4.2);
    gaster(q, 0.04 - 0.1 * m, 0.03 - 0.06 * m, 0.03, e * 4.2, 0.03, e * 1.3);
    for (let k = 0; k < 6; k++) { const d = DANGLE[LEG_PAIR[k]], ph = e * 3 + LEG_PAIR[k] * 1.3 + LEG_SIDE[k]; leg(q, k, d[0] - 0.5 * m, d[1] + 0.08 * Math.sin(ph) - 0.1 * m, d[2] + 0.12 * Math.sin(ph + 1) + 0.25 * m, d[3]); }
  },
  climb(q, ik, t, e) {
    // In group space the cliff face is the plane y = -GC and the top of the cliff the plane z = EDGE_Z (the scene tilts the group head-up).
    const ph = t / 0.9, heave = Math.sin(TAU * 2 * ph);
    q[BP + 2] = 0.05 * heave; q[BR] = -0.08; q[BR + 2] = 0.06 * Math.sin(TAU * ph); q[BR + 1] = 0.04 * Math.sin(TAU * ph + 1);
    q[HR] = 0.7 + 0.1 * Math.sin(e * 1.3); q[HR + 1] = 0.3 * Math.sin(e * 0.8); q[HR + 2] = -0.06 * Math.sin(TAU * ph); // peering over the edge across the top
    const snap = Math.max(0, Math.sin(e * 7)) ** 3;
    for (let si = 0; si < 2; si++) {
      const s = SIDES[si]; q[MAND + si] = 0.12 + 0.88 * snap;
      antenna(q, si, 0.3 + 0.25 * Math.sin(e * 3.1 + s * 1.5), 0.1 * Math.sin(e * 1.7 + s), 0.15 * Math.sin(e * 2.3 + s), -0.2 + 0.25 * Math.sin(e * 4 + s * 2), 0.2 * Math.sin(e * 5.3 + s));
      brow(q, si, 0.15, 0.1); q[EYES + si] = 0.15;
    }
    gaster(q, -0.04, -0.01, 0.02, e * 3, 0.08, TAU * ph); q[PUMP] = 0.5 + 0.5 * heave;
    for (let k = 0; k < 6; k++) {
      const pair = LEG_PAIR[k], side = LEG_SIDE[k];
      if (pair === 0) { // front legs reach up over the edge in turn and hook their claws onto the top
        const pf = (ph + (side > 0 ? 0 : 0.5)) % 1, swing = pf < 0.38 ? Math.sin(PI * pf / 0.38) : 0, slide = pf < 0.38 ? 0 : (pf - 0.38) / 0.62;
        foot(ik, k, 0.46 - 0.1 * swing, -GC - 0.07 + 0.5 * swing, EDGE_Z + 0.04 + 0.34 * swing - 0.06 * slide, lerp(-1.25, -0.2, swing));
      } else { // middle and hind legs scrabble on the face in a tripod gait and push
        const pg = (ph + ((pair === 1) === (side > 0) ? 0.5 : 0)) % 1, stance = pg < 0.62, k2 = stance ? pg / 0.62 : (pg - 0.62) / 0.38;
        const z0 = pair === 1 ? 0.06 : -0.62, z = stance ? lerp(z0 + 0.15, z0 - 0.15, k2) : lerp(z0 - 0.15, z0 + 0.15, smooth(0, 1, k2));
        foot(ik, k, pair === 1 ? 0.76 : 0.7, -GC + (stance ? 0 : 0.22 * Math.sin(PI * k2)), Math.min(z, EDGE_Z - 0.08), -0.55);
      }
    }
  },
  flip(q, ik, t, e) {
    const k = smooth(0, 0.12, t) * (1 - smooth(0.62, 0.9, t)), flare = smooth(0, 0.1, t);
    q[HR] = 0.35 * k; q[BP + 1] = 0.05 * k;
    for (let si = 0; si < 2; si++) { q[MAND + si] = 0.12 + 0.4 * k; antenna(q, si, -0.6 * k, 0, 0.2 * k, 0.3 * k, 0.2 * k); wing(q, si, -0.1 * flare, lerp(FOLDED, 0.12, flare), lerp(0.07, 0.4, flare)); brow(q, si, 0.1, 0.2); q[EYES + si] = 0.4 * k; }
    q[WAMP] = 0.6 * flare; q[WHZ] = 30; q[BLUR] = 0.8 * flare; q[FOLD] = 1 - flare; q[PUMP] = 0.8 * k;
    gaster(q, 0.25 * k, 0.32 * k); q[STING] = 0.3 * k;
    for (let j = 0; j < 6; j++) { const d = DANGLE[LEG_PAIR[j]]; leg(q, j, lerp(d[0], TUCK[LEG_PAIR[j]], k), lerp(d[1], 0.25, k), lerp(d[2], -2.3, k), lerp(d[3], -1, k)); }
  },
  attack(q, ik, t, e) {
    POSES.fly(q, ik, t, e, 0);
    const p = (t % 0.95) / 0.95, windup = smooth(0, 0.3, p) * (1 - smooth(0.32, 0.42, p)), strike = smooth(0.32, 0.42, p) * (1 - smooth(0.6, 0.95, p));
    q[BP + 2] = -0.18 * windup + 0.42 * strike; q[BP + 1] += 0.05 * windup - 0.05 * strike; q[BR] = 0.1 - 0.15 * windup + 0.28 * strike;
    q[HR] = -0.25 * windup + 0.3 * strike; q[HR + 1] = 0; q[HR + 2] = 0.06 * Math.sin(e * 23) * strike;
    const snap = 0.5 + 0.5 * Math.cos(TAU * 7 * t);
    for (let si = 0; si < 2; si++) {
      q[MAND + si] = lerp(snap, 1, windup) * (1 - 0.9 * smooth(0.36, 0.42, p) * (1 - smooth(0.42, 0.5, p)));
      antenna(q, si, -0.35 - 0.2 * strike, 0, 0.25, 0.2, 0.1); wing(q, si, 0, 0.3, 0.3); brow(q, si, 0.35, 0.35); q[EYES + si] = 0.35 + 0.3 * strike;
    }
    q[WAMP] = 0.82; q[WHZ] = 32;
    q[GAST] = 0.35 + 0.15 * strike; const c = 0.8 + 0.4 * strike - 0.25 * windup; for (let j = 0; j < 4; j++) { q[GAST + 2 + j] = STING_CURL[j] * c; q[GAST + 6 + j] = 0; } q[STING] = 0.4 + 0.6 * strike;
    for (let k = 0; k < 6; k++) { const pair = LEG_PAIR[k]; if (pair === 0) leg(q, k, 1.1, 0.15 + 0.3 * strike, -0.9 + 0.5 * strike, -0.6); else leg(q, k, pair === 1 ? 0.4 : -0.3, 0.2, -1.3, -0.5); }
  },
  confused(q, ik, t, e) {
    POSES.fly(q, ik, t, e, 0);
    q[BR + 2] = 0.2 * Math.sin(e * 1.6) + 0.05 * Math.sin(e * 4.3); q[BR] = 0.06 + 0.1 * Math.sin(e * 1.25 + 1); q[BP] = 0.08 * Math.sin(e * 1.6 - 0.5); q[BP + 1] = 0.06 * Math.sin(e * 2.1);
    q[HR] = 0.15 * Math.sin(e * 3.7); q[HR + 1] = 0.3 * Math.sin(e * 2.9 + 1); q[HR + 2] = 0.35 * Math.sin(e * 4.4);
    const stutter = smooth(-0.2, 0.3, Math.sin(e * 9.1) + 0.6 * Math.sin(e * 3.7));
    for (let si = 0; si < 2; si++) {
      const s = SIDES[si], twitch = Math.max(0, Math.sin(e * 13 + s * 2)) ** 4;
      q[MAND + si] = 0.4 + 0.2 * Math.sin(e * 2.3 + si);
      antenna(q, si, 0.75 + 0.25 * twitch, 0.15 * Math.sin(e * 1.9 + s), -0.1, 0.55 - 0.4 * twitch, 0.45 + 0.2 * Math.sin(e * 3 + s));
      brow(q, si, si ? 0.35 : -0.55, 0.12 * s * Math.sin(e * 1.3)); q[EYES + si] = si ? 0.5 + 0.3 * Math.sin(e * 2.2) : -0.15;
      wing(q, si, 0.1 * Math.sin(e * 5 + s), 0.5 + 0.2 * Math.sin(e * 1.4 + s), 0.12);
    }
    q[WAMP] = 0.75 * (0.25 + 0.75 * stutter); q[BLUR] = 0.3 + 0.6 * stutter; q[WHZ] = 24; q[FOLD] = 0.15;
    gaster(q, 0.06, 0.08, 0.06, e * 2.2, 0.12, e * 1.8);
    for (let k = 0; k < 6; k++) { const pair = LEG_PAIR[k], s = LEG_SIDE[k], r = PAW[pair]; leg(q, k, REACH[pair] + 0.4 * Math.sin(e * r + s), -0.25 + 0.35 * Math.sin(e * (r * 0.8) + s * 2 + pair), -1.0 + 0.5 * Math.sin(e * (r * 1.2) + s + pair), -0.5 + 0.3 * Math.sin(e * r + pair)); }
  },
  shake(q, ik, t, e) {
    POSES.fly(q, ik, t, e, 0);
    const k = t < 0.8 ? smooth(0, 0.06, t) : Math.exp(-(t - 0.8) * 5);
    q[BR + 2] += 0.5 * k * Math.sin(e * 41); q[BR + 1] += 0.22 * k * Math.sin(e * 33 + 1); q[BR] += 0.12 * k * Math.sin(e * 29 + 2); q[BP] += 0.07 * k * Math.sin(e * 37); q[BP + 1] += 0.05 * k * Math.sin(e * 45);
    q[HR + 1] += 0.35 * k * Math.sin(e * 35 + 0.5); q[HR + 2] += 0.2 * k * Math.sin(e * 31);
    for (let si = 0; si < 2; si++) {
      const s = SIDES[si]; q[MAND + si] = lerp(q[MAND + si], 1, k);
      q[ANT + 5 * si] += 0.4 * k * Math.sin(e * 30 + s); q[ANT + 5 * si + 2] += 0.3 * k * Math.sin(e * 26); q[ANT + 5 * si + 3] += 0.4 * k * Math.sin(e * 28 + s);
      wing(q, si, 0, lerp(q[WING + 3 * si + 1], 0.02, k), lerp(q[WING + 3 * si + 2], 0.45, k)); brow(q, si, 0.3 * k, 0.3 * k); q[EYES + si] = 0.4 * k;
    }
    q[WAMP] = 0.85; q[WHZ] = lerp(27, 34, k);
    for (let j = 0; j < 4; j++) q[GAST + 6 + j] += 0.25 * k * Math.sin(e * 30 - j * 0.7);
    for (let j = 0; j < 6; j++) { const o = LEG + 4 * j, ph = e * 24 + j * 2 + LEG_SIDE[j]; q[o + 1] = lerp(q[o + 1], 0.35 + 0.35 * Math.sin(ph), k); q[o + 2] = lerp(q[o + 2], -0.3 + 0.3 * Math.sin(ph * 1.1 + 1), k); q[o + 3] = lerp(q[o + 3], -0.1, k); }
  },
  onBack(q, ik, t, e) {
    // The body rolls over; the scene keeps the group at y = GC, so the thorax top rests on the ground (y = -GC in group space).
    q[BR + 2] = PI + 0.08 * Math.sin(e * 5.5); q[BP + 1] = BACK_Y; q[BR] = 0.06 * Math.sin(e * 3.1); q[BR + 1] = 0.08 * Math.sin(e * 2.3);
    q[HR] = 0.42 + 0.1 * Math.sin(e * 4.3); q[HR + 2] = 0.25 * Math.sin(e * 3.7); q[HR + 1] = 0.2 * Math.sin(e * 2.1);
    for (let si = 0; si < 2; si++) {
      const s = SIDES[si]; q[MAND + si] = 0.3 + 0.3 * Math.sin(e * 6 + si);
      antenna(q, si, 0.3 * Math.sin(e * 7 + s), 0.2 * Math.sin(e * 4.1 + s), 0.3 * Math.sin(e * 5.3), 0.3 * Math.sin(e * 9 + s), 0.3 * Math.sin(e * 6.2 + s));
      brow(q, si, -0.9, -0.08); q[EYES + si] = -0.22;
      wing(q, si, s * 0.3 + 0.08 * Math.sin(e * 11 + s), s > 0 ? 1.0 : 1.25, 0.02 + 0.05 * Math.sin(e * 17 + s)); // crumpled flat on the ground
    }
    q[WAMP] = 0.18 * Math.max(0, Math.sin(e * 1.7)) ** 6; q[WHZ] = 13; q[BLUR] = 0; q[FOLD] = 0.55; q[PUMP] = 0.5 + 0.5 * Math.sin(e * 9);
    gaster(q, 0.08, 0.1, 0.12, e * 5, 0.22, e * 8);
    for (let k = 0; k < 6; k++) { const ph = e * 15 + LEG_PAIR[k] * 1.1 + (LEG_SIDE[k] > 0 ? 0 : PI / 2); leg(q, k, CYCLE[LEG_PAIR[k]] + 0.45 * Math.sin(ph), -0.25 + 0.35 * Math.cos(ph), -1.2 + 0.6 * Math.sin(ph + 1.3), -0.6 + 0.4 * Math.sin(ph + 2)); }
  },
  rightItself(q, ik, t, e, speed, scratch, base) {
    POSES.onBack(q, ik, t, e);
    const rock = (1 - smooth(0.35, 0.55, t)) * smooth(0, 0.2, t), roll = smooth(0.45, 0.9, t), hop = bump(t, 0.68, 0.24), land = bump(t, 1.02, 0.12);
    q[BR + 2] = PI * (1 - roll) + 0.35 * rock * Math.sin(t * 16); q[BR] = 0.1 * hop; q[BR + 1] = 0.05 * Math.sin(t * 9) * (1 - roll);
    q[BP + 1] = lerp(BACK_Y, 0, smooth(0.4, 0.95, t)) + 0.3 * hop - 0.05 * land;
    q[HR] = lerp(0.42, 0, smooth(0.5, 1, t)); q[HR + 1] = 0.25 * land * Math.sin(t * 30);
    for (let si = 0; si < 2; si++) {
      const s = SIDES[si]; q[MAND + si] = lerp(0.05, 0.2, smooth(0.9, 1.1, t));
      brow(q, si, lerp(-0.9, 0.1, smooth(0.75, 1.1, t)), 0.1 * hop); q[EYES + si] = 0.45 * bump(t, 0.6, 0.3);
      wing(q, si, lerp(s * 0.3, 0, roll), lerp(s > 0 ? 1.0 : 1.25, 0.4, bump(t, 0.6, 0.4)), lerp(0.05, 0.3, bump(t, 0.6, 0.4)));
    }
    q[WAMP] = 0.7 * bump(t, 0.6, 0.35); q[WHZ] = 28; q[BLUR] = 0.6 * bump(t, 0.6, 0.3); q[FOLD] = 0.55 * (1 - bump(t, 0.6, 0.35));
    gaster(q, 0.05, 0.1 - 0.3 * bump(t, 0.5, 0.25), 0.1 * (1 - roll), e * 5, 0.2 * (1 - roll), e * 8);
    for (let k = 0; k < 6; k++) { const o = LEG + 4 * k, reach = smooth(0.55, 0.9, t); q[o + 1] = lerp(q[o + 1], -0.55, reach); q[o + 2] = lerp(q[o + 2], -0.9, reach); stand(ik, k); ik.mix[k] = smooth(0.82, 1.1, t); }
    // From 0.95 s on, settle exactly into the standing pose, so switching to 'standing' at 1.2 s is seamless.
    const done = smooth(0.95, 1.2, t); if (done > 0) { scratch.set(q); q.set(base); POSES.standing(q, ik, t, e); for (let c = 0; c < CHANNELS; c++) q[c] = lerp(scratch[c], q[c], done); }
  },
  standing(q, ik, t, e) {
    q[BP + 1] = 0.012 * Math.sin(e * 1.7); q[BR] = -0.04 + 0.012 * Math.sin(e * 1.7 + 0.5); q[BR + 1] = 0.03 * Math.sin(e * 0.5); q[BR + 2] = 0.012 * Math.sin(e * 0.9);
    q[HR] = -0.05 + 0.05 * Math.sin(e * 0.8); q[HR + 1] = 0.22 * Math.sin(e * 0.6) + 0.05 * Math.sin(e * 1.9); q[HR + 2] = 0.04 * Math.sin(e * 0.6 + 1);
    const rub = 0.12 * Math.sin(e * 5.5), flex = Math.max(0, Math.sin(e * 0.75)) ** 10, flick = Math.max(0, Math.sin(e * 0.45 + 1)) ** 20;
    for (let si = 0; si < 2; si++) {
      const s = SIDES[si]; q[MAND + si] = 0.2 + s * rub;
      antenna(q, si, 0.12 * Math.sin(e * 0.9 + s), 0.3 * Math.sin(e * 1.1 + si * 0.4), 0.06 * Math.sin(e * 0.7 + s), 0.15 * Math.sin(e * 1.3 + s * 2), 0.2 * Math.sin(e * 1.7 + s));
      brow(q, si, 0.05 + 0.05 * Math.sin(e * 0.6), 0.05); q[EYES + si] = 0.12 + 0.08 * Math.sin(e * 0.7);
      wing(q, si, 0, FOLDED - 0.7 * flick, 0.07 + 0.2 * flick);
    }
    q[WAMP] = 0.5 * flick; q[WHZ] = 24; q[BLUR] = 0.5 * flick; q[FOLD] = 1 - flick; q[STING] = 0.7 * flex; q[PUMP] = 0.5 + 0.5 * Math.sin(e * 3.4);
    gaster(q, 0.02 + 0.04 * flex, 0.03 + 0.04 * flex, 0.03, e * 3.4, 0.03, e * 0.8);
    for (let k = 0; k < 6; k++) stand(ik, k);
  },
  kick(q, ik, t, e) {
    // A blow every 0.45 s, left and right in turn; every second blow a hind leg stomps.
    const T = 0.45, n = Math.floor(t / T), p = (t % T) / T, punch = n % 2 ? 1 : -1, hit = smooth(0, 0.2, p) * (1 - smooth(0.35, 1, p)), jolt = bump(p, 0.24, 0.16);
    const ps = (t % (2 * T)) / (2 * T), stomper = Math.floor(t / (2 * T)) % 2 ? 5 : 2, lift = smooth(0.08, 0.42, ps) * (1 - smooth(0.5, 0.58, ps)), slam = bump(ps, 0.62, 0.08);
    q[BP + 1] = 0.3 + 0.03 * hit - 0.03 * slam; q[BP + 2] = -0.1 + 0.12 * hit; q[BR] = -0.62 + 0.16 * hit; q[BR + 1] = punch * 0.12 * hit; q[BR + 2] = punch * 0.08 * hit + 0.03 * jolt;
    q[HR] = 0.42 + 0.12 * hit; q[HR + 1] = -punch * 0.1 * hit; q[HR + 2] = 0.08 * jolt * punch;
    for (let si = 0; si < 2; si++) {
      q[MAND + si] = 0.3 + 0.65 * hit; antenna(q, si, -0.3 - 0.25 * hit, 0, 0.15, 0.2 * hit, 0.1); brow(q, si, 0.3, 0.3); q[EYES + si] = 0.3 + 0.2 * hit;
      wing(q, si, 0, 1.15 - 0.3 * hit, 0.25);
    }
    q[WAMP] = 0.35 * hit; q[WHZ] = 30; q[BLUR] = 0.35 * hit; q[FOLD] = 0.6; q[STING] = 0.5; q[PUMP] = hit;
    gaster(q, -0.2, -0.16 + 0.06 * hit);
    for (let k = 0; k < 6; k++) {
      const pair = LEG_PAIR[k], side = LEG_SIDE[k];
      if (pair === 0) { const h = side === punch ? hit : 0; foot(ik, k, lerp(0.34, 0.12, h), lerp(0.62, 0.42, h) + 0.04 * Math.sin(e * 6 + side), lerp(0.85, 1.5, h), lerp(0.5, 0, h)); }
      else { stand(ik, k); if (k === stomper) { ik.pos[3 * k + 1] += 0.34 * lift; ik.pos[3 * k] *= 1 + 0.08 * lift; } }
    }
  },
  eat(q, ik, t, e) {
    q[BP + 1] = -0.03 + 0.015 * Math.sin(e * 7); q[BR] = 0.13 + 0.02 * Math.sin(e * 7); q[BR + 2] = 0.02 * Math.sin(e * 3);
    q[HR] = 0.3 + 0.05 * Math.sin(e * 14); q[HR + 1] = 0.1 * Math.sin(e * 0.9);
    for (let si = 0; si < 2; si++) {
      const s = SIDES[si]; q[MAND + si] = 0.5 + 0.5 * Math.sin(e * 15 + si * 0.6);
      antenna(q, si, 0.45 + 0.15 * Math.sin(e * 6 + s * 2), 0, 0.1, 0.25, 0.2 + 0.2 * Math.sin(e * 9 + s));
      brow(q, si, 0, 0.1); q[EYES + si] = 0.3 + 0.1 * Math.sin(e * 15);
    }
    q[PUMP] = 0.5 + 0.5 * Math.sin(e * 8); gaster(q, -0.04, -0.05, 0.05, e * 8, 0.04, e * 2);
    for (let k = 0; k < 6; k++) {
      if (LEG_PAIR[k] === 0) { const a = TAU * ((e / 0.6 + (LEG_SIDE[k] > 0 ? 0 : 0.5)) % 1); foot(ik, k, 0.26 - 0.08 * Math.sin(a), Math.max(-GC, -GC + 0.12 + 0.16 * Math.sin(a)), 1.12 + 0.13 * Math.cos(a), -0.3); }
      else stand(ik, k);
    }
  },
};
const MODES = Object.keys(POSES), MODE_INDEX = new Map(MODES.map((m, i) => [m, i]));
const BLEND = 11; // pose weights ease at this rate: about 0.25 s from one mode to the next

// ---------------------------------------------------------------- the wasp
export const WASP = Object.freeze({
  length: 3.61, // rest-pose bounding-box length along Z (antenna tips to stinger tip; ~1.44 x the bumblebee)
  headOffset: Object.freeze({ x: HEAD_AT.x, y: HEAD_AT.y, z: HEAD_AT.z }), // head centre, group space, standing
  stingerOffset: Object.freeze({ x: 0, y: +(centreY(STING_Z) + STING_DIR.y * STING_LEN - 0.05).toFixed(3), z: +(STING_Z + STING_DIR.z * STING_LEN).toFixed(3) }), // stinger tip, standing
  groundClearance: GC, // standing: put the group at y = groundClearance and the feet touch y = 0 (the same height for onBack / rightItself)
  climbEdgeZ: EDGE_Z, // climbing: the cliff's top edge sits at this local z (front claws hook over it, ~30 % of the wasp shows above it)
  modes: Object.freeze([...MODES]),
});

export function createWasp() {
  const geo = waspGeometry(), group = new THREE.Group(), body = new THREE.Group(); group.name = 'wasp'; body.name = 'wasp-body'; group.add(body);
  const rig = buildRig(); body.add(rig.root);
  const skinned = (geometry, material, name, shadow) => { const m = new THREE.SkinnedMesh(geometry, material); m.name = name; m.castShadow = m.receiveShadow = shadow; body.add(m); return m; };
  const chitin = skinned(geo.chitin, chitinMaterial(), 'wasp-chitin', true), eyes = skinned(geo.eyes, eyeMaterial(), 'wasp-eyes', false), glints = skinned(geo.glints, glintMaterial(), 'wasp-glints', false);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(rig.bones);
  for (const m of [chitin, eyes, glints]) { m.bind(skeleton); m.boundingSphere = new THREE.Sphere(V(0, 0, -0.1), 3.4); }
  chitin.morphTargetInfluences[0] = 0;

  // Wings hinge on top of the thorax; their material is per wasp because it fades while the blur shows.
  const wingMat = new THREE.MeshPhysicalMaterial({ map: wingTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.3, metalness: 0, iridescence: 0.5, iridescenceIOR: 1.35, iridescenceThicknessRange: [220, 460] });
  const blurMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0 });
  const wings = SIDES.map(side => {
    const hinge = new THREE.Object3D(), pivot = new THREE.Object3D(); hinge.name = `wasp-wing${side}`; hinge.position.set(side * WING_AT.x, WING_AT.y, WING_AT.z); pivot.position.copy(hinge.position); rig.root.add(hinge, pivot);
    const roll = new THREE.Object3D(); roll.rotation.x = TENT; hinge.add(roll); // folded wings tent over the back, leading edges down
    const w = new THREE.Mesh(wingGeometry(side), wingMat); w.name = 'wasp-wing'; w.castShadow = w.receiveShadow = false; w.renderOrder = 2; w.scale.z = 0.64; roll.add(w);
    const b = new THREE.Mesh(blurGeometry(side), blurMat); b.name = 'wasp-wing-blur'; b.castShadow = b.receiveShadow = false; b.renderOrder = 3; b.visible = false; b.scale.setScalar(0); pivot.add(b);
    hinge.rotation.set(0, side * FOLDED, side * 0.07); pivot.rotation.copy(hinge.rotation); // folded until the first update
    return { hinge, pivot, roll, mesh: w, blur: b, side };
  });

  // Anchors for effects: crown (dizzy stars), stinger tip, feet.
  const crown = new THREE.Object3D(); crown.name = 'wasp-crown'; crown.position.copy(HEAD_AT).sub(NECK_AT).add(V(0, HEAD_R.y + 0.08, -0.04)); rig.head.add(crown);
  const tip = new THREE.Object3D(); tip.name = 'wasp-stinger-tip'; tip.position.copy(STING_DIR).multiplyScalar(STING_LEN).addScaledVector(Y, -0.05); rig.stinger.add(tip);
  const feet = rig.legs.map(l => { const f = new THREE.Object3D(); f.name = 'wasp-foot'; f.position.set(l.spec.tip[0], l.spec.tip[1], 0); l.ankle.add(f); return f; });
  const rest = { stinger: rig.stinger.position.clone(), antennae: rig.antennae.map(a => ({ scape: a.scape.rotation.clone(), elbow: a.f1.rotation.x, tip: a.f2.rotation.x })) };

  // Pose state. Nothing below allocates per frame.
  const base = new Float32Array(CHANNELS); base.set([0.14, 0.14], MAND); for (let si = 0; si < 2; si++) { base[WING + 3 * si + 1] = FOLDED; base[WING + 3 * si + 2] = 0.07; } base[WHZ] = 26; base[PUMP] = 0.3; base[FOLD] = 1;
  rig.legs.forEach((l, k) => { base[LEG + 4 * k] = l.hip.rotation.y; base[LEG + 4 * k + 1] = l.hip.rotation.z; base[LEG + 4 * k + 2] = l.knee.rotation.z; base[LEG + 4 * k + 3] = l.ankle.rotation.z; });
  const W = new Float32Array(MODES.length), TM = new Float32Array(MODES.length), P = new Float32Array(CHANNELS), Q = new Float32Array(CHANNELS), scratch = new Float32Array(CHANNELS);
  const ik = { mix: new Float32Array(6), pos: new Float32Array(18), tilt: new Float32Array(6) }, kept = MODES.map(() => ({ w: 0, mix: new Float32Array(6), pos: new Float32Array(18), tilt: new Float32Array(6) }));
  const inv = new THREE.Matrix4(), v = V(), angles = [0, 0, 0, 0];
  let current = MODE_INDEX.get('standing'), own = 0, started = false, phase = 0, hitAt = Infinity; W[current] = 1;

  const parts = {
    body, head: rig.head, abdomen: rig.chain[2], stinger: tip, legs: rig.legs.map(l => l.hip), feet, wings: wings.map(w => w.hinge), mandibles: rig.mandibles, antennae: rig.antennae.map(a => a.scape),
    eyes: rig.eyes, crown, skeleton,
  };
  return {
    group, parts,
    get mode() { return MODES[current]; },
    hit() { hitAt = 0; },
    update(dt, elapsed, state) {
      dt = clamp(+dt || 0, 0, 0.1); const e = +elapsed || 0, want = MODE_INDEX.get(state?.mode) ?? MODE_INDEX.get('fly'), speed = Math.max(0, +state?.speed || 0);
      if (!started) { started = true; W.fill(0); W[want] = 1; current = want; own = 0; } // the very first frame shows the asked-for pose
      if (want !== current) { current = want; own = 0; } else own += dt;
      let total = 0;
      for (let m = 0; m < MODES.length; m++) { if (m === current) TM[m] = Number.isFinite(state?.t) ? Math.max(0, +state.t) : own; else TM[m] += dt; W[m] = ease(W[m], m === current ? 1 : 0, dt, BLEND); if (m !== current && W[m] < 1e-3) W[m] = 0; total += W[m]; }
      P.fill(0);
      for (let m = 0; m < MODES.length; m++) {
        const k = kept[m]; k.w = W[m] / total; if (!W[m]) continue;
        Q.set(base); ik.mix.fill(0); POSES[MODES[m]](Q, ik, TM[m], e, speed, scratch, base); k.mix.set(ik.mix); k.pos.set(ik.pos); k.tilt.set(ik.tilt);
        for (let c = 0; c < LEG; c++) P[c] += k.w * Q[c];
        for (let j = 0; j < 6; j++) for (let a = 0; a < 4; a++) P[LEG + 4 * j + a] += k.w * (1 - k.mix[j]) * Q[LEG + 4 * j + a];
      }
      body.position.set(P[BP], P[BP + 1], P[BP + 2]); body.rotation.set(P[BR], P[BR + 1], P[BR + 2]); body.updateMatrix(); inv.copy(body.matrix).invert();
      for (let m = 0; m < MODES.length; m++) {
        const k = kept[m]; if (!W[m]) continue;
        for (let j = 0; j < 6; j++) if (k.mix[j] > 0) {
          const l = rig.legs[j]; v.set(k.pos[3 * j], k.pos[3 * j + 1], k.pos[3 * j + 2]).applyMatrix4(inv).applyMatrix4(l.frameInverse); solveLeg(l.spec, v.x, v.y, v.z, k.tilt[j], angles);
          for (let a = 0; a < 4; a++) P[LEG + 4 * j + a] += k.w * k.mix[j] * angles[a];
        }
      }
      // A bee just slammed the head: it squashes and wobbles back, the antennae flick, the eyes squint, the jaws gape. Gone within 0.6 s.
      if (hitAt < 1) hitAt += dt;
      const h = Math.min(1, hitAt), live = hitAt < 1, squash = live ? 0.32 * Math.exp(-9 * h) * Math.cos(17 * h) : 0, sting = live ? Math.exp(-7 * h) : 0, flick = live ? Math.exp(-8 * h) * Math.sin(26 * h) : 0;
      rig.head.rotation.set(P[HR] - 0.15 * sting, P[HR + 1], P[HR + 2]); rig.head.scale.set(1 + 0.45 * squash, 1 - squash, 1 + 0.3 * squash);
      for (let si = 0; si < 2; si++) {
        const s = SIDES[si], a = rig.antennae[si], r = rest.antennae[si], o = ANT + 5 * si;
        rig.mandibles[si].rotation.y = s * 0.8 * clamp(P[MAND + si] + 0.6 * sting, -0.1, 1.2);
        a.scape.rotation.set(r.scape.x + P[o] - 0.5 * flick, r.scape.y + P[o + 1], r.scape.z - s * (P[o + 2] + 0.3 * flick)); a.f1.rotation.x = r.elbow + P[o + 3] + 0.8 * flick; a.f2.rotation.x = r.tip + P[o + 4] + 0.5 * flick;
        rig.brows[si].rotation.set(P[BROWS + 2 * si + 1] + 0.3 * sting, 0, s * P[BROWS + 2 * si]);
        rig.eyes[si].scale.y = 1 - 0.7 * clamp(P[EYES + si] + 0.9 * sting, -0.25, 1);
        const w = wings[si], o2 = WING + 3 * si; w.hinge.rotation.set(P[o2], s * P[o2 + 1], s * (P[o2 + 2] + P[WAMP] * Math.sin(phase + si * 0.2))); w.pivot.rotation.set(P[o2], s * P[o2 + 1], s * P[o2 + 2]);
        w.mesh.scale.z = 1 - 0.36 * clamp(P[FOLD]); w.roll.rotation.x = TENT * clamp(P[FOLD]); w.blur.visible = P[BLUR] * P[WAMP] > 0.02; w.blur.scale.setScalar(w.blur.visible ? 1 : 0); // hidden fans also leave the bounding box
      }
      phase = (phase + dt * TAU * P[WHZ]) % TAU;
      blurMat.opacity = clamp(P[BLUR]) * clamp(P[WAMP] / 0.6); wingMat.opacity = 1 - 0.4 * clamp(P[BLUR]) * clamp(P[WAMP] / 0.6);
      rig.chain[0].rotation.set(-P[GAST], P[GAST + 1], 0); for (let j = 0; j < 4; j++) rig.chain[j + 1].rotation.set(-P[GAST + 2 + j], P[GAST + 6 + j], 0); // + curls the gaster under
      rig.stinger.position.copy(rest.stinger).addScaledVector(STING_DIR, 0.13 * clamp(P[STING]));
      chitin.morphTargetInfluences[0] = clamp(P[PUMP]);
      for (let j = 0; j < 6; j++) { const l = rig.legs[j], o = LEG + 4 * j; l.hip.rotation.set(0, P[o], P[o + 1]); l.knee.rotation.z = P[o + 2]; l.ankle.rotation.z = P[o + 3]; }
    },
    dispose() { wingMat.dispose(); blurMat.dispose(); skeleton.dispose(); },
  };
}
