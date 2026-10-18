// Pure 5e (2014) rules math. No DOM, no data loading — testable with `node rules.test.mjs`.

export const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABIL_NAME = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
export const SKILLS = {
  acrobatics: 'dex', 'animal handling': 'wis', arcana: 'int', athletics: 'str', deception: 'cha', history: 'int',
  insight: 'wis', intimidation: 'cha', investigation: 'int', medicine: 'wis', nature: 'int', perception: 'wis',
  performance: 'cha', persuasion: 'cha', religion: 'int', 'sleight of hand': 'dex', stealth: 'dex', survival: 'wis',
};
export const DMG_TYPE = { A: 'acid', B: 'bludgeoning', C: 'cold', F: 'fire', O: 'force', L: 'lightning', N: 'necrotic', P: 'piercing', I: 'poison', Y: 'psychic', R: 'radiant', S: 'slashing', T: 'thunder' };

export const mod = s => Math.floor((s - 10) / 2);
export const profBonus = lvl => 2 + Math.floor((Math.max(1, lvl) - 1) / 4);
export const signed = n => (n >= 0 ? '+' : '') + n;
export const code = s => String(s ?? '').split('|')[0];

// ---------- formulas ----------
const FN = ['max', 'min', 'floor', 'ceil', 'abs'];
// ponytail: whitelist + identifier substitution then Function(); every identifier is replaced by a number, so no code can be injected.
export function evalFormula(expr, vars = {}) {
  if (typeof expr === 'number') return expr;
  const s = String(expr ?? '').trim();
  if (!s) return 0;
  if (!/^[\w\s.+\-*/(),<>=!?:&|]*$/.test(s)) throw Error(`Bad formula: ${s}`);
  const js = s.replace(/[a-z_][\w.]*/gi, id => {
    if (FN.includes(id)) return 'Math.' + id;
    if (id in vars) return `(${+vars[id] || 0})`;
    throw Error(`Unknown name "${id}"`);
  });
  const v = Number(Function(`"use strict";return (${js})`)());
  if (!Number.isFinite(v)) throw Error(`Bad formula: ${s}`);
  return Math.floor(v);
}
export const isDice = v => /^\s*\d*d\d+(\s*[+-]\s*\d*d?\d+)*\s*$/i.test(String(v ?? ''));

// ---------- dice ----------
export function parseDice(expr) {
  const terms = [];
  const re = /([+-]?)\s*(\d*)d(\d+)|([+-]?)\s*(\d+)/gi;
  let m;
  while ((m = re.exec(String(expr).replace(/\s+/g, '')))) {
    if (m[3]) terms.push({ sign: m[1] === '-' ? -1 : 1, n: +(m[2] || 1), f: +m[3] });
    else terms.push({ sign: m[4] === '-' ? -1 : 1, flat: +m[5] });
  }
  return terms;
}

// adv/dis apply to the first d20 term; crit doubles dice.
export function roll(expr, { adv = false, dis = false, crit = false } = {}, rng = Math.random) {
  const d = f => 1 + Math.floor(rng() * f);
  let total = 0, d20 = null, first20 = true;
  const out = [];
  for (const t of parseDice(expr)) {
    if (t.flat != null) { total += t.sign * t.flat; out.push(signed(t.sign * t.flat)); continue; }
    if (t.f === 20 && t.n === 1 && first20 && adv !== dis) {
      first20 = false;
      const a = d(20), b = d(20), v = adv ? Math.max(a, b) : Math.min(a, b);
      d20 = v; total += t.sign * v; out.push(`d20(${a}|${b}→${v})`);
      continue;
    }
    const n = t.n * (crit ? 2 : 1), rs = Array.from({ length: n }, () => d(t.f));
    if (t.f === 20 && t.n === 1 && first20) { first20 = false; d20 = rs[0]; }
    total += t.sign * rs.reduce((a, b) => a + b, 0);
    out.push(`${t.sign < 0 ? '-' : ''}${n}d${t.f}(${rs.join(',')})`);
  }
  return { total, text: out.join(' '), d20 };
}

// "8d6","1d6","1d6" -> "10d6"; keeps different dice separate.
export function mergeDice(list) {
  const by = {};
  for (const x of list) for (const t of parseDice(x)) if (t.f) by[t.f] = (by[t.f] || 0) + t.sign * t.n;
  return Object.entries(by).filter(([, n]) => n).sort((a, b) => b[0] - a[0]).map(([f, n]) => `${n}d${f}`).join('+');
}

// ---------- spell slots ----------
const FULL = [[2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]];

// casters: [{prog: 'full'|'1/2'|'1/3'|'artificer'|'pact', level}]
export function spellSlots(casters) {
  const std = casters.filter(c => c.prog && c.prog !== 'pact');
  const single = std.length === 1;
  let cl = 0;
  for (const { prog, level: L } of std) {
    if (prog === 'full') cl += L;
    else if (prog === 'artificer') cl += Math.ceil(L / 2);
    else if (prog === '1/2') cl += single ? (L < 2 ? 0 : Math.ceil(L / 2)) : Math.floor(L / 2);
    else if (prog === '1/3') cl += single ? (L < 3 ? 0 : Math.ceil(L / 3)) : Math.floor(L / 3);
  }
  const w = casters.filter(c => c.prog === 'pact').reduce((a, c) => a + c.level, 0);
  return {
    slots: cl ? FULL[Math.min(cl, 20) - 1] : [],
    pact: w ? { n: w < 2 ? 1 : w < 11 ? 2 : w < 17 ? 3 : 4, level: Math.min(5, Math.ceil(w / 2)) } : null,
  };
}

