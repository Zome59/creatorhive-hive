import * as THREE from 'three';

// The bee token: a simple, abstract little bee in a golden glow, turning and bobbing above a flower.
// It blinks during its last seconds before it fades.
export function createBeeToken() {
  const group = new THREE.Group(), bee = new THREE.Group(); group.add(bee); group.visible = false;
  const yellow = new THREE.MeshStandardMaterial({ color: '#ffcf33', roughness: 0.35, emissive: '#6b4a00', emissiveIntensity: 0.45 });
  const black = new THREE.MeshStandardMaterial({ color: '#2b2620', roughness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.2, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), yellow); body.scale.set(0.85, 0.85, 1.15); bee.add(body);
  for (const z of [-0.1, 0.1]) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.05, 10, 28), black); band.position.z = z; band.scale.set(1, 1, 1); bee.add(band); }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 12), black); head.position.z = 0.36; bee.add(head);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' })); eye.position.set(side * 0.07, 0.05, 0.5); bee.add(eye);
    const wing = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), white); wing.scale.set(0.65, 1, 1); wing.position.set(side * 0.16, 0.28, 0.02); wing.rotation.set(-Math.PI / 2 + 0.3, 0, side * 0.5); wing.userData.side = side; bee.add(wing);
  }
  const sting = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 8), black); sting.rotation.x = -Math.PI / 2; sting.position.z = -0.4; bee.add(sting);
  // Glow and a slowly turning ring of light.
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let glowMap = null;
  if (canvas?.getContext) {
    canvas.width = canvas.height = 64; const ctx = canvas.getContext('2d');
    if (ctx?.createRadialGradient) { const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,230,120,1)'); g.addColorStop(1, 'rgba(255,200,40,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64); glowMap = new THREE.CanvasTexture(canvas); }
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: '#ffd84a', transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(2); group.add(glow);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.025, 6, 48), new THREE.MeshBasicMaterial({ color: '#ffe680', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); ring.rotation.x = Math.PI / 2; group.add(ring);
  let shown = 0;
  return {
    group,
    // `item` is the simulation's token (or null); `life` drives the last-seconds blink.
    update(dt, elapsed, item) {
      shown += ((item ? 1 : 0) - shown) * Math.min(1, dt * 6);
      group.visible = shown > 0.02;
      if (!group.visible) return;
      if (item) group.position.set(item.x, item.y + Math.sin(elapsed * 2.4) * 0.12, item.z);
      const blink = item && item.life < 4 ? (Math.sin(elapsed * 14) > 0 ? 1 : 0.35) : 1;
      group.scale.setScalar((0.6 + 0.4 * shown) * (1 + Math.sin(elapsed * 3) * 0.04));
      bee.rotation.y = elapsed * 1.4;
      for (const child of bee.children) if (child.userData.side) child.rotation.z = child.userData.side * (0.5 + Math.sin(elapsed * 40) * 0.35);
      ring.rotation.z = elapsed * 0.8; ring.material.opacity = 0.8 * shown * blink; glow.material.opacity = 0.7 * shown * blink;
    },
  };
}
