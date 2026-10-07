import * as THREE from 'three';

// Served from public/media/ under the site's base path (also when hosted in a subfolder, e.g. GitHub Pages).
const MEDIA = `${import.meta.env?.BASE_URL ?? '/'}media/`;
export const MONITOR_CLIPS = ['pollen-flight', 'waggle-dance', 'honey-loop', 'flower-clock', 'nectar-run', 'hive-scan'];

export function createMonitorMedia(screens, { random = Math.random } = {}) {
  const poster = document.createElement('canvas'); poster.width = 64; poster.height = 36;
  const ctx = poster.getContext('2d');
  ctx.fillStyle = '#303d4b'; ctx.fillRect(0, 0, 64, 36);
  ctx.fillStyle = '#dbe7eb'; ctx.fillRect(23, 8, 9, 7); ctx.fillRect(34, 8, 9, 7);
  ctx.fillStyle = '#e4bd58'; ctx.fillRect(19, 16, 27, 13);
  ctx.fillStyle = '#333631'; ctx.fillRect(24, 16, 4, 13); ctx.fillRect(34, 16, 4, 13); ctx.fillRect(44, 17, 7, 11);
  const posterTexture = new THREE.CanvasTexture(poster); posterTexture.colorSpace = THREE.SRGBColorSpace;
  screens.forEach(screen => { screen.material = new THREE.MeshBasicMaterial({ map: posterTexture, toneMapped: false }); });
  let active = false, paused = true;
  const pools = [];
  function makePool(index) {
    const video = document.createElement('video'); video.muted = true; video.defaultMuted = true; video.volume = 0;
    video.setAttribute('muted', ''); video.playsInline = true; video.setAttribute('playsinline', ''); video.preload = 'none';
    const texture = new THREE.VideoTexture(video); texture.colorSpace = THREE.SRGBColorSpace;
    const pool = { video, texture, clip: index, screens: [], needsSeek: true, phase: pools.length };
    const showPoster = () => pool.screens.forEach(s => { s.material.map = posterTexture; s.material.needsUpdate = true; });
    video.addEventListener('playing', () => pool.screens.forEach(s => { s.material.map = texture; s.material.needsUpdate = true; }));
    video.addEventListener('error', showPoster);
    video.addEventListener('loadedmetadata', () => {
      if (!pool.needsSeek || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const phase = (random() + pool.phase / Math.max(1, screens.length)) % 1;
      video.currentTime = phase * Math.max(0, video.duration - 0.1); pool.needsSeek = false;
    });
    video.addEventListener('ended', () => {
      pool.clip = (pool.clip + 1 + Math.floor(random() * (MONITOR_CLIPS.length - 1))) % MONITOR_CLIPS.length; pool.needsSeek = true;
      showPoster(); video.src = `${MEDIA}${MONITOR_CLIPS[pool.clip]}.mp4`;
      if (active && !paused) video.play()?.catch(showPoster);
    });
    video.src = `${MEDIA}${MONITOR_CLIPS[index]}.mp4`;
    return pool;
  }
  function shuffledClips() {
    const order = MONITOR_CLIPS.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return order;
  }
  function initialize() {
    if (pools.length) return;
    const order = shuffledClips();
    for (let i = 0; i < Math.min(6, screens.length); i++) pools.push(makePool(order[i]));
    screens.forEach((screen, i) => pools[i % pools.length].screens.push(screen));
  }
  return {
    start() { active = true; paused = false; initialize(); for (const pool of pools) pool.video.play()?.catch(() => {}); },
    pause() { paused = true; for (const pool of pools) pool.video.pause(); },
    stop() { active = false; paused = true; for (const pool of pools) pool.video.pause(); },
    shuffle() {
      const order = shuffledClips();
      for (const [i, pool] of pools.entries()) {
        pool.clip = order[i]; pool.needsSeek = true;
        pool.video.src = `${MEDIA}${MONITOR_CLIPS[pool.clip]}.mp4`;
        pool.screens.forEach(s => { s.material.map = posterTexture; s.material.needsUpdate = true; });
      }
    },
  };
}