// ---------- stats with breakdowns ----------
export const stat = () => ({ total: 0, parts: [], adv: [], dis: [], notes: [], dice: [] });
export function add(s, label, v) {
  if (!v) return s;
  s.parts.push({ label, value: v });
  s.total += v;
  return s;
}

export function whenOk(when, ctx) {
  return (when || []).every(w => (w.startsWith('spell:') ? ctx.spell === w.slice(6).toLowerCase()
    : w.startsWith('weapon:') ? w.slice(7).split('|').includes(ctx.weaponBase)
    : w.startsWith('active:') ? !!ctx.active?.has(w.slice(7).toLowerCase()) : !!ctx[w]));
}

// Dice with their source label (s.diceSrc runs parallel to s.dice) for the breakdown.
const addDice = (s, d, label) => { s.dice.push(d); (s.diceSrc ??= [])[s.dice.length - 1] = label; };

// Applies matching effects. Additive first, then set/min/mul (each recorded as a diff part so the breakdown sums).
export function apply(s, targets, effects, vars, ctx = {}) {
  const post = [];
  for (const e of effects) {
    if (!targets.includes(e.target) || !whenOk(e.when, ctx)) continue;
    try {
      if (e.op === 'adv') s.adv.push(e.label);
      else if (e.op === 'dis') s.dis.push(e.label);
      else if (e.op === 'note') s.notes.push(`${e.label}: ${e.value}`);
      else if (e.op === 'dice') addDice(s, `${evalFormula(e.value, vars)}${e.die}`, e.label);
      else if (e.op === 'add') isDice(e.value) ? addDice(s, String(e.value).trim(), e.label) : add(s, e.label, evalFormula(e.value, vars));
      else post.push(e);
    } catch (err) { s.notes.push(`⚠ ${e.label}: ${err.message}`); }
  }
  for (const e of post) {
    try {
      const v = evalFormula(e.value, vars);
      const target = e.op === 'set' ? v : e.op === 'min' ? Math.max(s.total, v) : e.op === 'mul' ? Math.floor(s.total * +e.value) : s.total;
      add(s, `${e.label} (${e.op === 'mul' ? '×' + e.value : e.op === 'min' ? 'at least ' + v : '= ' + v})`, target - s.total);
    } catch (err) { s.notes.push(`⚠ ${e.label}: ${err.message}`); }
  }
  return s;
}

function override(s, key, overrides) {
  const o = overrides?.[key];
  if (o === '' || o == null || isNaN(+o)) return s;
  return add(s, 'Manual override', +o - s.total);
}

// ---------- effect gathering ----------
export function itemEffects(d) {
  const n = v => parseInt(v) || 0, e = [];
  if (d.bonusAc) e.push({ target: 'ac', op: 'add', value: n(d.bonusAc) });
  if (d.bonusSavingThrow) e.push({ target: 'save.all', op: 'add', value: n(d.bonusSavingThrow) });
  if (d.bonusSpellAttack) e.push({ target: 'spellAttack', op: 'add', value: n(d.bonusSpellAttack) });
  if (d.bonusSpellSaveDc) e.push({ target: 'spellDc', op: 'add', value: n(d.bonusSpellSaveDc) });
  if (d.bonusAbilityCheck) e.push({ target: 'check.all', op: 'add', value: n(d.bonusAbilityCheck) });
  for (const [a, v] of Object.entries(d.ability?.static || {})) e.push({ target: `ability.${a}`, op: 'min', value: v });
  for (const a of ABIL) if (typeof d.ability?.[a] === 'number') e.push({ target: `ability.${a}`, op: 'add', value: d.ability[a] });
  return e;
}

// Effect definition for a source: user's custom edit wins over the preset.
export function sourceDef(c, s, P) {
  if (c.customEffects?.[s.key]) return c.customEffects[s.key];
  const map = s.kind === 'spell' ? P.SPELLS : s.kind === 'item' ? P.ITEMS : P.FEATURES;
  const n = s.name.toLowerCase(), c0 = s.cls?.toLowerCase();
  return (c0 && s.level && map?.[`${n}|${c0}|${s.level}`]) || (c0 && map?.[`${n}|${c0}`]) || (s.src && map?.[`${n}|${s.src.toLowerCase()}`]) || map?.[n] || null;
}

const itemActive = ({ inv, data }) => data.reqAttune ? inv.attuned : inv.equipped;

// R.sources: [{key, name, kind, cls}], R.items: [{inv, data}]
export function gatherEffects(c, R, P) {
  const out = [];
  const push = (label, def, cls) => def?.effects?.forEach(e => out.push({ ...e, label, ...(cls && { cls }) }));
  for (const s of R.sources) {
    const def = sourceDef(c, s, P);
    if (def && (!def.toggle || c.activeToggles?.includes(s.key))) push(s.name, def, s.cls);
  }
  for (const it of R.items) {
    if (!itemActive(it)) continue;
    const s = { key: `inv:${it.inv.id}`, name: it.data.name, kind: 'item' };
    const pre = sourceDef(c, s, P), own = itemEffects(it.data);
    const def = !pre ? { effects: own } : pre.replace || c.customEffects?.[s.key] ? pre : { ...pre, effects: [...own, ...(pre.effects || [])] };
    if (!def.toggle || c.activeToggles?.includes(s.key)) push(it.data.name, def);
  }
  for (const n of c.conditions || []) push(n, P.CONDITIONS?.[n.toLowerCase()]);
  const x = c.exhaustion || 0, ex = [];
  if (x >= 1) ex.push({ target: 'check.all', op: 'dis' });
  if (x >= 2) ex.push({ target: 'speed', op: 'mul', value: 0.5 });
  if (x >= 3) ex.push({ target: 'attack.all', op: 'dis' }, { target: 'save.all', op: 'dis' });
  if (x >= 4) ex.push({ target: 'hpMax', op: 'mul', value: 0.5 });
  if (x >= 5) ex.push({ target: 'speed', op: 'set', value: 0 });
  if (x >= 6) ex.push({ target: 'hpMax', op: 'note', value: 'Death' });
  push(`Exhaustion ${x}`, { effects: ex });
  for (const e of R.extraEffects || []) out.push(e); // e.g. Wild Shape: already labelled
  return out;
}

