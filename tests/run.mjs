// NOEON Words — automatic checks before a release.
// Runs the app in a headless phone browser with the network switched off and a fake server,
// and walks through the main scenarios. Exit code 0 = everything passed.
// Local:  node tests/run.mjs        (serves the folder itself)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pw;
try { pw = await import('playwright'); } catch (e) { pw = await import('/opt/npm-tools/node_modules/playwright/index.mjs'); }
const { chromium, devices } = pw;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.css': 'text/css', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => {
  let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/') f = '/index.html';
  const p = path.join(ROOT, f);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r);
}).listen(0);
const PORT = srv.address().port;

const exe = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const results = []; let failed = 0;

async function page() {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  const pg = await ctx.newPage();
  pg.errs = [];
  pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.route(u => !u.href.startsWith('http://127.0.0.1:' + PORT), r => r.abort());
  await pg.goto(`http://127.0.0.1:${PORT}/index.html`);
  await pg.waitForFunction(() => typeof go === 'function' && typeof S === 'object');
  await pg.evaluate(() => { window.confirm = () => true; window.alert = () => {}; S.settings.lang = 'ru'; S.settings.theme = 'light'; });
  return pg;
}
async function check(name, fn) {
  const pg = await page();
  try {
    const r = await fn(pg);
    if (pg.errs.length) throw new Error('ошибка на странице: ' + pg.errs[0]);
    results.push(['ok', name, r || '']);
  } catch (e) { failed++; results.push(['FAIL', name, String(e.message || e).split('\n')[0].slice(0, 300)]); }
  await pg.context().close();
}

/* shared helpers injected into the page */
const SEED = () => {
  window.sleep = ms => new Promise(r => setTimeout(r, ms));
  window.assert = (c, m) => { if (!c) throw new Error(m); };
  window.txt = () => document.querySelector('#app').innerText;
  const W = (en, ru, ex, ok, bad, box) => Object.assign(newWord(en, ru, ex || ''), { ok: ok || 0, bad: bad || 0, box: box || 0 });
  S.sets = [{ id: 's1', name: 'Unit 1', lang: 'en', upd: 1, synced: true, words: [
    W('thorough', 'тщательный', 'The police carried out a thorough search of the house.', 1, 6),
    W('reluctant', 'неохотный', 'She was reluctant to admit that she had made a mistake.', 2, 5),
    W('reliable', 'надёжный', 'He is a reliable friend.', 3, 1, 1),
    W('relevant', 'актуальный', 'This question is not relevant to the topic.', 2, 0, 2),
    W('remarkable', 'замечательный', 'It was a remarkable achievement.'),
    W('receive', 'получать', 'Did you receive my letter?'),
    W('whereas', 'тогда как', '', 0, 4),
    W('go', 'идти', 'Yesterday we went to the park.', 0, 0, 3)]}];
  save();
};
/* a fake server: answers every request with the given rows */
const FAKE = (rows) => {
  const res = tb => ({ data: rows[tb] || [], error: null, count: (rows[tb] || []).length });
  const mk = tb => { const c = new Proxy(function () {}, { get: (_, k) => k === 'then' ? (f, g) => Promise.resolve(res(tb)).then(f, g)
    : (k === 'maybeSingle' || k === 'single') ? () => Promise.resolve({ data: (rows[tb] || [])[0] || null, error: null })
    : (k === 'insert' || k === 'upsert' || k === 'update' || k === 'delete') ? (x) => { (window.SENT = window.SENT || []).push([tb, k, x]); return mk(tb); }
    : () => c }); return c; };
  sb = { from: mk, rpc: (n) => Promise.resolve({ data: (rows.rpc || {})[n] ?? null, error: null }),
    channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }), removeChannel() {},
    auth: { signOut: () => Promise.resolve({}), getSession: () => Promise.resolve({ data: { session: null } }) },
    functions: { invoke: () => Promise.resolve({ data: {}, error: null }) } };
};

