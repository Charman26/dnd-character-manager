// Builds icons.svg: one <symbol> per literal ic('name') in app.js, from game-icons.net (CC BY 3.0).
// Shapes come from the Iconify mirror (single-colour, fill="currentColor"); each icon's author from the game-icons repo, for the credits.
// Run after adding or changing an icon: node tools/mkicons.mjs   (needs network)
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const names = [...new Set([...(await readFile(new URL('app.js', root), 'utf8')).matchAll(/\bic\('([a-z0-9-]+)'\)/g)].map(m => m[1]))].sort();
const get = async u => { const r = await fetch(u); if (!r.ok) throw Error(`${r.status} ${u}`); return r.json(); };

const set = await get(`https://api.iconify.design/game-icons.json?icons=${names.join(',')}`);
const missing = names.filter(n => !set.icons?.[n]);
if (missing.length) throw Error(`not in game-icons: ${missing.join(', ')}`);

const tree = await get('https://api.github.com/repos/game-icons/icons/git/trees/master?recursive=1');
const author = {};
for (const { path } of tree.tree) {
  const m = path.match(/^([^/]+)\/([^/]+)\.svg$/);
  if (m && m[1] !== 'badges') author[m[2]] ??= m[1]; // "badges" holds variants of icons that also exist under their author
}
const who = n => author[n] || 'unknown';

const size = n => `0 0 ${set.icons[n].width || set.width || 512} ${set.icons[n].height || set.height || 512}`;
await writeFile(new URL('icons.svg', root), `<svg xmlns="http://www.w3.org/2000/svg">
<!-- Icons from https://game-icons.net by the authors below, licensed CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/).
     Built by tools/mkicons.mjs; do not edit by hand.
${names.map(n => `     ${n}: ${who(n)}`).join('\n')}
-->
${names.map(n => `<symbol id="${n}" viewBox="${size(n)}">${set.icons[n].body}</symbol>`).join('\n')}
</svg>
`);
console.log(`icons.svg: ${names.length} icons by ${[...new Set(names.map(who))].sort().join(', ')}`);
