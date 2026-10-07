import * as THREE from 'three';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// First-person "bee view": the camera sits on the player's head. W flies where you look,
// so looking down and pressing W dives; Space/C still climb and sink directly.
// Fine steering: radians per mouse pixel, and the arrow-key turn rate (rad/s), which eases in and out.
export const LOOK = Object.freeze({ yaw: 0.0015, pitch: 0.0013, turn: 1.3, ease: 4 });
export class BeeView {
  constructor() { this.yaw = 0; this.pitch = -0.1; this.roll = 0; this.shake = 0; this.fov = 72; this.turning = 0; }
  look(dx, dy) { this.yaw = wrap(this.yaw - dx * LOOK.yaw); this.pitch = clamp(this.pitch - dy * LOOK.pitch, -1.25, 1.1); }
  // Called every frame (direction 0 lets the turn ease out), so a short tap turns only a little.
  turn(direction, dt) { this.turning += (direction - this.turning) * Math.min(1, dt * LOOK.ease); this.yaw = wrap(this.yaw - this.turning * LOOK.turn * dt); }
  movement(forward, right, vertical = 0) {
    const cp = Math.cos(this.pitch), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    return { x: forward * sy * cp - right * cy, y: clamp(forward * Math.sin(this.pitch) + vertical, -1, 1), z: forward * cy * cp + right * sy };
  }
  face(p) { this.yaw = p.yaw; this.pitch = -0.1; }
  bump(strength) { this.shake = Math.min(1, this.shake + strength); }
  apply(camera, bee, dt, elapsed, { strafe = 0, boosting = false, stunned = false } = {}) {
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.roll += ((-strafe * 0.14 + (stunned ? Math.sin(elapsed * 9) * 0.3 : 0)) - this.roll) * Math.min(1, dt * 6);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), jitter = this.shake * this.shake * 0.12;
    camera.position.set(bee.x + sy * 0.32 + (Math.random() - 0.5) * jitter, bee.y + 0.2 + Math.sin(elapsed * 9) * 0.025 + (Math.random() - 0.5) * jitter, bee.z + cy * 0.32);
    camera.rotation.set(this.pitch, this.yaw + Math.PI, this.roll, 'YXZ');
    // Boost widens the view for a sense of speed.
    const fov = this.fov + (boosting ? 12 : 0);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 5); camera.updateProjectionMatrix(); }
  }
}

// Blurred wing tips flicker at the edge of the view, attached to the camera.
export function createBeeViewModel() {
  const group = new THREE.Group();
  const wingMaterial = new THREE.MeshStandardMaterial({ color: '#f6f4e8', transparent: true, opacity: 0.16, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false });
  const wings = [-1, 1].map(side => {
    const wing = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), wingMaterial);
    wing.scale.set(1, 0.45, 1); wing.position.set(side * 0.3, -0.04, -0.28); wing.rotation.set(-0.5, side * 0.9, side * 0.35); group.add(wing); return wing;
  });
  return {
    group,
    update(elapsed, { boosting = false } = {}) {
      wings.forEach((wing, i) => { wing.rotation.z = (i ? 1 : -1) * (0.35 + Math.sin(elapsed * (boosting ? 90 : 70)) * 0.25); });
    },
  };
}

// Mouse look: pointer lock when available (click the game), otherwise drag to look.
export function bindBeeLook(canvas, view, enabled) {
  let drag = null;
  const locked = () => canvas.ownerDocument?.pointerLockElement === canvas;
  canvas.addEventListener('pointerdown', event => {
    if (!enabled() || event.button !== 0) return;
    event.preventDefault();
    if (event.pointerType === 'mouse' && canvas.requestPointerLock && !locked()) {
      try { Promise.resolve(canvas.requestPointerLock()).catch(() => {}); } catch {}
    }
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try { canvas.setPointerCapture?.(event.pointerId); } catch {} // Not allowed while the pointer is being locked.
  });
  canvas.addEventListener('pointermove', event => {
    if (!enabled()) return;
    if (locked()) { view.look(event.movementX ?? 0, event.movementY ?? 0); return; }
    if (!drag || drag.id !== event.pointerId) return;
    view.look((event.clientX - drag.x) * 1.4, (event.clientY - drag.y) * 1.4); drag.x = event.clientX; drag.y = event.clientY;
  });
  const end = event => { if (drag?.id === event.pointerId) { if (canvas.hasPointerCapture?.(drag.id)) canvas.releasePointerCapture(drag.id); drag = null; } };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, end);
  return {
    cancel() { drag = null; },
    release() { drag = null; if (locked()) canvas.ownerDocument.exitPointerLock?.(); },
    get locked() { return locked(); },
  };
}
