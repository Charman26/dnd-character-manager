import * as db from './db.js';
import * as P from './effects.js';
import {
  ABIL, ABIL_NAME, SKILLS, signed, code, roll, computeCharacter, gatherEffects, computeAction, sourceDef, abilityChoiceSpec,
  evalFormula, dmgExpr, hitExpr, GROUP, itemEffects, mod, profSources, PROF_LISTS,
} from './rules.js';
import {
  D, classArt, imgUrl, downloadRules, setRules, list, find, refOf, lookup, search, CAT_LABEL, SEARCH_GROUPS, subclassesOf, findSubclass, classFeatures,
  subclassFeatures, subclassLevel, spellClasses, subclassSpellNames, spellBook, spellMatches, variantBases, resolveItem, esc, entries, detail, spellLevel,
  spellTime, isConc, itemType, matchScore, abilityText, itemLine, crNum, creatureType, creatureAc, speedText, statblock, grantedSpells, spellAlternatives,
} from './data.js';

const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const cap = s => s[0].toUpperCase() + s.slice(1);
const ORD = n => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
const OPT_TYPE = {
  EI: 'Eldritch Invocation', 'FS:F': 'Fighting Style (Fighter)', 'FS:R': 'Fighting Style (Ranger)', 'FS:P': 'Fighting Style (Paladin)',
  'FS:B': 'Fighting Style (Bard)', MM: 'Metamagic', 'MV:B': 'Maneuver', AI: 'Artificer Infusion', AS: 'Arcane Shot', ED: 'Elemental Discipline',
  PB: 'Pact Boon', RN: 'Rune', RP: 'Rune', 'OR': 'Onomancy Resonant',
};
const TARGETS = ['ac', 'acBase', 'speed', 'initiative', 'hpMax', 'spellDc', 'spellAttack', 'save.all', 'check.all', 'skill.all',
  'attack.all', 'attack.weapon', 'attack.melee', 'attack.ranged', 'attack.spell', 'damage.all', 'damage.weapon', 'damage.melee',
  'damage.ranged', 'damage.spell', ...ABIL.flatMap(a => [`ability.${a}`, `save.${a}`, `check.${a}`]), ...Object.keys(SKILLS).map(s => `skill.${s}`),
  'passive.perception', 'passive.investigation', 'passive.insight'];
const RACE_BOILERPLATE = /^(Age|Alignment|Size|Speed|Languages?|Ability Score Increases?|Creature Type|Life Span)$/i;
const WHEN = 'armor noArmor shield noShield notHeavyArmor lightOrNoArmor nonProficient weapon melee ranged oneHanded heavyWeapon finesseOrRanged str spell:<name>';

let chars = [], cur = null, S = null, saveT;
const ui = { plan: null, mode: 'normal', crit: false, log: [], showLog: false, dlg: null, pick: null, edit: null, open: new Set(), info: [] };
// undo: the last 3 saved states of the open character (JSON), base = the state as saved now
const hist = { id: null, base: null, stack: [], key: null };
// key: changes in a row with the same key (stepping one coin up and down) make a single undo step
function snap(key = null) {
  const s = JSON.stringify(cur);
  if (hist.id !== cur.id) Object.assign(hist, { id: cur.id, base: s, stack: [], key: null });
  else if (s !== hist.base) {
    if (!key || key !== hist.key) { hist.stack.push(hist.base); if (hist.stack.length > 3) hist.stack.shift(); }
    Object.assign(hist, { base: s, key });
  }
}

const newChar = () => ({
  id: uid(), name: 'New hero', race: null, subrace: null, background: null, alignment: '', xp: 0, classes: [],
  setupDone: false, profChoices: {}, profV: 2, abilityMethod: 'array', abilityAssign: { str: 0, dex: 1, con: 2, int: 3, wis: 4, cha: 5 }, rolledPool: null,
  baseScores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, abilityChoices: {}, asiBonuses: {}, skillProfs: {}, saveProfs: {},
  extraProfs: { armor: [], weapon: [], tool: [], lang: [] }, hp: { current: null, temp: 0 }, hitDiceUsed: {}, deathSaves: { s: 0, f: 0 }, inspiration: false, exhaustion: 0,
  conditions: [], activeToggles: [], customEffects: {}, customSources: [], concentration: null, spells: [], slotsUsed: [], pactUsed: 0,
  inventory: [], currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 }, feats: [], optionalFeatures: [], resources: [],
  actions: [{ id: uid(), kind: 'custom', name: 'Unarmed Strike', group: 'action', ability: 'str', prof: true, addMod: true, unarmed: true, dmgType: 'bludgeoning' }],
  featureChoices: {}, featureUses: {}, actionSlots: {}, shape: null, companions: [], kitChoices: {}, bgKit: null,
  // one entry per level-up, in order: { cls, asi?: ['dex', 'dex'], feat?: ref | 'owed' } (hit points stay in classes[].hpRolls)
  levels: [],
  overrides: {}, notes: { personality: '', ideals: '', bonds: '', flaws: '', backstory: '', other: '' },
});
// characters saved before setup/ability methods existed: treat as already set up, scores typed by hand
// older characters kept the unarmed strike as a flat "+1" custom action; mark it so die upgrades (Unarmed Fighting, claws…) reach it
const unarmedV = a => (a.kind === 'custom' && !a.unarmed && !a.dice && /^unarmed strike$/i.test(a.name || '') ? { ...a, unarmed: true, dmgBonus: String(a.dmgBonus) === '1' ? '' : a.dmgBonus } : a);
const normalize = c => {
  const n = { ...newChar(), setupDone: !!c.classes?.length, abilityMethod: 'manual', profV: 0, ...c };
  n.actions = n.actions.map(unarmedV);
  if (!n.classes.every(k => n.levels.filter(e => e.cls === k.name).length === k.level) || n.levels.some(e => !n.classes.some(k => k.name === e.cls))) n.levels = guessLevels(n);
  return n;
};
// characters without a level log: each class's levels in turn; ASI points already given are handed to the ASI levels, 2 each
function guessLevels(c) {
  const left = { ...c.asiBonuses }, levels = [];
  for (const k of c.classes) {
    const cls = D && find('class', k.name, k.source);
    for (let l = 1; l <= k.level; l++) {
      const asi = cls && classFeatures(cls, l).some(x => x.level === l && x.name === 'Ability Score Improvement')
        ? ABIL.flatMap(a => Array(Math.max(0, left[a] || 0)).fill(a)).slice(0, 2) : [];
      asi.forEach(a => left[a]--);
      levels.push({ cls: k.name, ...(asi?.length && { asi }) });
    }
  }
  c.asiBonuses = left;
  return levels;
}
// v0 characters stored race/background skills as manual toggles; those are now derived, so drop the duplicates
// v1 characters kept other proficiencies/languages as free text; move that text into notes so nothing is lost
function migrateProfs() {
  if (!cur.profV) for (const s of profSources(resolve(cur))) if (s.kind === 'skill') for (const k of s.fixed) if (cur.skillProfs[k] === 1) delete cur.skillProfs[k];
  const old = [cur.otherProfs && `Proficiencies: ${cur.otherProfs}`, cur.languages && `Languages: ${cur.languages}`].filter(Boolean);
  if (old.length) cur.notes.other = [cur.notes.other, ...old].filter(Boolean).join('\n');
  delete cur.otherProfs; delete cur.languages;
  cur.profV = 2;
  save();
}

// after every edit, so an earlier change (a subclass swapped, a level undone, a skill re-picked) leaves nothing stale behind:
// picks the rules no longer offer are dropped, lists that shrank are cut back, values no longer among the options are cleared
function prunePicks() {
  if (!cur || !D) return;
  let R = resolve(cur);
  const groups = new Map(R.choiceGroups.map(g => [g.key, g])), profs = new Map(profSources(R).filter(s => s.count).map(s => [s.key, s]));
  const fix = (store, key, n, ok) => { if (Array.isArray(store[key])) store[key] = store[key].slice(0, n).map(v => (v && ok(v) ? v : null)); };
  for (const key of Object.keys(cur.featureChoices)) {
    const g = groups.get(key);
    if (!g) delete cur.featureChoices[key]; else fix(cur.featureChoices, key, g.count, v => g.options.some(o => o.value === v));
  }
  for (const key of Object.keys(cur.profChoices)) {
    const s = profs.get(key);
    if (!s) delete cur.profChoices[key]; else if (s.from) fix(cur.profChoices, key, s.count, v => s.from.includes(v));
  }
  for (const key of Object.keys(cur.abilityChoices)) if (key.startsWith('feat:') && !R.feats.some(f => f.key === key)) delete cur.abilityChoices[key];
  // expertise needs proficiency, which the picks above decide
  R = resolve(cur);
  const stats = computeCharacter(cur, R, gatherEffects(cur, R, P)).stats;
  for (const [key, s] of profs) if (!s.from) fix(cur.profChoices, key, s.count, v => profOptions(s, stats).includes(v));
}

function save(key) {
  if (!cur) return;
  prunePicks();
  snap(key);
  clearTimeout(saveT);
  const c = cur;
  saveT = setTimeout(() => db.put('characters', structuredClone(c)).catch(e => toast(`Save failed: ${e.message}`)), 250);
}
const commit = () => { save(); render(); };
const toast = msg => { ui.log.unshift({ label: msg }); renderDice(); };

// ---------- resolve + compute ----------
function resolve(c) {
  const race = c.race && find('race', c.race.name, c.race.source);
  const subrace = c.subrace && list('subrace').find(s => s.name === c.subrace.name && s.source === c.subrace.source && s.raceName === race?.name);
  const background = c.background && find('background', c.background.name, c.background.source);
  const classes = c.classes.map(k => {
    const cls = find('class', k.name, k.source);
    return { ...k, cls, sub: cls && findSubclass(cls, k.subclass) };
  });
  const items = c.inventory.map(inv => ({ inv, data: resolveItem(inv) }));
  const feats = c.feats.map(f => ({ key: `feat:${f.name}|${f.source}`, data: find('feat', f.name, f.source) })).filter(f => f.data);
  const sources = [];
  for (const [who, x] of [['race', race], ['subrace', subrace]]) {
    for (const e of x?.entries || []) if (e.name && !RACE_BOILERPLATE.test(e.name)) sources.push({ key: `${who}:${e.name}`, name: e.name, kind: 'feature', src: x.source, group: 'Race', data: e });
  }
  const choices = c.featureChoices || {}, choiceGroups = [];
  for (const k of classes) {
    if (!k.cls) continue;
    const feats = [
      ...classFeatures(k.cls, k.level).map(f => ({ f, key: `cf:${k.cls.name}:${f.name}:${f.level}`, group: k.cls.name })),
      ...(k.sub ? subclassFeatures(k.cls, k.sub, k.level).map(f => ({ f, key: `sf:${k.sub.shortName}:${f.name}:${f.level}`, group: `${k.cls.name}: ${k.sub.name}` })) : []),
    ];
    // "options" blocks (Totem Spirit, Aspect of the Beast, Storm Aura…) point at sibling features: only chosen ones apply
    const optionOf = new Map();
    for (const x of feats) {
      const refs = optionRefs(x.f.entries);
      if (!refs.length) continue;
      const opts = refs.map(r => feats.find(y => y !== x && y.f.name === r.name && y.f.level === r.level)).filter(Boolean);
      opts.forEach(o => optionOf.set(o.key, x.key));
      choiceGroups.push({ key: `fo:${x.key}`, label: `${x.f.name} (${k.cls.name} ${x.f.level})`, count: 1, options: opts.map(o => ({ value: o.f.name, label: o.f.name })) });
    }
    for (const x of feats) {
      const parent = optionOf.get(x.key);
      if (parent && !(choices[`fo:${parent}`] || []).includes(x.f.name)) continue;
      sources.push({ key: x.key, name: x.f.name, kind: 'feature', cls: k.cls.name, level: x.f.level, group: x.group, data: x.f, ...(parent && { chosen: true }) });
    }
    // optional-feature progressions: Fighting Style, Invocations, Metamagic, Maneuvers, Infusions… (count grows with level)
    for (const [who, prog] of [['cls', k.cls], ['sub', k.sub]]) {
      for (const p of prog?.optionalfeatureProgression || []) {
        const count = progAt(p.progression, k.level);
        if (!count) continue;
        const key = `of:${k.cls.name}:${who}:${p.name}`;
        choiceGroups.push({ key, label: `${p.name} (${k.cls.name})`, count, options: list('optionalfeature').filter(o => o.featureType.some(t => p.featureType.includes(t)))
          .map(o => ({ value: `${o.name}|${o.source}`, label: o.name, x: o })) });
        for (const ref of (choices[key] || []).slice(0, count)) {
          const [n, src] = String(ref).split('|'), x = n && find('optionalfeature', n, src);
          if (x) sources.push({ key: `opt:${x.name}|${x.source}`, name: x.name, kind: 'feature', cls: k.cls.name, group: 'Class options', data: x, cat: 'optionalfeature' });
        }
      }
    }
  }
  // spells granted by subclass (domain/oath/circle), race and feats; Circle of the Land picks its land first
  // spellBooks: extra lists for the spell picker (Magic Initiate, Fey Touched, Divine Soul, patron spells…)
  const level = classes.reduce((a, k) => a + (k.level || 0), 0) || 1, bonusSpells = [], spellBooks = [];
  const book = (addl, lvl, key, origin, cls) => {
    const b = spellBook(addl, lvl, choices[key]?.[0]), alt = spellAlternatives(addl).length && choices[key]?.[0];
    if (b && !spellBooks.some(x => x.id === `book:${key}`)) spellBooks.push({ ...b, id: `book:${key}`, label: alt ? `${origin}: ${alt}` : origin, cls });
  };
  const grant = (addl, lvl, key, origin, cls) => {
    const alts = spellAlternatives(addl);
    if (alts.length) choiceGroups.push({ key, label: `${origin}: spell list`, count: 1, options: alts.map(a => ({ value: a, label: a })) });
    for (const sp of grantedSpells(addl, lvl, choices[key]?.[0])) if (!bonusSpells.some(b => b.name === sp.name)) bonusSpells.push({ ...sp, origin, cls });
    book(addl, lvl, key, origin, cls);
  };
  for (const k of classes) if (k.sub?.additionalSpells) grant(k.sub.additionalSpells, k.level, `as:${k.sub.shortName}`, k.sub.name, k.cls.name);
  for (const x of [race, subrace]) if (x?.additionalSpells) grant(x.additionalSpells, level, `as:${x.name}`, x.name || race?.name);
  for (const f of feats) if (f.data.additionalSpells) grant(f.data.additionalSpells, level, `as:${f.key}`, f.data.name);
  if (background?.additionalSpells) book(background.additionalSpells, level, `as:${background.name}`, background.name);
  for (const s of sources) if (s.cat !== 'feat' && s.data?.additionalSpells) book(s.data.additionalSpells, level, `as:${s.key}`, s.name, s.cls);
  // Wild Shape: the beast replaces STR/DEX/CON, AC and speed; its attacks become actions (see compute)
  const shape = c.shape && find('monster', c.shape.name, c.shape.source);
  const bgFeats = (background?.entries || []).flatMap(e => [e, ...(Array.isArray(e?.entries) ? e.entries : [])]).filter(e => e?.name?.startsWith?.('Feature:'));
  for (const f of bgFeats) sources.push({ key: `bg:${f.name}`, name: f.name.replace(/^Feature: /, ''), kind: 'feature', group: 'Background', data: f });
  for (const f of feats) sources.push({ key: f.key, name: f.data.name, kind: 'feature', cls: 'feat', group: 'Feats', data: f.data, cat: 'feat', remove: 'feats' });
  for (const o of c.optionalFeatures) {
    const x = find('optionalfeature', o.name, o.source);
    if (x) sources.push({ key: `opt:${x.name}|${x.source}`, name: x.name, kind: 'feature', group: 'Class options', data: x, cat: 'optionalfeature', remove: 'optionalFeatures' });
  }
  for (const s of c.spells) sources.push({ key: `spell:${s.name}|${s.source}`, name: s.name, kind: 'spell', cls: s.cls, group: 'Spells', data: find('spell', s.name, s.source) });
  for (const b of bonusSpells) {
    const d = find('spell', b.name); // granted spells can be toggled too (Hunter's Mark from Oath of Vengeance)
    if (d && !c.spells.some(x => x.name === d.name)) sources.push({ key: `spell:${d.name}|${d.source}`, name: d.name, kind: 'spell', cls: b.cls, group: 'Spells', data: d });
  }
  for (const s of c.customSources) sources.push({ key: `custom:${s.id}`, name: s.name, kind: 'custom', group: 'Custom modifiers', data: { entries: s.notes ? [s.notes] : [] }, custom: s });
  return { race, subrace, background, classes, items, feats, sources, weaponNames: weaponNames(), choiceGroups, bonusSpells, spellBooks, shape, extraEffects: shape ? shapeEffects(shape) : [] };
}

// option refs inside {type:'options'} blocks -> [{name, level}]
function optionRefs(e, out = []) {
  if (Array.isArray(e)) e.forEach(x => optionRefs(x, out));
  else if (e && typeof e === 'object') {
    if (e.type === 'options') for (const o of e.entries || []) {
      const ref = o.subclassFeature || o.classFeature;
      if (ref) { const parts = ref.split('|'); out.push({ name: parts[0], level: +parts.filter(p => /^\d+$/.test(p)).at(-1) }); }
    } else Object.values(e).forEach(x => optionRefs(x, out));
  }
  return out;
}
const progAt = (p, lvl) => (Array.isArray(p) ? p[lvl - 1] || 0 : Object.entries(p || {}).filter(([l]) => +l <= lvl).reduce((m, [, v]) => Math.max(m, v), 0));
function shapeEffects(m) {
  const label = `Wild Shape: ${m.name}`, e = [];
  for (const a of ['str', 'dex', 'con']) e.push({ target: `ability.${a}`, op: 'set', value: m[a], label, transform: true });
  e.push({ target: 'ac', op: 'set', value: creatureAc(m), label }, { target: 'speed', op: 'set', value: m.speed?.walk ?? 0, label });
  const other = speedText(Object.fromEntries(Object.entries(m.speed || {}).filter(([k]) => k !== 'walk')));
  if (other) e.push({ target: 'speed', op: 'note', value: other, label });
  for (const [sk, v] of Object.entries(m.skill || {})) e.push({ target: `skill.${sk}`, op: 'min', value: parseInt(v), label }); // use the better bonus
  e.push({ target: 'spellAttack', op: 'note', value: "Can't cast spells while transformed (until Beast Spells at 18th level)", label });
  return e;
}

let weaponCache = null;
function weaponNames() {
  if (weaponCache?.D === D) return weaponCache;
  // drop the DMG's renaissance/modern/futuristic firearms (they carry an "age")
  const ws = list('baseitem').filter(b => b.weaponCategory && !b.age), names = c => [...new Set(ws.filter(c).map(b => b.name.toLowerCase()))].sort();
  return (weaponCache = { D, all: names(() => true), martial: names(b => b.weaponCategory === 'martial') });
}

const ev = (f, vars) => { try { return evalFormula(f, vars); } catch { return 0; } };
const expandDie = (d, vars) => String(d).replace(/\[([^\]]+)\]/g, (_, f) => ev(f, vars));
function compute() {
  const R = resolve(cur), effects = gatherEffects(cur, R, P), s = computeCharacter(cur, R, effects);
  s.R = R;
  // class resources from features (Rage, Ki, Channel Divinity…), then the user's own counters
  s.featureRes = [];
  for (const src of R.sources) {
    const u = sourceDef(cur, src, P)?.uses, name = u && (u.name || src.name);
    if (!u || s.featureRes.some(r => r.name === name)) continue;
    const id = `f:${name}`;
    s.featureRes.push({ id, name, max: Math.max(0, ev(u.max, s.vars)), used: cur.featureUses[id] || 0, reset: u.shortIf && ev(u.shortIf, s.vars) ? 'short' : u.reset, die: u.die && expandDie(u.die, s.vars) });
  }
  s.resources = [...s.featureRes, ...cur.resources.map(r => ({ ...r, max: resMax(r, s.vars) }))];
  // actions: stored ones, then feature actions, then the Wild Shape beast's attacks
  const derived = [];
  const combatWS = R.sources.some(x => x.name === 'Combat Wild Shape');
  for (const src of R.sources) {
    const def = sourceDef(cur, src, P);
    (def?.actions || []).forEach((fa, i) => {
      const id = `f:${src.key}:${i}`;
      derived.push({ ...fa, id, kind: 'custom', feature: true, name: fa.name || src.name, ability: fa.ability || 'none',
        group: fa.special === 'wildshape' && combatWS ? 'bonus' : fa.group, resId: fa.res ? `f:${fa.res}` : fa.use ? `f:${def.uses?.name || src.name}` : null,
        toggleKey: fa.toggle ? src.key : null, slot: fa.slot ? cur.actionSlots[id] || 1 : undefined,
        link: src.cat === 'optionalfeature' ? { tag: 'optfeature', name: src.name } : src.key.startsWith('sf:') ? { tag: 'subclassFeature', name: src.name } : src.key.startsWith('cf:') ? { tag: 'classFeature', name: src.name } : null });
    });
  }
  if (R.shape) (R.shape.action || []).forEach((x, i) => {
    const t = JSON.stringify(x.entries), hit = t.match(/\{@hit (-?\d+)/), dmg = t.match(/\{@damage ([^}|]+)/);
    derived.push({ id: `shape:${i}`, kind: 'custom', feature: true, shape: true, name: `${x.name} (${R.shape.name})`, group: 'action', ability: 'none',
      ...(hit && { hitFixed: +hit[1] }), dice: dmg?.[1].replace(/\s+/g, '') || '', dmgType: (t.match(/\) (\w+) damage/) || [])[1] || '',
      notes: hit ? '' : x.entries.map(e => (typeof e === 'string' ? e : '')).join(' ').replace(/\{@\w+ ([^|}]+)[^}]*\}/g, '$1') });
  });
  s.actions = [...cur.actions.map((a, i) => ({ a, i })), ...derived.map(a => ({ a }))].map(({ a, i }) => {
    const data = a.kind === 'weapon' ? R.items.find(x => x.inv.id === a.ref)?.data : a.kind === 'spell' ? find('spell', a.ref?.name, a.ref?.source) : null;
    const r = { ...computeAction(a, { sheet: s, R, c: cur, data }), spec: a, stored: i };
    if (r.hit) s.stats[`act.${a.id}.hit`] = r.hit;
    if (r.dmg) s.stats[`act.${a.id}.dmg`] = r.dmg;
    return r;
  });
  const extra = R.sources.map(x => x.name.match(/^Extra Attack(?: \((\d)\))?$/)).filter(Boolean).map(m => (m[1] ? +m[1] + 1 : 2));
  s.attacks = Math.max(1, ...extra);
  s.hpMax = s.stats.hpMax.total;
  s.hp = cur.hp.current ?? s.hpMax;
  return s;
}

