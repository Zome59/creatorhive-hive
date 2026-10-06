// True when the element is shown in fullscreen (the element itself or one of its ancestors).
export function isFullscreenOf(element) {
  const full = document.fullscreenElement ?? document.webkitFullscreenElement;
  return !!full && (full === element || full.contains?.(element));
}
