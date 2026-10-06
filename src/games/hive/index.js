import { createHive } from './scene.js';

export const game = {
  id: 'hive', title: 'Honey Retrieval', uiClass: 'garden-ui', order: 10, label: 'Honey Retrieval garden game',
  controls: `<span class="controls-label">CONTROLS</span><span>Full list in the game's side panel. <kbd>H</kbd> or 🎮 shows / hides it.</span><span><kbd>WASD</kbd> move</span><span><kbd>SPACE</kbd> up</span><span><kbd>C</kbd> down</span>`, create: createHive,
};

