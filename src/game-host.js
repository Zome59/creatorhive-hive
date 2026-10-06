// The shell owns navigation; modules own their scenes, state, input, and UI.
export function createGameHost({ games, renderer, container, controls, navigation, arena, notify, openDialog, closeDialog, clearNotification = () => {}, toggleFullscreen = async () => {} }) {
  const entries = new Map(), instances = new Map(), buttons = new Map();
  let activeId = null, width = 1, height = 1;
  for (const entry of games) {
    if (!entry.id || entries.has(entry.id) || typeof entry.create !== 'function') throw new Error('Invalid or duplicate game module');
    entries.set(entry.id, entry);
    const button = document.createElement('button'); button.textContent = entry.title;
    button.dataset.game = entry.id; button.setAttribute('aria-pressed', 'false');
    button.onclick = () => select(entry.id); navigation.appendChild(button); buttons.set(entry.id, button);
  }
  function select(id) {
    if (id === activeId) return;
    const entry = entries.get(id); if (!entry) throw new Error(`Unknown game: ${id}`);
    // Construct before switching so a failed new module leaves the current game usable.
    if (!instances.has(id)) {
      const instance = entry.create({ renderer, container, notify, openDialog, closeDialog, toggleFullscreen });
      for (const method of ['activate', 'deactivate', 'update', 'resize', 'pause']) {
        if (typeof instance?.[method] !== 'function') throw new Error(`${id}: missing ${method} lifecycle method`);
      }
      instances.set(id, instance);
    }
    closeDialog(); clearNotification(); instances.get(activeId)?.deactivate(); activeId = id;
    const instance = instances.get(id); instance.activate(); instance.resize(width, height);
    controls.innerHTML = entry.controls; arena.setAttribute('aria-label', entry.label);
    renderer.domElement.setAttribute('aria-label', entry.label);
    for (const [gameId, button] of buttons) button.setAttribute('aria-pressed', String(gameId === id));
  }
  return {
    select,
    pause() { instances.get(activeId)?.pause(); },
    update(dt, elapsed) { instances.get(activeId)?.update(dt, elapsed); },
    resize(w, h) { width = w; height = h; instances.get(activeId)?.resize(w, h); },
    get activeId() { return activeId; },
  };
}
