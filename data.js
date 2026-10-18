// Rules data: one-time download from a 5etools JSON mirror into this browser, 2014/official filtering,
// lookups, and rendering of 5etools "entries" + {@tags}. Nothing here is bundled with the app.
import { code, signed, DMG_TYPE, ABIL_NAME } from './rules.js';

// A GitHub repo link (https://github.com/owner/repo) -> its raw main/data/ folder; any other URL is used as is.
export const dataBase = u => u.trim().replace(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(\.git)?\/?$/, 'https://raw.githubusercontent.com/$1/$2/main/data/').replace(/\/?$/, '/');
// Class art is never stored in the repo: the browser loads it from the sibling "-img" repo (sw.js caches it for offline use).
// ponytail: assumes the data repo is named "<x>-src" next to "<x>-img"; other repos simply show no art
const imgBase = base => (/^(https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+)-src\//.exec(base) || [])[1]?.concat('-img/main/');
export const imgUrl = p => { const b = imgBase(D?.raw.meta?.base || ''); return b && b + p.split('/').map(encodeURIComponent).join('/'); };
const CUTOFF = '2024-09-17'; // 2024 PHB release: books from here on use the 2024 rules
const KEEP = ['class', 'subclass', 'classFeature', 'subclassFeature', 'spell', 'item', 'baseitem', 'magicvariant', 'race', 'subrace', 'background', 'feat', 'condition', 'optionalfeature', 'monster',
  'disease', 'status', 'action', 'language', 'skill', 'sense', 'variantrule', 'trap', 'hazard', 'object', 'deity', 'reward', 'cult', 'boon', 'table'];
// Creatures are kept only where the sheet uses them: Wild Shape / Polymorph (beasts, elementals), summons, familiars.
const DROP_FIELDS = ['hasToken', 'tokenCredit', 'altArt', 'environment', 'traitTags', 'senseTags', 'actionTags', 'languageTags', 'damageTags',
  'damageTagsLegendary', 'damageTagsSpell', 'spellcastingTags', 'conditionInflictSpell', 'savingThrowForced', 'savingThrowForcedLegendary', 'foundryImg', 'treasure', 'otherSources', 'referenceSources', 'lootTables', 'hasFluff', 'hasFluffImages', 'fluff', 'reprintedAs', 'srd', 'srd52', 'basicRules', 'basicRules2024', 'additionalSources', 'soundClip'];
const K = (n, s) => `${n}|${s}`.toLowerCase();

export async function downloadRules(src, progress = () => {}) {
  const base = dataBase(src);
  const get = async p => {
    const r = await fetch(base + p);
    if (!r.ok) throw Error(`${p}: HTTP ${r.status}`);
    return r.json();
  };
  const [books, advs, classIdx, spellIdx, spellSrc, beastIdx, fluffIdx] = await Promise.all(
    ['books.json', 'adventures.json', 'class/index.json', 'spells/index.json', 'spells/sources.json', 'bestiary/index.json', 'class/fluff-index.json'].map(get));
  const allowed = new Set();
  for (const x of [...books.book, ...advs.adventure]) {
    if ((x.published || '9') < CUTOFF && !/^(UA|PS)/.test(x.id)) { allowed.add(x.id); if (x.source) allowed.add(x.source); }
  }
  const files = [
    ...Object.entries(classIdx).filter(([k]) => k !== 'sidekick').map(([, f]) => 'class/' + f),
    ...Object.entries(fluffIdx).filter(([k]) => k !== 'sidekick').map(([, f]) => 'class/' + f), // only for the class/subclass art paths
    ...Object.entries(spellIdx).filter(([k]) => allowed.has(k)).map(([, f]) => 'spells/' + f),
    'items.json', 'items-base.json', 'magicvariants.json', 'races.json', 'backgrounds.json', 'feats.json', 'conditionsdiseases.json', 'optionalfeatures.json',
    // everything else the lookup can show (vehicles and card decks left out: own stat block layout / mostly images)
    'actions.json', 'languages.json', 'skills.json', 'senses.json', 'variantrules.json', 'trapshazards.json', 'objects.json', 'deities.json', 'rewards.json', 'cultsboons.json', 'tables.json',
    ...Object.entries(beastIdx).filter(([k]) => allowed.has(k)).map(([, f]) => 'bestiary/' + f), // every creature of the 2014 books and adventures (~9 MB)
  ];
  const raw = Object.fromEntries(KEEP.map(k => [k, []])), fluff = [];
  let done = 0;
  await Promise.all(files.map(async f => {
    const j = await get(f);
    for (const k of KEEP) if (Array.isArray(j[k])) raw[k].push(...j[k]);
    for (const k of ['classFluff', 'subclassFluff']) if (Array.isArray(j[k])) fluff.push(...j[k].map(x => ({ ...x, kind: k === 'classFluff' ? 'class' : 'subclass' })));
    progress(++done, files.length, f);
  }));
  for (const v of raw.magicvariant) v.source = v.inherits?.source;

  const ok = x => allowed.has(x.source) && x.edition !== 'one';
  const keep = {
    subclass: x => allowed.has(x.classSource),
    classFeature: x => allowed.has(x.classSource),
    subclassFeature: x => allowed.has(x.classSource) && allowed.has(x.subclassSource),
    subrace: x => allowed.has(x.raceSource),
  };
  const out = {};
  for (const k of KEEP) {
    // ponytail: _copy is a one-level shallow merge, _mod patches are ignored (affects a handful of reprint variants)
    const by = new Map(raw[k].filter(x => !x._copy).map(x => [K(x.name, x.source), x]));
    const res = x => (x._copy ? { ...by.get(K(x._copy.name, x._copy.source)), ...x, _copy: undefined } : x);
    if (k === 'subrace') for (const x of raw[k]) x.name ??= ''; // nameless = the race's standard option (PHB human: +1 to all)
    out[k] = raw[k].map(res).filter(x => x.name != null && ok(x) && (!keep[k] || keep[k](x)));
    for (const x of out[k]) for (const f of DROP_FIELDS) delete x[f];
  }
  out.spellClasses = {};
  for (const [src, spells] of Object.entries(spellSrc)) {
    if (!allowed.has(src)) continue;
    for (const [n, v] of Object.entries(spells)) {
      out.spellClasses[K(n, src)] = [...new Set([...(v.class || []), ...(v.classVariant || [])].filter(c => allowed.has(c.source)).map(c => c.name))];
    }
  }
  out.art = {}; // "class|druid|phb" → image path; 2014 sources only, like the rules
  for (const x of fluff) {
    const p = x.images?.[0]?.href?.path;
    if (p && ok(x) && (x.kind === 'class' || allowed.has(x.classSource))) out.art[`${x.kind}|${K(x.name, x.source)}`] = p;
  }
  out.meta = { date: new Date().toISOString(), src, base, counts: Object.fromEntries(KEEP.map(k => [k, out[k].length])) };
  return out;
}

// ---------- index ----------
export let D = null;
// Art for a class row: the subclass picture if the book has one, else the class picture.
export function classArt(cls, sub) {
  const p = (sub && D?.raw.art?.[`subclass|${K(sub.name, sub.source)}`]) || (cls && D?.raw.art?.[`class|${K(cls.name, cls.source)}`]);
  return (p && imgUrl(p)) || null;
}
export function setRules(raw) {
  D = { raw, by: {}, byName: {}, all: null };
  for (const k of KEEP) {
    const by = D.by[k] = new Map(), bn = D.byName[k] = new Map();
    for (const x of raw[k] || []) {
      by.set(K(x.name, x.source), x);
      const n = x.name.toLowerCase();
      if (!bn.has(n)) bn.set(n, x);
    }
  }
}
export const list = cat => D?.raw[cat] || [];
export const find = (cat, name, source) => (!D || !name ? null : D.by[cat]?.get(K(name, source)) || D.byName[cat]?.get(String(name).toLowerCase()) || null);
export const refOf = x => x && { name: x.name, source: x.source };

const TAG_CATS = {
  creature: ['monster'], spell: ['spell'], item: ['item', 'baseitem', 'magicvariant'], condition: ['condition', 'status'], status: ['status', 'condition'], feat: ['feat'],
  race: ['race'], background: ['background'], class: ['class'], subclass: ['subclass'], optfeature: ['optionalfeature'],
  classFeature: ['classFeature'], subclassFeature: ['subclassFeature'], disease: ['disease'], action: ['action'], language: ['language'], skill: ['skill'],
  sense: ['sense'], variantrule: ['variantrule'], trap: ['trap'], hazard: ['hazard'], object: ['object'], reward: ['reward'], boon: ['boon'], cult: ['cult'], table: ['table'],
};
export function lookup(tagOrCat, name, src) {
  for (const cat of TAG_CATS[tagOrCat] || [tagOrCat]) {
    const x = find(cat, name, src);
    if (x) return { cat, x };
  }
  return null;
}

export const CAT_LABEL = {
  spell: 'Spell', item: 'Item', baseitem: 'Item', magicvariant: 'Magic variant', feat: 'Feat', race: 'Race', subrace: 'Subrace',
  background: 'Background', class: 'Class', subclass: 'Subclass', condition: 'Condition', optionalfeature: 'Option',
  classFeature: 'Class feature', subclassFeature: 'Subclass feature', monster: 'Creature', disease: 'Disease', status: 'Status', action: 'Action',
  language: 'Language', skill: 'Skill', sense: 'Sense', variantrule: 'Rule', trap: 'Trap', hazard: 'Hazard', object: 'Object', deity: 'Deity',
  reward: 'Supernatural gift', cult: 'Cult', boon: 'Boon', table: 'Table',
};
// the lookup's filter chips
export const SEARCH_GROUPS = [
  ['Spells', ['spell']], ['Items', ['item', 'baseitem', 'magicvariant']], ['Creatures', ['monster']],
  ['Classes', ['class', 'subclass', 'classFeature', 'subclassFeature', 'optionalfeature']], ['Races', ['race', 'subrace']], ['Feats', ['feat']],
  ['Backgrounds', ['background']], ['Conditions', ['condition', 'status', 'disease']], ['Rules', ['action', 'variantrule', 'skill', 'sense', 'language', 'table']],
  ['Traps & hazards', ['trap', 'hazard', 'object']], ['Deities & gifts', ['deity', 'reward', 'cult', 'boon']],
];
const ABC = new Intl.Collator();
// lowercase, apostrophes dropped, other punctuation -> one space: "Hunter's Mark" ~ "hunters mark" (cached: names repeat every keystroke)
const FOLD = new Map();
const fold = s => FOLD.get(s) ?? FOLD.set(s, s.toLowerCase().replace(/['’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()).get(s);
// how well a name matches a query: 0 exact (spaces ignored, so "fire ball" = Fireball), 1 prefix, 2 every word starts a word, 3 anywhere; -1 no match
export function matchScore(name, q) {
  const n = fold(name), w = fold(q), words = w ? w.split(' ') : [], nn = n.replace(/ /g, ''), ww = w.replace(/ /g, '');
  if (!words.length) return 0;
  if (!words.every(x => n.includes(x)) && !nn.includes(ww)) return -1;
  return nn === ww ? 0 : n.startsWith(w) ? 1 : words.every(x => ` ${n}`.includes(` ${x}`)) ? 2 : 3;
}
// Every word of the query must appear in the name, best matches first. Empty query lists everything.
export function search(q, cats = Object.keys(CAT_LABEL)) {
  const hits = [];
  for (const cat of cats) for (const x of list(cat)) {
    if (!x.name) continue; // unnamed "standard" subraces: nothing to show
    const score = matchScore(x.name, q);
    if (score >= 0) hits.push({ cat, x, score });
  }
  // equally good matches: the closest (shortest) name first while typing, alphabetical when browsing
  return hits.sort((a, b) => a.score - b.score || (q.trim() ? a.x.name.length - b.x.name.length : 0) || ABC.compare(a.x.name, b.x.name));
}

// ---------- creatures ----------
export const crNum = cr => { const [a, b] = String(cr?.cr ?? cr ?? 0).split('/'); return b ? a / b : +a || 0; };
export const creatureType = m => m.type?.type ?? m.type;
export const creatureAc = m => { const a = m.ac?.[0]; return typeof a === 'object' ? a.ac : a ?? 10; };
export const speedText = sp => Object.entries(sp || {}).filter(([k]) => k !== 'canHover').map(([k, v]) => `${k === 'walk' ? '' : k + ' '}${typeof v === 'object' ? v.number : v} ft`).join(', ');
const SIZE = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan' };
// resist/immune lists mix strings with {resist: [...], note} groups
const flat = v => v.map(x => (typeof x === 'string' ? x : x.special || `${flat(x.resist || x.immune || x.vulnerable || x.conditionImmune || [])}${x.note ? ' ' + x.note : ''}`)).join('; ');
const cap = s => s[0].toUpperCase() + s.slice(1);
const castLines = sc => {
  const out = [];
  if (sc.will) out.push(['At will', sc.will]);
  for (const [k, v] of Object.entries(sc.daily || {})) out.push([`${k.replace('e', '')}/day${k.endsWith('e') ? ' each' : ''}`, v]);
  for (const [l, v] of Object.entries(sc.spells || {})) out.push([`${l === '0' ? 'Cantrips' : `${l}${['st', 'nd', 'rd'][l - 1] || 'th'} level`}${v.slots ? ` (${v.slots} slots)` : ''}`, v.spells]);
  return out.map(([t, v]) => `<p class=small>${t}: ${txt(v.join(', '))}</p>`).join('');
};
export function statblock(m) {
  const ab = ['str', 'dex', 'con', 'int', 'wis', 'cha'].map(a => `<div><b>${a.toUpperCase()}</b><br>${m[a]} (${signed(Math.floor((m[a] - 10) / 2))})</div>`).join('');
  const sect = (t, list) => (list?.length ? `<h4>${t}</h4>${list.map(x => `<p><b><i>${txt(x.name || '')}.</i></b> ${entries(x.entries, true)}</p>`).join('')}` : '');
  return `<div class=statblock><i>${esc([].concat(m.size || []).map(z => SIZE[z]).join('/'))} ${esc(creatureType(m))}, CR ${esc(m.cr?.cr ?? m.cr ?? '—')}</i>
    <p><b>Armor Class</b> ${creatureAc(m)} · <b>Hit Points</b> ${m.hp?.average ?? '—'} (${esc(m.hp?.formula || '')}) · <b>Speed</b> ${esc(speedText(m.speed))}</p>
    <div class=abrow>${ab}</div>
    ${m.skill ? `<p><b>Skills</b> ${esc(Object.entries(m.skill).map(([k, v]) => `${k} ${v}`).join(', '))}</p>` : ''}
    ${m.save ? `<p><b>Saving Throws</b> ${esc(Object.entries(m.save).map(([k, v]) => `${cap(k)} ${v}`).join(', '))}</p>` : ''}
    ${[['Damage Vulnerabilities', m.vulnerable], ['Damage Resistances', m.resist], ['Damage Immunities', m.immune], ['Condition Immunities', m.conditionImmune]]
      .map(([t, v]) => (v?.length ? `<p><b>${t}</b> ${txt(flat(v))}</p>` : '')).join('')}
    <p><b>Senses</b> ${esc([...(m.senses || []), `passive Perception ${m.passive}`].join(', '))}</p>
    ${m.languages?.length ? `<p><b>Languages</b> ${txt(m.languages.join(', '))}</p>` : ''}
    ${(m.spellcasting || []).map(sc => `<p><b><i>${txt(sc.name || 'Spellcasting')}.</i></b> ${entries(sc.headerEntries, true)}</p>${castLines(sc)}`).join('')}
    ${sect('Traits', m.trait)}${sect('Actions', m.action)}${sect('Bonus actions', m.bonus)}${sect('Reactions', m.reaction)}
    ${m.legendary ? `${sect('Legendary actions', [{ name: 'Legendary actions', entries: m.legendaryHeader || [`The ${m.name.toLowerCase()} can take ${m.legendaryActions || 3} legendary actions.`] }, ...m.legendary])}` : ''}</div>`;
}

// spells granted by a subclass/race/feat `additionalSpells` block up to a level; `pick` chooses between named alternatives (Circle of the Land)
export const spellAlternatives = addl => (addl?.length > 1 && addl.every(a => a.name) ? addl.map(a => a.name) : []);
const pickBlock = (addl, pick) => (spellAlternatives(addl).length ? addl.find(x => x.name === pick) : addl?.[0]);
export function grantedSpells(addl, lvl, pick) {
  const a = pickBlock(addl, pick);
  const out = [];
  if (!a) return out;
  const add = (v, kind, uses) => { for (const x of [].concat(v || [])) if (typeof x === 'string') out.push({ name: x.split('|')[0].split('#')[0], kind, uses }); };
  for (const kind of ['prepared', 'known', 'innate']) {
    for (const [k, v] of Object.entries(a[kind] || {})) {
      if (!/^\d+$/.test(k) || +k > lvl) continue; // "s1"-style keys are expanded spell lists, handled by the spell picker
      if (Array.isArray(v)) { add(v, kind); continue; }
      for (const [freq, byN] of Object.entries(v)) {
        if (freq === '_') add(byN, kind);
        else if (byN && typeof byN === 'object') for (const [n, arr] of Object.entries(byN)) add(arr, kind, `${n}/${freq === 'daily' ? 'day' : freq === 'rest' ? 'short rest' : freq}`);
      }
    }
  }
  return out;
}

// spell lists a block opens up, for the spell picker: "choose"/"all" filters (Magic Initiate, Fey Touched, Divine Soul)
// and expanded lists (warlock patrons). Null when it opens none at this level.
export function spellBook(addl, lvl, pick) {
  const a = pickBlock(addl, pick), filters = new Set(), names = new Set();
  const walk = (v, expanded) => {
    if (typeof v === 'string') { if (expanded) names.add(v.split('|')[0].split('#')[0].toLowerCase()); return; }
    if (!v || typeof v !== 'object') return;
    const f = typeof v.choose === 'string' ? v.choose : v.all;
    if (typeof f === 'string') filters.add(f.toLowerCase());
    else if (v.choose?.from) v.choose.from.forEach(x => walk(x, true));
    else Object.values(v).forEach(x => walk(x, expanded));
  };
  for (const kind of ['prepared', 'known', 'innate', 'expanded'])
    for (const [k, v] of Object.entries(a?.[kind] || {})) if (!/^\d+$/.test(k) || +k <= lvl) walk(v, kind === 'expanded');
  return filters.size || names.size ? { filters: [...filters], names } : null;
}
// does a spell pass a 5etools filter such as "level=0;1|class=wizard|components & miscellaneous=ritual" (lowercase)
export const spellMatches = (s, filter) => filter.split('|').every(c => {
  const [k, v = ''] = c.split('='), vs = v.split(';');
  if (k === 'level') return vs.includes(String(s.level));
  if (k === 'class') return spellClasses(s).some(n => vs.includes(n.toLowerCase()));
  if (k === 'school') return vs.includes(String(s.school).toLowerCase());
  if (k === 'components & miscellaneous') return !vs.includes('ritual') || !!s.meta?.ritual;
  return true; // ponytail: other keys (spell attack, damage type…) don't narrow the list
});

// ---------- classes / spells / items ----------
const byLevel = (a, b) => a.level - b.level;
export const subclassesOf = cls => list('subclass').filter(s => s.className === cls.name && s.classSource === cls.source);
export const findSubclass = (cls, ref) => ref && subclassesOf(cls).find(s => s.name === ref.name && s.source === ref.source);
export const classFeatures = (cls, lvl) => list('classFeature').filter(f => f.className === cls.name && f.classSource === cls.source && f.level <= lvl).sort(byLevel);
export const subclassFeatures = (cls, sub, lvl) => list('subclassFeature').filter(f => f.className === cls.name && f.classSource === cls.source
  && f.subclassShortName === sub.shortName && f.subclassSource === sub.source && f.level <= lvl).sort(byLevel);
export function subclassLevel(cls) {
  const f = cls.classFeatures?.find(x => x.gainSubclassFeature);
  return f ? +f.classFeature.split('|')[3] || 3 : 3;
}
export const spellClasses = s => D?.raw.spellClasses?.[K(s.name, s.source)] || [];
export function subclassSpellNames(sub) {
  const out = new Set();
  const walk = v => {
    if (typeof v === 'string') out.add(v.split('|')[0].split('#')[0].toLowerCase());
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(sub?.additionalSpells);
  return out;
}

export function mergeVariant(v, b) {
  const inh = v.inherits || {};
  const m = { ...b, ...inh, name: `${inh.namePrefix || ''}${b.name}${inh.nameSuffix || ''}`, source: inh.source, variant: v.name, baseItem: `${b.name}|${b.source}` };
  m.entries = JSON.parse(JSON.stringify([...(inh.entries || []), ...(b.entries || [])]).replace(/\{=(\w+)\}/g, (_, k) => inh[k] ?? ''));
  delete m.namePrefix; delete m.nameSuffix;
  return m;
}
export const variantBases = v => list('baseitem').filter(b =>
  (v.requires || []).some(req => Object.entries(req).every(([k, val]) => (k === 'type' ? code(b.type) === code(val) : b[k] === val)))
  && !Object.entries(v.excludes || {}).some(([k, val]) => [].concat(val).includes(b[k])));

// inventory entry -> item data
export function resolveItem(inv) {
  if (inv.custom) return { name: inv.name, weight: +inv.weight || 0, entries: inv.notes ? [inv.notes] : [], custom: true };
  if (inv.variant) {
    const v = find('magicvariant', inv.variant, inv.source), b = find('baseitem', inv.base?.name, inv.base?.source);
    if (v && b) return mergeVariant(v, b);
  }
  const x = find('item', inv.name, inv.source) || find('baseitem', inv.name, inv.source);
  if (!x) return { name: inv.name, entries: ['Not found in the downloaded rules data.'], missing: true };
  if (!x.baseItem) return x;
  const [n, s] = x.baseItem.split('|');
  return { ...find('baseitem', n, s), ...x };
}

// ---------- rendering ----------
export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ATK = { mw: 'Melee Weapon Attack:', rw: 'Ranged Weapon Attack:', 'mw,rw': 'Melee or Ranged Weapon Attack:', ms: 'Melee Spell Attack:', rs: 'Ranged Spell Attack:' };
export const rollBtn = (expr, label) => `<button type=button class=roll data-roll="${expr}">${label}</button>`;

function tag(t, body) {
  const p = body.split('|'), [a, b, c] = p;
  switch (t) {
    case 'b': case 'bold': return `<b>${a}</b>`;
    case 'i': case 'italic': case 'note': return `<i>${a}</i>`;
    case 'u': case 'underline': return `<u>${a}</u>`;
    case 's': case 'strike': return `<s>${a}</s>`;
    case 'dice': case 'damage': case 'autodice': return rollBtn(a, b || a);
    case 'hit': case 'd20': return rollBtn(`1d20${signed(+a || 0)}`, b || signed(+a || 0));
    case 'scaledice': case 'scaledamage': return rollBtn(c, c);
    case 'dc': return `DC ${a}`;
    case 'atk': return `<i>${ATK[a] || a}</i>`;
    case 'h': return '<i>Hit:</i> ';
    case 'recharge': return `(Recharge ${a || 6}–6)`;
    case 'chance': return b || `${a}%`;
    // display text first: {@filter 1|bestiary|…}, {@book chapter 10|PHB|10}, {@link text|url}
    case 'filter': case 'book': case 'adventure': case '5etools': case 'link': case 'footnote': case 'color': case 'highlight': case 'loader': return a;
    case 'quickref': return p[4] || a; // name|source|page|section|display
    case 'deity': case 'card': return p[3] || a; // name|pantheon-or-deck|source|display
    case 'hitYourSpellAttack': return a || 'your spell attack modifier';
    case 'hom': return '<i>Hit or Miss:</i> ';
  }
  if (TAG_CATS[t]) {
    const feat = t.endsWith('Feature');
    return `<a class=ref data-tag="${t}" data-name="${a}" data-src="${feat ? '' : b || ''}">${(!feat && c) || a}</a>`;
  }
  return p[2] || a;
}
export function tags(s) {
  for (let prev; prev !== s;) { prev = s; s = s.replace(/\{@(\w+) ?([^{}]*)\}/g, (_, t, body) => tag(t, body)); }
  return s;
}
const txt = s => tags(esc(s));
const cell = c => (c?.type === 'cell' ? (c.entry != null ? entries(c.entry, true) : c.roll.exact ?? `${c.roll.min}–${c.roll.max}`) : entries(c, true));
// colStyles like "col-2 text-center" → width and alignment
const colStyle = s => { const w = s?.match(/col-(\d+)/), al = s?.match(/text-(center|right)/); return `${w ? `width:${(w[1] / 0.12).toFixed(1)}%;` : ''}${al ? `text-align:${al[1]}` : ''}`; };

export function entries(e, inline = false) {
  if (e == null) return '';
  if (typeof e === 'string' || typeof e === 'number') return inline ? txt(e) : `<p>${txt(e)}</p>`;
  if (Array.isArray(e)) return e.map(x => entries(x, inline)).join(inline ? ' ' : '');
  const name = e.name ? `<b>${txt(e.name)}.</b> ` : '';
  switch (e.type) {
    case 'list': return `<ul>${(e.items || []).map(i => `<li>${entries(i, true)}</li>`).join('')}</ul>`;
    case 'table':
      return `<div class=tbl><table>${e.caption ? `<caption>${txt(e.caption)}</caption>` : ''}<thead><tr>${(e.colLabels || []).map((l, i) => `<th style="${colStyle(e.colStyles?.[i])}">${txt(l)}</th>`).join('')}</tr></thead>`
        + `<tbody>${(e.rows || []).map(r => `<tr>${(r.row || r).map((c, i) => `<td style="${colStyle(e.colStyles?.[i]).replace(/width:[^;]*;/, '')}">${cell(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
        + `${e.footnotes ? `<small>${entries(e.footnotes)}</small>` : ''}</div>`;
    case 'item': case 'itemSub': case 'itemSpell': {
      const body = `${name}${entries(e.entry ?? e.entries, true)}`;
      return inline ? body : `<p>${body}</p>`;
    }
    case 'refClassFeature': case 'refSubclassFeature': case 'refOptionalfeature': {
      const ref = e.classFeature || e.subclassFeature || e.optionalfeature, n = esc(ref.split('|')[0]);
      const t = { refClassFeature: 'classFeature', refSubclassFeature: 'subclassFeature', refOptionalfeature: 'optfeature' }[e.type];
      return `<p>→ <a class=ref data-tag="${t}" data-name="${n}" data-src="">${n}</a></p>`;
    }
    case 'abilityDc': return `<p class=center><b>${esc(e.name)} save DC</b> = 8 + proficiency bonus + ${e.attributes.map(a => ABIL_NAME[a]).join('/')} modifier</p>`;
    case 'abilityAttackMod': return `<p class=center><b>${esc(e.name)} attack modifier</b> = proficiency bonus + ${e.attributes.map(a => ABIL_NAME[a]).join('/')} modifier</p>`;
    case 'image': case 'gallery': case 'hr': return '';
    case 'quote': return `<blockquote>${entries(e.entries)}${e.by ? `<i>— ${esc(e.by)}</i>` : ''}</blockquote>`;
    case 'link': return esc(e.text);
    case 'inline': case 'inlineBlock': return entries(e.entries, true);
    default: {
      const body = entries(e.headerEntries) + (e.entries ? entries(e.entries) : e.items ? entries({ type: 'list', items: e.items }) : e.entry ? entries(e.entry) : '');
      if (!e.name) return body;
      return inline ? name + body : `<div class=sec><h4>${txt(e.name)}</h4>${body}</div>`;
    }
  }
}

// ---------- detail views ----------
const ORD = n => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
const SCHOOL = { A: 'Abjuration', C: 'Conjuration', D: 'Divination', E: 'Enchantment', V: 'Evocation', I: 'Illusion', N: 'Necromancy', T: 'Transmutation' };
export const spellLevel = s => (s.level ? `${ORD(s.level)}-level ${(SCHOOL[s.school] || s.school).toLowerCase()}` : `${SCHOOL[s.school] || s.school} cantrip`) + (s.meta?.ritual ? ' (ritual)' : '');
export const spellTime = s => (s.time || []).map(t => `${t.number} ${t.unit === 'bonus' ? 'bonus action' : t.unit}${t.condition ? ', ' + t.condition : ''}`).join(' or ');
export function spellRange(s) {
  const r = s.range || {}, d = r.distance || {};
  const dist = d.amount ? `${d.amount} ${d.type === 'feet' ? 'ft' : d.type}` : d.type;
  return r.type === 'point' ? (dist === 'self' ? 'Self' : dist === 'touch' ? 'Touch' : dist) : r.type === 'special' ? 'Special' : `Self (${dist} ${r.type})`;
}
export const spellComp = s => {
  const c = s.components || {};
  return [c.v && 'V', c.s && 'S', c.m && `M (${typeof c.m === 'object' ? c.m.text : c.m === true ? '…' : c.m})`].filter(Boolean).join(', ');
};
export const isConc = s => (s.duration || []).some(d => d.concentration);
export function spellDur(s) {
  return (s.duration || []).map(d => d.type === 'instant' ? 'Instantaneous' : d.type === 'permanent' ? `Until ${(d.ends || ['dispelled']).join(' or ')}`
    : d.type === 'special' ? 'Special' : `${d.concentration ? 'Concentration, up to ' : ''}${d.duration.amount} ${d.duration.type}${d.duration.amount > 1 ? 's' : ''}`).join(' or ');
}

const TYPE = {
  M: 'Melee weapon', R: 'Ranged weapon', LA: 'Light armor', MA: 'Medium armor', HA: 'Heavy armor', S: 'Shield', A: 'Ammunition', RG: 'Ring', RD: 'Rod',
  WD: 'Wand', ST: 'Staff', P: 'Potion', SC: 'Scroll', G: 'Adventuring gear', AT: "Artisan's tools", T: 'Tools', INS: 'Instrument', GS: 'Gaming set',
  SCF: 'Spellcasting focus', $C: 'Coins', MNT: 'Mount', TAH: 'Tack and harness', FD: 'Food and drink', TG: 'Trade good', EXP: 'Explosive', OTH: 'Other',
  $: 'Treasure', $A: 'Art object', $G: 'Gemstone', VEH: 'Vehicle', SHP: 'Ship', AIR: 'Airship', GV: 'Magic item (any)',
};
const PROP = { A: 'ammunition', F: 'finesse', H: 'heavy', L: 'light', LD: 'loading', R: 'reach', S: 'special', T: 'thrown', '2H': 'two-handed', V: 'versatile', RLD: 'reload', BF: 'burst fire' };
export const itemType = x => (x.wondrous ? 'Wondrous item' : TYPE[code(x.type)] || (x.custom ? 'Custom' : 'Item'));
export function itemLine(x) {
  const a = [x.weaponCategory ? `${x.weaponCategory} ${itemType(x).toLowerCase()}` : itemType(x)];
  if (x.rarity && x.rarity !== 'none') a.push(x.rarity);
  if (x.reqAttune) a.push(`requires attunement${typeof x.reqAttune === 'string' ? ' ' + x.reqAttune : ''}`);
  const s = [];
  if (x.dmg1) s.push(`${x.dmg1}${x.dmg2 ? ` (${x.dmg2} two-handed)` : ''} ${DMG_TYPE[x.dmgType] || ''}`);
  if (x.ac) s.push(`AC ${x.ac}`);
  if (x.property?.length) s.push(x.property.map(p => PROP[code(p.uid ?? p)] || code(p.uid ?? p)).join(', '));
  if (x.range) s.push(`range ${x.range} ft`);
  for (const [k, l] of [['bonusWeapon', 'attack & damage'], ['bonusAc', 'AC'], ['bonusSavingThrow', 'saves'], ['bonusSpellAttack', 'spell attack'], ['bonusSpellSaveDc', 'spell DC']]) if (x[k]) s.push(`${x[k]} ${l}`);
  if (x.weight) s.push(`${x.weight} lb`);
  if (x.value) s.push(`${x.value / 100} gp`);
  return `<i>${esc(a.join(', '))}</i>${s.length ? '<br>' + esc(s.join(' · ')) : ''}`;
}
const prereq = x => (x.prerequisite || []).map(p => Object.entries(p).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v).replace(/[{}"[\]]/g, '').replace(/,/g, ', ') : v}`).join('; ')).join(' or ');
export function abilityText(x) {
  const a = x?.ability?.[0];
  if (!a) return x?.lineage ? '+2 and +1 to abilities of your choice' : '';
  const fixed = Object.entries(a).filter(([k]) => k !== 'choose').map(([k, v]) => `${k.toUpperCase()} ${signed(v)}`);
  const ch = a.choose;
  if (ch?.weighted) fixed.push(`choose ${ch.weighted.weights.map(signed).join('/')} from ${ch.weighted.from.join(', ').toUpperCase()}`);
  else if (ch) fixed.push(`choose ${ch.count || 1} × ${signed(ch.amount || 1)} from ${ch.from.join(', ').toUpperCase()}`);
  return fixed.join(', ');
}

export function detail(cat, x) {
  if (!x) return '<p>Not found in the downloaded rules data.</p>';
  const meta = [];
  const link = (t, n, s = '') => `<a class=ref data-tag="${t}" data-name="${esc(n)}" data-src="${esc(s)}">${esc(n)}</a>`;
  switch (cat) {
    case 'spell': {
      meta.push(`<i>${esc(spellLevel(x))}</i>`, `<b>Casting time:</b> ${txt(spellTime(x))}`, `<b>Range:</b> ${esc(spellRange(x))}`,
        `<b>Components:</b> ${esc(spellComp(x))}`, `<b>Duration:</b> ${esc(spellDur(x))}`);
      const cl = spellClasses(x);
      if (cl.length) meta.push(`<b>Classes:</b> ${esc(cl.join(', '))}`);
      break;
    }
    case 'item': case 'baseitem': meta.push(itemLine(x)); break;
    case 'magicvariant': meta.push(`<i>Magic variant · ${esc(x.inherits?.rarity || '')}</i>`, `<b>Applies to:</b> ${esc((x.requires || []).map(r => Object.entries(r).map(([k, v]) => (v === true ? k : TYPE[code(v)] || v)).join(' ')).join(', '))}`); break;
    case 'race': case 'subrace': {
      const ab = abilityText(x);
      if (ab) meta.push(`<b>Ability scores:</b> ${esc(ab)}`);
      if (x.speed) meta.push(`<b>Speed:</b> ${esc(typeof x.speed === 'object' ? Object.entries(x.speed).map(([k, v]) => `${k} ${v === true ? '=' : typeof v === 'object' ? v.number : v}`).join(', ') : x.speed)} ft`);
      if (cat === 'race') {
        const subs = list('subrace').filter(s => s.raceName === x.name && s.raceSource === x.source && s.name);
        if (subs.length) meta.push(`<b>Subraces:</b> ${subs.map(s => link('subrace', s.name, s.source)).join(', ')}`);
      }
      break;
    }
    case 'feat': case 'optionalfeature': if (x.prerequisite) meta.push(`<b>Prerequisite:</b> ${txt(prereq(x))}`); break;
    case 'class': {
      meta.push(`<b>Hit die:</b> d${x.hd?.faces} · <b>Saves:</b> ${esc((x.proficiency || []).join(', ').toUpperCase())}`);
      if (x.casterProgression) meta.push(`<b>Spellcasting:</b> ${esc(x.spellcastingAbility?.toUpperCase())} (${x.casterProgression})`);
      const feats = classFeatures(x, 20);
      meta.push(`<b>Features:</b> ${feats.map(f => `${f.level}: ${link('classFeature', f.name)}`).join(', ')}`);
      meta.push(`<b>${esc(x.subclassTitle || 'Subclasses')}:</b> ${subclassesOf(x).map(s => `<a class=ref data-tag=subclass data-name="${esc(s.name)}" data-src="${esc(s.source)}">${esc(s.name)}</a>`).join(', ')}`);
      break;
    }
    case 'subclass': {
      const cls = find('class', x.className, x.classSource);
      if (cls) meta.push(`<b>Features:</b> ${subclassFeatures(cls, x, 20).map(f => `${f.level}: ${link('subclassFeature', f.name)}`).join(', ')}`);
      break;
    }
    case 'classFeature': case 'subclassFeature': meta.push(`<i>${esc(x.className)}${x.subclassShortName ? ` (${esc(x.subclassShortName)})` : ''}, level ${x.level}</i>`); break;
    case 'deity': meta.push(`<i>${esc([x.title, x.pantheon].filter(Boolean).join(' · '))}</i>`, `<b>Domains:</b> ${esc((x.domains || []).join(', ') || '—')} · <b>Symbol:</b> ${esc(x.symbol || '—')}`); break;
    case 'language': meta.push(`<b>Speakers:</b> ${txt((x.typicalSpeakers || []).join(', ') || '—')} · <b>Script:</b> ${esc(x.script || '—')}`); break;
    case 'table': return `<h2>${esc(x.name)} <small class=src>${esc(x.source || '')}</small></h2>${entries({ ...x, type: 'table', caption: undefined })}`;
    case 'monster': return `<h2>${esc(x.name)} <small class=src>${esc(x.source || '')}${x.page ? ' p.' + x.page : ''}</small></h2>${statblock(x)}`;
    default:
  }
  return `<h2>${esc(x.name)} <small class=src>${esc(x.source || '')}${x.page ? ' p.' + x.page : ''}</small></h2>`
    + meta.map(m => `<div class=meta>${m}</div>`).join('')
    + `<div class=entries>${entries(x.entries || x.inherits?.entries)}${entries(x.entriesHigherLevel)}</div>`;
}
