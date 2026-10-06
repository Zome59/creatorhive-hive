const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class OrbitView {
  // Starts closer than the full island so bees stay readable; the view follows the player.
  constructor() { this.azimuth = Math.atan2(28, 35); this.elevation = Math.atan2(32, Math.hypot(28, 35)); this.radius = 42; }
  rotate(dx, dy) {
    this.azimuth = (this.azimuth - dx * 0.006) % (Math.PI * 2);
    this.elevation = clamp(this.elevation + dy * 0.005, 0.28, 1.25);
  }
  zoom(pixels) { this.radius = clamp(this.radius * Math.exp(clamp(pixels, -800, 800) * 0.001), 20, 80); }
  movement(forward, right) {
    return { x: right * Math.cos(this.azimuth) - forward * Math.sin(this.azimuth),
      z: -right * Math.sin(this.azimuth) - forward * Math.cos(this.azimuth) };
  }
  apply(camera, target) {
    const horizontal = this.radius * Math.cos(this.elevation);
    camera.position.set(target.x + Math.sin(this.azimuth) * horizontal, target.y + Math.sin(this.elevation) * this.radius, target.z + Math.cos(this.azimuth) * horizontal);
    camera.lookAt(target);
  }
}

export function bindOrbitControls(canvas, orbit, enabled) {
  let drag = null;
  function cancel() {
    const pointerId = drag?.id; drag = null;
    if (pointerId !== undefined && canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
  }
  canvas.addEventListener('pointerdown', event => {
    if (!enabled() || event.button !== 0) return;
    event.preventDefault(); drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId || !enabled()) return;
    orbit.rotate(event.clientX - drag.x, event.clientY - drag.y); drag.x = event.clientX; drag.y = event.clientY;
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, event => { if (drag?.id === event.pointerId) cancel(); });
  canvas.addEventListener('wheel', event => {
    if (!enabled()) return;
    event.preventDefault(); const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (canvas.clientHeight || 600) : 1;
    orbit.zoom(event.deltaY * scale);
  }, { passive: false });
  return { cancel };
}
