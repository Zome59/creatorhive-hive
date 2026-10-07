import * as THREE from 'three';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const MAX = 8, READ = 1.2; // one bubble per speaker; a newer one waits until the current one was up READ s

// Comic speech bubbles and sound words drawn as HTML over the canvas, following bees on screen.
// Text is set with textContent only.
export function createBubbles(layer, { random = Math.random } = {}) {
  const items = [], point = new THREE.Vector3();
  function add(item, text, className) {
    const anchor = document.createElement('div'), bubble = document.createElement('div');
    anchor.className = 'bubble-anchor'; bubble.className = className; bubble.textContent = text;
    bubble.style.setProperty('--tilt', `${((random() - 0.5) * 7).toFixed(1)}deg`);
    anchor.appendChild(bubble); anchor.hidden = true;
    Object.assign(item, { anchor, age: 0 });
    while (items.length >= MAX) remove(items.findIndex(i => i.kind === 'say') >= 0 ? items.findIndex(i => i.kind === 'say') : 0);
    items.push(item);
  }
  function remove(index) { const [item] = items.splice(index, 1); item?.anchor.remove(); }
  return {
    say(id, text, { style = 'talk', delay = 0 } = {}) {
      // At most one bubble per speaker on screen and one waiting: the newest waiting line wins.
      for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'say' && items[i].id === id && items[i].delay > 0) remove(i);
      add({ kind: 'say', id, delay: Math.max(delay, 1e-6), life: clamp(1.8 + text.length * 0.065, 2.6, 5) }, text, `bubble ${style}`);
    },
    pow(position, text, style = 'bump') {
      add({ kind: 'pow', world: new THREE.Vector3(position.x, position.y, position.z), delay: 0, life: 0.95 }, text, `pow ${style}`);
    },
    // `locate(id)` returns the speaker's head position or null when it is gone.
    update(dt, camera, width, height, locate) {
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.delay > 0) {
          item.delay -= dt; if (item.delay > 0) continue;
          if (item.kind === 'say') { // taking over from the speaker's current bubble, once that one could be read
            const shown = items.find(o => o !== item && o.kind === 'say' && o.id === item.id && o.delay <= 0);
            if (shown && shown.age < READ) { item.delay = READ - shown.age; continue; }
            if (shown) remove(items.indexOf(shown)), i = items.indexOf(item);
          }
        }
        if (!item.anchor.isConnected) layer.appendChild(item.anchor);
        item.age += dt;
        const position = item.world ?? locate(item.id);
        if (item.age > item.life || !position) { remove(i); continue; }
        point.copy(position).project(camera);
        const visible = point.z < 1 && Math.abs(point.x) < 1.2 && Math.abs(point.y) < 1.2;
        item.anchor.hidden = !visible;
        if (!visible) continue;
        const distance = camera.position.distanceTo(position), scale = clamp(18 / distance, 0.62, 1.15);
        const x = (point.x + 1) / 2 * width, y = (1 - point.y) / 2 * height - (item.kind === 'pow' ? item.age * 26 : 0);
        item.anchor.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
        item.anchor.style.opacity = String(clamp((item.life - item.age) / 0.3, 0, 1));
        item.anchor.style.zIndex = String(Math.round(1000 - distance));
      }
    },
    clear() { while (items.length) remove(0); },
    get count() { return items.length; },
  };
}
