// End-to-end browser test: serves the app, drives it in headless Chrome with a fresh profile, asserts on what the sheet shows.
// Run: RULES_REPO=https://github.com/owner/repo npm run test:e2e   (needs Google Chrome; set E2E_CHANNEL= to use Playwright's chromium)
// The rules files are downloaded once into node_modules/.cache/dndcm-e2e-rules and served from there afterwards (delete it to refresh).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// ---------- static server ----------
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)), file = join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const URL0 = `http://127.0.0.1:${server.address().port}/`;

// ---------- browser ----------
const profile = await mkdtemp(join(tmpdir(), 'dndcm-e2e-'));
const channel = process.env.E2E_CHANNEL ?? 'chrome';
const ctx = await chromium.launchPersistentContext(profile, { ...(channel && { channel }), headless: true, viewport: { width: 1400, height: 1000 } });
// the app still fetches and processes every rules file; only the network is skipped once a file is on disk
const CACHE = join(ROOT, 'node_modules/.cache/dndcm-e2e-rules');
await mkdir(CACHE, { recursive: true });
await ctx.route('https://raw.githubusercontent.com/*/*/main/data/**', async route => {
  const file = join(CACHE, createHash('sha1').update(route.request().url()).digest('hex') + '.json');
  const hit = await readFile(file).catch(() => null);
  if (hit) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: hit });
  const r = await route.fetch(), body = await r.body();
  if (r.ok()) await writeFile(file, body);
  return route.fulfill({ response: r, body });
});
const page = ctx.pages()[0] || await ctx.newPage();
page.setDefaultTimeout(8000);
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
page.on('dialog', d => d.accept());

const failures = [];
async function check(name, fn) {
  try { await fn(); console.log('✓', name); } catch (e) {
    failures.push(name);
    console.log('✗', name, '\n   ', e.message.split('\n').slice(0, 8).join('\n    '));
    await page.screenshot({ path: join(profile, `fail-${name.replace(/\W+/g, '_')}.png`), fullPage: true }).catch(() => {});
  }
}
const vit = async label => (await page.locator('.vitals > div', { hasText: label }).locator('b, .num').first().innerText()).trim();
const hpText = async () => (await page.locator('.hpbox').innerText()).replace(/\s+/g, ' ').trim();
const bdText = async k => {
  await page.locator(`.lbl[data-k="${k}"]`).first().click();
  const t = (await page.locator('#dlg').innerText()).replace(/\s+/g, ' ');
  await page.keyboard.press('Escape');
  return t;
};
const pick = async (q, re) => { await page.locator('#dlg input.search').fill(q); await page.locator('.prow button.grow', { hasText: re }).first().click(); };
const menu = blk => page.locator(`[data-blk=${blk}] details.menu > summary`).first().click(); // opens a section's ⋮ menu
// picks re-render on the next frame: wait for it so the following pick doesn't land on a select being replaced
const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
const choose = async (loc, v) => { await loc.selectOption(v); await frame(); };
const done = () => page.locator('#dlg [data-act=lu]').click(); // takes the level
const more = () => page.locator('.namewrap details.menu > summary').click(); // the ⋮ next to the character name
const addItem = async (q, re) => { await menu('inventory'); await page.locator('[data-act=pick][data-what=item]').click(); await pick(q, re); await page.keyboard.press('Escape'); };
const act = name => page.locator('.act', { hasText: name }).first();
const resLeft = async name => page.locator('.status .res', { hasText: name }).first().locator('.pip.on').count();
const open = async id => { await page.goto(`${URL0}#${id}`); await page.reload(); await page.locator('.status').waitFor(); };
const home = async () => { await page.goto(URL0); await page.locator('.card').first().waitFor(); };

// ---------- tests ----------
await home();
await check('rules data downloads into the browser', async () => {
  assert.ok(process.env.RULES_REPO, 'set RULES_REPO to the GitHub link of the rules data repository');
  await page.locator('#base').fill(process.env.RULES_REPO);
  await page.getByRole('button', { name: /Download rules data/ }).click();
  await page.getByText(/^Downloaded .*spells/).waitFor({ timeout: 120000 });
});

await check('lookup: every category is searchable, filter chips include/exclude, narrowed filters browse', async () => {
  await page.locator('[data-act=lookup]').first().click();
  await page.locator('#dlg input.search').fill('beholder');
  await page.locator('.prow', { hasText: /^Beholder\s*Creature · CR 13/ }).waitFor();
  await page.locator('[data-act=lookupf][data-g="Creatures"]').click();
  assert.equal(await page.locator('.prow', { hasText: 'Creature ·' }).count(), 0, 'Creatures switched off');
  assert.ok(await page.locator('.prow', { hasText: 'Item ·' }).count(), 'items still shown');
  await page.locator('#dlg input.search').fill('');
  await page.locator('[data-act=lookupf][data-g="-"]').click(); await page.locator('[data-act=lookupf][data-g="Deities & gifts"]').click();
  await page.locator('.prow', { hasText: 'Deity ·' }).first().waitFor(); // listed without typing
  await page.locator('[data-act=lookupf][data-g="*"]').click();
  await page.keyboard.press('Escape');
});

