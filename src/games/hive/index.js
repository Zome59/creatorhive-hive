import { createHive } from './scene.js';

export const game = {
  id: 'hive', title: 'Honey Retrieval', uiClass: 'garden-ui', order: 10, label: 'Honey Retrieval garden game',
  controls: `<span class="controls-label">CONTROLS</span><span><kbd>WASD</kbd> move</span><span><kbd>SPACE</kbd>/<kbd>C</kbd> up / down</span><span><kbd>SHIFT</kbd> boost</span><span><kbd>V</kbd> bee view</span><span><kbd>LMB</kbd> drag to rotate / look</span><span><kbd>SCROLL</kbd> zoom</span><span><kbd>F</kbd> fullscreen</span><span><kbd>P</kbd> pause</span>`, create: createHive,
};