// ---------- ability score grants (race / subrace / feat `ability` arrays) ----------
// Returns the choice spec {from, weights} of the first ability option, or null.
export function abilityChoiceSpec(data) {
  const a = data?.ability?.[0];
  if (!a && data?.lineage) return { from: ABIL, weights: [2, 1] }; // Tasha's custom origin
  const ch = a?.choose;
  if (!ch) return null;
  if (ch.weighted) return { from: ch.weighted.from, weights: ch.weighted.weights };
  return { from: ch.from, weights: Array(ch.count || 1).fill(ch.amount || 1) };
}
export function abilityGrants(data, choices = []) {
  const a = data?.ability?.[0] || {}, out = [];
  for (const k of ABIL) if (typeof a[k] === 'number') out.push([k, a[k]]);
  const spec = abilityChoiceSpec(data);
  spec?.weights.forEach((w, i) => choices[i] && out.push([choices[i], w]));
  return out;
}

// ---------- proficiency grants (skills, saves, expertise, armor, weapons, tools, languages) ----------
// Derived from race/subrace/background/class/feats/features each time, so removing a source removes its grants.
// Choices live in c.profChoices[source.key]; manual additions in c.skillProfs / c.saveProfs / c.extraProfs[kind].
const ALL_SKILLS = Object.keys(SKILLS);
export const PROF_LISTS = {
  armor: ['light', 'medium', 'heavy', 'shield'],
  standardLang: ['common', 'dwarvish', 'elvish', 'giant', 'gnomish', 'goblin', 'halfling', 'orc'],
  exoticLang: ['abyssal', 'celestial', 'deep speech', 'draconic', 'infernal', 'primordial', 'sylvan', 'undercommon'],
  artisan: ["alchemist's supplies", "brewer's supplies", "calligrapher's supplies", "carpenter's tools", "cartographer's tools", "cobbler's tools",
    "cook's utensils", "glassblower's tools", "jeweler's tools", "leatherworker's tools", "mason's tools", "painter's supplies", "potter's tools",
    "smith's tools", "tinker's tools", "weaver's tools", "woodcarver's tools"],
  instrument: ['bagpipes', 'drum', 'dulcimer', 'flute', 'horn', 'lute', 'lyre', 'pan flute', 'shawm', 'viol'],
  gaming: ['dice set', 'dragonchess set', 'playing card set', 'three-dragon ante set'],
  otherTool: ['disguise kit', 'forgery kit', 'herbalism kit', "navigator's tools", "poisoner's kit", "thieves' tools", 'vehicles (land)', 'vehicles (water)'],
};
const L = PROF_LISTS;
L.lang = [...L.standardLang, ...L.exoticLang];
L.tool = [...L.artisan, ...L.instrument, ...L.gaming, ...L.otherTool];
const ANY = { anySkill: ALL_SKILLS, anyTool: L.tool, anyStandard: L.standardLang, anyExotic: L.exoticLang, anyArtisansTool: L.artisan,
  anyMusicalInstrument: L.instrument, anyGamingSet: L.gaming, anyLanguage: L.lang };
const SPECIAL = new Set(['choose', 'any', 'other', 'firearms', ...Object.keys(ANY)]);
const kindList = (kind, R) => ({ skill: ALL_SKILLS, save: ABIL, armor: L.armor, tool: L.tool, lang: L.lang, weapon: R.weaponNames?.all || [] }[kind] || []);
const norm = k => k.split('|')[0].toLowerCase();

// one proficiency array (5etools *Proficiencies) -> {fixed, groups: [{from, count}]}
function grantSpec(arr, kind, R) {
  if (!arr?.length) return null;
  if (kind === 'expertise') return arr[0].anyProficientSkill ? { fixed: [], groups: [{ from: null, count: arr[0].anyProficientSkill }] } : null;
  const valid = kind === 'skill' ? ALL_SKILLS : kind === 'save' ? ABIL : null, all = kindList(kind, R);
  const ok = k => !valid || valid.includes(k);
  const expand = f => (ANY[f] ? ANY[f] : f === 'anyWeapon' ? all : [norm(f)]);
  const parse = o => {
    const fixed = Object.keys(o).filter(k => o[k] === true && !SPECIAL.has(k)).map(norm).filter(ok), groups = [];
    for (const [k, n] of Object.entries(o)) if (ANY[k] && typeof n === 'number') groups.push({ from: ANY[k], count: n });
    if (typeof o.any === 'number') groups.push({ from: all, count: o.any });
    if (o.other === true) groups.push({ from: all, count: 1 });
    for (const ch of [].concat(o.choose || [])) {
      const from = ch.from ? ch.from.flatMap(expand) : ch.fromFilter ? (/martial/.test(ch.fromFilter) ? R.weaponNames?.martial : all) || [] : all;
      groups.push({ from: from.filter(ok), count: ch.count || 1 });
    }
    return { fixed, groups };
  };
  if (arr.length === 1) return parse(arr[0]);
  // several objects = alternatives (Monk: artisan's tools OR an instrument): one pick from their union
  const alts = arr.map(parse);
  return { fixed: [], groups: [{ from: [...new Set(alts.flatMap(a => [...a.fixed, ...a.groups.flatMap(g => g.from)]))], count: 1 }] };
}
const classWeapons = l => (l?.length ? [Object.fromEntries(l.filter(w => typeof w === 'string').map(w => [(w.match(/\{@item ([^|}]+)/)?.[1] || w).toLowerCase(), true]))] : null);
const FEATURE_LANGS = { 'druidic': 'druidic', "thieves' cant": "thieves' cant" };