await check('new character: setup panel, standard array swap, point buy limits', async () => {
  await page.getByRole('button', { name: 'New character' }).click();
  await page.locator('.setup').waitFor();
  const score = a => page.locator('.abtable tr', { hasText: a }).locator('.lbl').innerText();
  assert.equal(await score('Strength'), '15');
  await page.locator('[data-act=assign][data-a=int]').selectOption({ index: 0 });
  assert.equal(await score('Intelligence'), '15'); assert.equal(await score('Strength'), '12');
  await page.locator('[data-act=method][data-m=pointbuy]').click();
  for (let i = 0; i < 7; i++) await page.locator('[data-act=pb][data-a=str][data-d="1"]').click();
  assert.ok(await page.locator('[data-act=pb][data-a=str][data-d="1"]').isDisabled(), '15 is the point-buy cap');
  assert.match(await page.locator('.setup p.small').first().innerText(), /18 of 27 points left/);
  await page.locator('[data-act=method][data-m=array]').click();
});

await check('setup: race, background and class grant proficiencies with their source', async () => {
  await page.locator('[data-act=pick][data-what=race]').click(); await pick('half-elf', /^Half-Elf PHB/);
  await page.locator('[data-act=pick][data-what=background]').click(); await pick('acolyte', /^Acolyte/);
  await page.locator('[data-act=pick][data-what=class]').click(); await pick('rogue', /Rogue/);
  await done(); // first level: maximum hit die, nothing to choose
  // the level's own picks (rogue skills, expertise) keep the dialog open; the half-elf's open picks don't
  await page.keyboard.press('Escape'); await frame();
  const skills = page.locator('#dlg select[data-path^="profChoices.skill:class"]');
  assert.equal(await skills.count(), 4, 'rogue picks 4 skills');
  assert.equal(await page.locator('#dlg select[data-path^="profChoices.skill:race"], #dlg select[data-path^="abilityChoices."]').count(), 0);
  assert.ok(await page.locator('#dlg [data-act=closedlg]').isDisabled());
  for (const [i, s] of ['stealth', 'perception', 'acrobatics', 'deception'].entries()) await choose(skills.nth(i), s);
  assert.equal(await skills.count(), 4, 'made picks stay listed until Done, so they can be changed');
  await choose(skills.nth(3), 'athletics'); await choose(skills.nth(3), 'deception');
  await choose(page.locator('#dlg select[data-path^="profChoices.expertise:"]').first(), 'insight');
  await choose(page.locator('#dlg select[data-path^="profChoices.expertise:"]').nth(1), 'stealth');
  await page.locator('#dlg [data-act=closedlg]').click();
  assert.match(await bdText('save.dex'), /Proficiency \(Rogue\)/);
  assert.equal(await page.locator('.setup select[data-path^="profChoices.skill:class"]').count(), 4);
  assert.match(await bdText('skill.religion'), /Proficiency \(Acolyte\)/);
  assert.match(await bdText('skill.insight'), /Expertise \(Rogue Expertise/);
  // background kit: items unpacked into single entries, pouch coins into the purse; swapping takes the old kit back
  const inv = () => page.locator('[data-blk=inventory]').innerText(), gp = () => page.locator('input[data-path="currency.gp"]').inputValue();
  assert.match(await inv(), /Sticks of incense\s*×5/); assert.match(await inv(), /Vestments/); assert.equal(await gp(), '15');
  await page.locator('.kit select[data-act=kitopt]').selectOption('b');
  await page.locator('details.item', { hasText: 'Prayer wheel' }).waitFor();
  assert.equal(await page.locator('details.item', { hasText: /^\s*Book/ }).count(), 0, 'option a swapped out');
  await page.locator('[data-act=pick][data-what=background]').click(); await pick('sage', /^Sage/);
  await page.locator('details.item', { hasText: 'Quill' }).waitFor();
  assert.doesNotMatch(await inv(), /incense/); assert.equal(await gp(), '10');
  await page.locator('[data-act=pick][data-what=background]').click(); await pick('acolyte', /^Acolyte/);
  await page.locator('details.item', { hasText: 'Vestments' }).waitFor(); assert.equal(await gp(), '15');
});

await check('setup confirm hides the panel; Edit character brings it back', async () => {
  await page.locator('[data-act=setupdone]').click();
  assert.equal(await page.locator('.setup').count(), 0);
  await more(); await page.locator('[data-act=editsetup]').click(); await page.locator('.setup').waitFor();
  await page.locator('[data-act=setupdone]').click();
});

await check('level up: hit points, archetype and ASI before Done; ⚠ lists open picks', async () => {
  for (let l = 2; l <= 4; l++) {
    await more(); await page.locator('[data-act=levelchooser]').click();
    await page.locator('[data-act=lvlup]').first().click();
    assert.ok(await page.locator('#dlg [data-act=lu]').isDisabled(), 'hit points not chosen yet');
    await choose(page.locator('#dlg select[data-path="@lu.hp"]'), 'avg');
    if (l === 3) {
      assert.ok(await page.locator('#dlg [data-act=lu]').isDisabled(), 'no archetype yet');
      await choose(page.locator('#dlg select[data-act=setsub]'), { label: 'Thief (PHB)' });
    }
    if (l === 4) {
      await page.locator('[data-act=asi][data-a=dex]').click();
      assert.ok(await page.locator('#dlg [data-act=lu]').isDisabled(), 'one ASI point still to spend');
      await page.locator('[data-act=asi][data-a=dex]').click();
    }
    await done();
  }
  assert.match(await bdText('ability.dex'), /ASI \/ other \+2/);
  await menu('features'); await page.locator('[data-act=pick][data-what=feat]').click(); await pick('skilled', /^Skilled/); await page.keyboard.press('Escape');
  await page.locator('.namewrap [data-act=openpicks]').click(); // ⚠: the open picks in an overlay
  await choose(page.locator('#dlg select[data-path^="profChoices.skill:feat:Skilled"]').first(), 'medicine');
  await page.keyboard.press('Escape');
  assert.match(await bdText('skill.medicine'), /Proficiency \(Skilled\)/);
  await page.locator('details.feat summary', { hasText: 'Skilled' }).click();
  await page.locator('details.feat[open] [data-act=delsource]').click();
  assert.doesNotMatch(await bdText('skill.medicine'), /Proficiency/, 'removing the feat removes its grant');
});

await check('edit character: level-up breakdown, edit a level, undo only the latest', async () => {
  await more(); await page.locator('[data-act=editsetup]').click();
  const rows = page.locator('.setup .lvrow'), max = async () => +(await hpText()).match(/\/ (\d+)/)[1];
  assert.equal(await rows.count(), 4);
  assert.match(await rows.nth(2).innerText(), /Rogue 3[\s\S]*Thief/);
  assert.match(await rows.nth(3).innerText(), /ASI DEX \+2/);
  await rows.nth(3).locator('[data-act=lvedit]').click();
  await choose(page.locator('#dlg select[data-act=lvasi]').nth(1), 'str');
  await choose(page.locator('#dlg select[data-act=lvhp]'), '8');
  await page.locator('#dlg [data-act=closedlg]').click();
  assert.match(await rows.nth(3).innerText(), /HP 8 \(rolled\)[\s\S]*ASI STR \+1, DEX \+1/);
  assert.match(await bdText('ability.str'), /ASI \/ other \+1/);
  const m0 = await max();
  await rows.nth(3).locator('[data-act=lvundo]').click();
  assert.equal(await rows.count(), 3);
  assert.ok(await max() < m0, 'level 4 hit points removed');
  assert.doesNotMatch(await bdText('ability.str'), /ASI \/ other \+[1-9]/);
  assert.doesNotMatch(await bdText('ability.dex'), /ASI \/ other \+[1-9]/);
  assert.match(await rows.nth(2).innerText(), /Thief/, 'earlier levels untouched');
  assert.equal(await rows.nth(2).locator('[data-act=lvundo]').count(), 1, 'level 3 is now the one to undo');
  await page.locator('[data-act=setupdone]').click();
});

await check('items: packs unpack, attunement drives AC, potions become actions, armor proficiency warning', async () => {
  await addItem("explorer's pack", /^Explorer's Pack/);
  assert.match(await page.locator('details.item', { hasText: 'Torch' }).innerText(), /×10/);
  const ac0 = +(await vit('AC'));
  await addItem('ring of protection', /^Ring of Protection/);
  await page.locator('details.item', { hasText: 'Ring of Protection' }).locator('[data-act=attune]').click();
  assert.equal(+(await vit('AC')), ac0 + 1);
  await addItem('potion of healing', /^Potion of Healing/);
  await page.locator('details.item', { hasText: 'Potion of Healing' }).locator('summary').click(); // + Action sits in the expanded item
  await page.locator('details.item[open]', { hasText: 'Potion of Healing' }).locator('[data-act=itemaction]').click();
  assert.match(await act('Potion of Healing').innerText(), /2d4\+2/);
  await addItem('plate armor', /^Plate Armor/);
  await page.locator('details.item', { hasText: 'Plate Armor' }).locator('[data-act=equip]').click();
  assert.match(await bdText('ac'), /Not proficient with heavy armor/);
});

await check('magic variants: +1 Longsword is a proper weapon with its bonus', async () => {
  await menu('inventory'); await page.locator('[data-act=pick][data-what=item]').click(); await pick('+1 weapon', /^\+1 Weapon/); await pick('longsword', /^Longsword/);
  await page.keyboard.press('Escape');
  await page.locator('details.item', { hasText: '+1 Longsword' }).locator('summary').click(); // + Action sits in the expanded item
  await page.locator('details.item[open]', { hasText: '+1 Longsword' }).locator('[data-act=itemaction]').click();
  assert.match(await act('+1 Longsword').innerText(), /1d8\+\d/);
});

await check('example characters load with the expected numbers', async () => {
  await home();
  await page.getByRole('button', { name: 'Load example characters' }).click();
  await page.locator('.row', { hasText: 'Ember Kastor' }).waitFor();
  const expect = { barbarian: [14, 40, '59 / 59'], druid: [11, 40, '34 / 34'], monk: [17, 40, '38 / 38'], paladin: [19, 30, '44 / 44'], warlock: [13, 30, '38 / 38'],
    cleric: [18, 25, '48 / 48'], fighter: [16, 30, '49 / 49'], bard: [14, 25, '33 / 33'], sorcerer: [15, 30, '37 / 37'] };
  for (const [id, [ac, speed, hp]] of Object.entries(expect)) {
    await open(`example-${id}`);
    assert.deepEqual([+(await vit('AC')), +(await vit('Speed')), (await hpText()).slice(0, hp.length)], [ac, speed, hp], id);
  }
});

await check('barbarian: Rage spends a use, adds damage and turns on the Bear totem', async () => {
  await open('example-barbarian');
  assert.equal(await act('Greataxe').locator('[data-act=rdmg]').innerText(), '1d12+4');
  await act('Rage').locator('[data-act=useaction]').click();
  assert.equal(await act('Greataxe').locator('[data-act=rdmg]').innerText(), '1d12+6');
  assert.equal(await resLeft('Rage'), 3);
  assert.match(await bdText('ac'), /Bear totem: resistance/);
  assert.equal(await page.locator('details.feat [data-act=effects], details.item [data-act=effects], [data-act=trackuses], [data-act=itemuses]').count(), 0,
    'no Effects… / Track uses buttons on features and items');
});

await check('druid: beast HP absorbs damage, overflow reverts; Moon limits allow CR 2', async () => {
  await open('example-druid');
  assert.match(await page.locator('.status').getAttribute('style'), /classes\/PHB\/Druid\.webp/, 'druid art behind the top panel');
  assert.match(await hpText(), /^34 \/ 34 Brown Bear HP · yours 45\/45/);
  await page.locator('#hpamt').fill('40'); await page.locator('[data-act=hp][data-op=dmg]').click();
  assert.equal(await page.locator('.shape').count(), 0);
  assert.match(await hpText(), /^39 \/ 45/);
  await page.locator('.status [data-act=wildshape]').click();
  assert.match(await page.locator('#dlg h2').innerText(), /CR 2, no flying speed/);
  await pick('dire wolf', /^Dire Wolf/);
  assert.equal(+(await vit('AC')), 14);
  assert.equal(await resLeft('Wild Shape'), 0);
  assert.match(await act('Bite (Dire Wolf)').innerText(), /2d6\+3/);
});

await check('druid: Shillelagh turns the quarterstaff into WIS + d8, scimitar untouched', async () => {
  await open('example-druid');
  if (await page.locator('[data-act=revert]').count()) await page.locator('[data-act=revert]').click();
  const qs = () => act('Quarterstaff').locator('[data-act=rdmg]');
  assert.equal(await qs().innerText(), '1d6');
  await page.locator('.spell', { hasText: 'Shillelagh' }).locator('[data-act=toggle]').click();
  await act('Quarterstaff').locator('[data-act=rdmg]', { hasText: /^1d8\+4$/ }).waitFor();
  assert.equal(await act('Scimitar').locator('[data-act=rdmg]').innerText(), '1d6+3');
  await page.locator('.spell', { hasText: 'Shillelagh' }).locator('[data-act=toggle]').click();
  await act('Quarterstaff').locator('[data-act=rdmg]', { hasText: /^1d6$/ }).waitFor();
});

await check('monk: martial arts uses DEX and the d6 die; Flurry spends ki', async () => {
  await open('example-monk');
  assert.match(await act('Martial Arts strike').innerText(), /\+7[\s\S]*1d6\+4/);
  assert.equal(await act('Unarmed Strike').locator('[data-act=rdmg]').innerText(), '1d6+4', 'unarmed strike gets DEX and the martial arts die');
  await act('Flurry of Blows').locator('[data-act=useaction]').click();
  assert.equal(await resLeft('Ki'), 4);
});

await check('paladin: smite spends the chosen slot; lay on hands spends the pool', async () => {
  await open('example-paladin');
  await act('Divine Smite').locator('select').selectOption('2');
  await act('Divine Smite').locator('[data-act=rdmg]', { hasText: /^3d8$/ }).waitFor(); // re-render happens on the next frame
  await act('Divine Smite').locator('[data-act=useaction]').click();
  assert.equal(await page.locator('.slotrow').nth(1).locator('.pip.on').count(), 1);
  const loh = () => page.locator('.status .res', { hasText: 'Lay on Hands' }).innerText();
  await act('Lay on Hands').locator('[data-act=useaction]').click();
  assert.match(await loh(), /24\/25/, 'healing spends one point per press');
  await act('Lay on Hands: Cure').locator('[data-act=useaction]').click();
  assert.match(await loh(), /19\/25/, 'curing spends five');
  assert.ok(await page.locator('.spell.granted', { hasText: 'Sanctuary' }).count(), 'oath spells are always prepared');
});

await check('sorcerer: Font of Magic turns 2 points into a 1st-level slot', async () => {
  await open('example-sorcerer');
  assert.equal(await page.locator('.slotrow').nth(0).locator('.pip.on').count(), 3);
  await page.locator('[data-act=fontslot][data-l="0"]').click();
  assert.equal(await page.locator('.slotrow').nth(0).locator('.pip.on').count(), 4);
  assert.equal(await resLeft('Sorcery Points'), 3);
});

await check('warlock: Agonizing Blast, two beams at 5th level, imp familiar, innate spell', async () => {
  await open('example-warlock');
  const eb = await act('Eldritch Blast').innerText();
  assert.match(eb, /1d10\+4/); assert.match(eb, /2 beam/);
  assert.match(await page.locator('details.comp summary').innerText(), /Sizzle[\s\S]*HP 10\/10/);
  await page.locator('.spell', { hasText: 'Hellish Rebuke' }).locator('[data-act=cast]').click();
  assert.match((await page.locator('#dlg [data-act=castat]').allInnerTexts()).join('|'), /Innate \(1\/day\)/);
  await page.keyboard.press('Escape');
});

await check('fighter: extra attack, maneuver DC, great weapon fighting note', async () => {
  await open('example-fighter');
  assert.match(await page.locator('.blk[data-blk=actions]').innerText(), /makes 2 attacks/);
  assert.match(await act('Maneuver').innerText(), /DC 15/);
  assert.match(await act('Greatsword').innerText(), /Great Weapon Fighting/);
  const fist = () => act('Unarmed Strike').locator('[data-act=rdmg]');
  assert.match(await fist().innerText(), /^\d+$/, 'plain unarmed strike is 1 + STR');
  await page.locator('[data-blk=features] details.fold > summary').click(); // all picks made: folded behind "View selection…"
  await page.locator('select[data-path="featureChoices.of:Fighter:cls:Fighting Style.0"]').selectOption({ label: 'Unarmed Fighting' });
  await act('Unarmed Strike').locator('[data-act=rdmg]', { hasText: /^1d6\+\d$/ }).waitFor(); // greatsword equipped: d6
  await page.locator('details.item', { hasText: 'Greatsword' }).locator('[data-act=equip]').click();
  await act('Unarmed Strike').locator('[data-act=rdmg]', { hasText: /^1d8\+\d$/ }).waitFor(); // empty hands: d8
});

await check('cleric: Life Domain grants heavy armor; undo restores removals, 3 steps deep', async () => {
  await open('example-cleric');
  assert.doesNotMatch(await bdText('ac'), /Not proficient/);
  const n = await page.locator('.spell').count();
  for (let i = 0; i < 4; i++) { const row = page.locator('.spell:has([data-act=delspell])').first(); await row.locator('details.menu > summary').click(); await row.locator('[data-act=delspell]').click(); }
  for (let i = 0; i < 3; i++) await page.locator('[data-act=undo]').click();
  assert.equal(await page.locator('.spell').count(), n - 1, 'only the last 3 changes come back');
  assert.ok(await page.locator('[data-act=undo]').isDisabled());
});

await check('death saves: three successes hide them (stable); damage at 0 HP brings them back with a failure', async () => {
  await open('example-fighter');
  await page.locator('#hpamt').fill('999'); await page.locator('[data-act=hp][data-op=dmg]').click();
  await page.locator('[data-act=ds][data-w=s]').nth(2).click();
  assert.equal(await page.locator('[data-act=ds]').count(), 0, 'stable: no death saves');
  await page.locator('#hpamt').fill('1'); await page.locator('[data-act=hp][data-op=dmg]').click();
  assert.equal(await page.locator('[data-act=ds][data-w=s].on').count(), 0);
  assert.equal(await page.locator('[data-act=ds][data-w=f].on').count(), 1);
  await page.getByRole('button', { name: 'Long rest' }).click(); await page.locator('[data-act=finishlong]').click();
});

await check('feat instead of an ASI: picker, then the feat\'s own picks, before the level closes', async () => {
  await open('example-fighter');
  await more(); await page.locator('[data-act=levelchooser]').click();
  await page.locator('[data-act=lvlup]').first().click();
  await page.locator('#dlg [data-path="@lu.feat"]').check();
  await choose(page.locator('#dlg select[data-path="@lu.hp"]'), 'avg'); await done();
  await page.keyboard.press('Escape'); await frame(); // closing the picker returns to the level's choices
  await page.locator('#dlg [data-act=pick][data-what=feat]').click(); await pick('skilled', /^Skilled/);
  const sel = page.locator('#dlg select[data-path^="profChoices.skill:feat:Skilled"]');
  for (const [i, s] of ['arcana', 'history', 'nature'].entries()) await choose(sel.nth(i), s);
  await page.locator('#dlg [data-act=closedlg]').click();
  assert.equal(await page.locator('#dlg[open]').count(), 0);
  assert.equal(await page.locator('.namewrap [data-act=openpicks]').count(), 0, 'nothing left to choose');
  assert.match(await bdText('skill.nature'), /Proficiency \(Skilled\)/);
});

await check('rename and change image: link, upload (shrunk to 900 px), back to class art', async () => {
  await open('example-monk');
  await more(); await page.locator('[data-act=rename]').click();
  await page.locator('#newname').fill('Kael the Swift'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('.charname').innerText(), 'Kael the Swift');
  const art = () => page.locator('.status').getAttribute('style');
  await more(); await page.locator('[data-act=image]').click();
  await page.locator('#imgurl').fill('javascript:alert(1)'); await page.keyboard.press('Enter');
  await page.locator('#dlg .warn').waitFor(); // only http(s) links
  await page.locator('#imgurl').fill("https://example.com/k'ael.png"); await page.keyboard.press('Enter');
  assert.match(await art(), /url\('https:\/\/example\.com\/k%27ael\.png'\)/, 'quote escaped inside url()');
  const png = Buffer.from(await page.evaluate(async () => { const c = Object.assign(document.createElement('canvas'), { width: 2000, height: 1000 });
    return [...new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer())]; }));
  await more(); await page.locator('[data-act=image]').click();
  await page.locator('[data-act=imgfile]').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: png });
  await page.locator('.status[style*="data:image/png"]').waitFor();
  assert.deepEqual(await page.evaluate(src => new Promise(ok => { const i = new Image(); i.onload = () => ok([i.width, i.height]); i.src = src; }),
    (await art()).match(/url\('([^']+)'\)/)[1]), [900, 450]);
  await more(); await page.locator('[data-act=image]').click(); await page.locator('[data-act=imgreset]').click();
  assert.match(await art(), /classes\/PHB\/Monk/, 'class art again');
});

await check('layout adapts: 3 / 2 / 1 columns, no sideways scroll, ability boxes fit their panel', async () => {
  await open('example-cleric');
  const cols = () => page.locator('.grid > .col').count();
  assert.equal(await cols(), 3);
  for (const width of [1400, 1099, 860, 700, 560, 390]) { // panels sit in columns of very different widths
    await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(200);
    const over = await page.evaluate(() => { const r = document.querySelector('[data-blk=abilities] .card').getBoundingClientRect();
      return [...document.querySelectorAll('.abil')].some(a => a.getBoundingClientRect().right > r.right + 1); });
    assert.ok(!over, `ability boxes overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 1400, height: 1000 }); await page.waitForTimeout(200);
  await page.setViewportSize({ width: 900, height: 1000 }); await page.waitForTimeout(200);
  assert.equal(await cols(), 2);
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  assert.equal(await cols(), 1);
  assert.ok(await page.locator('.jump').isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390));
  await page.setViewportSize({ width: 1400, height: 1000 });
});

await check('works offline after the first visit', async () => {
  await page.waitForTimeout(1000); // let the service worker finish caching the shell
  await ctx.setOffline(true);
  await page.reload(); await page.locator('.status').waitFor();
  assert.equal(+(await vit('AC')), 18);
  const art = (await page.locator('.status').getAttribute('style')).match(/url\('([^']+)'\)/)[1];
  assert.ok(await page.evaluate(src => new Promise(ok => { const i = new Image(); i.onload = () => ok(true); i.onerror = () => ok(false); i.src = src; }), art), 'class art loads offline');
  await ctx.setOffline(false);
});

// ---------- random builds: chosen in one go vs chosen differently and edited afterwards ----------
// Build A takes every choice from one set of preferences; build B makes other choices while levelling (another subclass,
// other picks, rolled hit points), then edits each level back through the level history. Some options only exist later
// (expertise in a skill gained at a later level), so both end with a settle pass: every level's Edit, preferences applied
// until nothing changes. The saved character and the whole sheet must then match. A also levels once more and undoes it.
// E2E_FUZZ = number of characters (default 4), E2E_SEED = starting seed (printed, to replay a failure).
const FUZZ = +(process.env.E2E_FUZZ ?? 4), SEED0 = +(process.env.E2E_SEED ?? Date.now() % 1e6);
const hash = str => { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const rng = seed => () => { // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
};
const CLASSES = ['Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard'];
const RACES = [['human', /^Human PHB/], ['half-orc', /^Half-Orc PHB/], ['half-elf', /^Half-Elf PHB/]];
function randomSpec(seed) {
  const r = rng(seed), any = xs => xs[Math.floor(r() * xs.length)], levels = 3 + Math.floor(r() * 6), first = any(CLASSES);
  const second = r() < 0.4 ? any(CLASSES.filter(c => c !== first)) : null, joins = 2 + Math.floor(r() * (levels - 1));
  return { race: any(RACES), steps: Array.from({ length: levels }, (_, i) => (second && i + 1 >= joins && r() < 0.6 ? second : first)) };
}
// the dialog's selects, grouped (a pick's slots share a group); each group's slots get its options ranked by the seed
async function fillDialog(seed) {
  let changes = 0;
  for (let guard = 0; guard < 60; guard++) {
    const sels = await page.$$eval('#dlg select', els => els.map(e => ({ path: e.dataset.path, act: e.dataset.act, i: e.dataset.i, n: e.dataset.n, j: e.dataset.j, c: e.dataset.c, l: e.dataset.l, value: e.value,
      opts: [...e.options].filter(o => o.value && !o.disabled && !o.text.includes('prerequisite not met')).map(o => o.value) })));
    const group = x => (x.path ? x.path.replace(/\.\d+$/, '') : `${x.act}:${x.i ?? x.n ?? x.c}`), slot = x => +(x.path?.match(/\.(\d+)$/)?.[1] ?? x.j ?? 0);
    const sel = x => (x.path ? `#dlg select[data-path="${x.path}"]` : x.act === 'lvasi' ? `#dlg select[data-act=lvasi][data-n="${x.n}"][data-j="${x.j}"]`
      : x.act === 'lvhp' ? `#dlg select[data-act=lvhp][data-c="${x.c}"][data-l="${x.l}"]` : `#dlg select[data-act=${x.act}][data-i="${x.i}"]`);
    const want = x => {
      if (x.act === 'lvhp') return ''; // average: build B's rolls are edited back here
      const opts = [...new Set(sels.filter(y => group(y) === group(x)).flatMap(y => y.opts))].sort((a, b) => hash(`${seed}|${group(x)}|${a}`) - hash(`${seed}|${group(x)}|${b}`));
      return opts.length ? opts[slot(x) % opts.length] : x.value;
    };
    const x = sels.find(y => y.value !== want(y));
    if (!x) return changes;
    await choose(page.locator(sel(x)), want(x)); changes++;
  }
  throw Error('dialog choices never settled');
}
// stage 1 of a level-up (hit points, subclass, ASI), Done, then the level's own choices
async function levelStage(seed, rollHp) {
  const hp = page.locator('#dlg select[data-path="@lu.hp"]');
  if (await hp.count()) await choose(hp, rollHp ? 'roll' : 'avg');
  const sub = page.locator('#dlg select[data-act=setsub]');
  if (await sub.count()) await fillDialog(seed);
  for (let k = 0; k < 2; k++) {
    const btns = await page.$$eval('#dlg [data-act=asi]:not(:disabled)', bs => bs.map(b => b.dataset.a));
    if (!btns.length) break;
    const a = btns.sort((x, y) => hash(`${seed}|asi|${x}`) - hash(`${seed}|asi|${y}`))[0];
    await page.locator(`#dlg [data-act=asi][data-a=${a}]`).click(); await frame();
  }
  await done(); await frame();
  if (await page.locator('#dlg[open] [data-act=closedlg]').count()) {
    await fillDialog(seed);
    assert.ok(!(await page.locator('#dlg [data-act=closedlg]').isDisabled()), `level choices can't be completed: ${(await page.locator('#dlg').innerText()).slice(0, 300)}`);
    await page.locator('#dlg [data-act=closedlg]').click(); await frame();
  }
}
async function build(spec, seed, rollHp) {
  await home(); await page.getByRole('button', { name: 'New character' }).click(); await page.locator('.setup').waitFor();
  await page.locator('[data-act=pick][data-what=race]').click(); await pick(...spec.race);
  await page.locator('[data-act=pick][data-what=background]').click(); await pick('soldier', /^Soldier/);
  const joined = [];
  for (const [i, c] of spec.steps.entries()) {
    if (i) { await more(); await page.locator('[data-act=levelchooser]').click(); }
    if (!joined.includes(c)) { await page.locator(i ? '#dlg [data-act=pick][data-what=class]' : '[data-act=pick][data-what=class]').click(); await pick(c.toLowerCase(), new RegExp(`^${c}`)); joined.push(c); }
    else await page.locator(`#dlg [data-act=lvlup][data-i="${joined.indexOf(c)}"]`).click();
    await levelStage(seed, rollHp && i > 0);
    if (!i) await page.locator('[data-act=setupdone]').click();
  }
  await page.locator('#hpamt').fill('3'); await page.locator('[data-act=hp][data-op=dmg]').click(); // edits must keep this gap
}
async function settle(seed) { // -> how many choices it changed
  await more(); await page.locator('[data-act=editsetup]').click();
  let total = 0;
  for (let pass = 0; pass < 5; pass++) {
    let changes = 0;
    for (let n = 0; n < await page.locator('.setup .lvrow').count(); n++) {
      await page.locator('.setup .lvrow').nth(n).locator('[data-act=lvedit]').click();
      changes += await fillDialog(seed);
      await page.locator('#dlg [data-act=closedlg]').click(); await frame();
    }
    total += changes;
    if (!changes) { await page.locator('[data-act=setupdone]').click(); return total; }
  }
  throw Error('level edits never settled');
}
// the saved character (minus identity) with keys sorted and empty picks dropped, plus everything the sheet shows
async function fingerprint() {
  await page.waitForTimeout(400); // saves are debounced
  const c = await page.evaluate(id => new Promise((res, rej) => {
    const r = indexedDB.open('dnd-cm', 1);
    r.onsuccess = () => { const q = r.result.transaction('characters').objectStore('characters').get(id); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); };
  }), await page.evaluate(() => location.hash.slice(1)));
  const canon = v => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]).filter(([, x]) => !(Array.isArray(x) && !x.some(y => y != null)))) : v);
  const { classes, levels, featureChoices, profChoices, abilityChoices, feats, asiBonuses, skillProfs, hp } = c;
  return { data: JSON.stringify(canon({ classes, levels, featureChoices, profChoices, abilityChoices, feats, asiBonuses, skillProfs, hp })), sheet: await page.locator('#app').innerText() };
}
const firstDiff = (a, b) => { const x = a.split('\n'), y = b.split('\n'), i = x.findIndex((l, k) => l !== y[k]); return i < 0 ? '(length)' : `line ${i}: ${JSON.stringify(x[i])} vs ${JSON.stringify(y[i])}`; };
const jsonDiff = (a, b) => { const x = JSON.parse(a), y = JSON.parse(b); return Object.keys({ ...x, ...y }).filter(k => JSON.stringify(x[k]) !== JSON.stringify(y[k])).map(k => `${k}: ${JSON.stringify(x[k])} vs ${JSON.stringify(y[k])}`).join('\n    '); };

