import * as THREE from 'three';

// Small, cheap effects around the player's bee: the rain cloud (after too many bumps) and the
// energy rings that rise around it when a boost starts. The scene places both every frame.
export function createRainCloud({ size = 1.7 } = {}) {
  // A small, soft cumulus: many smooth puffs, lighter on top, a darker, flatter belly underneath.
  const group = new THREE.Group(), puff = new THREE.SphereGeometry(1, 24, 16);
  const light = new THREE.MeshStandardMaterial({ color: '#b3bbc8', roughness: 1 }), mid = new THREE.MeshStandardMaterial({ color: '#949dac', roughness: 1 }), dark = new THREE.MeshStandardMaterial({ color: '#6f7888', roughness: 1 });
  for (const [x, y, z, r, m] of [
    [-0.5, -0.04, 0.02, 0.24, mid], [-0.22, -0.06, 0.1, 0.3, mid], [0.12, -0.05, -0.06, 0.3, mid], [0.44, -0.03, 0.05, 0.25, mid],
    [-0.3, 0.14, -0.02, 0.27, light], [0.02, 0.24, 0.03, 0.32, light], [0.3, 0.15, -0.05, 0.26, light], [-0.08, 0.1, -0.2, 0.25, light], [0.14, 0.08, 0.2, 0.24, light],
    [-0.04, 0.38, -0.02, 0.19, light], [0, -0.12, 0, 0.5, dark],
  ]) {
    const ball = new THREE.Mesh(puff, m); ball.position.set(x, y, z); ball.scale.set(r * 1.18, m === dark ? r * 0.3 : r * 0.9, r * (m === dark ? 0.62 : 1)); ball.castShadow = false; group.add(ball);
  }
  // Rain: fine streaks falling from the cloud down past the bee, recycled in a loop.
  const drops = 36, rain = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.011, 0.011, 0.2, 4), new THREE.MeshBasicMaterial({ color: '#a9d6ff', transparent: true, opacity: 0.8 }), drops);
  rain.frustumCulled = false; group.add(rain);
  const seeds = Array.from({ length: drops }, (_, i) => ({ x: Math.sin(i * 12.9898) * 0.42, z: Math.cos(i * 78.233) * 0.3, t: (i * 0.618) % 1 }));
  const dummy = new THREE.Object3D();
  // `lift` is how far above its spot the cloud floats: it sails down from high up when the rain starts and drifts
  // back up when it ends. The scene sets the spot; this adds the lift on top.
  let shown = 0, lift = 4.5;
  return {
    group,
    update(dt, elapsed, active) {
      if (active && shown < 0.05) lift = 4.5;
      lift += ((active ? 0 : 3) - lift) * Math.min(1, dt * (active ? 2.8 : 1.4));
      shown += ((active ? 1 : 0) - shown) * Math.min(1, dt * (active ? 4 : 2.5));
      group.visible = shown > 0.02;
      if (!group.visible) return;
      group.position.y += lift; const raining = active && lift < 0.6;
      group.scale.setScalar((0.4 + 0.6 * shown) * size); group.rotation.y = Math.sin(elapsed * 0.7) * 0.2;
      seeds.forEach((s, i) => {
        s.t = (s.t + dt * 2.2) % 1;
        dummy.position.set(s.x, -0.2 - s.t * 1.7, s.z); dummy.scale.setScalar(raining ? 1 : 0); dummy.updateMatrix(); rain.setMatrixAt(i, dummy.matrix);
      });
      rain.instanceMatrix.needsUpdate = true;
    },
  };
}

export function createBoostRings(scene, { count = 4 } = {}) {
  const material = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const rings = Array.from({ length: count }, () => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 40), material.clone()); ring.rotation.x = Math.PI / 2; ring.visible = false; scene.add(ring); return ring;
  });
  let time = -1, strength = 1;
  return {
    // Rings rise and widen around the bee for under a second, one after another.
    trigger(power = false) { time = 0; strength = power ? 1.6 : 1; },
    update(dt, at) {
      if (time < 0) return;
      time += dt;
      let alive = false;
      rings.forEach((ring, i) => {
        const t = (time - i * 0.12) / 0.75;
        ring.visible = t > 0 && t < 1; if (!ring.visible) return;
        alive = true;
        ring.position.set(at.x, at.y - 0.35 + t * 1.8, at.z);
        ring.scale.setScalar((1 + t * 0.8) * (strength > 1 ? 1.2 : 1)); ring.material.opacity = (1 - t) * 0.85 * Math.min(1, strength);
      });
      if (!alive && time > 0.2) time = -1;
    },
    get active() { return time >= 0; },
  };
}
