import * as THREE from 'three';

// Small, cheap effects around the player's bee: the rain cloud (after too many bumps) and the
// energy rings that rise around it when a boost starts. The scene places both every frame.
export function createRainCloud({ size = 2.6 } = {}) {
  const group = new THREE.Group(), puff = new THREE.SphereGeometry(1, 16, 12);
  const grey = new THREE.MeshStandardMaterial({ color: '#7d8796', roughness: 0.95 }), dark = new THREE.MeshStandardMaterial({ color: '#555f6e', roughness: 0.95 });
  for (const [x, y, z, r, m] of [[0, 0, 0, 0.42, grey], [0.38, -0.05, 0.05, 0.32, grey], [-0.36, -0.04, -0.04, 0.3, grey], [0.1, 0.18, -0.12, 0.3, grey], [0, -0.16, 0, 0.36, dark]]) {
    const ball = new THREE.Mesh(puff, m); ball.position.set(x, y, z); ball.scale.set(r * 1.25, r, r); group.add(ball);
  }
  // Rain: thin streaks falling from the cloud to just below the bee, recycled in a loop.
  const drops = 40, rain = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.02, 0.24, 4), new THREE.MeshBasicMaterial({ color: '#9fd0ff', transparent: true, opacity: 0.85 }), drops);
  rain.frustumCulled = false; group.add(rain);
  const seeds = Array.from({ length: drops }, (_, i) => ({ x: Math.sin(i * 12.9898) * 0.42, z: Math.cos(i * 78.233) * 0.32, t: (i * 0.618) % 1 }));
  const dummy = new THREE.Object3D();
  let shown = 0;
  return {
    group,
    update(dt, elapsed, active) {
      shown += ((active ? 1 : 0) - shown) * Math.min(1, dt * 5);
      group.visible = shown > 0.02;
      if (!group.visible) return;
      group.scale.setScalar((0.4 + 0.6 * shown) * size); group.rotation.y = Math.sin(elapsed * 0.7) * 0.2;
      seeds.forEach((s, i) => {
        s.t = (s.t + dt * 2.2) % 1;
        dummy.position.set(s.x, -0.25 - s.t * 1.6, s.z); dummy.scale.setScalar(active ? 1 : 0); dummy.updateMatrix(); rain.setMatrixAt(i, dummy.matrix);
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