await check('an earlier edit ripples: new subclass picks in the same Edit, unmet prerequisites flagged, stale expertise cleared', async () => {
  await build({ race: RACES[0], steps: ['Fighter', 'Fighter'] }, 'ripple', false);
  const lvl = async () => { await more(); await page.locator('[data-act=levelchooser]').click(); await page.locator('#dlg [data-act=lvlup]').click(); await choose(page.locator('#dlg select[data-path="@lu.hp"]'), 'avg'); };
  await lvl(); await choose(page.locator('#dlg select[data-act=setsub]'), { label: 'Champion (PHB)' }); await done();
  await lvl(); await page.locator('#dlg [data-path="@lu.feat"]').check(); await done(); await pick('grappler', /^Grappler/);
  await page.locator('#dlg [data-act=closedlg]').click();
  await more(); await page.locator('[data-act=editsetup]').click();
  await page.locator('.setup .lvrow').nth(2).locator('[data-act=lvedit]').click();
  await choose(page.locator('#dlg select[data-act=setsub]'), { label: 'Battle Master (PHB)' });
  assert.equal(await page.locator('#dlg select[data-path^="featureChoices.of:Fighter:sub:Maneuvers"]').count(), 3, "the new subclass's picks join the open Edit");
  await page.locator('#dlg [data-act=closedlg]').click();
  await choose(page.locator('[data-act=assign][data-a=str]'), { index: 5 }); // STR 8: Grappler needs 13
  await page.locator('[data-act=setupdone]').click();
  await page.locator('.namewrap [data-act=openpicks]').click();
  assert.match(await page.locator('#dlg').innerText(), /Grappler: prerequisite no longer met/);
  await page.keyboard.press('Escape');

  await build({ race: RACES[0], steps: ['Rogue'] }, 'ripple', false);
  await more(); await page.locator('[data-act=editsetup]').click();
  await page.locator('.setup .lvrow').first().locator('[data-act=lvedit]').click();
  const skill = i => page.locator(`#dlg select[data-path="profChoices.skill:class.${i}"]`), exp = i => page.locator(`#dlg select[data-path^="profChoices.expertise:"][data-path$=".${i}"]`);
  for (const [i, v] of ['stealth', 'perception', 'acrobatics', 'deception'].entries()) await choose(skill(i), v);
  await choose(exp(0), 'stealth'); await choose(exp(1), 'perception');
  await choose(skill(0), 'investigation'); // stealth no longer proficient: its expertise goes
  assert.equal(await exp(0).inputValue(), '');
  assert.match(await exp(0).getAttribute('class'), /unset/);
  await page.locator('#dlg [data-act=closedlg]').click();
  assert.doesNotMatch(await bdText('skill.stealth'), /Expertise|Proficiency/);
  await page.locator('[data-act=setupdone]').click();
});

