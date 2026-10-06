// Fullscreen shows only the game area (canvas, HUD, toasts). Falls back to the whole page.
export function fullscreenAvailable() {
  return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
}
export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
export async function toggleFullscreen(element) {
  if (isFullscreen()) return (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document);
  const target = element?.requestFullscreen || element?.webkitRequestFullscreen ? element : document.documentElement;
  const request = target.requestFullscreen ?? target.webkitRequestFullscreen;
  if (!request) throw new Error('Fullscreen unavailable');
  return request.call(target, { navigationUI: 'hide' });
}