export function profSources(R) {
  const out = [];
  const push = (src, label, kind, arr) => {
    const sp = grantSpec(arr, kind, R);
    if (!sp) return;
    if (!sp.groups.length) out.push({ key: `${kind}:${src}`, src, label, kind, fixed: sp.fixed, from: [], count: 0 });
    sp.groups.forEach((g, i) => out.push({ key: `${kind}:${src}${i ? '#' + i : ''}`, src, label, kind, fixed: i ? [] : sp.fixed, ...g }));
  };
  const bundle = (src, label, x) => {
    if (!x) return;
    push(src, label, 'skill', x.skillProficiencies || x.skillToolLanguageProficiencies);
    push(src, label, 'lang', x.languageProficiencies);
    push(src, label, 'tool', x.toolProficiencies);
    push(src, label, 'weapon', x.weaponProficiencies);
    push(src, label, 'armor', x.armorProficiencies);
  };
  bundle('race', R.race?.name, R.race);
  bundle('subrace', R.subrace?.name || R.race?.name, R.subrace);
  bundle('background', R.background?.name, R.background);
  R.classes.forEach((k, i) => {
    if (!k.cls) return;
    const src = i ? `mc:${k.cls.name}` : 'class', cp = i ? k.cls.multiclassing?.proficienciesGained : k.cls.startingProficiencies;
    push(src, k.cls.name, 'skill', cp?.skills);
    push(src, k.cls.name, 'armor', cp?.armorProficiencies);
    push(src, k.cls.name, 'weapon', classWeapons(cp?.weapons));
    push(src, k.cls.name, 'tool', cp?.toolProficiencies);
  });
  for (const f of R.feats || []) {
    bundle(f.key, f.data.name, f.data);
    push(f.key, f.data.name, 'save', f.data.savingThrowProficiencies);
    push(f.key, f.data.name, 'expertise', f.data.expertise);
  }
  for (const s of R.sources || []) {
    if (!s.key.startsWith('cf:')) continue;
    if (s.name === 'Expertise') out.push({ key: `expertise:${s.key}`, src: s.key, label: `${s.cls} Expertise (Lv ${s.level})`, kind: 'expertise', fixed: [], from: null, count: 2 });
    const lang = FEATURE_LANGS[s.name.toLowerCase()];
    if (lang) out.push({ key: `lang:${s.key}`, src: s.key, label: s.name, kind: 'lang', fixed: [lang], from: [], count: 0 });
  }
  // class/subclass features grant armor, weapons and tools only in prose ("you gain proficiency with heavy armor")
  for (const s of R.sources || []) {
    if (!/^[cs]f:/.test(s.key)) continue;
    const g = featureProfs(s.data?.entries, R), label = s.group?.split(': ').at(-1) || s.name;
    for (const kind of ['armor', 'weapon', 'tool']) if (g[kind].length) out.push({ key: `${kind}:${s.key}`, src: s.key, label, kind, fixed: g[kind], from: [], count: 0 });
  }
  return out;
}
// ponytail: prose parsing, misses grants worded differently; picks "of your choice" are left to manual adds
export function featureProfs(ent, R) {
  const g = { armor: [], weapon: [], tool: [] }, txt = JSON.stringify(ent || '');
  for (const [, clause] of txt.matchAll(/(?:gain|have) proficiency with (.+?)(?=\.|"|$)/gi)) {
    for (const part of clause.split(/,\s*(?:and\s+)?|\s+and\s+/)) {
      if (/choice|one type|other type/i.test(part)) continue;
      for (const [, a] of part.matchAll(/\b(light|medium|heavy) armor/gi)) g.armor.push(a.toLowerCase());
      if (/\bshields?\b/i.test(part)) g.armor.push('shield');
      for (const [, w] of part.matchAll(/\b(simple|martial) weapons/gi)) g.weapon.push(w.toLowerCase());
      for (const [, n] of part.matchAll(/\{@item ([^|}]+)/g)) {
        const k = n.toLowerCase();
        if (L.tool.includes(k)) g.tool.push(k); else if (R.weaponNames?.all?.includes(k)) g.weapon.push(k);
      }
    }
  }
  return g;
}
// -> {skill|save|expertise|armor|weapon|tool|lang: {name: [source labels]}}; manual extras labelled "manual"
export function profGrants(c, R) {
  const g = { skill: {}, save: {}, expertise: {}, armor: {}, weapon: {}, tool: {}, lang: {} };
  const cls0 = R.classes.find(k => k.cls)?.cls;
  for (const a of cls0?.proficiency || []) (g.save[a] ||= []).push(cls0.name);
  for (const s of profSources(R)) {
    const picks = (c.profChoices?.[s.key] || []).slice(0, s.count).filter(p => p && (!s.from || s.from.includes(p)));
    for (const p of new Set([...s.fixed, ...picks])) (g[s.kind][p] ||= []).push(s.label);
  }
  for (const [kind, list] of Object.entries(c.extraProfs || {})) for (const p of list) (g[kind][p] ||= []).push('manual');
  return g;
}

// ---------- AC ----------
const armorType = d => code(d?.type);
export function acFlags(R) {
  const eq = R.items.filter(i => i.inv.equipped);
  const armor = eq.find(i => ['LA', 'MA', 'HA'].includes(armorType(i.data)));
  const shield = eq.find(i => armorType(i.data) === 'S');
  const t = armor && armorType(armor.data);
  const weapon = eq.some(i => i.data.weaponCategory || ['M', 'R'].includes(code(i.data.type)));
  return {
    armor, shield, flags: {
      armor: !!armor, noArmor: !armor, shield: !!shield, noShield: !shield, noWeapon: !weapon,
      notHeavyArmor: t !== 'HA', lightOrNoArmor: !t || t === 'LA',
    },
  };
}

// ---------- the character sheet ----------
// R: {race, subrace, background, classes:[{cls, sub, level, hpRolls}], items:[{inv,data}], feats:[{key,data}], sources, weaponNames}
export function computeCharacter(c, R, effects) {
  const ov = c.overrides || {}, stats = {};
  const classes = R.classes.filter(k => k.cls);
  const level = classes.reduce((a, k) => a + k.level, 0) || 1;
  const pb = override(add(stat(), `Level ${level}`, profBonus(level)), 'prof', ov);
  stats.prof = pb;
  const vars = { prof: pb.total, level };
  for (const k of classes) vars[`level.${k.cls.name.toLowerCase()}`] = k.level;

  // abilities (formulas here may only use level/prof)
  const scores = {};
  const raceAb = R.subrace?.overwrite?.ability ? [] : abilityGrants(R.race, c.abilityChoices?.race);
  const grants = [
    ...raceAb.map(g => [...g, R.race.name]),
    ...abilityGrants(R.subrace, c.abilityChoices?.subrace).map(g => [...g, R.subrace.name || 'Subrace']),
    ...(R.feats || []).flatMap(f => abilityGrants(f.data, c.abilityChoices?.[f.key]).map(g => [...g, f.data.name])),
  ];
  for (const a of ABIL) {
    const s = add(stat(), 'Base score', +c.baseScores?.[a] || 0);
    for (const [k, v, label] of grants) if (k === a) add(s, label, v);
    add(s, 'ASI / other', +c.asiBonuses?.[a] || 0);
    // a transformation (Wild Shape) swaps scores but never your own hit point maximum: remember CON without it
    if (a === 'con') vars.ownCon = mod(apply(structuredClone(s), ['ability.con'], effects.filter(e => !e.transform), vars).total);
    apply(s, [`ability.${a}`], effects, vars);
    stats[`ability.${a}`] = override(s, `ability.${a}`, ov);
    scores[a] = s.total;
    vars[`score.${a}`] = s.total;
    vars[`mod.${a}`] = mod(s.total);
  }
  const M = a => vars[`mod.${a}`];
  const { armor, shield, flags } = acFlags(R);
  // names of switched-on toggles, for effects that only apply "while raging" etc. (when: ['active:rage'])
  flags.active = new Set(R.sources.filter(s => c.activeToggles?.includes(s.key)).map(s => s.name.toLowerCase()));

  // saves
  const pg = profGrants(c, R);
  const why = (list, manual) => [...(list || []), ...(manual ? ['manual'] : [])].join(', ');
  for (const a of ABIL) {
    stats[`check.${a}`] = override(apply(add(stat(), `${a.toUpperCase()} mod`, M(a)), ['check.all', `check.${a}`], effects, vars, { ...flags, nonProficient: true }), `check.${a}`, ov);
    const s = add(stat(), `${a.toUpperCase()} mod`, M(a));
    const prof = !!pg.save[a] || !!c.saveProfs?.[a];
    if (prof) add(s, `Proficiency (${why(pg.save[a], c.saveProfs?.[a])})`, pb.total);
    apply(s, ['save.all', `save.${a}`], effects, vars, flags);
    stats[`save.${a}`] = override(s, `save.${a}`, ov);
    s.proficient = prof;
    s.derived = pg.save[a] ? 1 : 0;
  }

  // skills + passives
  for (const [sk, a] of Object.entries(SKILLS)) {
    const manual = c.skillProfs?.[sk] || 0, derived = pg.expertise[sk] ? 2 : pg.skill[sk] ? 1 : 0, p = Math.max(manual, derived);
    const s = add(stat(), `${a.toUpperCase()} mod`, M(a));
    if (p) add(s, p === 2 ? `Expertise (${why(pg.expertise[sk], manual === 2)})` : `Proficiency (${why(pg.skill[sk], manual === 1)})`, pb.total * p);
    apply(s, ['check.all', `check.${a}`, `skill.all`, `skill.${sk}`], effects, vars, { ...flags, nonProficient: !p });
    stats[`skill.${sk}`] = override(s, `skill.${sk}`, ov);
    s.proficient = p;
    s.derived = derived;
    s.sources = [...(pg.skill[sk] || []), ...(pg.expertise[sk] || []).map(l => `${l} (expertise)`)];
  }
  for (const sk of ['perception', 'investigation', 'insight']) {
    const sk0 = stats[`skill.${sk}`], s = add(stat(), 'Base', 10);
    add(s, `${sk} check`, sk0.total);
    const ad = (sk0.adv.length ? 1 : 0) - (sk0.dis.length ? 1 : 0);
    add(s, ad > 0 ? 'Advantage' : 'Disadvantage', ad * 5);
    apply(s, [`passive.${sk}`], effects, vars, flags);
    stats[`passive.${sk}`] = override(s, `passive.${sk}`, ov);
  }

  // initiative (a Dex check)
  stats.initiative = override(apply(add(stat(), 'DEX mod', M('dex')), ['initiative', 'check.all', 'check.dex'], effects, vars, { ...flags, nonProficient: true }), 'initiative', ov);

  // AC: best of armor / unarmored / acBase candidates, then shield and bonuses
  const cands = [];
  if (armor) {
    const t = armorType(armor.data), base = +armor.data.ac || 10, dex = t === 'HA' ? 0 : t === 'MA' ? Math.min(2, M('dex')) : M('dex');
    cands.push({ label: armor.data.name, parts: [[armor.data.name, base], ...(dex ? [[t === 'MA' ? 'DEX mod (max 2)' : 'DEX mod', dex]] : [])] });
  } else cands.push({ label: 'Unarmored', parts: [['Unarmored', 10], ['DEX mod', M('dex')]] });
  for (const e of effects) if (e.target === 'acBase' && whenOk(e.when, flags)) {
    try { cands.push({ label: e.label, parts: [[`${e.label} (${e.value})`, evalFormula(e.value, vars)]] }); } catch { /* bad formula: ignore candidate */ }
  }
  for (const k of cands) k.total = k.parts.reduce((a, p) => a + p[1], 0);
  const best = cands.reduce((a, b) => (b.total > a.total ? b : a));
  const ac = stat();
  best.parts.forEach(([l, v]) => add(ac, l, v));
  if (shield) add(ac, shield.data.name, +shield.data.ac || 2);
  apply(ac, ['ac'], effects, vars, flags);
  ac.candidates = cands.map(k => `${k.label}: ${k.total}`);
  const armorKind = { LA: 'light', MA: 'medium', HA: 'heavy' }[armor && armorType(armor.data)];
  if (armorKind && !pg.armor[armorKind]) ac.notes.push(`Not proficient with ${armorKind} armor: disadvantage on STR/DEX checks, saves and attacks; no spellcasting`);
  if (shield && !pg.armor.shield) ac.notes.push('Not proficient with shields: disadvantage on STR/DEX checks, saves and attacks; no spellcasting');
  stats.ac = override(ac, 'ac', ov);

  // speed
  const rs = R.subrace?.speed ?? R.race?.speed ?? 30, walk = typeof rs === 'object' ? rs.walk ?? 30 : rs;
  const sp = add(stat(), R.race?.name || 'Base', walk);
  if (armor?.data.strength && scores.str < +armor.data.strength) add(sp, `${armor.data.name} (needs STR ${armor.data.strength})`, -10);
  apply(sp, ['speed'], effects, vars, flags);
  if (typeof rs === 'object') for (const [k, v] of Object.entries(rs)) if (k !== 'walk') sp.notes.push(`${k} ${v === true ? 'equal to walking' : typeof v === 'object' ? v.number : v} ft`);
  stats.speed = override(sp, 'speed', ov);

  // HP: max die at character level 1, then rolled or average
  const hp = stat(), hitDice = {};
  classes.forEach((k, i) => {
    const f = k.cls.hd?.faces || 8;
    let sum = 0;
    for (let l = 1; l <= k.level; l++) sum += i === 0 && l === 1 ? f : (k.hpRolls?.[l - 1] ?? f / 2 + 1);
    add(hp, `${k.cls.name} d${f} ×${k.level}`, sum);
    hitDice[f] = (hitDice[f] || 0) + k.level;
  });
  add(hp, `CON mod × ${level}`, vars.ownCon * level);
  apply(hp, ['hpMax'], effects, vars, flags);
  stats.hpMax = override(hp, 'hpMax', ov);
  if (stats.hpMax.total < 1) add(stats.hpMax, 'Minimum', 1 - stats.hpMax.total);

  // spellcasting
  const casters = [], spellcasting = [];
  for (const k of classes) {
    const subCaster = k.sub?.casterProgression;
    const prog = k.cls.casterProgression || subCaster;
    if (!prog) continue;
    const src = k.cls.casterProgression ? k.cls : k.sub, a = src.spellcastingAbility, n = k.cls.name;
    casters.push({ prog, level: k.level });
    const dc = add(add(add(stat(), 'Base', 8), 'Proficiency', pb.total), `${a.toUpperCase()} mod`, M(a));
    const atk = add(add(stat(), 'Proficiency', pb.total), `${a.toUpperCase()} mod`, M(a));
    stats[`spellDc.${n}`] = override(apply(dc, ['spellDc'], effects, vars, flags), `spellDc.${n}`, ov);
    stats[`spellAttack.${n}`] = override(apply(atk, ['spellAttack'], effects, vars, flags), `spellAttack.${n}`, ov);
    let prepared = null;
    if (src.preparedSpells) {
      try {
        prepared = Math.max(1, evalFormula(src.preparedSpells.replace(/<\$level\$>/g, k.level).replace(/<\$(\w+)_mod\$>/g, (_, x) => M(x)), vars));
      } catch { /* unknown formula shape: leave uncounted */ }
    }
    spellcasting.push({
      cls: n, ability: a, dc: stats[`spellDc.${n}`], attack: stats[`spellAttack.${n}`], prepared,
      known: src.spellsKnownProgression?.[k.level - 1] ?? null, cantrips: src.cantripProgression?.[k.level - 1] ?? null,
      list: subCaster && !k.cls.casterProgression ? 'Wizard' : n, // EK / Arcane Trickster use the wizard list
    });
  }
  const { slots, pact } = spellSlots(casters);

  const weight = R.items.reduce((a, { inv, data }) => a + (+data.weight || 0) * (+inv.qty || 1), 0);
  return { level, vars, stats, scores, flags, profs: pg, hitDice, spellcasting, slots, pact, weight: Math.round(weight * 100) / 100, capacity: scores.str * 15, effects };
}

// ---------- actions ----------
const props = d => (d.property || []).map(p => code(p.uid ?? p));
// The plain weapon an item is: "+1 Longsword" → longsword; 2014 magic staffs carry only `staff: true` but are quarterstaffs.
const weaponBase = d => (code(d.baseItem) || code(d.base) || (d.staff && d.dmg1 ? 'quarterstaff' : d.name)).toLowerCase();
export function weaponProficient(d, profs = {}) {
  return !!(profs[d.weaponCategory] || profs[d.name.toLowerCase()] || profs[weaponBase(d)]);
}

function spellDice(d, totalLevel, slot) {
  const sld = [].concat(d.scalingLevelDice || [])[0];
  if (sld) {
    const k = Object.keys(sld.scaling).map(Number).filter(l => l <= totalLevel).pop();
    return sld.scaling[k ?? 1];
  }
  const txt = JSON.stringify(d.entries || []);
  const base = (txt.match(/\{@damage ([^|}]+)/) || txt.match(/\{@dice ([^|}]+)/))?.[1];
  if (!base) return '';
  const up = JSON.stringify(d.entriesHigherLevel || []).match(/\{@scale(?:damage|dice) [^|}]+\|[^|}]+\|([^|}]+)\}/);
  const extra = up && slot > d.level ? Array(slot - d.level).fill(up[1]) : [];
  return extra.length ? mergeDice([base, ...extra]) : base;
}