for (let f = 0; f < FUZZ; f++) {
  const seed = SEED0 + f, spec = randomSpec(seed);
  await check(`random build ${seed} (${spec.race[0]}, ${spec.steps.join(' ')}): edited afterwards = chosen in one go; undo restores`, async () => {
    await build(spec, `${seed}final`, false); await settle(`${seed}final`);
    const a = await fingerprint();
    if (spec.steps.length < 20) {
      await more(); await page.locator('[data-act=levelchooser]').click(); await page.locator('#dlg [data-act=lvlup]').first().click();
      await levelStage(`${seed}extra`, true);
      await more(); await page.locator('[data-act=editsetup]').click();
      await page.locator('.setup .lvrow').last().locator('[data-act=lvundo]').click();
      await page.locator('[data-act=setupdone]').click();
      const u = await fingerprint();
      assert.ok(u.data === a.data, `undo left the character changed:\n    ${jsonDiff(a.data, u.data)}`);
      assert.ok(u.sheet === a.sheet, `undo left the sheet changed: ${firstDiff(a.sheet, u.sheet)}`);
    }
    await build(spec, `${seed}first`, true);
    const edits = await settle(`${seed}final`), b = await fingerprint();
    console.log(`    build B needed ${edits} edits`);
    assert.ok(edits > 0, 'build B was never edited: the comparison proves nothing');
    assert.ok(b.data === a.data, `edited build differs:\n    ${jsonDiff(a.data, b.data)}`);
    assert.ok(b.sheet === a.sheet, `edited build's sheet differs: ${firstDiff(a.sheet, b.sheet)}`);
  });
}
if (FUZZ) console.log(`random builds: seeds ${SEED0}…${SEED0 + FUZZ - 1} (E2E_SEED=${SEED0} replays them)`);

await check('no uncaught page errors', async () => assert.deepEqual(pageErrors, []));

await ctx.close();
server.close();
if (failures.length) {
  console.log(`\n${failures.length} failed — screenshots in ${profile}`);
  process.exit(1);
}
await rm(profile, { recursive: true, force: true });
console.log('\ne2e.test.mjs: all checks passed');
