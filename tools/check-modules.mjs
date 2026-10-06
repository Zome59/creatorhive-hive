import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const gamesRoot = resolve(root, 'src/games');
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(dir, entry.name)) : [resolve(dir, entry.name)]);
}
function checkCss(text, prefix, file) {
  text = text.replace(/\/\*[\s\S]*?\*\//g, '');
  let position = 0;
  while (position < text.length) {
    const start = text.indexOf('{', position); if (start < 0) break;
    const selector = text.slice(position, start).trim(); let end = start + 1, depth = 1;
    while (depth && end < text.length) { if (text[end] === '{') depth++; if (text[end] === '}') depth--; end++; }
    const body = text.slice(start + 1, end - 1);
    // Keyframe names are global, so they must carry the game's prefix (e.g. `garden-` for `.garden-ui`).
    if (selector.startsWith('@keyframes')) { if (!selector.slice(10).trim().startsWith(`${prefix.replace(/-ui$/, '')}-`)) throw new Error(`${file}: keyframes must be prefixed: ${selector}`); }
    else if (selector.startsWith('@media') || selector.startsWith('@supports')) checkCss(body, prefix, file);
    else if (!selector.split(',').every(part => new RegExp(`^\\.${prefix}(?:[\\s:.#\\[]|$)`).test(part.trim()))) throw new Error(`${file}: game CSS must be scoped to .${prefix}: ${selector}`);
    position = end;
  }
}
const ids = new Set();
for (const folder of readdirSync(gamesRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
  const moduleRoot = resolve(gamesRoot, folder.name);
  const { game } = await import(pathToFileURL(resolve(moduleRoot, 'index.js')));
  if (game?.id !== folder.name || ids.has(game.id) || typeof game.create !== 'function' || !game.title || !game.label || typeof game.controls !== 'string' || !Number.isFinite(game.order) || !game.uiClass) throw new Error(`${folder.name}: invalid game descriptor`);
  ids.add(game.id);
  for (const file of files(moduleRoot)) {
    const source = readFileSync(file, 'utf8');
    if (file.endsWith('.css')) checkCss(source, game.uiClass, relative(root, file));
    if (!file.endsWith('.js')) continue;
    for (const match of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)(['"])([^'"]+)\1/g)) {
      if (!match[2].startsWith('.')) continue;
      const target = resolve(dirname(file), match[2]);
      if (!target.startsWith(moduleRoot + '/') && !target.startsWith(resolve(root, 'src/shared') + '/')) throw new Error(`${relative(root, file)}: imports outside its game module: ${match[2]}`);
    }
  }
  console.log(`${game.id}: isolated module, scoped CSS`);
}
for (const file of files(resolve(root, 'src')).filter(file => !file.startsWith(gamesRoot + '/') && file.endsWith('.js'))) {
  const source = readFileSync(file, 'utf8');
  if (/\bfrom\s*['"][^'"]*games\//.test(source) || /\bimport\s*(?:\(\s*)?['"][^'"]*games\//.test(source)) throw new Error(`${relative(root, file)}: discover game entries through import.meta.glob; no game-specific shell imports`);
}
console.log(`${ids.size} game modules checked.`);