export const GROUP = { action: 'Action', bonus: 'Bonus action', reaction: 'Reaction' };

// a: {kind:'weapon'|'spell'|'custom', ...}; ctx: {sheet, R, c, data (resolved item/spell)}
export function computeAction(a, { sheet, R, c, data }) {
  const { vars, effects, flags } = sheet, M = x => vars[`mod.${x}`] ?? 0, pb = vars.prof;
  const fx = (s, t, ctx) => apply(s, t, effects, vars, { ...flags, ...ctx });
  const manual = (s, v, label = 'Manual') => {
    if (!v && v !== 0) return;
    try { isDice(v) ? s.dice.push(String(v)) : add(s, label, evalFormula(v, vars)); } catch (e) { s.notes.push(`⚠ ${e.message}`); }
  };
  const res = { id: a.id, name: a.name, group: a.group || 'action', range: a.range || '', notes: a.notes || '', hit: null, save: null, dmg: null, dmgType: a.dmgType || '' };

  if (a.kind === 'weapon') {
    if (!data) return { ...res, error: 'Item no longer in inventory' };
    const p = props(data), ranged = code(data.type) === 'R', finesse = p.includes('F');
    const wb = weaponBase(data);
    const base = { weapon: true, melee: !ranged, ranged, finesseOrRanged: finesse || ranged, oneHanded: !p.includes('2H'), heavyWeapon: p.includes('H'), weaponBase: wb,
      monkWeapon: !ranged && (wb === 'shortsword' || (data.weaponCategory === 'simple' && !p.includes('2H') && !p.includes('H'))) };
    const usual = ranged ? 'dex' : finesse && M('dex') > M('str') ? 'dex' : 'str';
    const up = upgrades(sheet, base, usual, a.versatile && data.dmg2 ? data.dmg2 : data.dmg1 || '1', M);
    const forced = a.ability && a.ability !== 'auto', abil = forced ? a.ability : up.abil;
    const prof = a.prof === 'auto' || a.prof == null ? weaponProficient(data, sheet.profs.weapon) : !!a.prof;
    const ctx = { ...base, str: abil === 'str' };
    const t = ranged ? 'ranged' : 'melee';
    const aLabel = `${abil.toUpperCase()} mod${!forced && up.abilBy ? ` (${up.abilBy})` : ''}`;
    const hit = add(stat(), aLabel, M(abil));
    if (prof) add(hit, 'Proficiency', pb);
    add(hit, data.name, (parseInt(data.bonusWeapon) || 0) + (parseInt(data.bonusWeaponAttack) || 0));
    fx(hit, ['attack.all', 'attack.weapon', `attack.${t}`], ctx);
    manual(hit, a.toHit);
    const dmg = stat();
    addDice(dmg, up.die, up.dieBy ? `${data.name} (${up.dieBy})` : data.name);
    add(dmg, aLabel, M(abil));
    add(dmg, data.name, (parseInt(data.bonusWeapon) || 0) + (parseInt(data.bonusWeaponDamage) || 0));
    fx(dmg, ['damage.all', 'damage.weapon', `damage.${t}`], ctx);
    manual(dmg, a.dmgBonus);
    return {
      ...res, name: a.name || data.name, hit, dmg, dmgType: a.dmgType || up.type || DMG_TYPE[data.dmgType] || '',
      range: a.range || (data.range ? `${data.range} ft` : p.includes('R') ? '10 ft' : '5 ft'),
      props: p, versatile: !!data.dmg2, prof,
    };
  }

  if (a.kind === 'spell') {
    if (!data) return { ...res, error: 'Spell no longer in spellbook' };
    const sc = sheet.spellcasting.find(s => s.cls === a.cls) || sheet.spellcasting[0];
    const ctx = { spell: data.name.toLowerCase() };
    let hit = null, save = null;
    if (data.spellAttack?.length && sc) {
      hit = stat();
      sc.attack.parts.forEach(p => add(hit, p.label, p.value));
      fx(hit, ['attack.all', 'attack.spell'], ctx);
      manual(hit, a.toHit);
    }
    if (data.savingThrow?.length) save = { dc: sc?.dc.total ?? 8 + pb, ability: data.savingThrow.map(s => s.slice(0, 3).toUpperCase()).join('/') };
    const dice = spellDice(data, sheet.level, +a.slot || data.level);
    let dmg = null;
    if (dice || a.dmgBonus) {
      dmg = stat();
      if (dice) dmg.dice.push(dice);
      fx(dmg, ['damage.all', 'damage.spell'], ctx);
      manual(dmg, a.dmgBonus);
    }
    const r = data.range?.distance;
    const t = data.time?.[0]?.unit;
    return {
      ...res, name: a.name || data.name, hit, save, dmg, group: a.group || (GROUP[t] ? t : 'other'),
      dmgType: a.dmgType || (data.damageInflict || []).join('/'),
      range: a.range || (r ? (r.amount ? `${r.amount} ${r.type === 'feet' ? 'ft' : r.type}` : r.type) : ''),
      notes: data.name === 'Eldritch Blast' ? `${1 + (sheet.level >= 5) + (sheet.level >= 11) + (sheet.level >= 17)} beam(s), each its own attack roll${a.notes ? ' · ' + a.notes : ''}` : res.notes,
      level: data.level, slot: +a.slot || data.level, scales: /\{@scale(damage|dice)/.test(JSON.stringify(data.entriesHigherLevel || [])),
    };
  }

  // custom (also feature actions and creature attacks). "[formula]" inside dice/bonuses is evaluated, with `slot` = chosen slot level.
  const v = a.slot ? { ...vars, slot: +a.slot } : vars;
  const expand = x => (x == null || x === '' ? x : String(x).replace(/\[([^\]]+)\]/g, (_, e) => { try { return evalFormula(e, v); } catch { return '0'; } }));
  const own = a.ability === 'best' ? (M('dex') > M('str') ? 'dex' : 'str') : a.ability;
  // unarmed strikes: 1 + STR unless something offers a die or another ability (Martial Arts, Unarmed Fighting, Tavern Brawler, claws…)
  const up = a.unarmed ? upgrades(sheet, { weapon: true, melee: true, unarmed: true }, own && own !== 'none' ? own : 'str', a.dice ? expand(a.dice) : '1', M) : null;
  const abil = up ? up.abil : own, ab = `${abil?.toUpperCase()} mod${up?.abilBy ? ` (${up.abilBy})` : ''}`;
  const t = a.range && !/^(5|10) ?ft/.test(a.range) ? 'ranged' : 'melee';
  const actx = { melee: t === 'melee', ranged: t === 'ranged', str: abil === 'str', ...(up && { weapon: true, unarmed: true }) }, w = up ? ['attack.weapon'] : [];
  let hit = null;
  if (a.hitFixed != null) {
    hit = add(stat(), 'Statblock', +a.hitFixed);
    fx(hit, ['attack.all', `attack.${t}`], actx);
  } else if (abil && abil !== 'none') {
    hit = add(stat(), ab, M(abil));
    if (a.prof) add(hit, 'Proficiency', pb);
    fx(hit, ['attack.all', ...w, `attack.${t}`], actx);
    manual(hit, expand(a.toHit));
  }
  let dmg = null;
  if (a.dice || a.dmgBonus || a.addMod || up) {
    dmg = stat();
    if (up) faces(up.die) > 1 ? addDice(dmg, up.die, up.dieBy ? `Unarmed strike (${up.dieBy})` : 'Unarmed strike') : add(dmg, 'Unarmed strike', 1);
    else if (a.dice) dmg.dice.push(expand(a.dice));
    if (a.addMod && abil && abil !== 'none') add(dmg, ab, M(abil));
    if (hit) fx(dmg, ['damage.all', ...w.map(x => x.replace('attack', 'damage')), `damage.${t}`], actx);
    manual(dmg, expand(a.dmgBonus));
  }
  let save = null;
  if (a.saveDc) { try { save = { dc: evalFormula(expand(a.saveDc), v), ability: a.saveAbility || '' }; } catch { save = { dc: '?', ability: a.saveAbility || '' }; } }
  return { ...res, hit, dmg, save, slot: a.slot, ...(up?.type && { dmgType: up.type }) };
}

