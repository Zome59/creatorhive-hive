import * as THREE from 'three';

// Golden glow around the player's bee while nectar power is charged: a soft outline that hugs the
// body and rings that fade outward. No canvas: the ring texture is computed into a DataTexture.
function ringTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
    const a = Math.max(0, 1 - Math.abs(r - 0.78) / 0.2) ** 1.6 + Math.max(0, 1 - r) ** 3 * 0.35;
    data.set([255, 214, 90, Math.round(Math.min(1, a) * 255)], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size); texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  return texture;
}

export function createPowerAura() {
  const glow = (opacity, scale) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), new THREE.MeshBasicMaterial({ color: '#ffcf3a', transparent: true, opacity, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.scale.set(...scale); return mesh;
  };
  // Two back-face shells around the body read as an outline with a soft falloff.
  const outline = new THREE.Group(); outline.add(glow(0.75, [0.4, 0.38, 0.64]), glow(0.32, [0.52, 0.49, 0.8]));
  outline.visible = false;
  const halo = new THREE.Group(), texture = ringTexture();
  const rings = Array.from({ length: 3 }, () => {
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.add(ring); return ring;
  });
  halo.visible = false;
  let strength = 0;
  return {
    outline, halo,
    get strength() { return strength; },
    update(dt, elapsed, { active = false, boosting = false } = {}) {
      strength += ((active ? 1 : 0) - strength) * Math.min(1, dt * 6);
      outline.visible = halo.visible = strength > 0.02;
      if (!outline.visible) return;
      const pulse = 0.85 + Math.sin(elapsed * (boosting ? 18 : 5)) * 0.15;
      outline.children[0].material.opacity = 0.75 * strength * pulse * (boosting ? 1.4 : 1);
      outline.children[1].material.opacity = 0.32 * strength * pulse * (boosting ? 1.5 : 1);
      const speed = boosting ? 1.8 : 0.7;
      rings.forEach((ring, i) => {
        const t = (elapsed * speed + i / rings.length) % 1;
        ring.scale.setScalar(1 + t * 2.4); ring.material.opacity = (1 - t) ** 1.4 * 0.95 * strength;
      });
    },
  };
}
