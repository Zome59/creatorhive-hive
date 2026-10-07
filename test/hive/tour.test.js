import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { TOUR_STEPS, createTour } from '../../src/games/hive/features/tour.js';
import { readingTime, READING } from '../../src/games/hive/features/reading.js';
import { game as hiveModule } from '../../src/games/hive/index.js';

test('the landing tour explains the game shot by shot, fades between shots, and ends on "Let\'s go!"', () => {
  assert.deepEqual(TOUR_STEPS.map(s => s.shot), ['orbit', 'chase', 'bee', 'hive', 'bumble', 'finale']);
  assert.match(TOUR_STEPS.find(s => s.shot === 'bee').text, /SPACE climbs, C sinks/);
  const tour = createTour();
  assert.equal(tour.update(0).cover, 1, 'starts from dark');
  assert.equal(tour.update(2).cover, 0, 'clear in the middle of a shot');
  const near = tour.update(TOUR_STEPS[0].time - 2 - 0.1);
  assert.ok(near.cover > 0.5 && !near.changed, 'darkens before the cut');
  const cut = tour.update(0.2); assert.ok(cut.changed); assert.equal(tour.index, 1);
  for (let i = 0; i < 200; i++) tour.update(0.1);
  assert.ok(tour.index >= 0 && tour.index < TOUR_STEPS.length, 'loops');
  assert.equal(TOUR_STEPS.at(-1).title, 'Let’s go!');
});
test('the landing screen shows captions and action, pulses the play button at the end; starting stops the tour', () => {
  const browserWindow = new Window(), previous = Object.fromEntries(['window', 'document', 'matchMedia'].map(key => [key, globalThis[key]]));
  try {
    globalThis.window = browserWindow; globalThis.document = browserWindow.document; globalThis.matchMedia = () => ({ matches: false });
    browserWindow.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {}, beginPath() {}, roundRect() {}, fill() {} });
    const container = document.createElement('div'); document.body.appendChild(container);
    const dialogs = [];
    const hive = hiveModule.create({ renderer: { domElement: document.createElement('canvas'), render() {} }, container, notify() {}, openDialog(html) { dialogs.push(html); }, closeDialog() {} });
    hive.activate(); hive.resize(800, 600); hive.update(0.05, 0);
    const caption = container.querySelector('#tour-caption'), start = container.querySelector('#start');
    container.querySelector('#tour-info').click();
    assert.match(dialogs.at(-1), /FULL GUIDE[\s\S]*Nectar power[\s\S]*The bumblebee/, 'the info button opens the full guide');
    assert.match(caption.textContent, /Welcome to the honey garden/); assert.equal(start.classList.contains('pulse'), false);
    const startOf = shot => TOUR_STEPS.slice(0, TOUR_STEPS.findIndex(s => s.shot === shot)).reduce((sum, s) => sum + s.time, 0);
    let time = 0; for (; time < startOf('bumble') + 1; time += 0.1) hive.update(0.1, time);
    assert.match(caption.textContent, /Beware the bumblebee/);
    for (; time < startOf('finale') + 1; time += 0.1) hive.update(0.1, time);
    assert.match(caption.textContent, /Let’s go!/); assert.ok(start.classList.contains('pulse'), 'play button pulses');
    start.click(); hive.update(0.05, time);
    assert.equal(caption.hidden, true); assert.equal(start.classList.contains('pulse'), false);
    container.querySelector('#guide').click();
    assert.equal(container.querySelector('#pause').getAttribute('aria-label'), 'Resume game', 'opening the guide in a round pauses it');
    hive.deactivate();
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    browserWindow.happyDOM.abort();
  }
});

test('every message stays long enough to read, and tour captions follow the same rule', () => {
  assert.equal(readingTime('Paused.'), READING.min, 'short messages still stay a few seconds');
  assert.ok(Math.abs(readingTime('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen') - 6.3) < 1e-9);
  assert.equal(readingTime('word '.repeat(80)), READING.max, 'capped');
  for (const step of TOUR_STEPS.filter(s => !s.finale)) assert.ok(step.time >= readingTime(`${step.title} ${step.text}`), `${step.title}: ${step.time} s`);
});