// ---------- rendering ----------
const opt = (v, label, sel, dis) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}${dis ? ' disabled' : ''}>${esc(label ?? v)}</option>`;
const bd = (k, label) => `<button class=lbl data-act=bd data-k="${esc(k)}">${label}</button>`;
const marks = s => `${s.adv.length ? '<i class=adv title="Advantage">A</i>' : ''}${s.dis.length ? '<i class=dis title="Disadvantage">D</i>' : ''}`;
const r20 = (k, label, s = S.stats[k]) => `<button class=num data-act=r20 data-k="${esc(k)}" data-label="${esc(label)}">${signed(s.total)}${s.dice.map(d => `<small>+${d}</small>`).join('')}</button>${marks(s)}`;
// filled = still available; tapping spends or restores
const pips = (left, max, act, attrs = '', label = '', [on, off] = ['available', 'spent']) => Array.from({ length: max }, (_, i) => `<button class="pip ${i < left ? 'on' : ''}" data-act=${act} data-i=${i} ${attrs}
  aria-label="${esc(label)} ${i + 1} of ${max}, ${i < left ? on : off}" title="${i < left ? cap(on) : cap(off)}: tap to change"></button>`).join('');
const link = (tag, x) => (x ? `<a class=ref data-tag=${tag} data-name="${esc(x.name)}" data-src="${esc(x.source || '')}">${esc(x.name)}</a>` : '');
const info = (tag, x) => `<a class="ref icon" data-tag=${tag} data-name="${esc(x.name)}" data-src="${esc(x.source || '')}" title=Details>ⓘ</a>`;
// icons: game-icons.net symbols (CC BY 3.0) in icons.svg. tools/mkicons.mjs builds it from every literal ic('…') in this file
const ic = n => `<svg class=ic aria-hidden=true><use href="icons.svg#${n}"></use></svg>`;
const IC = {
  abilities: ic('vitruvian-man'), saves: ic('checked-shield'), skills: ic('skills'), actions: ic('crossed-swords'), spells: ic('spell-book'), inventory: ic('knapsack'),
  features: ic('scroll-unfurled'), companions: ic('wolf-head'), profs: ic('graduate-cap'), notes: ic('quill-ink'), setup: ic('character'),
  hp: ic('hearts'), ac: ic('round-shield'), initiative: ic('lightning-frequency'), speed: ic('run'), hitDice: ic('dice-eight-faces-eight'),
  inspiration: ic('inspiration'), exhaustion: ic('tired-eye'), conc: ic('meditation'), death: ic('tombstone'), short: ic('campfire'), long: ic('night-sleep'),
  temp: ic('temporary-shield'), effects: ic('aura'), shape: ic('paw-print'), xp: ic('upgrade'), alignment: ic('scales'), kit: ic('open-treasure-chest'),
  adv: ic('thumb-up'), dis: ic('thumb-down'), crit: ic('dice-fire'), choices: ic('interleaved-arrows'), cantrips: ic('sparkles'),
  cls: ic('visored-helm'), subclass: ic('wizard-face'),
};
const ABIL_IC = { str: ic('biceps'), dex: ic('acrobatic'), con: ic('muscular-torso'), int: ic('brain'), wis: ic('owl'), cha: ic('drama-masks') };
const SKILL_IC = { acrobatics: ic('body-balance'), 'animal handling': ic('paw-heart'), arcana: ic('crystal-ball'), athletics: ic('jump-across'), deception: ic('domino-mask'),
  history: ic('tied-scroll'), insight: ic('third-eye'), intimidation: ic('shouting'), investigation: ic('magnifying-glass'), medicine: ic('medical-pack'), nature: ic('oak-leaf'),
  perception: ic('eyeball'), performance: ic('lyre'), persuasion: ic('shaking-hands'), religion: ic('holy-symbol'), 'sleight of hand': ic('snatch'), stealth: ic('hooded-figure'), survival: ic('footprint') };
const COND_IC = { Blinded: ic('blindfold'), Charmed: ic('charm'), Deafened: ic('sound-off'), Frightened: ic('terror'), Grappled: ic('grab'), Incapacitated: ic('knockout'),
  Invisible: ic('invisible'), Paralyzed: ic('frozen-body'), Petrified: ic('stone-bust'), Poisoned: ic('poison-bottle'), Prone: ic('falling'), Restrained: ic('crossed-chains'),
  Stunned: ic('knocked-out-stars'), Unconscious: ic('sleepy') };
const DMG_IC = { acid: ic('acid'), bludgeoning: ic('flat-hammer'), cold: ic('snowflake-1'), fire: ic('flame'), force: ic('mighty-force'), lightning: ic('lightning-arc'),
  necrotic: ic('death-skull'), piercing: ic('piercing-sword'), poison: ic('poison'), psychic: ic('psychic-waves'), radiant: ic('sun-radiations'), slashing: ic('quick-slash'),
  thunder: ic('thunder-struck'), healing: ic('healing') };
const GROUP_IC = { action: ic('sword-clash'), bonus: ic('fast-arrow'), reaction: ic('shield-reflect'), other: ic('cog'),
  Weapons: ic('sword-brandish'), Armor: ic('breastplate'), 'Magic items': ic('magic-swirl'), Gear: ic('swap-bag'),
  Race: ic('elf-ear'), Background: ic('family-house'), Feats: ic('laurel-crown'), 'Class options': ic('rune-stone'), 'Custom modifiers': ic('gears') };
const PROF_IC = { armor: ic('breastplate'), weapon: ic('sword-brandish'), tool: ic('hammer-nails'), lang: ic('conversation') };
const NOTE_IC = { personality: ic('tribal-mask'), ideals: ic('star-formation'), bonds: ic('heart-key'), flaws: ic('cracked-mask'), backstory: ic('book-pile'), other: ic('scroll-quill') };
const METHOD_IC = { array: ic('stone-tablet'), pointbuy: ic('two-coins'), roll: ic('rolling-dice-cup'), manual: ic('quill') };
const LOOKUP_IC = { Spells: ic('spell-book'), Items: ic('knapsack'), Creatures: ic('dragon-head'), Classes: ic('visored-helm'), Races: ic('elf-ear'), Feats: ic('laurel-crown'),
  Backgrounds: ic('family-house'), Conditions: ic('bandaged'), Rules: ic('book-cover'), 'Traps & hazards': ic('wolf-trap'), 'Deities & gifts': ic('ankh') };

// section heading with a ⋮ menu holding its less frequent "+ …" buttons (closed by the click handler below)
const menu = (items, cls = '') => `<details class="menu ${cls}"><summary title="More" aria-label="More options">⋮</summary><div class=menupop>${items}</div></details>`;
const sechead = (title, items) => `<div class=sechead><h3>${title}</h3>${menu(items)}</div>`;
const summary = c => [c.race?.name, c.classes.map(k => `${k.name} ${k.level}`).join(' / ')].filter(Boolean).join(' · ');

function withFocus(fn) {
  const ae = document.activeElement, path = ae?.dataset?.path;
  let sel = null;
  try { sel = ae?.selectionStart; } catch { /* not a text input */ }
  fn();
  if (!path) return;
  const el = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (el && el !== ae) {
    el.focus();
    try { if (sel != null) el.setSelectionRange(sel, sel); } catch { /* number inputs */ }
  }
}

function render() {
  withFocus(() => {
    if (cur && D && cur.profV !== 2) migrateProfs();
    if (cur && D) S = compute();
    if (cur && hist.id !== cur.id) snap();
    $('#app').innerHTML = cur && D ? sheetView() : homeView();
    $('#title').textContent = cur ? '' : 'D&D 5e Characters';
    $('[data-act=home]').hidden = !cur;
    document.title = cur ? `${cur.name} · D&D Character Manager` : 'D&D Character Manager';
    if (ui.dlg) $('#dlgBody').innerHTML = ui.dlg();
    layout();
  });
  syncJump();
  if (ui.focusName) { ui.focusName = false; $('[data-path=name]')?.select(); }
  renderDice();
  if (!cur) navigator.storage?.estimate?.().then(e => { const el = $('#storage'); if (el) el.textContent = `Storage used: ${(e.usage / 1e6).toFixed(1)} MB`; });
}
const renderDlg = () => withFocus(() => { if (ui.dlg) $('#dlgBody').innerHTML = ui.dlg(); });

function homeView() {
  const meta = D?.raw.meta;
  const characters = `<section class=card><h2>Characters</h2>
    ${chars.map(c => `<div class=row><a href="#${c.id}" class="grow open"><span><b>${esc(c.name)}</b><br><small class=muted>${esc(summary(c))}</small></span><span class=chev aria-hidden=true>›</span></a>
      ${menu(`<button data-act=dup data-id=${c.id}>Duplicate</button><button data-act=export data-id=${c.id}>Export JSON</button><button class=danger data-act=delchar data-id=${c.id}>Delete…</button>`)}</div>`).join('') || '<p class=muted>No characters yet.</p>'}
    <div class=btns><button class=primary data-act=newchar ${D ? '' : 'disabled'}>New character</button><button data-act=loadexamples ${D ? '' : 'disabled'}>Load example characters</button>
      <label class=btn>Import JSON<input type=file accept=".json,application/json" data-act=import hidden></label></div>
    ${D ? '' : `<p class=warn>${cur ? 'Download the rules data to open characters.' : 'Download the rules data above first: creating or loading characters needs it.'}</p>`}
  </section>`;
  return `${D ? characters : ''}<section class=card><h2>Rules data</h2>
    ${meta ? `<p>Downloaded ${new Date(meta.date).toLocaleString()}: ${meta.counts.spell} spells, ${meta.counts.class} classes, ${meta.counts.subclass} subclasses,
      ${meta.counts.item + meta.counts.baseitem} items, ${meta.counts.feat} feats, ${meta.counts.race} races.</p>`
    : '<p><b>No rules data yet.</b> Download it once while online. It is stored in this browser and works offline afterwards.</p>'}
    <p class=muted>Official D&amp;D 5e (2014) content only: no 2024 rules, Unearthed Arcana or homebrew. This site hosts none of the data: on first use, paste the GitHub link of a repository with the 5e data (like <code>https://github.com/owner/repo</code>). Its <code>main/data/</code> folder is fetched straight into this browser and saved there.</p>
    <label class=field><span>Data repository</span><input id=base type=url placeholder="https://github.com/owner/repo" value="${esc(meta?.src || meta?.base || '')}"></label>
    <div class=btns><button class=primary data-act=download>${meta ? 'Refresh' : 'Download'} rules data</button></div>
    <div id=prog></div><p class=muted id=storage></p>
    <p class=note>Icons by Lorc, Delapouite, Skoll, Carl Olsen, DarkZaitzev, Faithtoken, Sbed and Willdabeast from <a href="https://game-icons.net" target=_blank rel=noopener>game-icons.net</a>,
      licensed <a href="https://creativecommons.org/licenses/by/3.0/" target=_blank rel=noopener>CC BY 3.0</a> (per-icon credits in icons.svg).</p>
  </section>${D ? '' : characters}`;
}

// Blocks in priority order. Each goes into the currently shortest column, so the core blocks
// head separate columns on wide screens and come first in a single column.
const BLOCKS = ['abilities', 'saves', 'skills', 'actions', 'spells', 'inventory', 'features', 'companions', 'profs', 'notes'];
const blocksFor = n => (n === 1 ? ['abilities', 'skills', 'saves', ...BLOCKS.slice(3)] : BLOCKS); // single column: saves below skills
const JUMP = { abilities: 'Stats', skills: 'Skills', actions: 'Actions', spells: 'Spells', inventory: 'Items', features: 'Features', companions: 'Allies', notes: 'Notes' };
const colCount = () => (innerWidth >= 1100 ? 3 : innerWidth >= 700 ? 2 : 1);
const planOk = () => ui.plan?.n === colCount() && ui.plan.id === cur.id;
function sheetView() {
  const views = { ...statsBlocks(), actions: actionsView(), spells: spellsView(), inventory: inventoryView(), features: featuresView(), companions: companionsView(), notes: notesView() };
  const n = colCount();
  // no plan yet: everything in column 1 so layout() can measure real heights, then distribute
  const cols = planOk() ? ui.plan.cols : [blocksFor(n), ...Array(n - 1).fill([])];
  return `${cur.setupDone ? '' : setupView()}${statusView()}
  ${n === 1 ? `<nav class=jump>${Object.entries(JUMP).map(([k, l]) => `<button data-act=jump data-b=${k}>${l}</button>`).join('')}</nav>` : ''}
  <div class="grid cols${n}">${cols.map(c => `<div class=col>${c.map(id => `<div class=blk data-blk=${id}>${views[id]}</div>`).join('')}</div>`).join('')}</div>`;
}
// ponytail: placement is computed once per character/column count and then kept, so blocks don't jump while editing
function layout() {
  if (!cur || !D || planOk()) return;
  const cols = [...document.querySelectorAll('.grid > .col')], hs = cols.map(() => 0), plan = cols.map(() => []);
  for (const id of blocksFor(cols.length)) {
    const el = document.querySelector(`[data-blk=${id}]`), i = hs.indexOf(Math.min(...hs));
    hs[i] += el.offsetHeight;
    plan[i].push(id);
    cols[i].append(el);
  }
  ui.plan = { n: cols.length, id: cur.id, cols: plan };
}
// single column: highlight the section under the jump bar and keep its button in view
function syncJump() {
  const nav = $('.jump');
  if (!nav) return;
  const y = Math.max(nav.getBoundingClientRect().bottom + 8, innerHeight / 3), bs = [...nav.children];
  const on = bs.filter(b => document.querySelector(`[data-blk=${b.dataset.b}]`)?.getBoundingClientRect().top <= y).at(-1) || bs[0];
  bs.forEach(b => b.classList.toggle('on', b === on));
  if (nav.dataset.on === on.dataset.b) return;
  nav.scrollTo({ left: on.offsetLeft - nav.clientWidth / 3, behavior: nav.dataset.on ? 'smooth' : 'instant' }); // fresh after a render: no animation
  nav.dataset.on = on.dataset.b;
}
addEventListener('scroll', () => requestAnimationFrame(syncJump), { passive: true });

function toggleSources() {
  const out = S.R.sources.filter(s => sourceDef(cur, s, P)?.toggle);
  for (const { inv, data } of S.R.items) if (cur.customEffects[`inv:${inv.id}`]?.toggle) out.push({ key: `inv:${inv.id}`, name: data.name });
  return out;
}
const isOn = k => cur.activeToggles.includes(k);
const togBtn = (s, label) => `<button class="tog ${isOn(s.key) ? 'on' : ''}" data-act=toggle data-k="${esc(s.key)}">${label ?? esc(s.name)}</button>`;

function statusView() {
  const { hp, hpMax } = S, st = S.stats;
  const res = S.resources.map(r => {
    const left = Math.max(0, r.max - r.used), id = esc(r.id);
    return `<span class=res><b>${esc(r.name)}</b> ${r.max <= 12 ? pips(left, r.max, 'respip', `data-id="${id}"`, r.name) : `<button data-act=resstep data-id="${id}" data-d=1 aria-label="Spend one">−</button> ${left}/${r.max} <button data-act=resstep data-id="${id}" data-d=-1 aria-label="Restore one">+</button>`}
      ${r.die ? `<button class=roll data-roll="${esc(r.die)}">${esc(r.die)}</button>` : ''}${r.reset === 'never' ? '' : `<small class=muted title="Resets on a ${esc(r.reset)} rest">↻ ${esc(r.reset)} rest</small>`}
      ${r.id.startsWith('f:') ? '' : menu(`<button data-act=editres data-id="${id}">Edit…</button><button class=danger data-act=delres data-r=${cur.resources.findIndex(x => x.id === r.id)}>Delete</button>`, 'sm left')}</span>`;
  }).join('');
  const shape = S.R.shape, canShape = S.featureRes.some(r => r.name === 'Wild Shape');
  const conds = list('condition');
  const main = S.R.classes.filter(k => k.cls).sort((a, b) => b.level - a.level)[0], art = cur.image || (main && classArt(main.cls, main.sub));
  const open = cur.setupDone ? pendingPicks().length : 0; // during setup its panel lists them
  return `<section class="card status${art ? ' art' : ''}"${art ? ` style="--art: url('${esc(cssUrl(art))}')"` : ''}>
    <div class=namewrap><h2 class=charname>${esc(cur.name)}</h2>${open ? `<button class="icon pickwarn" data-act=openpicks title="Choices still to make" aria-label="${open} choice${open > 1 ? 's' : ''} still to make">⚠</button>` : ''}${menu(`<button data-act=rename>Rename…</button><button data-act=image>Change image…</button><button data-act=levelchooser>Level up</button>${cur.setupDone ? '<button data-act=editsetup>Edit character</button>' : ''}<button data-act=addres>+ Resource</button>`)}</div>
    ${shape ? `<div class=shape><span class=grow>${IC.shape} <b>Wild Shape: ${link('creature', shape)}</b> <small class=muted>CR ${esc(shape.cr?.cr ?? shape.cr)} · ${esc(speedText(shape.speed))}</small></span>
      <button data-act=revert>Revert</button></div>` : ''}
    <div class=hprow>
      <div class=hpbox>${shape ? `<div>${IC.hp}<span class=big>${cur.shape.hp}</span> / ${cur.shape.max} <small class=muted>${esc(shape.name)} HP · yours ${hp}/${hpMax}</small> ${cur.hp.temp ? `<span class=temp>${IC.temp}+${cur.hp.temp} temp</span>` : ''}</div>
        <div class="bar beast"><i style="width:${Math.max(0, Math.min(100, (100 * cur.shape.hp) / cur.shape.max))}%"></i></div>`
        : `<div>${IC.hp}<span class=big>${hp}</span> / ${bd('hpMax', hpMax)} ${cur.hp.temp ? `<span class=temp>${IC.temp}+${cur.hp.temp} temp</span>` : ''}</div>
        <div class=bar><i style="width:${Math.max(0, Math.min(100, (100 * hp) / hpMax))}%"></i></div>`}</div>
      <span class=hpctl role=group aria-label="Change hit points"><input type=number id=hpamt min=0 inputmode=numeric enterkeyhint=done placeholder=HP aria-label="HP amount" title="Type an amount; Enter applies damage">
        ${[['danger', 'dmg', 'Damage'], ['ok', 'heal', 'Heal'], ['', 'temp', 'Temp']].map(([c, op, l]) => `<button class="${c}" data-act=hp data-op=${op} disabled title="Type an amount first">${l}</button>`).join('')}</span>
    </div>
    ${hp <= 0 && cur.deathSaves.s < 3 ? `<div class=chips><b>${IC.death} Death saves</b> ✓ ${pips(cur.deathSaves.s, 3, 'ds', 'data-w=s', 'Success', ['marked', 'empty'])} ✗ ${pips(cur.deathSaves.f, 3, 'ds', 'data-w=f', 'Failure', ['marked', 'empty'])}
      <button data-act=deathroll>Roll</button></div>` : ''}
    <div class=vitals>
      <div>${bd('ac', `${IC.ac}AC`)}<b>${st.ac.total}</b></div>
      <div>${bd('initiative', `${IC.initiative}Init`)}${r20('initiative', 'Initiative')}</div>
      <div>${bd('speed', `${IC.speed}Speed`)}<b>${st.speed.total}</b></div>
      <div>${bd('prof', `${IC.profs}Prof`)}<b>${signed(st.prof.total)}</b></div>
      <div><button class=lbl data-act=short title="Spend on a short rest">${IC.hitDice}Hit Dice</button><span class=hd>${Object.entries(S.hitDice).sort((a, b) => b[0] - a[0])
        .map(([f, n]) => `<b>${n - (cur.hitDiceUsed[f] || 0)}d${f}<small>/${n}</small></b>`).join('') || '<b>—</b>'}</span></div>
    </div>
    <div class=chips>
      <label class=chip><input type=checkbox data-path=inspiration ${cur.inspiration ? 'checked' : ''}> ${IC.inspiration}Inspiration</label>
      <label class=chip>${IC.exhaustion}Exhaustion <select data-path=exhaustion data-type=num>${[0, 1, 2, 3, 4, 5, 6].map(n => opt(n, n, cur.exhaustion === n)).join('')}</select></label>
      ${cur.concentration ? `<span class="chip conc">${IC.conc}${esc(cur.concentration)} <button class=icon data-act=dropconc title="End concentration">✕</button></span>` : ''}
      ${cur.conditions.map(n => `<span class="chip on">${COND_IC[n] || ''}<a class=ref data-tag=condition data-name="${esc(n)}" data-src=PHB>${esc(n)}</a><button class=icon data-act=cond data-n="${esc(n)}">✕</button></span>`).join('')}
      <select data-act=addcond aria-label="Add condition"><option value="">+ Condition</option>${conds.filter(c => c.name !== 'Exhaustion' && !cur.conditions.includes(c.name)).map(c => opt(c.name)).join('')}</select>
    </div>
    ${toggleSources().length ? `<div class=chips title="Tap to switch an effect on or off"><small class=muted>${IC.effects}Active effects</small> ${toggleSources().map(s => togBtn(s)).join('')}</div>` : ''}
    ${res ? `<div class=chips>${res}</div>` : ''}
    <div class=btns><button data-act=short>${IC.short}Short rest</button><button data-act=long>${IC.long}Long rest</button>
      ${canShape && !shape ? '<button data-act=wildshape>Wild Shape</button>' : ''}</div>
  </section>`;
}

function statsBlocks() {
  const R = S.R, st = S.stats;
  const skills = Object.entries(SKILLS).map(([sk, a]) => {
    const s = st[`skill.${sk}`];
    return `<div class=srow><button class="dot p${s.proficient} ${s.derived ? 'g' : ''}" data-act=skillprof data-s="${sk}" title="${esc(s.sources.length ? `From ${s.sources.join(', ')}` : 'Tap: proficient → expertise → none')}"></button>
      ${bd(`skill.${sk}`, `${SKILL_IC[sk]}${cap(sk)} <small class=muted>${a.toUpperCase()}</small>`)}${r20(`skill.${sk}`, cap(sk))}</div>`;
  }).join('');
  const saves = ABIL.map(a => `<div class=srow><button class="dot p${st[`save.${a}`].proficient ? 1 : 0} ${st[`save.${a}`].derived ? 'g' : ''}" data-act=saveprof data-a=${a}></button>
    ${bd(`save.${a}`, `${ABIL_IC[a]}${ABIL_NAME[a]}`)}${r20(`save.${a}`, `${ABIL_NAME[a]} save`)}</div>`).join('');
  return {
    abilities: `<section class=card><h3>${IC.abilities}Abilities</h3><div class=abils>${ABIL.map(a => `<div class=abil>${bd(`ability.${a}`, `${ABIL_IC[a]}${a.toUpperCase()}`)}
    ${r20(`check.${a}`, `${ABIL_NAME[a]} check`)}<small>${S.scores[a]}</small></div>`).join('')}</div></section>`,
    saves: `<section class=card><h3>${IC.saves}Saving throws</h3>${profChoiceRows(s => s.kind === 'save')}${saves}</section>`,
    skills: `<section class=card><h3>${IC.skills}Skills</h3>${profChoiceRows(s => s.kind === 'skill' || s.kind === 'expertise')}${skills}
    <div class=srow>${bd('passive.perception', `${SKILL_IC.perception}Passive Perception`)}<b>${st['passive.perception'].total}</b></div>
    <div class=srow>${bd('passive.investigation', `${SKILL_IC.investigation}Passive Investigation`)}<b>${st['passive.investigation'].total}</b></div>
    <div class=srow>${bd('passive.insight', `${SKILL_IC.insight}Passive Insight`)}<b>${st['passive.insight'].total}</b></div></section>`,
    profs: profsView(),
  };
}

const PROF_KINDS = { armor: 'Armor', weapon: 'Weapons', tool: 'Tools', lang: 'Languages' };
const titleCase = s => String(s).replace(/(^|[\s(-])\w/g, m => m.toUpperCase());
const profSuggest = kind => ({ armor: PROF_LISTS.armor, weapon: ['simple', 'martial', ...S.R.weaponNames.all], tool: PROF_LISTS.tool, lang: PROF_LISTS.lang }[kind]);
function profsView() {
  const groups = Object.entries(PROF_KINDS).map(([kind, label]) => {
    const have = S.profs[kind], extra = cur.extraProfs[kind] || [];
    const chips = Object.keys(have).sort().map(p => {
      const from = have[p].filter(x => x !== 'manual');
      return `<span class="chip ${from.length ? 'g' : ''}" title="${esc(from.length ? `From ${from.join(', ')}` : 'Added manually')}">${esc(titleCase(p))}${
        extra.includes(p) ? `<button class=icon data-act=delprof data-k=${kind} data-v="${esc(p)}" aria-label="Remove ${esc(p)}">✕</button>` : ''}</span>`;
    }).join('');
    return `<div class=profrow><b>${PROF_IC[kind]}${label}</b><div class=chips>${chips || '<small class=muted>none</small>'}</div></div>`;
  }).join('');
  return `<section class=card>${sechead(`${IC.profs}Proficiencies &amp; languages`, Object.entries(PROF_KINDS).map(([k, l]) => `<button data-act=pick data-what=prof data-k=${k}>Add ${l === 'Armor' ? 'armor' : l.toLowerCase().replace(/s$/, '')}…</button>`).join(''))}${profChoiceRows(s => PROF_KINDS[s.kind])}${groups}
    <p class=note>Gold = granted by race, class, background, feats or features (removed with them). Others are manual.</p></section>`;
}

const POINT = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
function abilityChoiceUI(key, data) {
  const spec = abilityChoiceSpec(data);
  if (!spec) return '';
  const ch = cur.abilityChoices[key] || [];
  return `<div class=field><span>${esc(data.name || 'Subrace')} bonus</span><div class="inline choice">${spec.weights.map((w, i) => `<select data-path="abilityChoices.${key}.${i}" class="${ch[i] ? '' : 'unset'}">
    ${opt('', `${signed(w)} to…`)}${spec.from.map(a => opt(a, a.toUpperCase(), ch[i] === a)).join('')}</select>`).join('')}</div></div>`;
}
const STD_ARRAY = [15, 14, 13, 12, 10, 8];
const METHODS = { array: 'Standard array', pointbuy: 'Point buy', roll: 'Roll 4d6', manual: 'Manual' };
const poolOf = () => (cur.abilityMethod === 'array' ? STD_ARRAY : cur.rolledPool || []);
const syncPool = () => { const p = poolOf(); for (const a of ABIL) if (p[cur.abilityAssign[a]] != null) cur.baseScores[a] = p[cur.abilityAssign[a]]; };
const pointsSpent = () => ABIL.reduce((t, a) => t + (POINT[cur.baseScores[a]] ?? 0), 0);
function rollPool() {
  cur.rolledPool = ABIL.map(() => {
    const r = [1, 2, 3, 4].map(() => 1 + Math.floor(Math.random() * 6)).sort((x, y) => y - x);
    ui.log.unshift({ label: '4d6 drop lowest', total: r[0] + r[1] + r[2], text: r.join(',') });
    return r[0] + r[1] + r[2];
  }).sort((x, y) => y - x);
  cur.abilityAssign = Object.fromEntries(ABIL.map((a, i) => [a, i]));
}

function abilityUI() {
  const m = cur.abilityMethod, pool = poolOf(), left = 27 - pointsSpent();
  const ctl = a => {
    const v = cur.baseScores[a];
    if (m === 'pointbuy') return `<span class=pb><button data-act=pb data-a=${a} data-d=-1 ${v <= 8 ? 'disabled' : ''} aria-label="Lower ${a}">−</button><b class=pbv>${v}</b>`
      + `<button data-act=pb data-a=${a} data-d=1 ${v >= 15 || POINT[v + 1] - POINT[v] > left ? 'disabled' : ''} aria-label="Raise ${a}">+</button></span>`;
    if (m === 'manual') return `<input type=number min=1 max=30 data-path="baseScores.${a}" value="${v}" aria-label="${ABIL_NAME[a]} base">`;
    return `<select data-act=assign data-a=${a} aria-label="${ABIL_NAME[a]} score">${pool.map((x, i) => {
      const owner = ABIL.find(b => b !== a && cur.abilityAssign[b] === i);
      return opt(i, owner ? `${x}  (now ${owner.toUpperCase()})` : x, cur.abilityAssign[a] === i);
    }).join('')}</select>`;
  };
  const rows = ABIL.map(a => {
    const st = S.stats[`ability.${a}`], bonus = st.total - cur.baseScores[a];
    return `<tr><th><span class=full>${ABIL_NAME[a]}</span><span class=abbr>${a.toUpperCase()}</span></th><td class=ctl>${ctl(a)}</td><td class=muted>${bonus ? signed(bonus) : ''}</td>
      <td><button class=lbl data-act=bd data-k="ability.${a}">${st.total}</button></td><td><b>${signed(mod(st.total))}</b></td></tr>`;
  }).join('');
  return `<div class=abwrap><div class=seg>${Object.entries(METHODS).map(([k, l]) => `<button class="${m === k ? 'on' : ''}" data-act=method data-m=${k}>${METHOD_IC[k]}${l}</button>`).join('')}</div>
    <p class=small>${{
      array: 'Pick a value for each ability. Choosing one already in use swaps the two.',
      pointbuy: `Raise scores from 8 (max 15). <b>${left}</b> of 27 points left.`,
      roll: `${cur.rolledPool ? `Rolled: <b>${cur.rolledPool.join(', ')}</b>. Assign them like the standard array.` : ''} <button data-act=rollpool>${cur.rolledPool ? 'Reroll' : 'Roll'} 4d6 ×6</button>`,
      manual: 'Type each base score.',
    }[m]}</p>
    <table class=abtable><tr><th></th><th>Base</th><th>Bonus</th><th>Score</th><th>Mod</th></tr>${rows}</table>
    <p class=note>Bonus = race, feats and ASIs; tap a score for its breakdown.</p></div>`;
}

function setupView() {
  const R = S.R, race = R.race, sub = R.subrace;
  const subs = race ? list('subrace').filter(s => s.raceName === race.name && s.raceSource === race.source) : [];
  const srcs = profSources(R);
  const hint = keys => {
    const mine = srcs.filter(s => keys.some(k => s.src === k || s.src.startsWith(k + ':')));
    const names = { skill: 'Skills', lang: 'Languages', tool: 'Tools', weapon: 'Weapons', armor: 'Armor' };
    const fixed = Object.entries(names).map(([k, l]) => [l, mine.filter(s => s.kind === k).flatMap(s => s.fixed)]).filter(([, f]) => f.length);
    return fixed.map(([l, f]) => `<small class="muted block">${l}: ${esc(f.map(titleCase).join(', '))}</small>`).join('') + profChoiceRows(s => mine.some(m => m.key === s.key));
  };
  const classes = R.classes.map((k, i) => {
    if (!k.cls) return `<div class=classrow>${esc(k.name)} <span class=warn>not in rules data</span></div>`;
    const sl = subclassLevel(k.cls);
    return `<div class=classrow>${link('class', k.cls)} <b>${k.level}</b><button data-act=lvlup data-i=${i} ${S.level >= 20 ? 'disabled' : ''} aria-label="Level up ${esc(k.cls.name)}">+</button>
      ${k.level >= sl ? `${subclassSelect(k.cls, k.sub, i)}
        ${k.sub ? info('subclass', k.sub) : ''}`
        : `<small class=muted>${esc(k.cls.subclassTitle || 'Subclass')} at level ${sl}</small>`}</div>`;
  }).join('');
  // open selects: proficiency picks of race/background/class, and the race's "+1 to…" ability picks
  const unpicked = (picks, n) => Array.from({ length: n }, (_, i) => picks?.[i]).filter(x => !x).length;
  const picks = srcs.filter(s => s.count && /^(race|subrace|background|class|mc:)/.test(s.src)).reduce((n, s) => n + unpicked(cur.profChoices[s.key], s.count), 0)
    + [['race', sub?.overwrite?.ability ? null : race], ['subrace', sub]].reduce((n, [k, x]) => n + unpicked(cur.abilityChoices[k], abilityChoiceSpec(x)?.weights.length || 0), 0);
  const missing = [!race && 'race', race && !race.ability && subs.length && !sub && 'subrace', !R.background && 'background', !cur.classes.length && 'class',
    R.classes.some(k => k.cls && k.level >= subclassLevel(k.cls) && !k.sub) && 'subclass', picks && `${picks} pick${picks > 1 ? 's' : ''} (dashed boxes)`].filter(Boolean);
  return `<section class="card setup">
    <div class=setuphead><h2>${IC.setup}Character setup</h2><span class=grow></span>
      ${missing.length ? `<small class=muted>Still to choose: ${missing.join(', ')}</small>` : ''}
      <button class=primary data-act=setupdone>${missing.length ? 'Done for now' : 'Confirm character'}</button>${menu(`<button data-act=export data-id=${cur.id}>Export JSON</button>`)}</div>
    <div class=setupgrid><div>
      <label class=field><span>Name</span><input data-path=name value="${esc(cur.name)}"></label>
      <div class=two><label class=field><span>${IC.alignment}Alignment</span><input data-path=alignment value="${esc(cur.alignment)}"></label>
        <label class=field><span>${IC.xp}XP</span><input type=number data-path=xp value="${cur.xp}"></label></div>
      <div class=field><span>Race</span><div class=inline><button data-act=pick data-what=race>${race ? esc(race.name) : 'Choose…'}</button>${race ? info('race', race) : ''}
        ${subs.length ? `<select data-act=setsubrace>${opt('', '— Subrace —')}${subs.map((s, j) => opt(j, s.name || '(standard)', sub === s)).join('')}</select>` : ''}</div>
        ${race ? `<small class=muted>${esc(abilityText(sub?.overwrite?.ability ? sub : race))}${sub && !sub.overwrite?.ability ? ' · ' + esc(abilityText(sub)) : ''}</small>` : ''}
        ${hint(['race', 'subrace'])}</div>
      ${sub?.overwrite?.ability ? '' : abilityChoiceUI('race', race)}${abilityChoiceUI('subrace', sub)}
      ${R.feats.map(f => abilityChoiceUI(f.key, f.data)).join('')}
      <div class=field><span>Background</span><div class=inline><button data-act=pick data-what=background>${R.background ? esc(R.background.name) : 'Choose…'}</button>
        ${R.background ? info('background', R.background) : ''}</div>${hint(['background'])}${R.background ? kitView(R.background) : ''}</div>
      <div class=field><span>Classes</span>${classes}<div class=inline><button data-act=pick data-what=class>+ ${cur.classes.length ? 'Multiclass' : 'Add class'}</button></div>
        ${hint(['class', 'mc'])}${levelsView()}</div>
    </div><div class=field><span>Ability scores</span>${abilityUI()}</div></div>
  </section>`;
}

// selects for every proficiency choice a source offers; picks live in cur.profChoices[source.key]
// once every pick in a block is made, it folds behind "View selection…"
const foldChoices = (key, html, done) => (!html || !done ? html : `<details class=fold data-key="${esc(key)}" ${ui.open.has(key) ? 'open' : ''}><summary></summary>${html}</details>`);
const allPicked = (picks, n) => Array.from({ length: n }, (_, i) => picks?.[i]).every(Boolean);
const picksOk = (picks, n, opts) => Array.from({ length: n }, (_, i) => picks?.[i]).every(v => v && opts.includes(v));
// a proficiency pick's options right now: its list, or for expertise any skill you're proficient in
const profOptions = (s, stats = S.stats) => s.from || Object.keys(SKILLS).filter(k => stats[`skill.${k}`].proficient >= 1);
const profDone = s => picksOk(cur.profChoices[s.key], s.count, profOptions(s));
const optionOk = o => !o.x || prereqMet(o.x);
const groupDone = g => picksOk(cur.featureChoices[g.key], g.count, g.options.filter(optionOk).map(o => o.value));

function profChoiceRows(filter) {
  const srcs = profSources(S.R).filter(s => s.count && filter(s));
  return foldChoices(`ch:${srcs.map(s => s.key).join()}`, srcs.map(profChoiceRow).join(''), srcs.every(profDone));
}
function profChoiceRow(s) {
  const picks = cur.profChoices[s.key] || [];
  const from = profOptions(s);
  const label = x => (s.kind === 'save' ? ABIL_NAME[x] : titleCase(x));
  const has = x => (s.kind === 'save' ? S.stats[`save.${x}`].proficient : s.kind === 'skill' || s.kind === 'expertise'
    ? S.stats[`skill.${x}`].proficient >= (s.kind === 'expertise' ? 2 : 1) : !!S.profs[s.kind][x]);
  const what = { expertise: 'expertise', save: 'saving throw', skill: 'skill', lang: 'language', tool: 'tool', weapon: 'weapon', armor: 'armor' }[s.kind] + (s.count > 1 && s.kind !== 'armor' ? 's' : '');
  return `<div class=choice><span>${esc(s.label)}: choose ${s.count} ${what}</span>${Array.from({ length: s.count }, (_, i) => `<select data-path="profChoices.${s.key}.${i}" class="${from.includes(picks[i]) ? '' : 'unset'}">
    ${opt('', 'Choose…')}${from.map(x => opt(x, `${label(x)}${has(x) && picks[i] !== x ? ' ✓' : ''}`, picks[i] === x)).join('')}</select>`).join('')}</div>`;
}
const subclassSelect = (cls, sub, i) => `<select data-act=setsub data-i=${i} class="${sub ? '' : 'unset'}">${opt('', `— ${cls.subclassTitle || 'Subclass'} —`)}${subclassesOf(cls).map((s, j) => opt(j, `${s.name} (${s.source})`, sub === s)).join('')}</select>`;

// every pick the character has, as [key, html, done]: subclass, feature options, proficiency and ability picks, feats taken instead of an ASI
// the open ones feed the ⚠ next to the name; the picks overlay (see openPicks) shows them
function allPicks() {
  const R = S.R, out = [], row = (label, html) => `<div class=choice><span>${esc(label)}</span>${html}</div>`;
  R.classes.forEach((k, i) => { if (k.cls && k.level >= subclassLevel(k.cls) && subclassesOf(k.cls).length) out.push([`sub:${i}`, row(`${k.cls.name}: ${k.cls.subclassTitle || 'Subclass'}`, subclassSelect(k.cls, k.sub, i)), !!k.sub]); });
  for (const g of R.choiceGroups) if (g.options.length) out.push([`fc:${g.key}`, featureChoiceRow(g), groupDone(g)]);
  for (const s of profSources(R)) if (s.count && s.from?.length !== 0) out.push([`pc:${s.key}`, profChoiceRow(s), profDone(s)]);
  // feats whose prerequisite an edit took away (an ASI moved, a race changed): keep or remove, the player decides
  for (const f of R.feats) if (!prereqMet(f.data)) out.push([`prq:${f.key}`, row(`${f.data.name}: prerequisite no longer met`, `<button class=danger data-act=delsource data-k="${esc(f.key)}">Remove feat</button>`), false]);
  for (const [k, x] of [['race', R.subrace?.overwrite?.ability ? null : R.race], ['subrace', R.subrace], ...R.feats.map(f => [f.key, f.data])])
    if (abilityChoiceSpec(x)) out.push([`ab:${k}`, abilityChoiceUI(k, x), allPicked(cur.abilityChoices[k], abilityChoiceSpec(x).weights.length)]);
  const owed = cur.levels.filter(e => e.feat === 'owed').length;
  if (owed) out.push(['feat', row(`Feat instead of an ASI${owed > 1 ? ` (${owed})` : ''}`, '<button data-act=pick data-what=feat>Choose feat…</button>'), false]);
  // what each level-up chose: hit points (not the first level: always the maximum) and the ASI's two +1s
  cur.levels.forEach((e, n) => {
    const ci = cur.classes.findIndex(k => k.name === e.cls), cls = R.classes[ci]?.cls, l = classLevelAt(n), v = cur.classes[ci]?.hpRolls[l - 1], f = cls?.hd?.faces || 8;
    if (cls && !(ci === 0 && l === 1)) out.push([`hp:${n}`, row(`${e.cls} ${l}: hit points`, `<select data-act=lvhp data-c=${ci} data-l=${l - 1}>${opt('', `Average (${f / 2 + 1})`, v == null)}
      ${Array.from({ length: f }, (_, r) => opt(r + 1, `Rolled ${r + 1}`, v === r + 1)).join('')}</select>`), true]);
    if (e.asi) out.push([`asi:${n}`, row(`${e.cls} ${l}: Ability Score Improvement`, [0, 1].map(j => `<select data-act=lvasi data-n=${n} data-j=${j} class="${e.asi[j] ? '' : 'unset'}">
      ${opt('', '+1 to…')}${ABIL.map(a => opt(a, a.toUpperCase(), e.asi[j] === a)).join('')}</select>`).join('')), true]);
  });
  return out;
}
const pendingPicks = () => allPicks().filter(p => !p[2]);

function levelChooser() {
  if (!cur.classes.length) return '<h2>Level up</h2><p>Choose a class in Character setup first.</p><button data-act=editsetup>Open setup</button>';
  if (S.level >= 20) return '<h2>Level up</h2><p>Already at level 20.</p>';
  return `<h2>Level up</h2><p>Character level ${S.level} → ${S.level + 1}. Which class gains the level?</p>
    <div class=btns>${cur.classes.map((k, i) => `<button class=primary data-act=lvlup data-i=${i}>${esc(k.name)} ${k.level} → ${k.level + 1}</button>`).join('')}</div>
    <div class=btns><button data-act=pick data-what=class>+ Multiclass into a new class</button></div>`;
}

function actionsView() {
  const groups = [...Object.keys(GROUP), 'other'];
  const card = r => {
    const a = r.spec, i = r.stored, id = esc(a.id), stored = i != null;
    const res = stored ? S.resources.find(x => x.id === a.resource) : a.resId && S.resources.find(x => x.id === a.resId);
    const name = a.kind === 'spell' ? `<a class=ref data-tag=spell data-name="${esc(a.ref?.name)}" data-src="${esc(a.ref?.source)}">${esc(r.name)}</a>`
      : a.kind === 'weapon' ? `<a href="#" data-act=itemdetail data-id="${esc(a.ref)}">${esc(r.name)}</a>`
        : a.link ? `<a class=ref data-tag=${a.link.tag} data-name="${esc(a.link.name)}" data-src="${esc(a.link.src || '')}">${esc(r.name)}</a>` : esc(r.name);
    const maxSlot = Math.max(S.slots.length, S.pact?.level || 0);
    const useLabel = a.special === 'wildshape' ? 'Transform' : a.toggleKey ? (isOn(a.toggleKey) ? 'Active' : 'Start') : a.slot ? 'Smite' : 'Use';
    const usable = !stored && (a.resId || a.toggleKey || a.slot || a.special);
    return `<div class="act ${stored ? '' : 'derived'} ${a.toggleKey && isOn(a.toggleKey) ? 'on' : ''}"><div class=acthead><b>${name}</b>
        <small class=muted>${esc([r.range, r.props?.filter(p => p !== 'A').join(' ')].filter(Boolean).join(' · '))}</small><span class=grow></span>
        ${stored ? menu(`<button data-act=editaction data-i=${i}>Edit…</button><button class=danger data-act=delaction data-i=${i}>Remove</button>`, 'sm')
          : `<small class=badge title="Comes from a class feature, trait or Wild Shape">${a.shape ? 'beast' : 'feature'}</small>`}</div>
      ${r.error ? `<p class=warn>${esc(r.error)}</p>` : `<div class=actbtns>
        ${r.hit ? `<span>${bd(`act.${a.id}.hit`, 'Hit')}${r20(`act.${a.id}.hit`, `${r.name} attack`)}</span>` : ''}
        ${r.save ? `<span class=pill>DC ${r.save.dc} ${esc(r.save.ability)}</span>` : ''}
        ${r.dmg ? `<span>${bd(`act.${a.id}.dmg`, r.dmgType ? `${DMG_IC[r.dmgType.toLowerCase()] || ''}${esc(r.dmgType)}` : 'Dmg')}<button class=num data-act=rdmg data-k="act.${id}.dmg" data-label="${esc(r.name)}">${esc(dmgExpr(r.dmg))}</button></span>` : ''}
        ${stored && a.kind === 'spell' && r.level ? `<button class=primary data-act=castaction data-i=${i}>Cast <small>(${ORD(r.slot)} slot)</small></button>` : ''}
        ${stored && r.scales ? `<select data-path="actions.${i}.slot" data-type=num aria-label="Slot level">${[1, 2, 3, 4, 5, 6, 7, 8, 9].filter(l => l >= r.level).map(l => opt(l, `${ORD(l)} slot`, l === r.slot)).join('')}</select>` : ''}
        ${!stored && a.slot ? `<select data-path="actionSlots.${a.id}" data-type=num aria-label="Slot level">${Array.from({ length: maxSlot }, (_, l) => opt(l + 1, `${ORD(l + 1)} slot`, l + 1 === a.slot)).join('')}</select>` : ''}
        ${r.versatile ? `<label class=small><input type=checkbox data-path="actions.${i}.versatile" ${a.versatile ? 'checked' : ''}> two-handed</label>` : ''}
        ${stored && res ? `<button data-act=useres data-id="${esc(res.id)}">Use ${esc(res.name)} (${Math.max(0, res.max - res.used)})</button>` : ''}
        ${usable ? `<button class="${a.toggleKey && isOn(a.toggleKey) ? 'tog on' : 'primary'}" data-act=useaction data-id="${id}">${useLabel}${res ? ` <small>(${a.use || 1} ${esc(res.name)} · ${Math.max(0, res.max - res.used)} left)</small>` : ''}</button>` : ''}
      </div>`}${r.notes ? `<small class=muted>${esc(r.notes)}</small>` : ''}${[...(r.hit?.notes || []), ...(r.dmg?.notes || [])].map(n => `<small class=note>${esc(n)}</small>`).join('')}</div>`;
  };
  return `<section class=card>${sechead(`${IC.actions}Actions`, '<button data-act=pick data-what=weaponaction>+ Weapon</button><button data-act=pick data-what=spellaction>+ Spell</button><button data-act=newaction>+ Custom</button>')}
    ${S.attacks > 1 ? `<p class=small><b>Extra Attack:</b> the Attack action makes <b>${S.attacks}</b> attacks.</p>` : ''}
    ${groups.map(g => {
      const xs = S.actions.filter(r => (r.group || 'action') === g || (g === 'other' && !GROUP[r.group]));
      return xs.length ? `<h4>${GROUP_IC[g] || GROUP_IC.other}${GROUP[g] || 'Other'}</h4>${xs.map(card).join('')}` : '';
    }).join('')}</section>`;
}

function spellsView() {
  const known = cur.spells.map((s, i) => ({ s, i, d: find('spell', s.name, s.source) }));
  const sc = S.spellcasting.map(c => {
    const mine = known.filter(k => k.d && (k.s.cls === c.cls || S.spellcasting.length === 1));
    const lv = mine.filter(k => k.d.level > 0), can = mine.length - lv.length;
    const prep = lv.filter(k => k.s.prepared).length;
    return `<div class=sc><b>${esc(c.cls)}</b> <small class=muted>${c.ability.toUpperCase()}</small>
      ${bd(`spellDc.${c.cls}`, 'DC')} <b>${c.dc.total}</b> · ${bd(`spellAttack.${c.cls}`, 'Attack')}${r20(`spellAttack.${c.cls}`, `${c.cls} spell attack`)}
      ${c.prepared ? ` · <span class=nw>Prepared ${prep}/${c.prepared}</span>` : c.known ? ` · <span class=nw>Known ${lv.length}/${c.known}</span>` : ''}${c.cantrips ? ` · <span class=nw>Cantrips ${can}/${c.cantrips}</span>` : ''}</div>`;
  }).join('');
  const slots = S.slots.map((n, l) => `<div class=slotrow><span>${ORD(l + 1)}</span>${pips(n - (cur.slotsUsed[l] || 0), n, 'slot', `data-l=${l}`, `${ORD(l + 1)}-level slot`)}</div>`).join('')
    + (S.pact ? `<div class=slotrow><span>Pact (${ORD(S.pact.level)})</span>${pips(S.pact.n - cur.pactUsed, S.pact.n, 'pact', '', 'Pact slot')}</div>` : '');
  const byLvl = {};
  for (const k of known) (byLvl[k.d?.level ?? '?'] ||= []).push(k);
  for (const b of S.R.bonusSpells) {
    const d = find('spell', b.name);
    if (d && !known.some(k => k.d?.name === d.name)) (byLvl[d.level] ||= []).push({ s: { name: d.name, source: d.source, cls: b.cls }, d, bonus: b });
  }
  const sp = S.featureRes.find(r => r.name === 'Sorcery Points'), COST = [2, 3, 5, 6, 7];
  const font = sp ? `<div class=font><b>Font of Magic</b> <small class=muted>${sp.max - sp.used}/${sp.max} sorcery points</small>
      <div class=inline><small>Create slot:</small>${COST.map((c, l) => (l < S.slots.length ? `<button data-act=fontslot data-l=${l} ${sp.max - sp.used < c || !(cur.slotsUsed[l] > 0) ? 'disabled' : ''}>${ORD(l + 1)} (−${c})</button>` : '')).join('')}</div>
      <div class=inline><small>Slot → points:</small>${S.slots.map((n, l) => `<button data-act=fontpts data-l=${l} ${n - (cur.slotsUsed[l] || 0) <= 0 ? 'disabled' : ''}>${ORD(l + 1)} (+${l + 1})</button>`).join('')}</div></div>` : '';
  const row = ({ s, i, d, bonus }) => {
    if (!d) return `<div class=spell><span class="warn grow">${esc(s.name)} (not in rules data)</span>${menu(`<button class=danger data-act=delspell data-i=${i}>Remove</button>`, 'sm')}</div>`;
    const def = sourceDef(cur, { key: `spell:${s.name}|${s.source}`, name: s.name, kind: 'spell' }, P), ns = `data-n="${esc(d.name)}" data-s="${esc(d.source)}"`;
    const tag = bonus ? `<span class=badge title="${esc(`${bonus.kind === 'innate' ? 'Innate' : 'Always prepared'} — from ${bonus.origin}`)}">${esc(bonus.uses || (bonus.kind === 'innate' ? 'innate' : bonus.origin))}</span>` : '';
    return `<div class="spell ${bonus ? 'granted' : ''}">${bonus ? '<span class=cb title="Always prepared">★</span>' : d.level ? `<input type=checkbox title=Prepared data-path="spells.${i}.prepared" ${s.prepared ? 'checked' : ''}>` : '<span class=cb></span>'}
      <span class=grow>${link('spell', d)} <small class=muted>${esc(spellTime(d).replace(/,.*/, ''))}${isConc(d) ? ' · C' : ''}${d.meta?.ritual ? ' · R' : ''}${S.spellcasting.length > 1 ? ' · ' + esc(s.cls || '') : ''}</small> ${tag}</span>
      ${d.level ? `<button data-act=cast ${ns}>Cast</button>` : ''}
      ${def?.toggle ? togBtn({ key: `spell:${s.name}|${s.source}`, name: s.name }, 'Active') : isConc(d) ? `<button class="tog ${cur.concentration === d.name ? 'on' : ''}" data-act=conc ${ns}>Conc.</button>` : ''}
      ${menu(`<button data-act=spellaction ${ns}>Add to actions</button>${bonus ? '' : `<button class=danger data-act=delspell data-i=${i}>Remove</button>`}`, 'sm')}</div>`;
  };
  return `<section class=card>${sechead(`${IC.spells}Spellcasting`, '<button data-act=pick data-what=spell>+ Add spells</button>')}${sc || '<p class=muted>No spellcasting class.</p>'}${slots}${font}
    ${Object.keys(byLvl).sort((a, b) => a - b).map(l => `<h4>${l === '0' ? IC.cantrips + 'Cantrips' : l === '?' ? 'Unknown' : ORD(+l) + ' level'}</h4>${byLvl[l].sort((a, b) => a.s.name.localeCompare(b.s.name)).map(row).join('')}`).join('')}
  </section>`;
}

const isWeapon = d => d.weapon || ['M', 'R'].includes(code(d.type)) || !!d.dmg1;
const FX_LABEL = { ac: 'AC', 'save.all': 'saves', spellAttack: 'spell attack', spellDc: 'spell DC', 'check.all': 'checks' };
const fxSummary = list => (list || []).map(e => `${FX_LABEL[e.target] || e.target} ${e.op === 'min' ? '≥' + e.value : e.op === 'add' && typeof e.value === 'number' ? signed(e.value) : e.op}`).join(', ');
const INV_GROUPS = ['Weapons', 'Armor', 'Magic items', 'Gear'];
const invGroup = d => (isWeapon(d) ? 'Weapons' : ['LA', 'MA', 'HA', 'S'].includes(code(d.type)) ? 'Armor' : d.wondrous || (d.rarity && d.rarity !== 'none') ? 'Magic items' : 'Gear');
function inventoryView() {
  const att = cur.inventory.filter(i => i.attuned).length;
  const card = ({ inv, data }, i) => {
    const key = `inv:${inv.id}`, open = ui.open.has(key), w = isWeapon(data), equippable = w || data.armor || ['LA', 'MA', 'HA', 'S'].includes(code(data.type)) || data.reqAttune || data.wondrous || data.bonusAc || data.ability;
    const def = sourceDef(cur, { key, name: data.name, kind: 'item' }, P) || { effects: itemEffects(data) };
    const active = data.reqAttune ? inv.attuned : inv.equipped, fx = fxSummary(def.effects);
    const hasAction = cur.actions.some(a => a.ref === inv.id || a.link?.inv === inv.id);
    return `<details class="feat item ${active && fx ? 'active' : ''}" data-key="${esc(key)}" ${open ? 'open' : ''}><summary>
        <span class=grow>${esc(data.name)}${(inv.qty ?? 1) !== 1 ? ` <small class=muted>×${inv.qty}</small>` : ''} <small class=muted>${esc(itemType(data))}</small></span>
        ${fx ? `<span class=badge title="${esc(active ? 'Active' : 'Inactive until ' + (data.reqAttune ? 'attuned' : 'equipped'))}">${esc(fx)}</span>` : ''}
        ${equippable ? `<button class="tog ${inv.equipped ? 'on' : ''}" data-act=equip data-i=${i}>${inv.equipped ? 'Equipped' : 'Equip'}</button>` : ''}
        ${data.reqAttune ? `<button class="tog ${inv.attuned ? 'on' : ''}" data-act=attune data-i=${i}>${inv.attuned ? 'Attuned' : 'Attune'}</button>` : ''}
</summary>
      ${open ? `<div class=entries>${inv.custom ? '' : `<div class=meta>${itemLine(data)}</div>`}${entries(data.entries)}</div>` : ''}
      <div class=btns><label class=small>Qty <input type=number class=qty min=0 data-path="inventory.${i}.qty" value="${inv.qty ?? 1}"></label>
        ${inv.custom ? `<input data-path="inventory.${i}.name" value="${esc(inv.name)}" aria-label="Item name">
          <label class=small>lb <input type=number class=qty data-path="inventory.${i}.weight" value="${inv.weight || 0}"></label>
          <input data-path="inventory.${i}.notes" value="${esc(inv.notes || '')}" placeholder=Notes aria-label=Notes>` : ''}
        <button class="tog ${hasAction ? 'on' : ''}" data-act=itemaction data-i=${i} title="Add to actions">${hasAction ? 'In actions' : '+ Action'}</button>
        <button class=danger data-act=delitem data-i=${i}>Remove</button></div></details>`;
  };
  const cards = S.R.items.map(card);
  return `<section class=card>${sechead(`${IC.inventory}Inventory`, '<button data-act=pick data-what=item>+ Add item</button><button data-act=customitem>+ Custom item</button>')}
    <div class=coins>${['pp', 'gp', 'ep', 'sp', 'cp'].map(k => `<label>${k}<input type=number data-path="currency.${k}" value="${cur.currency[k] || 0}"></label>`).join('')}</div>
    <p class=small>Weight ${S.weight} / ${S.capacity} lb${S.weight > S.capacity ? ' <b class=warn>over capacity</b>' : ''} · Attuned ${att}/3${att > 3 ? ' <b class=warn>too many</b>' : ''}</p>
    ${INV_GROUPS.map(g => [g, cards.filter((_, i) => invGroup(S.R.items[i].data) === g)]).filter(([, xs]) => xs.length)
      .map(([g, xs]) => `<h4>${GROUP_IC[g]}${g}</h4>${xs.join('')}`).join('') || '<p class=muted>Empty.</p>'}</section>`;
}

function featuresView() {
  const groups = {};
  for (const s of S.R.sources) if (s.kind !== 'spell') (groups[s.group] ||= []).push(s);
  const card = s => {
    const def = sourceDef(cur, s, P), open = ui.open.has(s.key);
    return `<details class=feat data-key="${esc(s.key)}" ${open ? 'open' : ''}><summary><span class=grow>${esc(s.name)}</span>
        ${s.level ? `<small class=muted>Lv ${s.level}</small>` : ''}${def?.toggle ? togBtn(s, isOn(s.key) ? 'On' : 'Off') : def?.effects?.length ? '<span class=badge title="Has automatic effects">auto</span>' : ''}</summary>
      ${open ? `<div class=entries>${s.cat === 'feat' || s.cat === 'optionalfeature' ? detail(s.cat, s.data) : entries(s.data?.entries)}</div>` : ''}
      <div class=btns>${s.custom ? `<button data-act=effects data-k="${esc(s.key)}" data-n="${esc(s.name)}">Effects…</button>` : ''}<button data-act=featureaction data-k="${esc(s.key)}">Add as action</button>
        ${s.remove ? `<button class=danger data-act=delsource data-k="${esc(s.key)}">Remove</button>` : ''}
        ${s.custom ? `<button class=danger data-act=delcustom data-id="${s.custom.id}">Remove</button>` : ''}</div></details>`;
  };
  return `<section class=card>${sechead(`${IC.features}Features &amp; traits`, '<button data-act=pick data-what=feat>+ Feat</button><button data-act=pick data-what=optfeature>+ Class option</button><button data-act=addcustom>+ Custom modifier</button>')}
    ${choicesView()}
    ${Object.entries(groups).map(([g, xs]) => `<h4>${GROUP_IC[g] || (g.includes(': ') ? IC.subclass : IC.cls)}${esc(g)}</h4>${xs.map(card).join('')}`).join('') || '<p class=muted>Choose a race and class first.</p>'}
  </section>`;
}

// feature options (Totem Spirit…), option progressions (Invocations, Maneuvers…) and spell-list picks (Circle of the Land)
function choicesView() {
  const gs = S.R.choiceGroups;
  if (!gs.length) return '';
  return foldChoices('ch:features', `<div class=choices><h4>${IC.choices}Choices</h4>${gs.map(featureChoiceRow).join('')}</div>`, gs.every(groupDone));
}
function featureChoiceRow(g) {
  const picks = cur.featureChoices[g.key] || [], ok = new Set(g.options.filter(optionOk).map(o => o.value));
  return `<div class=choice><span>${esc(g.label)}: choose ${g.count}</span>${Array.from({ length: g.count }, (_, i) => `<select data-path="featureChoices.${g.key}.${i}" class="${ok.has(picks[i]) ? '' : 'unset'}">
    ${opt('', 'Choose…')}${g.options.map(o => opt(o.value, `${o.label}${picks.includes(o.value) && picks[i] !== o.value ? ' ✓' : ''}${ok.has(o.value) ? '' : ' (prerequisite not met)'}`,
      picks[i] === o.value, !ok.has(o.value) && picks[i] !== o.value)).join('')}</select>`).join('')}</div>`;
}

function companionsView() {
  const cards = cur.companions.map((cp, i) => {
    const m = find('monster', cp.name, cp.source), key = `comp:${cp.id}`, open = ui.open.has(key);
    if (!m) return `<p class=warn>${esc(cp.name)} is not in the rules data (refresh it to download creatures).</p>`;
    return `<details class="feat comp" data-key="${esc(key)}" ${open ? 'open' : ''}><summary><span class=grow>${esc(cp.nick || m.name)} <small class=muted>${cp.nick ? esc(m.name) + ' · ' : ''}CR ${esc(m.cr?.cr ?? m.cr)}</small></span>
        <span class=pill>AC ${creatureAc(m)}</span><span class="pill ${cp.hp ? '' : 'warn'}">HP ${cp.hp}/${cp.max}</span></summary>
      <div class=btns><input type=number class=qty id="comphp-${cp.id}" min=0 placeholder=HP aria-label="HP amount"><button class=danger data-act=comphp data-i=${i} data-op=dmg>Damage</button>
        <button class=ok data-act=comphp data-i=${i} data-op=heal>Heal</button><input data-path="companions.${i}.nick" value="${esc(cp.nick || '')}" placeholder="Name" aria-label=Name>
        <button class=danger data-act=delcomp data-i=${i}>Remove</button></div>
      ${open ? statblock(m) : ''}</details>`;
  }).join('');
  return `<section class=card>${sechead(`${IC.companions}Companions`, `<button data-act=pick data-what=companion ${list('monster').length ? '' : 'disabled title="Refresh the rules data to download creatures"'}>+ Add creature</button>`)}
    ${cards || '<p class=note>Familiars, animal companions, summons and mounts, with their own HP and attacks. Add one from the ⋮ menu.</p>'}</section>`;
}

function notesView() {
  return `<section class=card><h3>${IC.notes}Notes</h3>${Object.keys(cur.notes).map(k => `<label class=field><span>${NOTE_IC[k] || ''}${cap(k)}</span>
    <textarea data-path="notes.${k}" rows=${k === 'backstory' || k === 'other' ? 6 : 2}>${esc(cur.notes[k])}</textarea></label>`).join('')}</section>`;
}

function renderDice() {
  const last = ui.log[0], bar = $('#dice');
  bar.hidden = !cur && (!last || last.total != null); // home: only to show a message (e.g. examples loaded), never rolls
  if (!cur) { bar.innerHTML = last ? `<span class=last>${esc(last.label)}</span>` : ''; return; }
  const n = hist.id === cur.id ? hist.stack.length : 0;
  bar.innerHTML = `<button class=undo data-act=undo ${n ? '' : 'disabled'} title="Undo the last change (up to 3)" aria-label="Undo (${n} available)">↶<span class=undolbl> Undo</span>${n ? ` <small>${n}</small>` : ''}</button>
    <div class=modes>${[['dis', 'Dis'], ['normal', 'Normal'], ['adv', 'Adv']].map(([m, l]) => `<button class="${ui.mode === m ? 'on' : ''}" data-act=mode data-m=${m}>${IC[m] || ''}${l}</button>`).join('')}
      <button class="${ui.crit ? 'on' : ''}" data-act=crit title="Double damage dice on next damage roll">${IC.crit}Crit</button></div>
    <button class=last data-act=logtoggle>${last ? `${last.total != null ? `<b class="${last.nat === 20 ? 'nat20' : last.nat === 1 ? 'nat1' : ''}">${last.total}</b> ` : ''}${esc(last.label)} <small>${esc(last.text || '')}</small>` : '<span class=muted>Tap a number to roll</span>'}</button>
    <form class=custom data-act=customroll><input name=expr placeholder="2d6+3" aria-label="Dice expression" enterkeyhint=go><button>Roll</button></form>
    ${ui.showLog ? `<ol class=log>${ui.log.map(l => `<li>${l.total != null ? `<b>${l.total}</b> ` : ''}${esc(l.label)} <small>${esc(l.text || '')}</small></li>`).join('')}</ol>` : ''}`;
}

// ---------- dialogs ----------
function openDlg(view) {
  ui.dlg = view;
  $('#dlgBody').innerHTML = view();
  if (!$('#dlg').open) $('#dlg').showModal();
  const af = $('#dlgBody').querySelector('[autofocus]');
  af?.focus(); af?.select?.();
}
const closeDlg = () => { ui.dlg = null; if ($('#dlg').open) $('#dlg').close(); };
function showInfo(html, push = true) {
  if (push) ui.info.push(html);
  $('#infoBody').innerHTML = (ui.info.length > 1 ? '<button data-act=infoback>← Back</button>' : '') + html;
  if (!$('#info').open) $('#info').showModal();
  $('#info').scrollTop = 0;
}

// stat key -> readable name ("ability.str" -> "Strength score")
function statTitle(k) {
  const [a, b] = k.split('.'), rest = k.slice(a.length + 1);
  if (a === 'act') return `${S.actions.find(r => r.spec.id === k.slice(4, k.lastIndexOf('.')))?.name || 'Action'} ${k.endsWith('.hit') ? 'attack' : 'damage'}`;
  return { ac: 'Armor Class', initiative: 'Initiative', speed: 'Speed', prof: 'Proficiency bonus', hpMax: 'Hit point maximum' }[k]
    || { ability: `${ABIL_NAME[b]} score`, check: `${ABIL_NAME[b]} check`, save: `${ABIL_NAME[b]} saving throw`, skill: titleCase(rest), passive: `Passive ${titleCase(rest)}`,
      spellDc: `${rest} spell save DC`, spellAttack: `${rest} spell attack` }[a] || k;
}
function breakdownView(k) {
  const s = S.stats[k];
  if (!s) return '<p>Nothing to show.</p>';
  const d20 = !k.startsWith('act.') || k.endsWith('.hit');
  const plain = ['ac', 'speed', 'hpMax', 'prof'].includes(k) || k.startsWith('passive.') || k.startsWith('ability.') || k.startsWith('spellDc.') || k.endsWith('.dmg');
  // a plain value starts from a base (score, armor, walking speed): show that one unsigned
  return `<h2>${esc(statTitle(k))}</h2><table class=bd>${s.parts.map((p, i) => `<tr><td>${esc(p.label)}</td><td>${plain && !i && !k.endsWith('.dmg') ? p.value : signed(p.value)}</td></tr>`).join('')}
    ${s.dice.map((d, i) => `<tr><td>${esc(s.diceSrc?.[i] || 'Dice')}</td><td>+${esc(d)}</td></tr>`).join('')}<tr class=total><td>Total</td><td>${s.total}${s.dice.length ? ' + ' + esc(s.dice.join(' + ')) : ''}</td></tr></table>
    ${s.candidates ? `<p class=small><b>AC options:</b> ${esc(s.candidates.join(' · '))}</p>` : ''}
    ${s.adv.length ? `<p class=small><b>Advantage:</b> ${esc(s.adv.join(', '))}</p>` : ''}${s.dis.length ? `<p class=small><b>Disadvantage:</b> ${esc(s.dis.join(', '))}</p>` : ''}
    ${s.notes.map(n => `<p class=note>${esc(n)}</p>`).join('')}
    ${k.startsWith('act.') ? '' : `<label class=field><span>Manual override (blank = computed)</span><input type=number data-path="overrides.${k}" value="${esc(cur.overrides[k] ?? '')}"></label>`}
    ${!plain && d20 ? `<button class=primary data-act=r20 data-k="${esc(k)}" data-label="${esc(statTitle(k))}">Roll</button>` : ''}`;
}

// generic picker: cfg.items() -> [{x, cat}]
const PICK = {
  race: { title: 'Choose race', items: () => list('race').map(x => ({ x, cat: 'race' })), sub: x => `${x.source} · ${abilityText(x)}`,
    pick: x => { cur.race = refOf(x); cur.subrace = null; cur.abilityChoices.race = []; clearChoices('race'); clearChoices('subrace'); closeDlg(); } },
  background: { title: 'Choose background', items: () => list('background').map(x => ({ x, cat: 'background' })),
    pick: x => { cur.background = refOf(x); clearChoices('background'); cur.kitChoices = {}; grantKit(); closeDlg(); } },
  class: { title: 'Add class', items: () => list('class').filter(c => !cur.classes.some(k => k.name === c.name)).map(x => ({ x, cat: 'class' })),
    pick: x => { cur.classes.push({ name: x.name, source: x.source, level: 0, hpRolls: [], subclass: null }); levelUp(cur.classes.length - 1); } },
  feat: { title: 'Add feat', items: () => list('feat').map(x => ({ x, cat: 'feat' })), has: x => cur.feats.some(f => f.name === x.name && f.source === x.source),
    sub: x => `${x.source}${prereqMet(x) ? '' : ' · prerequisite not met'}`,
    pick: x => {
      cur.feats.push(refOf(x));
      const owed = cur.levels.findLast(e => e.feat === 'owed');
      if (owed) owed.feat = refOf(x);
      if (ui.picks) ui.dlg = picksView; // back to the remaining choices (the feat's own picks among them)
    } },
  optfeature: { title: 'Add class option', items: () => list('optionalfeature').map(x => ({ x, cat: 'optionalfeature' })),
    sub: x => `${x.featureType.map(t => OPT_TYPE[t] || t).join(', ')} · ${x.source}${prereqMet(x) ? '' : ' · prerequisite not met'}`, has: x => cur.optionalFeatures.some(f => f.name === x.name && f.source === x.source),
    pick: x => { cur.optionalFeatures.push(refOf(x)); } },
  item: { title: 'Add item', items: () => [...list('baseitem').map(x => ({ x, cat: 'baseitem' })), ...list('item').map(x => ({ x, cat: 'item' })), ...list('magicvariant').map(x => ({ x, cat: 'magicvariant' }))],
    sub: (x, cat) => `${cat === 'magicvariant' ? 'Magic variant — pick a base item' : itemType(x)}${x.rarity && x.rarity !== 'none' ? ' · ' + x.rarity : ''} · ${x.source}`,
    pick: (x, cat) => {
      if (cat !== 'magicvariant') return addItem({ name: x.name, source: x.source });
      ui.pick = { kind: 'variantbase', q: '', variant: x };
    } },
  variantbase: { title: () => `${ui.pick.variant.name}: choose base item`, items: () => variantBases(ui.pick.variant).map(x => ({ x, cat: 'baseitem' })),
    pick: x => { const v = ui.pick.variant; addItem({ name: `${v.inherits?.namePrefix || ''}${x.name}${v.inherits?.nameSuffix || ''}`, source: v.source, variant: v.name, base: refOf(x) }); ui.pick = { kind: 'item', q: '' }; } },
  weaponaction: { title: 'Attack with…', items: () => S.R.items.filter(i => isWeapon(i.data)).map(i => ({ x: { ...i.data, invId: i.inv.id }, cat: 'item' })),
    pick: x => { addAction({ kind: 'weapon', ref: x.invId, group: 'action', ability: 'auto', prof: 'auto' }); closeDlg(); } },
  spellaction: { title: 'Cast as action…', items: () => cur.spells.map(s => ({ x: find('spell', s.name, s.source), cat: 'spell', s })).filter(i => i.x),
    pick: (x, cat, it) => { addSpellAction(it.s); closeDlg(); } },
  spell: { title: 'Add spells', items: spellPickItems, sub: x => `${spellLevel(x)} · ${x.source}`, has: x => cur.spells.some(s => s.name === x.name && s.source === x.source),
    filters: () => {
      const lists = [...new Set(S.spellcasting.map(c => c.list))];
      return `<div class=inline><select data-path="@pick.cls">${lists.map(l => opt(l, `${l} list`, ui.pick.cls === l)).join('')}
        ${S.R.spellBooks.map(b => opt(b.id, b.label, ui.pick.cls === b.id)).join('')}${opt('all', 'All spells', ui.pick.cls === 'all')}</select>
        <select data-path="@pick.lvl">${opt('castable', 'Castable levels', ui.pick.lvl === 'castable')}${opt('all', 'All levels', ui.pick.lvl === 'all')}
        ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => opt(l, l ? ORD(l) : 'Cantrip', ui.pick.lvl === String(l))).join('')}</select></div>`;
    },
    pick: x => {
      const bk = S.R.spellBooks.find(b => b.id === ui.pick.cls);
      const sc = (bk ? S.spellcasting.find(c => c.cls === bk.cls) : S.spellcasting.find(c => c.list === ui.pick.cls)) || S.spellcasting[0];
      cur.spells.push({ name: x.name, source: x.source, cls: sc?.cls || '', prepared: false });
    } },
  wildshape: {
    title: () => { const w = wildShapeLimits(); return `Wild Shape — beasts up to CR ${crText(w.cr)}${w.fly ? '' : w.swim ? ', no flying speed' : ', no flying or swimming speed'}${w.elemental ? ', or an elemental (2 uses)' : ''}`; },
    items: () => {
      const w = wildShapeLimits();
      return list('monster').filter(m => (creatureType(m) === 'beast' && crNum(m.cr) <= w.cr && (w.fly || !m.speed?.fly) && (w.swim || !m.speed?.swim)) || (w.elemental && ELEMENTALS.includes(m.name) && m.source === 'MM'))
        .sort((a, b) => crNum(b.cr) - crNum(a.cr) || a.name.localeCompare(b.name)).map(x => ({ x, cat: 'monster' }));
    },
    sub: x => `CR ${x.cr?.cr ?? x.cr} · AC ${creatureAc(x)} · HP ${x.hp?.average} · ${speedText(x.speed)}`,
    pick: x => {
      if (!spend('f:Wild Shape', ELEMENTALS.includes(x.name) ? 2 : 1)) return;
      cur.shape = { name: x.name, source: x.source, hp: x.hp?.average || 1, max: x.hp?.average || 1 };
      toast(`Transformed into ${x.name}`);
      closeDlg();
    } },
  prof: { title: () => `Add ${PROF_KINDS[ui.pick.k].toLowerCase()}`, noInfo: true, sub: () => '',
    items: () => profSuggest(ui.pick.k).map(p => ({ x: { name: titleCase(p), source: '', p }, cat: 'prof' })), has: x => !!S.profs[ui.pick.k][x.p],
    pick: x => { (cur.extraProfs[ui.pick.k] ||= []).push(x.p); } },
  companion: { title: 'Add companion, familiar or summon', items: () => list('monster').slice().sort((a, b) => a.name.localeCompare(b.name)).map(x => ({ x, cat: 'monster' })),
    sub: x => `${creatureType(x)} · CR ${x.cr?.cr ?? x.cr} · ${x.source}${x.summonedBySpell ? ' · summoned by ' + x.summonedBySpell.split('|')[0] : ''}`,
    pick: x => { cur.companions.push({ id: uid(), name: x.name, source: x.source, hp: x.hp?.average || 1, max: x.hp?.average || 1 }); closeDlg(); } },
  lookup: {
    title: 'Look up rules', browse: () => ui.pick.off.size > 0, // a narrowed filter lists everything in it without typing
    items: () => {
      const p = ui.pick, all = search(p.q);
      p.counts = {};
      for (const h of all) p.counts[GROUP_OF[h.cat]] = (p.counts[GROUP_OF[h.cat]] || 0) + 1;
      return all.filter(h => !p.off.has(GROUP_OF[h.cat]));
    },
    filters: () => `<div class="inline lkf">${SEARCH_GROUPS.map(([g]) => `<button class="tog ${ui.pick.off.has(g) ? '' : 'on'} ${ui.pick.counts[g] ? '' : 'none'}" data-act=lookupf data-g="${esc(g)}">${LOOKUP_IC[g] || ''}${esc(g)} <small>${ui.pick.counts[g] || 0}</small></button>`).join('')}
      <button class=tog data-act=lookupf data-g="*">All</button><button class=tog data-act=lookupf data-g="-">None</button></div>
      <small class=note>Filled = searched. Tap a category to switch it on or off.</small>`,
    sub: (x, cat) => `${CAT_LABEL[cat]} · ${cat === 'monster' ? `CR ${x.cr?.cr ?? x.cr ?? '—'} ${creatureType(x)} · ` : cat === 'spell' ? spellLevel(x) + ' · ' : x.className ? x.className + ' · ' : ''}${x.source}`,
    pick: (x, cat) => showInfo(detail(cat, x)), keepOpen: true },
};
function spellPickItems() {
  const p = ui.pick, max = Math.max(S.slots.length, S.pact?.level || 0);
  let xs = list('spell');
  const bk = S.R.spellBooks.find(b => b.id === p.cls);
  if (bk) xs = xs.filter(s => bk.names.has(s.name.toLowerCase()) || bk.filters.some(f => spellMatches(s, f)));
  else if (p.cls !== 'all') {
    const extra = new Set(S.R.classes.filter(k => k.sub && (k.cls?.name === p.cls || S.spellcasting.find(c => c.cls === k.cls?.name)?.list === p.cls)).flatMap(k => [...subclassSpellNames(k.sub)]));
    xs = xs.filter(s => spellClasses(s).includes(p.cls) || extra.has(s.name.toLowerCase()));
  }
  if (p.lvl === 'castable') { if (!bk || bk.cls) xs = xs.filter(s => s.level <= max); } // feat/race lists set their own levels, slots or not
  else if (p.lvl !== 'all') xs = xs.filter(s => s.level === +p.lvl);
  return xs.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)).map(x => ({ x, cat: 'spell' }));
}
const GROUP_OF = Object.fromEntries(SEARCH_GROUPS.flatMap(([g, cats]) => cats.map(c => [c, g])));

function pickerView() {
  const p = ui.pick, cfg = PICK[p.kind], q = p.q.trim();
  let xs = cfg.items();
  // same matching and ranking as the lookup; ties keep the picker's own order (spells by level)
  if (q && p.kind !== 'lookup') xs = xs.map(i => [i, matchScore(i.x.name, q)]).filter(([, s]) => s >= 0).sort((a, b) => a[1] - b[1]).map(([i]) => i);
  else if (!q && xs.length > 400 && !cfg.browse?.()) xs = [];
  const total = xs.length;
  p.results = xs = xs.slice(0, 250);
  return `<h2>${esc(typeof cfg.title === 'function' ? cfg.title() : cfg.title)}</h2>
    <input class=search type=search data-path="@pick.q" value="${esc(p.q)}" placeholder="${p.kind === 'lookup' ? 'Spells, items, creatures, rules…' : 'Search…'}" enterkeyhint=search autofocus
      title="Enter opens the first result; ↓ moves into the list">${cfg.filters?.() || ''}
    <div class=plist>${xs.map(({ x, cat }, i) => {
      const has = cfg.has?.(x);
      return `<div class=prow><button class=grow data-act=pickrow data-i=${i} ${has ? 'disabled' : ''}>${esc(x.name)}${has ? ' ✓' : ''} <small class=muted>${esc(cfg.sub?.(x, cat) ?? x.source)}</small></button>
        ${cfg.noInfo ? '' : `<button class=icon data-act=info data-cat=${cat} data-name="${esc(x.name)}" data-src="${esc(x.source)}" title=Details>i</button>`}</div>`;
    }).join('') || `<p class=muted>${q ? 'No matches.' : p.kind === 'lookup' ? 'Type to search, or tap None and then a category to browse it.' : 'Type to search.'}</p>`}
    ${total > xs.length ? `<p class="muted small">Showing ${xs.length} of ${total}: type more or narrow the filters.</p>` : ''}</div>`;
}
function openPicker(kind, extra = {}) {
  ui.pick = { kind, q: '', ...extra };
  openDlg(pickerView);
}

const clearChoices = src => { for (const k of Object.keys(cur.profChoices)) if (k.split(':').slice(1).join(':').split('#')[0] === src) delete cur.profChoices[k]; };
// Mundane containers (packs, "Arrows (20)") are unpacked into their contents; magic ones (Deck of Many Things) stay whole.
// Returns [{id, qty}] of the inventory entries it added to (the background kit uses it to take them back).
function addItem(ref, qty = 1, silent = false) {
  const x = !ref.variant && !ref.custom && (find('item', ref.name, ref.source) || find('baseitem', ref.name, ref.source));
  if (x?.packContents && (!x.rarity || x.rarity === 'none')) {
    const out = [];
    for (const p of x.packContents) {
      const n = (typeof p === 'object' && p.quantity || 1) * qty;
      if (typeof p === 'object' && p.special) { out.push(...addItem({ custom: true, name: cap(p.special), weight: 0, notes: `From ${x.name}` }, n, true)); continue; }
      const [name, src] = (typeof p === 'string' ? p : p.item).split('|'), y = find('item', name, src) || find('baseitem', name, src);
      out.push(...addItem(y ? { name: y.name, source: y.source } : { custom: true, name: cap(name), weight: 0, notes: `From ${x.name}` }, n, true));
    }
    if (!silent) { toast(`Unpacked ${x.name} into ${x.packContents.length} items`); commit(); }
    return out;
  }
  // one entry per thing: same item (or same-named custom item) stacks
  const stack = cur.inventory.find(i => !i.variant && i.name === ref.name && (ref.custom ? i.custom : !i.custom && i.source === ref.source));
  if (stack) stack.qty = (stack.qty ?? 1) + qty;
  else cur.inventory.push({ id: uid(), qty, equipped: false, attuned: false, ...ref });
  if (!silent) { toast(`Added ${ref.name}`); commit(); }
  return [{ id: (stack || cur.inventory.at(-1)).id, qty }];
}

// ---------- background starting equipment ----------
// startingEquipment: [{_: [always…], a: [...], b: [...]}]; entries are "item|src", {item, quantity, containsValue}, {special}, {value} (cp),
// or {equipmentType} (any artisan's tool / instrument / gaming set). Picks live in cur.kitChoices; what was added is kept in cur.bgKit.
const EQUIP_TYPE = { toolArtisan: 'AT', instrumentMusical: 'INS', setGaming: 'GS' };
const TYPE_LABEL = { toolArtisan: "artisan's tools", instrumentMusical: 'musical instrument', setGaming: 'gaming set' };
const typeItems = t => list('item').concat(list('baseitem')).filter(x => code(x.type) === EQUIP_TYPE[t] && (!x.rarity || x.rarity === 'none'))
  .sort((a, b) => a.name.localeCompare(b.name));
// each group: the always-part plus the picked alternative, as [[listKey, entries], …]; choice keys are "t<group>.<listKey>.<index>"
const kitGroups = bg => (bg?.startingEquipment || []).map((g, i) => {
  const opts = Object.keys(g).filter(k => k !== '_'), pick = cur.kitChoices?.[`g${i}`] || opts[0];
  return { i, opts: opts.map(k => [k, g[k]]), pick, lists: [['_', g._ || []], ...(pick ? [[pick, g[pick]]] : [])] };
});
function kitTypePick(t, key) {
  if (cur.kitChoices?.[key]) return cur.kitChoices[key];
  const prof = cur.profChoices['tool:background'] || [], x = typeItems(t).find(y => prof.includes(y.name.toLowerCase())); // default: the tool you're proficient with
  return x ? `${x.name}|${x.source}` : '';
}
const kitLabel = e => (typeof e === 'string' ? cap(e.split('|')[0]) : e.value ? `${e.value / 100} gp` : e.equipmentType ? `any ${TYPE_LABEL[e.equipmentType]}`
  : `${e.quantity > 1 ? e.quantity + ' ' : ''}${e.displayName || cap((e.item || e.special).split('|')[0])}${e.containsValue ? ` (${e.containsValue / 100} gp)` : ''}`);
function revokeKit() {
  const k = cur.bgKit;
  if (!k) return;
  for (const { id, qty } of k.items) {
    const i = cur.inventory.findIndex(x => x.id === id);
    if (i < 0) continue;
    cur.inventory[i].qty = (cur.inventory[i].qty ?? 1) - qty;
    if (cur.inventory[i].qty <= 0) { cur.inventory.splice(i, 1); cur.actions = cur.actions.filter(a => a.ref !== id && a.link?.inv !== id); }
  }
  for (const [c, n] of Object.entries(k.coins)) cur.currency[c] = Math.max(0, (cur.currency[c] || 0) - n);
  cur.bgKit = null;
}
function grantKit() {
  revokeKit();
  const bg = cur.background && find('background', cur.background.name, cur.background.source);
  if (!bg?.startingEquipment) return;
  // not in the rules data (vestments, "holy symbol") → custom entry; a long display name goes to its notes
  const items = [], ref = (n, s, shown) => { const x = find('item', n, s) || find('baseitem', n, s); return x ? refOf(x) : { custom: true, name: cap(n), weight: 0, notes: [shown, `From ${bg.name}`].filter(Boolean).join(' · ') }; };
  let cp = 0;
  for (const g of kitGroups(bg)) for (const [lk, entries] of g.lists) entries.forEach((e, n) => {
    if (typeof e === 'string') return items.push(...addItem(ref(...e.split('|')), 1, true));
    cp += (e.value || 0) + (e.containsValue || 0);
    if (e.equipmentType) { const [name, src] = kitTypePick(e.equipmentType, `t${g.i}.${lk}.${n}`).split('|'); if (name) items.push(...addItem({ name, source: src }, 1, true)); }
    else if (e.item) items.push(...addItem(ref(...e.item.split('|'), e.displayName), e.quantity || 1, true));
    else if (e.special) items.push(...addItem(ref(e.special), e.quantity || 1, true));
  });
  const coins = { gp: Math.floor(cp / 100), sp: Math.floor((cp % 100) / 10), cp: cp % 10 };
  for (const [c, n] of Object.entries(coins)) cur.currency[c] = (cur.currency[c] || 0) + n;
  cur.bgKit = { bg: `${bg.name}|${bg.source}`, items, coins };
}
function kitView(bg) {
  const gs = kitGroups(bg);
  if (!gs.length) return '';
  const sel = (e, key) => {
    const v = kitTypePick(e.equipmentType, key);
    return `<select data-act=kittype data-k="${key}" class="${v ? '' : 'unset'}">${opt('', `Choose ${TYPE_LABEL[e.equipmentType]}…`)}${typeItems(e.equipmentType).map(x => opt(`${x.name}|${x.source}`, x.name, v === `${x.name}|${x.source}`)).join('')}</select>`;
  };
  const done = cur.bgKit?.bg === `${bg.name}|${bg.source}`;
  return `<div class=kit><small class=muted>${IC.kit}Starting equipment</small>
    ${gs.map(g => `<div class=small>${g.lists[0][1].map((e, n) => (e.equipmentType ? sel(e, `t${g.i}._.${n}`) : esc(kitLabel(e)))).join(', ')}
      ${g.opts.length ? `<div class=inline><select data-act=kitopt data-g=${g.i}>${g.opts.map(([k, l]) => opt(k, l.map(kitLabel).join(', '), g.pick === k)).join('')}</select>
        ${g.lists[1][1].map((e, n) => (e.equipmentType ? sel(e, `t${g.i}.${g.pick}.${n}`) : '')).join('')}</div>` : ''}</div>`).join('')}
    ${done ? `<small class=muted>In your inventory${cur.bgKit.coins.gp ? ` · ${cur.bgKit.coins.gp} gp added` : ''}. Changing the background or a choice swaps it.</small>`
      : '<button data-act=grantkit>Add starting equipment</button>'}</div>`;
}
function addAction(a) {
  cur.actions.push({ id: uid(), ...a });
  commit();
}
function addSpellAction(s) {
  const d = find('spell', s.name, s.source);
  addAction({ kind: 'spell', ref: { name: s.name, source: s.source }, cls: s.cls, slot: d?.level || null });
}

function levelUp(i) {
  // picks already open stay optional; S still predates a class just added, so its first-level picks count as new
  ui.lu = { i, asi: {}, feat: false, before: new Set(pendingPicks().map(p => p[0])) };
  openDlg(() => {
    const k = cur.classes[i], cls = find('class', k.name, k.source);
    if (!cls) return '<p>Class not found.</p>';
    const next = k.level + 1, f = cls.hd?.faces || 8, first = i === 0 && k.level === 0, sub = findSubclass(cls, k.subclass);
    const feats = [...classFeatures(cls, next).filter(x => x.level === next), ...(sub ? subclassFeatures(cls, sub, next).filter(x => x.level === next) : [])];
    const asi = feats.some(x => x.name === 'Ability Score Improvement'), subLvl = next === subclassLevel(cls) && subclassesOf(cls).length;
    // Done takes the level once every choice on this screen is made (the first level always takes the maximum hit die)
    const hp = first ? 'max' : ui.lu.hp, ready = hp && !(asi && !ui.lu.feat && asiLeft()) && !(subLvl && !sub);
    return `<h2>${esc(cls.name)} ${k.level} → ${next}</h2>
      <div class=choice><span>Hit points</span>${first ? `<b>Maximum hit die (${f})</b>`
        : `<select data-path="@lu.hp" class="${hp ? '' : 'unset'}">${opt('', 'Choose…')}${opt('avg', `Average (${f / 2 + 1})`, hp === 'avg')}${opt('roll', `Roll d${f}`, hp === 'roll')}</select>`}</div>
      ${subLvl ? `<div class=choice><span>${esc(cls.subclassTitle || 'Subclass')}</span>${subclassSelect(cls, sub, i)}</div>` : ''}
      ${asi ? asiView() : ''}
      <h3>New at level ${next}</h3><ul>${feats.map(x => `<li><a class=ref data-tag=${x.subclassShortName ? 'subclassFeature' : 'classFeature'} data-name="${esc(x.name)}" data-src="">${esc(x.name)}</a></li>`).join('') || '<li>No new features.</li>'}</ul>
      <div class=btns><button class=primary data-act=lu data-v="${hp || ''}" ${ready ? '' : 'disabled'}>Done</button></div>`;
  });
}
// ASI points still to spend: 2, less what's spent and what no score can take (max 20)
const asiLeft = () => Math.min(2 - Object.values(ui.lu.asi).reduce((a, b) => a + b, 0), ABIL.reduce((n, a) => n + Math.max(0, 20 - S.scores[a] - (ui.lu.asi[a] || 0)), 0));

// ---------- level history (setup panel): what each level-up gave; any level can be edited, the latest undone ----------
const classLevelAt = n => cur.levels.slice(0, n + 1).filter(e => e.cls === cur.levels[n].cls).length; // the class level entry n reached
function levelsView() {
  if (!cur.levels.length) return '';
  return `<div class=levels><small class=muted>Level-ups</small>${cur.levels.map((e, n) => {
    const ci = cur.classes.findIndex(k => k.name === e.cls), k = S.R.classes[ci], l = classLevelAt(n), f = k?.cls?.hd?.faces || 8, v = k?.hpRolls[l - 1];
    const asi = e.asi && ABIL.filter(a => e.asi.includes(a)).map(a => `${a.toUpperCase()} +${e.asi.filter(x => x === a).length}`).join(', ');
    const parts = [`HP ${ci === 0 && l === 1 ? `${f} (max)` : v == null ? `${f / 2 + 1} (avg)` : `${v} (rolled)`}`, k?.cls && l === subclassLevel(k.cls) && k.sub?.name,
      asi && `ASI ${asi}`, e.feat && `Feat: ${e.feat === 'owed' ? 'not chosen' : e.feat.name}`,
      // the sheet's features of that level: unchosen options (Totem Spirit's other animals) are already left out
      ...S.R.sources.filter(s => /^[cs]f:/.test(s.key) && s.cls === e.cls && s.level === l && s.name !== 'Ability Score Improvement' && s.name !== k?.sub?.name).map(s => s.name)];
    return `<div class=lvrow><b>${n + 1}</b><span class=grow>${esc(e.cls)} ${l} <small class=muted>${esc(parts.filter(Boolean).join(' · '))}</small></span>
      <button data-act=lvedit data-n=${n}>Edit…</button>${n === cur.levels.length - 1 ? `<button class=danger data-act=lvundo>Undo</button>` : ''}</div>`;
  }).join('')}</div>`;
}
// pick keys (with counts) the rules offer a character: feature options, proficiency picks, subclass
function pickCounts(c) {
  const R = resolve(c);
  return new Map([...R.choiceGroups.map(g => [`fc:${g.key}`, g.count]), ...profSources(R).filter(s => s.count).map(s => [`pc:${s.key}`, s.count]),
    ...R.classes.flatMap((k, i) => (k.cls && k.level >= subclassLevel(k.cls) ? [[`sub:${i}`, 1]] : []))]);
}
// the picks level n brought: what its class offers at that level but not the one before (a grown count counts too),
// its hit points and ASI, the feat taken instead and that feat's own picks
function levelKeys(n) {
  const e = cur.levels[n], ci = cur.classes.findIndex(k => k.name === e.cls), l = classLevelAt(n);
  const at = lv => pickCounts({ ...cur, classes: cur.classes.map((k, j) => (j === ci ? { ...k, level: lv } : k)) });
  const now = at(l), prev = at(l - 1), keys = new Set([`hp:${n}`, `asi:${n}`]), src = ci ? `mc:${e.cls}` : 'class';
  for (const [key, c] of now) if (c > (prev.get(key) || 0) || (l === 1 && key.startsWith('pc:') && key.split(':').slice(2).join(':').split('#')[0] === src)) keys.add(key);
  if (e.feat === 'owed') keys.add('feat');
  else if (e.feat) for (const [key] of allPicks()) if (key.includes(`feat:${e.feat.name}|${e.feat.source}`)) keys.add(key);
  return keys;
}
// 5etools prerequisites: any one entry of the list, with every condition in it; ones the sheet can't judge (campaign, item, prose) pass
// ponytail: judged on the character now, so a feat's own +1 can count toward its prerequisite; per-level snapshots if that matters
function prereqMet(x) {
  if (!x?.prerequisite || !S) return true;
  const R = S.R, low = v => String(v).split('|')[0].replace(/#c$/, '').toLowerCase();
  const has = n => R.sources.some(s => s.name.toLowerCase() === low(n));
  const spells = new Set([...cur.spells, ...R.bonusSpells].map(sp => sp.name.toLowerCase()));
  const casts = () => S.spellcasting.length > 0;
  const test = {
    level: v => (typeof v === 'number' ? S.level : v.class ? R.classes.find(k => k.cls?.name === v.class.name)?.level || 0 : S.level) >= (v.level ?? v),
    ability: v => v.some(o => Object.entries(o).every(([a, n]) => S.scores[a] >= n)),
    race: v => v.some(r => low(R.race?.name || '') === low(r.name) && (!r.subrace || low(R.subrace?.name || '').includes(low(r.subrace)))),
    proficiency: v => v.some(o => Object.entries(o).every(([k, n]) => S.profs[k]?.[n])),
    spellcasting: casts, spellcastingFeature: casts, spellcasting2020: () => casts() || R.bonusSpells.length > 0,
    pact: v => has(`pact of the ${v}`),
    spell: v => v.every(sp => typeof sp !== 'string' || spells.has(low(sp))),
    optionalfeature: v => v.every(has), feature: v => v.every(has),
    feat: v => v.every(n => cur.feats.some(f => f.name.toLowerCase() === low(n))),
    background: v => v.some(b => low(b.name) === low(R.background?.name || '')),
  };
  return x.prerequisite.some(p => Object.entries(p).every(([k, v]) => !test[k] || test[k](v)));
}
// a change to the levels (new, edited or undone) moves current HP with the maximum, CON changes across all levels included; returns the change
function keepHpGap(change) {
  const m0 = S.hpMax;
  change();
  S = compute();
  if (cur.hp.current != null) cur.hp.current = Math.max(0, cur.hp.current + S.hpMax - m0);
  return S.hpMax - m0;
}
// undo the latest level-up: its hit points, ASI or feat, the class level (and subclass or class with it); the picks it brought go when it's saved (prunePicks)
function undoLevel() {
  const e = cur.levels.pop(), ci = cur.classes.findIndex(k => k.name === e.cls), k = cur.classes[ci];
  if (k) {
    const cls = find('class', k.name, k.source), f = cls?.hd?.faces || 8;
    if (cur.hitDiceUsed[f]) cur.hitDiceUsed[f] = Math.min(cur.hitDiceUsed[f], S.hitDice[f] - 1);
    k.level--;
    k.hpRolls.length = k.level;
    if (!cls || k.level < subclassLevel(cls)) k.subclass = null;
    if (!k.level) cur.classes.splice(ci, 1);
  }
  const fi = e.feat && e.feat !== 'owed' ? cur.feats.findLastIndex(f => f.name === e.feat.name && f.source === e.feat.source) : -1;
  if (fi >= 0) cur.feats.splice(fi, 1);
  toast(`Undid level ${cur.levels.length + 1} (${e.cls} ${(k?.level ?? 0) + 1})`);
}

// overlay holding just the picks to make: { title, note, keys, only, lock }, opened by the ⚠ next to the name, after a level-up and by a level's Edit
// keys: () => the rows it covers, made or not (a level's Edit); otherwise the open picks passing only(key) (default: all)
// lock: it won't close while any of its picks is open
function openPicks(o) { ui.picks = { ...o, shown: new Set() }; openDlg(picksView); }
// a pick stays listed once it's been shown, so it can still be changed until Done; ones a change creates (a feat's or new subclass's picks) join in
function picksRows() {
  const o = ui.picks, all = allPicks();
  if (o.keys) for (const k of o.keys()) o.shown.add(k);
  else for (const [k, , done] of all) if (!done && (!o.only || o.only(k))) o.shown.add(k);
  return all.filter(([k]) => o.shown.has(k));
}
function picksView() {
  const { title, note, lock } = ui.picks, xs = picksRows();
  return `<h2>${esc(title)}</h2>${xs.length ? `${note ? `<p>${esc(note)}</p>` : ''}${xs.map(p => p[1]).join('')}` : '<p>Nothing to choose.</p>'}
    <div class=btns><button class=primary data-act=closedlg ${lock && xs.some(p => !p[2]) ? 'disabled' : ''}>Done</button></div>`;
}

function asiView() {
  const used = Object.values(ui.lu.asi).reduce((a, b) => a + b, 0);
  return `<h3>Ability Score Improvement</h3>
    <label class=small><input type=checkbox data-path="@lu.feat" ${ui.lu.feat ? 'checked' : ''}> Take a feat instead (picked after Done)</label>
    ${ui.lu.feat ? '' : `<p class=small>Spend 2 points (max 20): <b>${2 - used}</b> left. <button data-act=asireset>Reset</button></p>
    <div class=btns>${ABIL.map(a => {
      const now = S.scores[a] + (ui.lu.asi[a] || 0);
      return `<button data-act=asi data-a=${a} ${used >= 2 || now >= 20 ? 'disabled' : ''}>${a.toUpperCase()} ${now}${ui.lu.asi[a] ? ` (+${ui.lu.asi[a]})` : ''}</button>`;
    }).join('')}</div>`}`;
}

function effectsEditor() {
  const e = ui.edit;
  return `<h2>Effects: ${esc(e.name)}</h2>
    ${e.custom ? `<label class=field><span>Name</span><input data-path="@edit.name" value="${esc(e.name)}"></label>` : ''}
    <label class=small><input type=checkbox data-path="@edit.toggle" ${e.toggle ? 'checked' : ''}> Toggleable (switch on the sheet) — otherwise always on</label>
    <datalist id=targets>${TARGETS.map(t => `<option value="${t}">`).join('')}</datalist>
    <div class=fx><span>Target</span><span>Op</span><span>Value</span><span>When</span><span></span>
    ${e.effects.map((x, i) => `<input list=targets data-path="@edit.effects.${i}.target" value="${esc(x.target)}" aria-label=Target>
      <select data-path="@edit.effects.${i}.op">${['add', 'set', 'min', 'mul', 'adv', 'dis', 'note', 'dice'].map(o => opt(o, o, x.op === o)).join('')}</select>
      <input data-path="@edit.effects.${i}.value" value="${esc(x.value ?? '')}" placeholder="2, 1d4, mod.int" aria-label=Value>
      <input data-path="@edit.effects.${i}.when" value="${esc([].concat(x.when || []).join(' '))}" placeholder="noArmor" aria-label=When>
      <button class=icon data-act=fxdel data-i=${i}>✕</button>`).join('')}</div>
    <p class=small muted>Value: number, dice (1d4), or formula with mod.X, score.X, prof, level, level.wizard, max(), floor(). For op "dice" write the count, e.g. ceil(level.rogue/2), and it rolls d6s. When: space-separated, any of: ${WHEN}.</p>
    <div class=btns><button data-act=fxadd>+ Effect</button><button class=primary data-act=fxsave>Save</button></div>`;
}

// i == null: a new resource drafted in ui.edit, added only on "Add resource"
function resEditor(i) {
  const r = i == null ? ui.edit : cur.resources[i], p = f => (i == null ? `@edit.${f}` : `resources.${i}.${f}`);
  return `<h2>${i == null ? 'New resource' : 'Resource'}</h2><label class=field><span>Name</span><input data-path="${p('name')}" value="${esc(r.name)}" placeholder="e.g. Bardic Inspiration" autofocus></label>
    <label class=field><span>Maximum uses</span><input data-path="${p('max')}" value="${esc(r.max)}">
      <small class=note>A number, or a formula such as level.monk or max(1,mod.cha)</small></label>
    <label class=field><span>Resets on</span><select data-path="${p('reset')}">${['short', 'long', 'never'].map(x => opt(x, x === 'never' ? 'never' : `${x} rest`, r.reset === x)).join('')}</select></label>
    <div class=btns>${i == null ? '<button class=primary data-act=saveres>Add resource</button>' : `<button class=danger data-act=delres data-r=${i}>Delete</button>`}</div>`;
}
const resMax = (r, vars = S?.vars || {}) => Math.max(0, ev(r.max, vars));
const resGet = id => S.resources.find(r => r.id === id);
const resSet = (id, used) => { if (id.startsWith('f:')) cur.featureUses[id] = used; else cur.resources.find(r => r.id === id).used = used; };
function spend(id, n) {
  const r = resGet(id);
  if (!r) return true;
  if (r.max - r.used < n) { toast(`Not enough ${r.name} (${r.max - r.used} left)`); return false; }
  resSet(id, r.used + n);
  return true;
}
function spendSlot(l) {
  if ((S.slots[l - 1] || 0) - (cur.slotsUsed[l - 1] || 0) > 0) cur.slotsUsed[l - 1] = (cur.slotsUsed[l - 1] || 0) + 1;
  else if (S.pact && S.pact.level >= l && cur.pactUsed < S.pact.n) cur.pactUsed++;
  else { toast(`No ${ORD(l)}-level slot left`); return false; }
  return true;
}
// Wild Shape limits by druid level; Circle of the Moon raises CR and adds elementals at 10th
function wildShapeLimits() {
  const lvl = S.vars['level.druid'] || 0, has = n => S.R.sources.some(x => x.name === n), moon = has('Circle Forms');
  return { cr: moon ? (lvl >= 6 ? Math.floor(lvl / 3) : 1) : lvl >= 8 ? 1 : lvl >= 4 ? 0.5 : 0.25, swim: lvl >= 4, fly: lvl >= 8, elemental: has('Elemental Wild Shape') };
}
const crText = n => (n === 0.25 ? '1/4' : n === 0.5 ? '1/2' : n === 0.125 ? '1/8' : String(n));
const ELEMENTALS = ['Air Elemental', 'Earth Elemental', 'Fire Elemental', 'Water Elemental'];

function actionEditor(i) {
  const a = cur.actions[i], p = f => `actions.${i}.${f}`;
  const inp = (f, label, ph = '') => `<label class=field><span>${label}</span><input data-path="${p(f)}" value="${esc(a[f] ?? '')}" placeholder="${ph}"></label>`;
  const abil = (f, extra) => `<select data-path="${p(f)}">${extra.map(x => opt(x, x, a[f] === x)).join('')}${ABIL.map(x => opt(x, x.toUpperCase(), a[f] === x)).join('')}</select>`;
  return `<h2>Edit action</h2>${inp('name', 'Name (blank = default)')}
    <label class=field><span>Type</span><select data-path="${p('group')}">${Object.entries(GROUP).map(([k, l]) => opt(k, l, a.group === k)).join('')}${opt('other', 'Other', a.group === 'other')}</select></label>
    ${a.kind === 'weapon' ? `<label class=field><span>Ability</span>${abil('ability', ['auto'])}</label>
      <label class=field><span>Proficient</span><select data-path="${p('prof')}" data-type=json>${opt('"auto"', 'auto', a.prof === 'auto')}${opt('true', 'yes', a.prof === true)}${opt('false', 'no', a.prof === false)}</select></label>` : ''}
    ${a.kind === 'spell' ? `<label class=field><span>Casting class</span><select data-path="${p('cls')}">${S.spellcasting.map(c => opt(c.cls, c.cls, a.cls === c.cls)).join('')}</select></label>` : ''}
    ${a.kind === 'custom' ? `<label class=field><span>Attack ability</span>${abil('ability', ['none'])}</label>
      <label class=small><input type=checkbox data-path="${p('prof')}" ${a.prof ? 'checked' : ''}> Proficient</label>
      <label class=small><input type=checkbox data-path="${p('unarmed')}" ${a.unarmed ? 'checked' : ''}> Unarmed strike (1 + mod, or a die from Martial Arts, claws, Unarmed Fighting…)</label>
      ${inp('dice', 'Damage dice', '1d8')}<label class=small><input type=checkbox data-path="${p('addMod')}" ${a.addMod ? 'checked' : ''}> Add ability mod to damage</label>
      ${inp('dmgType', 'Damage type')}${inp('saveDc', 'Save DC (formula)', '8+prof+mod.wis')}${inp('saveAbility', 'Save ability', 'DEX')}${inp('range', 'Range', '5 ft')}` : ''}
    ${inp('toHit', 'Extra to-hit (number/formula)', '0')}${inp('dmgBonus', 'Extra damage (number, formula or dice)', '0')}${inp('notes', 'Notes')}
    <label class=field><span>Uses resource</span><select data-path="${p('resource')}">${opt('', '— none —')}${cur.resources.map(r => opt(r.id, r.name, a.resource === r.id)).join('')}</select></label>`;
}

function castView(n, src) {
  const d = find('spell', n, src), at = `data-n="${esc(d.name)}" data-s="${esc(d.source)}"`;
  const lv = S.slots.map((n, l) => ({ l: l + 1, left: n - (cur.slotsUsed[l] || 0) })).filter(x => x.l >= d.level && x.left > 0);
  const pact = S.pact && S.pact.level >= d.level && cur.pactUsed < S.pact.n;
  const innate = S.R.bonusSpells.find(b => b.name.toLowerCase() === d.name.toLowerCase() && b.kind === 'innate');
  return `<h2>Cast ${esc(d.name)}</h2>${lv.map(x => `<button data-act=castat ${at} data-l=${x.l}>${ORD(x.l)} level (${x.left} left)</button>`).join(' ')}
    ${pact ? `<button data-act=castat ${at} data-l=pact>Pact slot (${ORD(S.pact.level)})</button>` : ''}
    ${innate ? `<button data-act=castat ${at} data-l=innate>Innate (${esc(innate.uses || 'at will')})</button>` : ''}
    ${!lv.length && !pact && !innate ? '<p class=warn>No slots left.</p>' : ''}${d.meta?.ritual ? `<button data-act=castat ${at} data-l=ritual>As ritual (no slot)</button>` : ''}`;
}

// after a slot is spent: concentration, the spell's on/off toggle, the log line
function castDone(d, how) {
  if (isConc(d)) setConc(d.name);
  const key = `spell:${d.name}|${d.source}`;
  if (sourceDef(cur, { key, name: d.name, kind: 'spell' }, P)?.toggle && !isOn(key)) cur.activeToggles.push(key);
  toast(`Cast ${d.name}${how}`);
}

// quotes, backslashes and line breaks would end url('…') early
const cssUrl = u => String(u).replace(/['"\\\n\r]/g, c => `%${c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`); // encodeURIComponent leaves ' alone
const renameView = () => `<h2>Rename</h2><label class=field><span>Name</span><input id=newname value="${esc(cur.name)}" autofocus></label>
  <div class=btns><button class=primary data-act=renamesave>Save</button><button data-act=closedlg>Cancel</button></div>`;
const imageView = (msg = '') => `<h2>Character image</h2>
  ${cur.image ? `<img class=imgprev src="${esc(cur.image)}" alt="Current image">` : '<p class=small>Showing the class art. Pick a picture of your own below.</p>'}
  <label class=field><span>Picture link</span><input id=imgurl type=url placeholder="https://…" value="${esc(cur.image?.startsWith('http') ? cur.image : '')}" autofocus></label>
  <div class=btns><button class=primary data-act=imglink>Use link</button>
    <label class=btn>Upload picture…<input type=file accept="image/*" data-act=imgfile hidden></label>
    ${cur.image ? '<button class=danger data-act=imgreset>Back to class art</button>' : ''}</div>
  ${msg ? `<p class=warn>${esc(msg)}</p>` : ''}<p class=note>Uploads are shrunk and saved with the character (and in its JSON export). Linked pictures are cached after the first view, so they also work offline.</p>`;
// uploads: longest side ≤ 900 px; PNGs stay PNG (token art is often transparent), everything else becomes JPEG
async function shrinkImage(file, max = 900) {
  const bmp = await createImageBitmap(file), k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
}

function shortRestView() {
  return `<h2>Short rest</h2><p>Spend hit dice to heal (adds CON mod ${signed(S.vars['mod.con'])}).</p>
    ${Object.entries(S.hitDice).map(([f, n]) => `<button data-act=spendhd data-f=${f} ${n - (cur.hitDiceUsed[f] || 0) <= 0 ? 'disabled' : ''}>Spend d${f} (${n - (cur.hitDiceUsed[f] || 0)}/${n} left)</button>`).join(' ')}
    <p>HP ${S.hp} / ${S.hpMax}</p><div class=btns><button class=primary data-act=finishshort>Finish short rest</button></div>
    <p class=small muted>Finishing restores pact slots and resources that reset on a short rest.</p>`;
}

// ---------- concentration + toggles ----------
function setConc(name) {
  const old = cur.concentration;
  if (old && old !== name) cur.activeToggles = cur.activeToggles.filter(k => !k.startsWith(`spell:${old}|`));
  cur.concentration = name;
}
function toggle(k) {
  if (isOn(k)) {
    cur.activeToggles = cur.activeToggles.filter(x => x !== k);
    if (k.startsWith('spell:') && cur.concentration === k.slice(6).split('|')[0]) cur.concentration = null;
  } else {
    if (k.startsWith('spell:')) {
      const [n, s] = k.slice(6).split('|'), d = find('spell', n, s);
      if (d && isConc(d)) setConc(d.name);
    }
    cur.activeToggles.push(k);
  }
}

// ---------- rolling ----------
function doRoll(expr, label, { d20 = false, adv = false, dis = false } = {}) {
  if (d20) { adv ||= ui.mode === 'adv'; dis ||= ui.mode === 'dis'; }
  const r = roll(expr, { adv: d20 && adv && !dis, dis: d20 && dis && !adv, crit: !d20 && ui.crit });
  if (!d20 && ui.crit) ui.crit = false;
  ui.log.unshift({ label, total: r.total, text: label === expr ? r.text : `${expr}: ${r.text}`, nat: d20 ? r.d20 : null });
  ui.log.length = Math.min(ui.log.length, 40);
  renderDice();
  rollFx(r, label, d20 ? r.d20 : null);
  return r;
}

// Every die is tossed up from the dice bar, bounces off the screen edges and settles on its face. Then, all at once, the other dice
// dash into the primary one, the die advantage/disadvantage discards greys out and sinks, and the flat bonus pops up beside it and
// smacks into it: the primary die bumps to the final total. Done within 1s; fades out by 4s (the bar keeps the result).
// [outline, facet lines] per die, in a 100×100 box, drawn like the app icon (the d20 is the icon's)
const DIE_SVG = { 4: ['M50 7 94 87H6Z', 'M50 7v52M6 87l44-28 44 28'],
  6: ['M22 8h56a14 14 0 0 1 14 14v56a14 14 0 0 1-14 14H22A14 14 0 0 1 8 78V22A14 14 0 0 1 22 8Z', 'M24 24h52v52H24ZM12 12l12 12M88 12 76 24M88 88 76 76M12 88l12-12'],
  8: ['M50 5 95 50 50 95 5 50Z', 'M50 5 24 62h52ZM5 50l19 12M95 50 76 62M24 62l26 33 26-33'],
  10: ['M50 4 96 45 50 96 4 45Z', 'M50 4 27 53l23 14 23-14ZM4 45l23 8M96 45l-23 8M50 67v29'],
  12: ['M50 5 95 38 78 93H22L5 38Z', 'M50 27 74 45 65 74H35L26 45ZM50 5v22M95 38 74 45M78 93 65 74M22 93 35 74M5 38l21 7'],
  20: ['M50 4 91 28v44L50 96 9 72V28Z', 'M50 4 26 60h48ZM9 28l17 32M91 28 74 60M26 60l24 36 24-36'] };
const dieSvg = f => { const [o, l] = DIE_SVG[f] || DIE_SVG[f === 100 ? 10 : 6]; return `<svg viewBox="0 0 100 100"><path class=r d="${o}"/><path class=o d="${o}"/><path d="${l}"/></svg>`; };
let fxStop = () => {};
function rollFx(r, label, nat) {
  fxStop();
  // ponytail: at most 12 dice on screen (a crit 40d6 would bury the sheet); the total still counts them all
  const shown = r.dice.slice(0, 12), p = Math.max(0, shown.findIndex(d => !d.drop));
  if (!shown.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const dice = [shown[p], ...shown.filter((_, i) => i !== p)]; // [primary, ...the rest]
  const n = dice.length, R = n > 6 ? 22 : n > 3 ? 26 : 30, T = 520, bar = $('#dice'), rnd = Math.random; // die radius (px), flight time (ms)
  const lo = R + 4, hx = innerWidth - R - 4, hy = (bar.hidden ? innerHeight : bar.getBoundingClientRect().top) - R - 4; // walls for die centres
  const el = document.createElement('div');
  el.className = 'rollfx'; el.popover = 'manual'; el.ariaHidden = 'true'; // popover: top layer, so it also shows over open dialogs
  el.style.setProperty('--d', `${2 * R}px`);
  el.innerHTML = dice.map(d => `<div class=fxdie><div class=fxface data-f=${d.f}>${dieSvg(d.f)}<b></b></div></div>`).join('') + `<small class=fxlabel>${esc(label)}</small>`;
  document.body.append(el); el.showPopover?.();
  const cap = el.lastChild, timers = [], later = (f, ms) => timers.push(setTimeout(f, ms));
  let raf;
  const stop = () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout); el.remove(); if (fxStop === stop) fxStop = () => {}; };
  fxStop = stop;

  // Where they land: the primary left of centre (room for the bonus on its right), the rest in a sunflower spiral around it, off its right side.
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ex = lo + (hx - lo) * (n > 1 ? .3 + .25 * rnd() : .15 + .35 * rnd()), ey = lo + (hy - lo) * (.3 + .3 * rnd()), ends = [[ex, ey]];
  for (let k = 1; ends.length < n; k++) {
    const a = k * 2.4 + 2, d = R * (2.25 + 1.25 * Math.sqrt(k - 1));
    if (Math.cos(a) < .5) ends.push([clamp(ex + d * Math.cos(a), lo, hx), clamp(ey + d * Math.sin(a), lo, hy)]);
  }
  // Each flight is a straight line folded at the walls: each fold is a bounce. Start on the bottom edge and pick the mirror image
  // of the landing spot whose unfolded path is closest to D px long.
  const fold = (u, l, h) => { const L = 2 * (h - l), m = ((u - l) % L + L) % L; return l + Math.min(m, L - m); };
  const seg = (u, l, h) => Math.floor((u - l) / (h - l)); // changes at each bounce
  const imgs = (e, l, h) => [-2, -1, 0, 1, 2].flatMap(k => [e + 2 * k * (h - l), 2 * l - e + 2 * k * (h - l)]);
  const fx = dice.map((d, i) => {
    const node = el.children[i], [x, y] = ends[i], sx = lo + (hx - lo) * rnd(), sy = hy - 1, D = (hx + hy) * (.5 + .2 * rnd());
    let best = [x, y], bs = Infinity;
    for (const ux of imgs(x, lo, hx)) for (const uy of imgs(y, lo, hy)) {
      const sc = Math.abs(Math.hypot(ux - sx, uy - sy) - D) + 150 * rnd();
      if (uy < sy - R && sc < bs) { bs = sc; best = [ux, uy]; }
    }
    return { d, node, face: node.firstChild, num: node.firstChild.lastChild, val: d.sign * d.v, x, y, sx, sy, vx: best[0] - sx, vy: best[1] - sy,
      T: i ? T - 80 * rnd() : T, spin: (rnd() < .5 ? -1 : 1) * 720 + (rnd() - .5) * 30, hit: { x: [0, -1e9], y: [0, -1e9] },
      seen: { x: seg(sx, lo, hx), y: seg(sy, lo, hy) }, lastNum: -1e9, done: false };
  });
  const [P] = fx, pos = o => `${o.x - R}px ${o.y - R}px`;
  const squash = ([a, ti], t) => a * .4 * Math.exp((ti - t) / 50) * Math.cos((t - ti) / 17); // a spring: squash, slight stretch, settle
  let t0;
  el.animate({ opacity: [0, 1] }, 90);
  const frame = now => {
    t0 ??= now;
    for (const o of fx) if (!o.done) {
      const t = Math.min(now - t0, o.T), k = 1 - t / o.T, s = 1 - k ** 3; // speed ∝ k²: rolls to a smooth stop exactly at T
      const ux = o.sx + o.vx * s, uy = o.sy + o.vy * s, x = fold(ux, lo, hx), y = fold(uy, lo, hy);
      for (const [ax, u, h] of [['x', ux, hx], ['y', uy, hy]]) if (seg(u, lo, h) !== o.seen[ax]) { o.seen[ax] = seg(u, lo, h); o.hit[ax] = [k * k + .15, t]; }
      const hop = k ** 1.5 * Math.abs(Math.cos(Math.PI * 2.5 * t / o.T)), z = 1 + .35 * hop; // little hops off the table, from a high toss
      const qx = squash(o.hit.x, t), qy = squash(o.hit.y, t);
      o.node.style.translate = `${x - R}px ${y - R}px`;
      o.node.style.scale = `${z * (1 - qx + qy / 2)} ${z * (1 - qy + qx / 2)}`;
      o.node.style.filter = `drop-shadow(${3 + 9 * hop}px ${5 + 14 * hop}px ${2 + 7 * hop}px rgb(60 30 10 / ${.4 - .2 * hop}))`;
      o.face.style.rotate = `${o.spin * s}deg`;
      if (t > .8 * o.T) o.num.textContent = o.val;
      else if (now - o.lastNum > 45 + 120 * (t / o.T) ** 2) { o.lastNum = now; o.num.textContent = 1 + Math.floor(rnd() * o.d.f); } // faces flicker, slowing down
      if (t === o.T) { o.done = true; land(o); }
    }
    if (!P.done) raf = requestAnimationFrame(frame); // the primary lands last
  };
  raf = requestAnimationFrame(frame);

  const land = o => {
    o.node.style.scale = '';
    o.node.animate({ scale: [1, '1.15 .85', '.95 1.05', 1] }, { duration: 220, easing: 'ease-out' });
    o.num.animate({ scale: [1.35, 1] }, { duration: 200, easing: 'cubic-bezier(.3,1.6,.5,1)' });
    if (o !== P) return;
    if (P.d.f === 20) { P.node.classList.toggle('fx20', nat === 20); P.node.classList.toggle('fx1', nat === 1); }
    later(merge, 30);
  };
  const merge = () => {
    const rest = fx.slice(1), adding = rest.some(o => !o.d.drop);
    for (const o of rest) {
      if (o.d.drop) { // discarded by advantage/disadvantage: greys out and sinks away
        o.node.classList.add('fxdrop');
        o.node.animate({ translate: [pos(o), `${o.x - R}px ${o.y - R + 14}px`], scale: [1, .55], opacity: [1, 0] }, { duration: 380, easing: 'ease-in', fill: 'forwards' });
        continue;
      }
      const dx = o.x - P.x, dy = o.y - P.y, l = Math.hypot(dx, dy) || 1;
      o.node.animate([ // pulls back a little, then dashes into the primary and vanishes behind it
        { translate: pos(o), scale: 1, easing: 'ease-out' },
        { translate: `${o.x - R + 8 * dx / l}px ${o.y - R + 8 * dy / l}px`, scale: 1.08, offset: .3, easing: 'cubic-bezier(.6,0,1,.6)' },
        { translate: pos(P), scale: .5, opacity: 1, offset: .94 },
        { translate: pos(P), scale: .4, opacity: 0 },
      ], { duration: 240, fill: 'forwards' });
    }
    if (r.flat) bonus();
    if (r.flat || adding) later(clash, 225); else later(caption, 200);
  };
  const gap = 22;
  const bonus = () => {
    const b = el.appendChild(document.createElement('b'));
    b.className = 'fxbonus'; b.textContent = signed(r.flat);
    const w = b.offsetWidth, h = b.offsetHeight;
    b.style.translate = `${P.x + R + gap}px ${P.y - h / 2}px`;
    b.animate([
      { transform: 'scale(0) rotate(-30deg)', opacity: 0, easing: 'cubic-bezier(.3,1.7,.6,1)' }, // pop up
      { transform: 'scale(1) rotate(0)', opacity: 1, offset: .38, easing: 'ease-out' },
      { transform: 'translateX(8px) scale(1.06, .94)', offset: .56, easing: 'cubic-bezier(.6,0,1,.5)' }, // wind up, then charge
      { transform: `translateX(${-gap - 3}px) scale(.75, 1.2)`, offset: .75, easing: 'ease-out' }, // smack
      { transform: `translateX(${-gap - w / 2}px) scale(.3)`, opacity: 0 }, // ...and melts into the die
    ], { duration: 300, fill: 'forwards' });
  };
  const clash = () => {
    P.num.textContent = r.total;
    P.node.animate(r.flat ? { translate: [pos(P), `${P.x - R - 9}px ${P.y - R}px`, pos(P)], scale: [1, '.8 1.16', '1.07 .94', 1] } // knocked by the bonus
      : { scale: [1, 1.22, .92, 1] }, { duration: 200, easing: 'ease-out' }); // swells with the merged dice
    P.num.animate({ scale: [1.9, .9, 1], textShadow: ['0 0 10px #ffd76a, 0 0 4px #ffd76a', '0 1px 0 rgb(0 0 0 / .4)'] }, { duration: 220, easing: 'ease-out' });
    const cx = r.flat ? P.x + R * .85 : P.x, r0 = r.flat ? 5 : R * .8; // sparks fly from the bonus's point of impact, or all round the die
    const ring = el.appendChild(document.createElement('i'));
    ring.className = 'fxring'; ring.style.translate = `${cx}px ${P.y}px`;
    ring.animate({ scale: r.flat ? [.2, 1.5] : [1, 3.2], opacity: [.9, 0] }, { duration: 260, easing: 'ease-out', fill: 'forwards' });
    for (let i = 0; i < 8; i++) {
      const sp = el.appendChild(document.createElement('i')), a = i * Math.PI / 4 + rnd() * .5, d = r0 + 13 + 12 * rnd();
      sp.className = 'fxspark'; sp.style.translate = `${cx}px ${P.y}px`;
      sp.animate({ transform: [`rotate(${a}rad) translateX(${r0}px) scaleX(1)`, `rotate(${a}rad) translateX(${d}px) scaleX(.1)`], opacity: [1, 0] },
        { duration: 260, easing: 'cubic-bezier(.2,.8,.4,1)', fill: 'forwards' });
    }
    later(caption, 90);
  };
  const caption = () => {
    cap.style.translate = `${P.x}px ${P.y + R + 6}px`;
    cap.animate({ opacity: [0, 1], transform: ['translate(-50%, -5px)', 'translate(-50%, 0)'] }, { duration: 200, easing: 'ease-out', fill: 'forwards' });
  };
  later(() => el.animate({ opacity: [1, 0] }, { duration: 450, easing: 'ease-in', fill: 'forwards' }).finished.then(stop, stop), 3550);
}

const stableNote = () => { if (cur.deathSaves.s >= 3) toast('Stable: unconscious at 0 HP until healed'); };

// ---------- actions (event handlers) ----------
const idx = el => +el.dataset.i;
const ACT = {
  jump: el => document.querySelector(`[data-blk=${el.dataset.b}]`)?.scrollIntoView({ behavior: 'smooth' }),
  bd: el => openDlg(() => breakdownView(el.dataset.k)),
  r20: el => { const s = S.stats[el.dataset.k]; if (s) doRoll(hitExpr(s), el.dataset.label || el.dataset.k, { d20: true, adv: s.adv.length > 0, dis: s.dis.length > 0 }); },
  rdmg: el => { const s = S.stats[el.dataset.k]; if (s) doRoll(dmgExpr(s), `${el.dataset.label} damage`); },
  mode: el => { ui.mode = el.dataset.m; renderDice(); },
  crit: () => { ui.crit = !ui.crit; renderDice(); },
  logtoggle: () => { ui.showLog = !ui.showLog; renderDice(); },
  info: el => showInfo(detail(el.dataset.cat, find(el.dataset.cat, el.dataset.name, el.dataset.src))),
  infoback: () => { ui.info.pop(); showInfo(ui.info.at(-1), false); },
  lookup: () => openPicker('lookup', { off: new Set(), q: ui.lastQ || '' }), // every category on; reopens on the last search, selected so typing replaces it
  lookupf: el => {
    const off = ui.pick.off, g = el.dataset.g;
    if (g === '*') off.clear(); else if (g === '-') SEARCH_GROUPS.forEach(([x]) => off.add(x)); else off.has(g) ? off.delete(g) : off.add(g);
    renderDlg();
  },
  home: () => { location.hash = ''; },
  undo: () => {
    const s = hist.stack.pop();
    if (!s) return;
    Object.assign(hist, { base: s, key: null });
    const c = JSON.parse(s);
    chars[chars.indexOf(cur)] = c; cur = c;
    save(); toast(`Undone (${hist.stack.length} more available)`); render();
  },

  // home
  newchar: () => { const c = newChar(); chars.push(c); cur = c; save(); ui.focusName = true; location.hash = c.id; },
  dup: el => { const c = { ...structuredClone(chars.find(x => x.id === el.dataset.id)), id: uid() }; c.name += ' (copy)'; chars.push(c); db.put('characters', c); render(); },
  delchar: el => {
    const c = chars.find(x => x.id === el.dataset.id);
    if (!confirm(`Delete ${c.name}? This cannot be undone (export first if unsure).`)) return;
    chars = chars.filter(x => x !== c); db.del('characters', c.id); render();
  },
  export: el => {
    const c = chars.find(x => x.id === el.dataset.id), a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' }));
    a.download = `${c.name.replace(/[^\w-]+/g, '_')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  import: async el => {
    for (const f of el.files) {
      try {
        const data = JSON.parse(await f.text());
        for (const c of [].concat(data)) {
          if (!c || typeof c !== 'object' || !c.name) throw Error('not a character file');
          const n = normalize(c);
          if (chars.some(x => x.id === n.id)) n.id = uid();
          chars.push(n); await db.put('characters', n);
        }
      } catch (e) { alert(`Import of ${f.name} failed: ${e.message}`); }
    }
    el.value = '';
    render();
  },
  download: async el => {
    const base = $('#base').value.trim(), prog = $('#prog');
    if (!base) { prog.innerHTML = '<p class=warn>Paste the GitHub link of the data repository first.</p>'; return; }
    el.disabled = true;
    try {
      const out = await downloadRules(base, (d, n, f) => { prog.innerHTML = `<progress value=${d} max=${n}></progress> <small>${esc(f)}</small>`; });
      await db.put('rules', out, 'all');
      setRules(out);
      // keep the class pictures for offline use (subclass pictures are cached by sw.js the first time they show)
      globalThis.caches?.open('dndcm-art').then(c => c.addAll(Object.entries(out.art).filter(([k]) => k.startsWith('class|')).map(([, p]) => imgUrl(p)).filter(Boolean))).catch(() => {});
      navigator.storage?.persist?.();
      render();
    } catch (e) {
      prog.innerHTML = `<p class=warn>Download failed: ${esc(e.message)}. Check the connection and repository link.</p>`;
      el.disabled = false;
    }
  },

  // setup
  pick: el => openPicker(el.dataset.what, el.dataset.what === 'spell' ? { cls: S.spellcasting[0]?.list || S.R.spellBooks[0]?.id || 'all', lvl: 'castable' } : { k: el.dataset.k }),
  pickrow: el => {
    const it = ui.pick.results[idx(el)], cfg = PICK[ui.pick.kind];
    cfg.pick(it.x, it.cat, it);
    if (cfg.keepOpen) return;
    save(); render();
    if ($('#dlg').open && ui.dlg === pickerView) renderDlg();
  },
  setsubrace: el => {
    const race = S.R.race, subs = list('subrace').filter(s => s.raceName === race.name && s.raceSource === race.source), s = subs[+el.value];
    cur.subrace = s ? { name: s.name, source: s.source } : null;
    cur.abilityChoices.subrace = [];
    clearChoices('subrace');
    commit();
  },
  setsub: el => { const k = cur.classes[idx(el)], cls = S.R.classes[idx(el)].cls, s = subclassesOf(cls)[+el.value]; keepHpGap(() => { k.subclass = s ? refOf(s) : null; }); commit(); },
  lu: el => {
    const k = cur.classes[ui.lu.i], cls = find('class', k.name, k.source), f = cls.hd?.faces || 8, v = el.dataset.v;
    const roll = v === 'roll' ? doRoll(`1d${f}`, `${k.name} hit points`).total : null, asi = Object.entries(ui.lu.asi).flatMap(([a, n]) => Array(n).fill(a));
    const gain = keepHpGap(() => {
      k.hpRolls[k.level] = roll;
      k.level++;
      cur.levels.push({ cls: k.name, ...(ui.lu.feat ? { feat: 'owed' } : asi.length && { asi }) });
    });
    toast(`${k.name} level ${k.level}: +${gain} HP`);
    commit();
    // the picks this level added (feature options, subclass, expertise, the feat…); reuse the open dialog, closing first would race its close event
    const before = ui.lu.before;
    openPicks({ title: `${k.name} level ${k.level}: choices`, note: 'Make these choices to finish the level.', only: key => !before.has(key), lock: true });
    if (ui.lu.feat) openPicker('feat');
    else if (!picksRows().length) closeDlg();
  },
  method: el => {
    const m = cur.abilityMethod = el.dataset.m;
    if (m === 'array') { cur.abilityAssign = Object.fromEntries(ABIL.map((a, i) => [a, i])); syncPool(); }
    if (m === 'roll') { if (!cur.rolledPool) rollPool(); syncPool(); }
    if (m === 'pointbuy') for (const a of ABIL) cur.baseScores[a] = 8;
    commit();
  },
  rollpool: () => { rollPool(); syncPool(); commit(); },
  assign: el => {
    const a = el.dataset.a, i = +el.value, asg = cur.abilityAssign, other = ABIL.find(b => b !== a && asg[b] === i);
    if (other) asg[other] = asg[a]; // swap
    asg[a] = i;
    syncPool(); commit();
  },
  pb: el => { const a = el.dataset.a; cur.baseScores[a] = Math.min(15, Math.max(8, cur.baseScores[a] + +el.dataset.d)); commit(); },
  setupdone: () => { cur.setupDone = true; commit(); },
  editsetup: () => { cur.setupDone = false; closeDlg(); commit(); scrollTo({ top: 0, behavior: 'smooth' }); },
  levelchooser: () => openDlg(levelChooser),
  lvedit: el => {
    const n = +el.dataset.n;
    openPicks({ title: `Level ${n + 1}: ${cur.levels[n].cls} ${classLevelAt(n)}`, keys: () => levelKeys(n) });
  },
  lvundo: () => {
    const n = cur.levels.length - 1;
    if (confirm(`Undo level ${n + 1} (${cur.levels[n].cls} ${classLevelAt(n)})? Its hit points, ASI or feat, subclass and choices are removed.`)) { keepHpGap(undoLevel); commit(); }
  },
  lvhp: el => { keepHpGap(() => { cur.classes[+el.dataset.c].hpRolls[+el.dataset.l] = el.value ? +el.value : null; }); commit(); }, // blank = average
  lvasi: el => { keepHpGap(() => { cur.levels[+el.dataset.n].asi[+el.dataset.j] = el.value || null; }); commit(); },
  openpicks: () => openPicks({ title: 'Choices to make' }),
  lvlup: el => levelUp(idx(el)),
  asi: el => { ui.lu.asi[el.dataset.a] = (ui.lu.asi[el.dataset.a] || 0) + 1; renderDlg(); },
  asireset: () => { ui.lu.asi = {}; renderDlg(); },
  skillprof: el => {
    const k = el.dataset.s, st = S.stats[`skill.${k}`], next = (st.proficient + 1) % 3;
    if (next <= st.derived && st.derived) toast(`${cap(k)}: granted by ${st.sources.join(', ')}`);
    cur.skillProfs[k] = next > st.derived ? next : 0;
    commit();
  },
  saveprof: el => {
    const a = el.dataset.a, st = S.stats[`save.${a}`];
    if (st.derived) { toast(`${ABIL_NAME[a]} save is granted by your class or a feat`); return; }
    cur.saveProfs[a] = !cur.saveProfs[a]; commit();
  },

  // status
  hp: el => {
    const v = +$('#hpamt').value || 0, op = el.dataset.op, max = S.hpMax;
    let hp = S.hp;
    if (!v) return;
    if (cur.shape && op !== 'temp') { // damage/healing go to the beast first; excess damage carries over when it drops to 0
      if (op === 'heal') { cur.shape.hp = Math.min(cur.shape.max, cur.shape.hp + v); return commit(); }
      const t = Math.min(cur.hp.temp, v);
      cur.hp.temp -= t; cur.shape.hp -= v - t;
      if (cur.concentration) toast(`Concentration (${cur.concentration}): CON save DC ${Math.max(10, Math.floor(v / 2))}`);
      if (cur.shape.hp > 0) return commit();
      const over = -cur.shape.hp;
      toast(`${cur.shape.name} drops to 0 HP: you revert${over ? ` and take ${over} damage` : ''}`);
      cur.shape = null;
      hp = Math.max(0, hp - over);
      cur.hp.current = hp >= max ? null : hp;
      return commit();
    }
    if (op === 'dmg') {
      const t = Math.min(cur.hp.temp, v);
      // damage at 0 HP: one failed death save, and a stable character starts saving again
      if (hp === 0 && v > t) cur.deathSaves = { s: cur.deathSaves.s >= 3 ? 0 : cur.deathSaves.s, f: Math.min(3, cur.deathSaves.f + 1) };
      cur.hp.temp -= t; hp = Math.max(0, hp - (v - t));
      if (cur.concentration) toast(`Concentration (${cur.concentration}): CON save DC ${Math.max(10, Math.floor(v / 2))}`);
    } else if (op === 'heal') { if (hp === 0) cur.deathSaves = { s: 0, f: 0 }; hp = Math.min(max, hp + v); } else cur.hp.temp = Math.max(cur.hp.temp, v);
    cur.hp.current = hp >= max ? null : hp;
    commit();
  },
  ds: el => { const w = el.dataset.w, i = idx(el); cur.deathSaves[w] = i < cur.deathSaves[w] ? i : i + 1; stableNote(); commit(); },
  deathroll: () => {
    const r = doRoll('1d20', 'Death save', { d20: true }).total;
    if (r === 20) { cur.hp.current = 1; cur.deathSaves = { s: 0, f: 0 }; } else if (r === 1) cur.deathSaves.f = Math.min(3, cur.deathSaves.f + 2);
    else if (r >= 10) cur.deathSaves.s = Math.min(3, cur.deathSaves.s + 1); else cur.deathSaves.f = Math.min(3, cur.deathSaves.f + 1);
    stableNote(); commit();
  },
  addcond: el => { if (el.value) cur.conditions.push(el.value); commit(); },
  cond: el => { cur.conditions = cur.conditions.filter(c => c !== el.dataset.n); commit(); },
  dropconc: () => { setConc(null); commit(); },
  toggle: el => { toggle(el.dataset.k); commit(); },
  addres: () => { ui.edit = { name: '', max: 1, reset: 'long' }; openDlg(() => resEditor(null)); },
  saveres: () => { cur.resources.push({ id: uid(), used: 0, ...ui.edit, name: ui.edit.name.trim() || 'Resource' }); closeDlg(); commit(); },
  editres: el => { const i = cur.resources.findIndex(r => r.id === el.dataset.id); openDlg(() => resEditor(i)); },
  delres: el => { cur.resources.splice(+el.dataset.r, 1); closeDlg(); commit(); },
  respip: el => { const r = resGet(el.dataset.id), left = r.max - r.used, i = idx(el); resSet(r.id, r.max - (i < left ? i : i + 1)); commit(); },
  resstep: el => { const r = resGet(el.dataset.id); resSet(r.id, Math.max(0, Math.min(r.max, r.used + +el.dataset.d))); commit(); },
  useres: el => { spend(el.dataset.id, 1); commit(); },
  // feature actions: spend the resource / slot, switch the toggle on, roll self-targeted dice (healing, inspiration…)
  useaction: el => {
    const r = S.actions.find(x => x.spec.id === el.dataset.id), a = r.spec;
    if (a.toggleKey && isOn(a.toggleKey)) { toggle(a.toggleKey); return commit(); }
    if (a.special === 'wildshape') return openPicker('wildshape');
    if (a.slot && !spendSlot(a.slot)) return;
    if (a.resId && !spend(a.resId, a.use || 1)) return;
    if (a.toggleKey) toggle(a.toggleKey);
    if (r.dmg && !r.hit) doRoll(dmgExpr(r.dmg), `${a.name}${r.dmgType ? ` (${r.dmgType})` : ''}`);
    else toast(`${a.name}${a.slot ? ` (${ORD(a.slot)}-level slot)` : ''} used`);
    commit();
  },
  wildshape: () => openPicker('wildshape'),
  revert: () => { toast(`Reverted from ${cur.shape.name}`); cur.shape = null; commit(); },
  fontslot: el => { const l = +el.dataset.l; if (spend('f:Sorcery Points', [2, 3, 5, 6, 7][l])) cur.slotsUsed[l]--; commit(); },
  fontpts: el => { const l = +el.dataset.l; cur.slotsUsed[l] = (cur.slotsUsed[l] || 0) + 1; cur.featureUses['f:Sorcery Points'] = Math.max(0, (cur.featureUses['f:Sorcery Points'] || 0) - (l + 1)); commit(); },
  comphp: el => {
    const cp = cur.companions[idx(el)], v = +$(`#comphp-${cp.id}`).value || 0;
    cp.hp = Math.max(0, Math.min(cp.max, cp.hp + (el.dataset.op === 'heal' ? v : -v)));
    if (!cp.hp) toast(`${cp.nick || cp.name} dropped to 0 HP`);
    commit();
  },
  delcomp: el => { cur.companions.splice(idx(el), 1); commit(); },
  loadexamples: async () => {
    try {
      const files = await (await fetch('examples/index.json')).json();
      let n = 0;
      for (const f of files) {
        const c = normalize(await (await fetch(`examples/${f}`)).json());
        if (chars.some(x => x.id === c.id)) continue;
        chars.push(c); await db.put('characters', c); n++;
      }
      toast(n ? `Loaded ${n} example characters` : 'Examples already loaded');
      render();
    } catch (e) { toast(`Could not load examples: ${e.message}`); }
  },
  short: () => openDlg(shortRestView),
  spendhd: el => {
    const f = el.dataset.f, r = doRoll(`1d${f}${signed(S.vars['mod.con'])}`, 'Hit die');
    cur.hitDiceUsed[f] = (cur.hitDiceUsed[f] || 0) + 1;
    const hp = Math.min(S.hpMax, S.hp + Math.max(0, r.total));
    cur.hp.current = hp >= S.hpMax ? null : hp;
    commit();
  },
  finishshort: () => {
    cur.pactUsed = 0;
    for (const r of cur.resources) if (r.reset === 'short') r.used = 0;
    for (const r of S.featureRes) if (r.reset === 'short') delete cur.featureUses[r.id];
    toast('Short rest finished'); closeDlg(); commit();
  },
  long: () => openDlg(() => `<h2>Long rest</h2><p>Restores HP, spell slots, resources and half your hit dice, and lowers exhaustion by one level.</p>
    <div class=btns><button class=primary data-act=finishlong autofocus>Take long rest</button><button data-act=closedlg>Cancel</button></div>`),
  closedlg: () => closeDlg(),
  rename: () => openDlg(renameView),
  renamesave: () => { const n = $('#newname').value.trim(); if (n) cur.name = n; closeDlg(); commit(); },
  image: () => openDlg(imageView),
  imglink: () => {
    const v = $('#imgurl').value.trim();
    let ok = false;
    try { ok = /^https?:$/.test(new URL(v).protocol); } catch { /* not a URL */ }
    if (!ok) return openDlg(() => imageView('Paste a full http(s) link to a picture.'));
    cur.image = v; closeDlg(); commit();
  },
  imgfile: async el => {
    const f = el.files[0];
    if (!f) return;
    try { cur.image = await shrinkImage(f); closeDlg(); commit(); } catch { openDlg(() => imageView(`Couldn't read ${f.name} as a picture.`)); }
  },
  imgreset: () => { delete cur.image; closeDlg(); commit(); },
  finishlong: () => {
    closeDlg();
    Object.assign(cur, { hp: { current: null, temp: 0 }, deathSaves: { s: 0, f: 0 }, slotsUsed: [], pactUsed: 0, exhaustion: Math.max(0, cur.exhaustion - 1) });
    for (const r of cur.resources) if (r.reset !== 'never') r.used = 0;
    cur.featureUses = {};
    for (const cp of cur.companions) cp.hp = cp.max;
    let back = Math.max(1, Math.floor(S.level / 2));
    for (const f of Object.keys(cur.hitDiceUsed).sort((a, b) => b - a)) {
      const n = Math.min(back, cur.hitDiceUsed[f]);
      cur.hitDiceUsed[f] -= n; back -= n;
    }
    toast('Long rest finished');
    commit();
  },

  // spells
  slot: el => { const l = +el.dataset.l, n = S.slots[l], left = n - (cur.slotsUsed[l] || 0), i = idx(el); cur.slotsUsed[l] = n - (i < left ? i : i + 1); commit(); },
  pact: el => { const n = S.pact.n, left = n - cur.pactUsed, i = idx(el); cur.pactUsed = n - (i < left ? i : i + 1); commit(); },
  cast: el => openDlg(() => castView(el.dataset.n, el.dataset.s)),
  castat: el => {
    const d = find('spell', el.dataset.n, el.dataset.s), s = { name: d.name, source: d.source }, l = el.dataset.l;
    if (l === 'pact') cur.pactUsed++;
    else if (!['ritual', 'innate'].includes(l)) cur.slotsUsed[l - 1] = (cur.slotsUsed[l - 1] || 0) + 1;
    for (const a of cur.actions) if (a.kind === 'spell' && a.ref?.name === s.name && +l) a.slot = +l;
    castDone(d, l === 'ritual' ? ' as a ritual' : l === 'innate' ? ' (innate)' : ` (${l === 'pact' ? 'pact slot' : ORD(+l) + ' level'})`);
    closeDlg(); commit();
  },
  // spell action: spend a slot of its chosen level; none left → the cast dialog offers the other slots / ritual / innate
  castaction: el => {
    const a = cur.actions[idx(el)], d = find('spell', a.ref?.name, a.ref?.source), l = +a.slot || d?.level;
    if (!d) return;
    if (!spendSlot(l)) return openDlg(() => castView(d.name, d.source));
    castDone(d, ` (${ORD(l)} level)`);
    commit();
  },
  conc: el => { const n = el.dataset.n; setConc(cur.concentration === n ? null : n); commit(); },
  delspell: el => { cur.spells.splice(idx(el), 1); commit(); },
  spellaction: el => {
    const n = el.dataset.n, b = S.R.bonusSpells.find(x => x.name.toLowerCase() === n.toLowerCase());
    addSpellAction(cur.spells.find(x => x.name === n) || { name: n, source: el.dataset.s, cls: b?.cls || S.spellcasting[0]?.cls });
  },

  // inventory
  itemdetail: (el, e) => { e.preventDefault(); const it = S.R.items.find(i => i.inv.id === el.dataset.id); if (it) showInfo(detail('item', it.data)); },
  customitem: () => { cur.inventory.push({ id: uid(), custom: true, name: 'Custom item', qty: 1, weight: 0, notes: '' }); commit(); },
  grantkit: () => { grantKit(); commit(); },
  kitopt: el => { (cur.kitChoices ||= {})[`g${el.dataset.g}`] = el.value; if (cur.bgKit) grantKit(); commit(); },
  kittype: el => { (cur.kitChoices ||= {})[el.dataset.k] = el.value; if (cur.bgKit) grantKit(); commit(); },
  delitem: el => { const [inv] = cur.inventory.splice(idx(el), 1); cur.actions = cur.actions.filter(a => a.ref !== inv.id && a.link?.inv !== inv.id); commit(); },
  weaponaction: el => addAction({ kind: 'weapon', ref: el.dataset.id, group: 'action', ability: 'auto', prof: 'auto' }),
  equip: el => { const inv = cur.inventory[idx(el)]; inv.equipped = !inv.equipped; commit(); },
  attune: el => {
    const inv = cur.inventory[idx(el)];
    if (!inv.attuned && cur.inventory.filter(i => i.attuned).length >= 3) return toast('You can attune to at most 3 items');
    inv.attuned = !inv.attuned; commit();
  },
  // weapons get a computed attack; anything else becomes a custom action using the item's first dice expression
  itemaction: el => {
    const { inv, data } = S.R.items[idx(el)];
    if (cur.actions.some(a => a.ref === inv.id || a.link?.inv === inv.id)) return toast(`${data.name} is already in your actions`);
    if (isWeapon(data)) return addAction({ kind: 'weapon', ref: inv.id, group: 'action', ability: 'auto', prof: 'auto' });
    const txt = JSON.stringify(data.entries || ''), dice = (txt.match(/\{@(?:damage|dice) ([^|}]+)/) || [])[1];
    addAction({ kind: 'custom', name: data.name, ability: 'none', dice: dice?.replace(/\s+/g, '') || '', dmgType: /regains? .{0,40}hit points/i.test(txt) ? 'healing' : '',
      group: /bonus action/i.test(txt) ? 'bonus' : /\breaction\b/i.test(txt) ? 'reaction' : 'action', link: { tag: 'item', name: data.name, src: data.source || '', inv: inv.id } });
  },
  delprof: el => { const k = el.dataset.k; cur.extraProfs[k] = cur.extraProfs[k].filter(p => p !== el.dataset.v); commit(); },

  // actions
  newaction: () => { addAction({ kind: 'custom', name: 'New action', group: 'action', ability: 'none' }); openDlg(() => actionEditor(cur.actions.length - 1)); },
  editaction: el => openDlg(() => actionEditor(idx(el))),
  delaction: el => { cur.actions.splice(idx(el), 1); commit(); },

  // features + effects
  featureaction: el => {
    const s = S.R.sources.find(x => x.key === el.dataset.k), txt = JSON.stringify(s.data?.entries || '');
    const group = /as a bonus action|use a bonus action|take a bonus action/i.test(txt) ? 'bonus' : /your reaction|use a reaction|use your reaction/i.test(txt) ? 'reaction' : 'action';
    const tag = s.cat === 'feat' ? 'feat' : s.cat === 'optionalfeature' ? 'optfeature' : s.key.startsWith('sf:') ? 'subclassFeature' : s.key.startsWith('cf:') ? 'classFeature' : null;
    addAction({ kind: 'custom', name: s.name, group, ability: 'none', link: tag && { tag, name: s.name, src: s.data?.source || '' } });
  },
  delsource: el => {
    const s = S.R.sources.find(x => x.key === el.dataset.k);
    cur[s.remove] = cur[s.remove].filter(f => !(f.name === s.data.name && f.source === s.data.source));
    commit();
  },
  addcustom: () => {
    const id = uid();
    cur.customSources.push({ id, name: 'Custom modifier' });
    cur.customEffects[`custom:${id}`] = { toggle: true, effects: [{ target: 'ac', op: 'add', value: 1 }] };
    commit();
    ACT.effects({ dataset: { k: `custom:${id}`, n: 'Custom modifier' } });
  },
  delcustom: el => {
    cur.customSources = cur.customSources.filter(s => s.id !== el.dataset.id);
    delete cur.customEffects[`custom:${el.dataset.id}`];
    commit();
  },
  effects: el => {
    const k = el.dataset.k, s = S.R.sources.find(x => x.key === k) || { key: k, name: el.dataset.n, kind: k.startsWith('inv:') ? 'item' : 'feature' };
    let def = sourceDef(cur, s, P);
    if (!def && k.startsWith('inv:')) def = { effects: itemEffects(S.R.items.find(i => `inv:${i.inv.id}` === k)?.data || {}) };
    const custom = s.kind === 'custom' ? cur.customSources.find(c => `custom:${c.id}` === k) : null;
    ui.edit = { key: k, name: custom?.name || s.name, custom, toggle: !!def?.toggle, effects: structuredClone(def?.effects || []) };
    openDlg(effectsEditor);
  },
  fxadd: () => { ui.edit.effects.push({ target: 'ac', op: 'add', value: 1 }); renderDlg(); },
  fxdel: el => { ui.edit.effects.splice(idx(el), 1); renderDlg(); },
  fxsave: () => {
    const e = ui.edit;
    cur.customEffects[e.key] = {
      toggle: e.toggle,
      effects: e.effects.filter(x => x.target).map(x => {
        const when = (Array.isArray(x.when) ? x.when : String(x.when || '').split(/[\s,]+/)).filter(Boolean);
        const v = x.value === '' || x.value == null || isNaN(+x.value) ? x.value : +x.value;
        return { target: x.target.trim(), op: x.op || 'add', value: v, ...(when.length && { when }), ...(x.op === 'dice' && { die: x.die || 'd6' }) };
      }),
    };
    if (e.custom) e.custom.name = e.name;
    closeDlg(); commit();
  },
};

// ---------- wiring ----------
function setPath(path, value) {
  let root = cur;
  const parts = path.split('.');
  if (path[0] === '@') { root = ui; parts[0] = parts[0].slice(1); }
  let o = root;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] ??= /^\d+$/.test(parts[i + 1]) ? [] : {};
  const k = parts.at(-1);
  if (value === '' && path.startsWith('overrides.')) delete o[k];
  else o[k] = value;
}
function inputValue(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.dataset.type === 'json') return JSON.parse(el.value);
  if (el.type === 'number' || el.dataset.type === 'num') return el.value === '' ? (el.dataset.path.startsWith('overrides.') ? '' : 0) : +el.value;
  return el.value;
}

