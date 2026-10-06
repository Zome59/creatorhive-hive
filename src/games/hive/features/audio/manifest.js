// Sound files live in public/games/hive/audio/ (see the README there for source and rights).
// `gain` is the mix level; `loop` sounds play continuously, positioned at a bee.
// `variants: n` means files `<name>-1.mp3` … `<name>-n.mp3`; one is picked at random per play.
// `bus` is the sound mixer channel the sound plays through. `lazy` files load only when first needed.
export const HIVE_SOUNDS = Object.freeze([
  { name: 'buzz', loop: true, gain: 0.3, bus: 'bees' },
  { name: 'bumble', loop: true, gain: 0.9, bus: 'bumblebee' },
  { name: 'garden', loop: true, gain: 0.07, bus: 'ambience' },
  { name: 'pass', gain: 0.9, bus: 'bees' },
  { name: 'bump', gain: 1, bus: 'effects' },
  { name: 'thud', gain: 0.7, bus: 'effects' },
  { name: 'collect', gain: 0.6, bus: 'effects' },
  { name: 'deliver', gain: 0.8, bus: 'effects' },
  { name: 'boost', gain: 0.7, bus: 'own' },
  { name: 'crash', gain: 1, bus: 'bumblebee' },
  { name: 'grumble', gain: 0.75, variants: 3, bus: 'voices' },
  { name: 'alarm', gain: 0.22, bus: 'effects' },
  { name: 'dizzy', gain: 0.4, bus: 'effects' },
  { name: 'slurp', gain: 0.55, bus: 'bumblebee' },
  { name: 'music-synthwave', loop: true, gain: 0.075, bus: 'music', lazy: true },
  { name: 'music-chill', loop: true, gain: 0.095, bus: 'music', lazy: true },
]);
export const soundFiles = sound => sound.variants ? Array.from({ length: sound.variants }, (_, i) => `${sound.name}-${i + 1}`) : [sound.name];
// Sound mixer channels, in the order the controls panel shows them. Levels go from 0 to 150 %.
export const MIXER = Object.freeze([
  { id: 'master', label: 'Master volume', preview: 'collect' },
  { id: 'bees', label: 'Other bees', preview: 'pass' },
  { id: 'own', label: 'Your bee', preview: 'boost' },
  { id: 'bumblebee', label: 'Bumblebee', preview: 'crash' },
  { id: 'voices', label: 'Voices', preview: 'grumble' },
  { id: 'effects', label: 'Effects', preview: 'bump' },
  { id: 'ambience', label: 'Garden ambience' },
  { id: 'music', label: 'Music' },
].map(Object.freeze));
// Background music choices; the default plays quietly once the game starts.
export const MUSIC_TRACKS = Object.freeze([{ id: 'music-synthwave', label: 'Synthwave' }, { id: 'music-chill', label: 'Chill-out' }, { id: 'off', label: 'Off' }].map(Object.freeze));
export const MIX_MAX = 1.5;
