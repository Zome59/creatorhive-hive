import * as THREE from 'three';

// Honeycomb ring around the hive base: one cell per `unit` nectar in the hive (the ring holds the goal). Cells fill in order;
// a cell filled mostly by the player glows orange, scout honey is gold. Delivered honey flies into
// the next cell as droplets. The ledger keeps who brought each nectar, newest last (thieves drink
// from the top).
export const GAUGE = Object.freeze({ cells: 35, unit: 10, radius: 2.72, y: 0.36 }); // 35 cells × 10 = the 350-nectar goal
const COLORS = Object.freeze({ empty: new THREE.Color('#4d3f27'), scouts: new THREE.Color('#f2b52a'), player: new THREE.Color('#ff7a1a') });

export function createHoneyGauge({ cells = GAUGE.cells, unit = GAUGE.unit, radius = GAUGE.radius, y = GAUGE.y } = {}) {
  const group = new THREE.Group(), ledger = [], dummy = new THREE.Object3D(), color = new THREE.Color();
  const comb = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.21, 0.21, 0.28, 6), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.25, metalness: 0.05, emissive: '#3a2000', emissiveIntensity: 0.5 }), cells);
  const rim = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.25, 0.12, 6, 1, true), new THREE.MeshStandardMaterial({ color: '#c99a43', roughness: 0.7, side: THREE.DoubleSide }), cells);
  const spot = i => { const a = i / cells * Math.PI * 2 + Math.PI / cells; return [Math.sin(a) * radius, Math.cos(a) * radius, a]; };
  for (let i = 0; i < cells; i++) {
    const [x, z, a] = spot(i);
    dummy.position.set(x, y, z); dummy.rotation.set(0, a, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); rim.setMatrixAt(i, dummy.matrix);
  }
  comb.castShadow = false; rim.receiveShadow = true; group.add(rim, comb);
  // Droplets: a small pool reused for every delivery.
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.2, emissive: '#5a3000', emissiveIntensity: 0.4 }), 48);
  drops.frustumCulled = false; group.add(drops);
  const flights = Array.from({ length: 48 }, () => ({ t: 1, delay: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), color: new THREE.Color() }));
  let shown = [];
  const owner = i => {
    const part = ledger.slice(i * unit, (i + 1) * unit);
    return part.filter(who => who === 'player').length * 2 >= part.length ? 'player' : 'scouts';
  };
  return {
    group, ledger,
    get player() { return ledger.filter(who => who === 'player').length; },
    // Records a delivery and sends droplets from the bee to the cells it fills.
    deliver(from, amount, who) {
      const start = ledger.length;
      for (let n = 0; n < amount; n++) ledger.push(who);
      for (let n = 0; n < Math.min(amount, 8); n++) {
        const flight = flights.find(f => f.t >= 1); if (!flight) break;
        const [x, z] = spot(Math.min(cells - 1, Math.floor((start + n * amount / Math.min(amount, 8)) / unit)));
        Object.assign(flight, { t: 0, delay: n * 0.07 }); flight.from.copy(from); flight.to.set(x, y + 0.15, z); flight.color.copy(COLORS[who]);
      }
    },
    drain(amount = 1) { ledger.length = Math.max(0, ledger.length - amount); },
    // Keeps the ledger in step with the hive total (new round, or honey changed elsewhere).
    sync(total) { if (ledger.length > total) ledger.length = total; while (ledger.length < total) ledger.push('scouts'); },
    update(dt, elapsed) {
      shown = shown.length === cells ? shown : new Array(cells).fill(0);
      for (let i = 0; i < cells; i++) {
        const fill = Math.max(0, Math.min(1, (ledger.length - i * unit) / unit));
        shown[i] += (fill - shown[i]) * Math.min(1, dt * 5);
        const [x, z, a] = spot(i), level = shown[i];
        // Full cells bulge a little above the wax rim.
        dummy.position.set(x, y - 0.1 + level * 0.14, z); dummy.rotation.set(0, a, 0); dummy.scale.set(0.98, Math.max(0.05, level), 0.98); dummy.updateMatrix(); comb.setMatrixAt(i, dummy.matrix);
        color.copy(COLORS.empty).lerp(COLORS[owner(i)], Math.min(1, level * 1.4));
        if (level > 0.98 && owner(i) === 'player') color.multiplyScalar(1 + Math.sin(elapsed * 3 + i) * 0.06);
        comb.setColorAt(i, color);
      }
      comb.instanceMatrix.needsUpdate = true; if (comb.instanceColor) comb.instanceColor.needsUpdate = true;
      flights.forEach((f, i) => {
        if (f.t < 1) { if (f.delay > 0) f.delay -= dt; else f.t = Math.min(1, f.t + dt / 0.6); }
        const active = f.t > 0 && f.t < 1;
        dummy.position.lerpVectors(f.from, f.to, f.t); dummy.position.y += Math.sin(Math.PI * f.t) * 1.6;
        dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(active ? 1 : 0); dummy.updateMatrix(); drops.setMatrixAt(i, dummy.matrix); drops.setColorAt(i, f.color);
      });
      drops.instanceMatrix.needsUpdate = true; if (drops.instanceColor) drops.instanceColor.needsUpdate = true;
    },
  };
}