/* ------------------------------ scenarios ------------------------------ */
await check('запуск: все главные экраны открываются', async pg => pg.evaluate(async (seed) => {
  eval('(' + seed + ')()');
  for (const [n, p] of [['today', {}], ['vocab', {}], ['set', { id: 's1' }], ['archive', {}], ['me', {}], ['text', {}], ['library', {}], ['wf', {}], ['progress', { tab: 'cal' }], ['progress', { tab: 'words' }], ['progress', { tab: 'week' }], ['progress', { tab: 'vt' }]]) {
    go(n, p); await sleep(60); assert(txt().length > 20, 'пустой экран ' + n);
  }
}, SEED.toString()));

await check('слово: добавить, найти, удалить', async pg => pg.evaluate(async (seed) => {
  eval('(' + seed + ')()');
  const s = S.sets[0], n0 = s.words.length;
  s.words.unshift(newWord('apple', 'яблоко')); save(); go('set', { id: 's1' }); await sleep(60);
  assert(txt().includes('apple'), 'новое слово не видно');
  s.words = s.words.filter(w => w.en !== 'apple'); save(); go('set', { id: 's1' }); await sleep(60);
  assert(!txt().includes('apple') && s.words.length === n0, 'слово не удалилось');
}, SEED.toString()));

for (const m of ['cards', 'learn', 'test', 'match', 'sent', 'dict']) {
  await check('режим «' + m + '» запускается и принимает ответ', async pg => pg.evaluate(async ([seed, m]) => {
    eval('(' + seed + ')()');
    go('set', { id: 's1' }); await sleep(50); launchMode('set', 's1', m); await sleep(400);
    const start = [...document.querySelectorAll('#app .btn.pri')].find(b => /Начать|Start/.test(b.textContent)); if (start) { start.click(); await sleep(300); }
    const opt = document.querySelector('#qb .opt, .sxo .opt'); const ta = document.querySelector('#ta');
    if (opt) opt.click(); else if (ta) { ta.value = 'xxx'; (document.querySelector('#tsub') || {}).click?.(); }
    else if (m === 'cards' || m === 'match') { assert(document.querySelector('#app .card, #app .mt, #app .match, #app button'), 'нет карточек'); }
    await sleep(200); assert(txt().length > 10, 'экран режима пустой');
  }, [SEED.toString(), m]));
}

await check('«В предложении»: первый вопрос сразу, даже если сеть молчит', async pg => pg.evaluate(async (seed) => {
  eval('(' + seed + ')()');
  /* words without their own example: only the built-in bank can help; the network never answers */
  S.sets[0].words.push(newWord('steady', 'устойчивый'), newWord('to abandon', 'покидать'), newWord('bite bit bitten', 'кусать'));
  S.sets[0].words.forEach(w => { if (!['steady', 'to abandon', 'bite bit bitten'].includes(w.en)) w.ex = ''; }); save();
  await sxBank(); assert(Object.keys(SXB).length > 4000, 'встроенный банк предложений не загрузился');
  const real = window.fetch; window.fetch = (u, o) => String(u).includes('lib/') ? real(u, o) : new Promise(() => {});          /* a network that hangs */
  go('set', { id: 's1' }); await sleep(50);
  const t0 = performance.now(); launchMode('set', 's1', 'sent');
  for (let k = 0; k < 40 && !document.querySelector('.sxs'); k++) await sleep(25);
  const ms = Math.round(performance.now() - t0);
  assert(document.querySelector('.sxs'), 'вопрос не появился');
  assert(ms < 800, 'слишком долго: ' + ms + ' мс');
  return ms + ' мс';
}, SEED.toString()));

await check('«В предложении»: после ответа не выкидывает в список', async pg => pg.evaluate(async (seed) => {
  eval('(' + seed + ')()');
  await sxBank();
  S.sets[0].words.push(newWord('steady', 'устойчивый'), newWord('to abandon', 'покидать'), newWord('reluctant', 'неохотный'), newWord('acquaintance', 'знакомство')); save();
  go('set', { id: 's1' }); await sleep(50);
  launchMode('set', 's1', 'sent');
  for (let k = 0; k < 40 && !document.querySelector('.sxs'); k++) await sleep(25);
  for (let q = 0; q < 3; q++) {
    const o = document.querySelector('.sxo .opt');
    if (o) o.click(); else { const ta = document.querySelector('#ta'); ta.value = 'xyz'; document.querySelector('#tsub').click(); }
    await sleep(60);
    softRender(); liveCheck && await Promise.resolve(); await sleep(1500);          /* what a sync or a list update does in the background */
    assert(document.querySelector('#nx'), 'после ответа ' + (q + 1) + ' экран сбросился');
    document.querySelector('#nx').click(); await sleep(150);
    assert(document.querySelector('.sxs') || document.querySelector('#chero, .cel-hero, .chero'), 'после «Дальше» выкинуло из режима');
  }
  return 'ok';
}, SEED.toString()));