// weapon.ability / weapon.die effects are options ("you can use…"): the highest ability and the biggest die win.
// 'spell' = the caster's spellcasting ability; die values may hold [formulas] (Martial Arts die). weapon.dmgType changes the type (claws: slashing).
const faces = d => +(String(d).match(/d(\d+)/)?.[1] ?? 1);
function upgrades({ effects, vars, flags, spellcasting }, ctx, usual, die, M) {
  const on = k => effects.filter(e => e.target === `weapon.${k}` && whenOk(e.when, { ...flags, ...ctx }));
  const r = { abil: usual, abilBy: null, die, dieBy: null, type: null };
  for (const e of on('ability')) {
    const x = e.value === 'spell' ? (spellcasting.find(s => s.cls === e.cls) || spellcasting[0])?.ability : e.value;
    if (x && M(x) > M(r.abil)) Object.assign(r, { abil: x, abilBy: e.label });
  }
  for (const e of on('die')) {
    const d = String(e.value).replace(/\[([^\]]+)\]/g, (_, f) => { try { return evalFormula(f, vars); } catch { return '0'; } });
    if (faces(d) > faces(r.die)) Object.assign(r, { die: /d\d/.test(r.die) ? r.die.replace(/d\d+/, `d${faces(d)}`) : `1d${faces(d)}`, dieBy: e.label });
  }
  for (const e of on('dmgType')) r.type = e.value;
  return r;
}

// "1d8+1d6+5"
export const dmgExpr = s => (s.dice.join('+') + (s.total ? signed(s.total) : '')).replace(/^\+/, '') || '0';
export const hitExpr = s => `1d20${signed(s.total)}${s.dice.map(d => '+' + d).join('')}`;