document.addEventListener('click', e => {
  const ref = e.target.closest('a.ref');
  if (ref) {
    e.preventDefault();
    const hit = lookup(ref.dataset.tag, ref.dataset.name, ref.dataset.src);
    return showInfo(hit ? detail(hit.cat, hit.x) : `<h2>${esc(ref.dataset.name)}</h2><p class=muted>Not in the downloaded rules data.</p>`);
  }
  const rb = e.target.closest('button.roll');
  if (rb) return doRoll(rb.dataset.roll, rb.dataset.roll, { d20: /^1d20/.test(rb.dataset.roll) });
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT' || el.tagName === 'FORM' || el.type === 'file') return;
  if (el.closest('summary')) e.preventDefault();
  ACT[el.dataset.act]?.(el, e);
});
document.addEventListener('click', e => {
  for (const m of document.querySelectorAll('details.menu[open]')) if (!m.contains(e.target) || e.target.closest('.menupop button')) m.open = false;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('details.menu[open]').forEach(m => { m.open = false; }); });
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.act) return ACT[el.dataset.act]?.(el, e);
  if (!el.dataset.path || el.dataset.path === '@pick.q') return;
  const set = () => setPath(el.dataset.path, inputValue(el));
  if (cur && el.dataset.path[0] !== '@') keepHpGap(set); else set(); // a pick can move max HP (a CON bump, Draconic Resilience): damage taken stays taken
  if (el.dataset.path.startsWith('profChoices.tool:background') && cur.bgKit) grantKit(); // the kit's "any artisan's tool" follows this pick
  if (el.dataset.path[0] !== '@') save(el.dataset.path.startsWith('currency.') ? el.dataset.path : null);
  if (el.dataset.path[0] === '@') return requestAnimationFrame(renderDlg);
  requestAnimationFrame(render);
});
document.addEventListener('input', e => {
  if (e.target.dataset.path === '@pick.q') { ui.pick.q = e.target.value; if (ui.pick.kind === 'lookup') ui.lastQ = ui.pick.q; renderDlg(); }
  if (e.target.id === 'hpamt') for (const b of document.querySelectorAll('[data-act=hp]')) { b.disabled = !(+e.target.value > 0); b.title = b.disabled ? 'Type an amount first' : ''; }
});
// pickers: Enter takes the first result, arrows walk the list and back up to the search box
// anywhere else: "/" or Ctrl/Cmd+K opens the lookup
document.addEventListener('keydown', e => {
  const t = e.target, rows = [...document.querySelectorAll('#dlg .prow button.grow:not(:disabled)')];
  if (t.matches?.('#dlg input.search')) {
    if (e.key === 'Enter') { e.preventDefault(); rows[0]?.click(); }
    if (e.key === 'ArrowDown' && rows[0]) { e.preventDefault(); rows[0].focus(); }
  } else if (rows.includes(t) && /^Arrow(Up|Down)$/.test(e.key)) {
    e.preventDefault();
    (rows[rows.indexOf(t) + (e.key === 'ArrowDown' ? 1 : -1)] || $('#dlg input.search')).focus();
  } else if ((e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) || (e.key === 'k' && (e.ctrlKey || e.metaKey))) {
    if (D && !$('#dlg').open && !$('#info').open) { e.preventDefault(); ACT.lookup(); }
  }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const go = { hpamt: '[data-act=hp][data-op=dmg]:not(:disabled)', newname: '[data-act=renamesave]', imgurl: '[data-act=imglink]' }[e.target.id];
  if (go) { e.preventDefault(); $(go)?.click(); }
});
document.addEventListener('submit', e => {
  if (e.target.dataset.act !== 'customroll') return;
  e.preventDefault();
  const v = e.target.expr.value.trim();
  if (v) doRoll(v, v, { d20: /^1?d20/.test(v) });
});
document.addEventListener('toggle', e => {
  const k = e.target.dataset?.key;
  if (!k) return;
  const had = ui.open.has(k);
  if (e.target.open) ui.open.add(k); else ui.open.delete(k);
  if (e.target.open && !had && e.target.classList.contains('feat')) render(); // lazy-render feature text
}, true);
$('#dlg').addEventListener('close', () => {
  if (ui.picks?.lock && picksRows().some(p => !p[2])) return openDlg(picksView); // Escape, backdrop or a picker closing: not finished yet
  ui.dlg = null; ui.pick = null; ui.edit = null; ui.lu = null; ui.picks = null;
  if (cur && cur.classes.some(k => k.level === 0)) { cur.classes = cur.classes.filter(k => k.level > 0); commit(); }
});
$('#info').addEventListener('close', () => { ui.info = []; });
for (const d of ['#dlg', '#info']) $(d).addEventListener('click', e => { if (e.target === $(d)) $(d).close(); });

let lastCols = colCount();
addEventListener('resize', () => { if (colCount() !== lastCols) { lastCols = colCount(); if (cur) render(); } });

window.addEventListener('hashchange', () => {
  cur = chars.find(c => c.id === location.hash.slice(1)) || null;
  ui.log = []; ui.showLog = false; // rolls belong to the character they were made for
  window.scrollTo(0, 0);
  render();
});

(async () => {
  try {
    const r = await db.get('rules', 'all');
    if (r) setRules(r);
    chars = (await db.getAll('characters')).map(normalize);
  } catch (e) {
    $('#app').innerHTML = `<p class=warn>Storage unavailable: ${esc(e.message)}. Private browsing may block IndexedDB.</p>`;
    return;
  }
  cur = chars.find(c => c.id === location.hash.slice(1)) || null;
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