await check('серия: разные тексты и реакции', async pg => pg.evaluate(async (seed) => {
  eval('(' + seed + ')()');
  const heads = new Set(), reacts = new Set();
  for (let k = 0; k < 30; k++) { const r = celTexts(5, { best: 9, goal: 10 }); heads.add(r.head); reacts.add(r.react); assert(r.sub && !/\{/.test(r.sub), 'плохой подзаголовок ' + r.sub); }
  assert(heads.size >= 8, 'мало разных заголовков: ' + heads.size);
  assert(reacts.size >= 4, 'мало реакций: ' + reacts.size);
  localStorage.setItem('noeon_cel_best', '6');
  assert(celTexts(7, { best: 7, goal: 10 }).react === 'fireworks', 'рубеж 7 дней без салюта');
  const b = celTexts(9, { best: 9, goal: 10 }); assert(b.react === 'fountain', 'рекорд без фонтана');
  S.stats.streak = 12; S.stats.best = 20; S.stats.met = true; celShow(); await sleep(100);
  assert(document.querySelector('#celeb #chl') && document.querySelector('#csub').textContent.length > 5, 'нет экрана серии');
  document.querySelector('#cgo').click(); await sleep(400);
  return heads.size + ' заголовков, ' + reacts.size + ' реакций';
}, SEED.toString()));

await check('тест словарного запаса: полный проход и результат', async pg => pg.evaluate(async (seed) => {
  eval('(' + seed + ')()');
  assert(await vtLoad(), 'банк слов не загрузился');
  vtBegin(); let g = 0;
  while (VTR && g < 60) { const b = VTR.cur.b; const ok = b <= 3; const btn = ok ? [...document.querySelectorAll('.vto .opt')].find(x => x.dataset.ok === '1') : document.querySelector('#vtdk'); btn.click(); g++; await sleep(ok ? 170 : 10); }
  await sleep(100);
  const h = S.stats.vt.h.slice(-1)[0]; assert(h && h.n > 1500 && h.n < 6500, 'странный результат ' + (h && h.n));
  assert(txt().includes('Сколько слов'), 'нет экрана результата');
  const used = Object.values(S.stats.vt.u).flat().length; assert(used === h.q, 'не запомнились заданные слова');
  return h.n + ' слов за ' + h.q + ' вопросов';
}, SEED.toString()));

await check('боссы: карточка на «Сегодня» и разбор', async pg => pg.evaluate(async (seed) => {
  eval('(' + seed + ')()');
  AUTH.profile = { id: 'u1', role: 'student' }; AUTH.user = { id: 'u1' };
  go('today'); await sleep(80);
  assert(document.querySelector('.bossc'), 'нет карточки босса'); assert(txt().includes('thorough'), 'не тот босс');
  document.querySelector('.bossc .btn').click(); await sleep(200);
  assert(document.querySelector('#bgo'), 'нет экрана разбора');
}, SEED.toString()));

await check('профиль: настройки сразу меняются на экране', async pg => pg.evaluate(async (seed) => {
  eval('(' + seed + ')()');
  go('me'); await sleep(80);
  setTheme('dark'); await sleep(50); assert(document.documentElement.dataset.theme === 'dark' || document.documentElement.classList.contains('dark') || resolveDark(), 'тема не сменилась');
  setFx('off'); assert(S.settings.fx === 'off', 'звук не выключился'); setFx('on'); assert(S.settings.fx === 'on', 'звук не включился');
  setLang('en'); await sleep(50); assert(/Profile|Settings/.test(txt()), 'язык не сменился'); setLang('ru');
}, SEED.toString()));

await check('аккаунты: чужие слова не достаются следующему', async pg => pg.evaluate(async ([seed, fake]) => {
  eval('(' + seed + ')()'); eval('(' + fake + ')({})');
  S.sets.forEach(x => { x.synced = false; }); save();   /* words made on this phone before signing in */
  await onSignedIn({ id: 'A' }); assert(S.uid === 'A' && S.sets.length, 'первый аккаунт потерял слова');
  S.sets.push({ id: 'x', name: 'A secret', lang: 'en', upd: 1, synced: false, words: [] });
  window.SENT = [];
  await onSignedIn({ id: 'B' });
  assert(!S.sets.some(s => s.name === 'A secret'), 'аккаунт B видит слова A');
  assert(!JSON.stringify(window.SENT).includes('A secret'), 'слова A ушли в аккаунт B');
  await doSignOut(); assert(!S.sets.length, 'после выхода слова остались на устройстве');
}, [SEED.toString(), FAKE.toString()]));

await check('учитель: экраны ученика, вредный текст не выполняется', async pg => pg.evaluate(async ([seed, fake]) => {
  eval('(' + seed + ')()');
  const P = `"><img src=x onerror="window.__x=1">'+(window.__x=1)+'`;
  const now = new Date().toISOString();
  const rows = {
    profiles: [{ id: 'st1', display_name: P, role: 'student', stats: { vt: { h: [{ t: 1, n: 3000, b: [90,80,70,60,50,40,30,20,10,5], q: 30 }], k: [[P, P]] }, boss: {}, act: {}, asg: {} } }],
    links: [{ teacher_id: 't1', student_id: 'st1', created_at: now }],
    sets: [{ id: 'a', owner_id: 'st1', name: P, lang: 'en', position: 0, deleted: false, updated_at: now }],
    words: [0, 1].map(i => ({ id: 'w' + i, set_id: 'a', owner_id: 'st1', en: P + i, ru: P, ex: P, box: 0, arch: false, ok: 0, bad: 5, position: i, deleted: false, updated_at: now })),
    library_sets: [{ id: 'l1', teacher_id: 't1', title: P, descr: P, lang: 'en', words: [{ en: P, ru: P }], status: 'students', folder: P, version: 1, deleted: false, updated_at: now }],
    rpc: { is_owner: true, owner_list_teachers: [{ id: 'a1', name: P, email: P, joined: now, teacher_code: P, students: 1, active7: 0, words: 1 }], owner_list_invites: [] },
  };
  eval('(' + fake + ')')(rows);
  AUTH.user = { id: 't1' }; AUTH.profile = { id: 't1', role: 'teacher', display_name: P }; AUTH.isOwner = true; AUTH.students = rows.profiles;
  TC.owner.st1 = { sets: rows.sets, words: rows.words };
  for (const [n, p] of [['students', {}], ['tsets', { sid: 'st1', sname: P }], ['twords', { sid: 'st1', sname: P, setId: 'a', setName: P }], ['tprog', { sid: 'st1', tab: 'vt' }], ['tan', {}], ['library', {}], ['owner', {}], ['me', {}]]) {
    go(n, p); await sleep(150);
  }
  await tVtAddSheet('st1'); await sleep(100);
  assert(!window.__x && !document.querySelector('img[src="x"]'), 'вредный текст выполнился (XSS)');
}, [SEED.toString(), FAKE.toString()]));

await check('офлайн-файлы приложения на месте', async pg => pg.evaluate(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const r = await fetch('sw.js').then(r => r.text());
  const files = [...r.matchAll(/'(\.\/[^']+)'/g)].map(m => m[1]).filter(f => !f.endsWith('/'));
  const bad = [];
  for (const f of files) { const x = await fetch(f, { method: 'HEAD' }).catch(() => null); if (!x || !x.ok) bad.push(f); }
  assert(!bad.length, 'нет файлов: ' + bad.join(', '));
  return files.length + ' файлов';
}));

srv.close(); await browser.close();
for (const [s, n, r] of results) console.log((s === 'ok' ? '✓ ' : '✗ ') + n + (r ? ' — ' + r : ''));
console.log(failed ? `\nНЕ ПРОЙДЕНО: ${failed} из ${results.length}` : `\nВсё пройдено: ${results.length} проверок`);
process.exit(failed ? 1 : 0);
