import { buildModel, autoMapProfiles, buildScope, profileDims, boxOf } from './model.js';
import { computeJoints } from './joints.js';
import { groupParts } from './parts.js';
import { cutPlan, yardPlan, cutPlanFromYard, cutPlanWithInventory } from './cutlist.js';
import { buildBom, toolsNeeded } from './bom.js';
import { buildSteps } from './assembly.js';
import { iso, ortho, partDrawing, partSimple, cutBoardSimple, fmt } from './render.js';
import { evalExpr } from './expr.js';
import { icons, screwIcon } from './icons.js';
import { fitToInventory } from './fit.js';

// ============================================================================
//  Flow:  home (my projects / examples / my yard)
//         project: 1 המקום → 2 המידות → 3 העץ → 4 התוכנית
//  The engine (model, joints, cut plan, bom, steps) is untouched; this file is the UI.
// ============================================================================

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const woodName = item => item.name.includes(`${item.t}×${item.w}`) || item.name.includes(`${item.t}x${item.w}`) ? item.name : `${item.name} ${item.t}×${item.w}`;
const ls = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { localStorage.setItem(k, JSON.stringify(v)); stamp(k); scheduleSync(); }, del: k => { localStorage.removeItem(k); stamp(k); scheduleSync(); } };
// ============================================================================
//  sync: one shared document (for everyone with access) in the hub's store at /api/family/woody.
//  Every cp.* key is one entry with a change time; newer wins when the two devices disagree.
//  Offline: the local copy keeps working and the next change is pushed when the site answers.
// ============================================================================
const SYNC_ON = typeof gallabStore === 'function' && /\.gallab\.top$/.test(location.hostname);
const store = SYNC_ON ? gallabStore('woody', { scope: 'family' }) : null;
const stamps = () => ls.get('cp._ts', {});
const stamp = k => { const t = stamps(); t[k] = Date.now(); localStorage.setItem('cp._ts', JSON.stringify(t)); };
const localDoc = () => { const data = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('cp.') && k !== 'cp._ts') data[k] = localStorage.getItem(k); } return { app: 'carpenters-plans', when: new Date().toISOString(), data, ts: stamps() }; };
// merge two documents key by key: the newer change wins, including deletions
function mergeDocs(local, remote) {
  if (!remote?.data) return { doc: local, changed: false, remoteWins: false };
  const data = {}, ts = {}; let localWins = false, remoteWins = false;
  const keys = new Set([...Object.keys(local.data), ...Object.keys(remote.data), ...Object.keys(local.ts || {}), ...Object.keys(remote.ts || {})]);
  for (const k of keys) {
    const lt = local.ts?.[k] || 0, rt = remote.ts?.[k] || 0;
    const lHas = k in local.data, rHas = k in remote.data;
    let useRemote;
    if (rt > lt) useRemote = true; else if (lt > rt) useRemote = false; else useRemote = !lHas && rHas; // no stamps: keep what we have, take what we lack
    const v = useRemote ? remote.data[k] : local.data[k], has = useRemote ? rHas : lHas;
    if (has) data[k] = v;
    const t = Math.max(lt, rt); if (t) ts[k] = t;
    if (useRemote && (v !== local.data[k] || has !== lHas)) remoteWins = true;
    if (!useRemote && (v !== remote.data[k] || has !== rHas)) localWins = true;
  }
  return { doc: { app: 'carpenters-plans', when: new Date().toISOString(), data, ts }, changed: localWins, remoteWins };
}
function applyDoc(doc) {
  for (const k of Object.keys(localStorage)) if (k.startsWith('cp.') && k !== 'cp._ts' && !(k in doc.data)) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(doc.data)) localStorage.setItem(k, v);
  localStorage.setItem('cp._ts', JSON.stringify(doc.ts || {}));
}
let syncTimer = null, syncing = false, syncAgain = false;
function scheduleSync() { if (!store) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1500); }
async function syncNow() {
  if (!store) return false;
  if (syncing) { syncAgain = true; return false; }
  syncing = true; let remoteChanged = false;
  try {
    const { doc: remote, offline } = await store.load();
    if (offline) return false;
    const m = mergeDocs(localDoc(), remote);
    if (m.remoteWins) { applyDoc(m.doc); remoteChanged = true; }
    if (m.changed || !remote) { try { await store.save(m.doc); } catch (e) { if (e instanceof store.GallabConflict) syncAgain = true; else throw e; } }
    setSyncState('ok');
  } catch (e) { console.warn('sync', e.message); setSyncState('off'); }
  finally { syncing = false; if (syncAgain) { syncAgain = false; scheduleSync(); } }
  return remoteChanged;
}
function setSyncState(s) { const el = $('#syncDot'); if (!el) return; el.hidden = !store; el.dataset.state = s; el.title = s === 'ok' ? 'מסונכרן בין המכשירים' : 'לא מחובר — עובד מהעותק המקומי'; }

async function loadJson(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
let viewerMod = null, viewerLoad = null;
function loadViewer() { return viewerLoad ||= import('./viewer.js').then(m => (viewerMod = m)).catch(e => { console.warn('3D viewer unavailable', e); return null; }); }

const state = { index: [], custom: [], design: null, values: {}, spaces: {}, mapping: {}, catalog: null, photo: null, result: null, returnTo: 'home' };
const pid = () => state.design?.id;
const per = (k, d) => ls.get(`cp.${k}.${pid()}`, d);
const setPer = (k, v) => ls.set(`cp.${k}.${pid()}`, v);
const saveCatalog = () => ls.set('cp.catalog', state.catalog);
const yardWoods = () => state.catalog.lumber.filter(l => !l.own && !l.hidden);

// ============================================================================
//  bootstrap
// ============================================================================
async function init() {
  if (store) { await Promise.race([syncNow(), new Promise(r => setTimeout(r, 6000))]); document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && await syncNow()) location.reload(); }); }
  setSyncState(store ? 'ok' : 'off');
  state.catalog = ls.get('cp.catalog', null) || await loadJson('catalog/default-catalog.json');
  migrateCatalog();
  state.index = await loadJson('designs/index.json');
  state.custom = ls.get('cp.customDesigns', []);
  $('#homeBtn').onclick = showHome;
  $('#yardBtn').onclick = () => showYard();
  $('#printBtn').onclick = e => { e.stopPropagation(); $('#printMenu').hidden = !$('#printMenu').hidden; };
  $('#printMenu').onclick = e => e.stopPropagation();
  document.addEventListener('click', () => { $('#printMenu').hidden = true; });
  $('#printGo').onclick = printPlan;
  $('#printAll').onclick = () => $$('#printMenu input').forEach(i => i.checked = true);
  $('#jsonBtn').onclick = exportJson;
  setupBackup();
  $('#designFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; const d = JSON.parse(await f.text()); if (!d.id) d.id = 'custom-' + Date.now(); state.custom = state.custom.filter(x => x.id !== d.id); state.custom.push(d); ls.set('cp.customDesigns', state.custom); openDesign(d); e.target.value = ''; };
  $$('nav.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  $$('[data-go]').forEach(b => b.onclick = () => showStep(b.dataset.go));
  $$('#stepper button').forEach(b => b.onclick = () => showStep(b.dataset.step));
  setupPhoto(); wireProjectPage();
  const last = ls.get('cp.lastDesign', null);
  if (last) { try { await openById(last); return; } catch {} }
  showHome();
}

function migrateCatalog() {
  const c = state.catalog;
  c.lumber ||= []; c.inventory ||= []; c.hardware ||= {}; c.transport ||= { enabled: false, poleLen: 5100, maxPiece: 2400, maxCuts: 2, margin: 30 };
  // leftovers of older versions: alias items, never yard woods; junk sections dropped
  c.lumber = c.lumber.filter(l => !(l.id.startsWith('own') && (l.t < 5 || l.w < 5) && !c.inventory.some(r => r.itemId === l.id)));
  for (const l of c.lumber) if (l.id.startsWith('own') || l.own) { l.own = true; l.name = (l.name || '').replace(' (יש לי)', '').replace(/^עץ /, 'שאריות '); }
  for (const l of c.lumber) if (l.own && !l.yardId) l.yardId = closestYard(l.t, l.w)?.id || null;
  // "bought before" is set only by the shopping list from now on; forget the automatic marks
  if (!c.historyV2) { for (const l of c.lumber) delete l.lastUsed; c.historyV2 = true; }
  if (c.woodMode === undefined) c.woodMode = c.inventory.some(r => r.qty > 0) ? 'own' : 'buy';
  saveCatalog();
}

function setupBackup() {
  const allData = () => { const all = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('cp.')) all[k] = localStorage.getItem(k); } return all; };
  $('#backupBtn').onclick = () => download(`carpenters-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'carpenters-plans', when: new Date().toISOString(), data: allData() }, null, 1));
  $('#restoreBtn').onclick = () => $('#restoreFile').click();
  $('#restoreFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const j = JSON.parse(await f.text()); if (j.app !== 'carpenters-plans') throw new Error('לא קובץ גיבוי של האפליקציה'); if (!confirm('לשחזר את הגיבוי? הנתונים הנוכחיים בדפדפן הזה יוחלפו.')) return; for (const [k, v] of Object.entries(j.data)) { if (k === 'cp._ts') continue; localStorage.setItem(k, v); stamp(k); } if (store) await syncNow(); location.reload(); } catch (err) { alert('שחזור נכשל: ' + err.message); } };
  const WEB = 'https://woody.gallab.top';
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    $('#sendToWebBtn').hidden = false;
    $('#sendToWebBtn').onclick = () => {
      const win = window.open(WEB + '/?receive=1', 'carpenters-web');
      if (!win) { alert('הדפדפן חסם את החלון. אפשר להשתמש בגיבוי/שחזור במקום.'); return; }
      const payload = { app: 'carpenters-plans', transfer: true, data: allData() };
      let tries = 0; const timer = setInterval(() => { if (tries++ > 60) clearInterval(timer); try { win.postMessage(payload, WEB); } catch {} }, 500);
      window.addEventListener('message', e => { if (e.origin === WEB && e.data?.ack === 'carpenters-plans') { clearInterval(timer); $('#sendToWebBtn').textContent = '✔ הועבר לאתר'; } });
    };
  }
  if (new URLSearchParams(location.search).get('receive')) {
    let done = false;
    window.addEventListener('message', e => {
      if (done || e.data?.app !== 'carpenters-plans' || !e.data.transfer) return;
      if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(e.origin)) return;
      done = true; for (const [k, v] of Object.entries(e.data.data)) { localStorage.setItem(k, v); stamp(k); }
      e.source.postMessage({ ack: 'carpenters-plans' }, e.origin); location.replace(location.pathname);
    });
  }
}

// ============================================================================
//  pages: home / yard / project
// ============================================================================
function showPage(id) {
  $$('.page').forEach(p => p.hidden = p.id !== 'page-' + id);
  $('#stepper').hidden = id !== 'project';
  if (id !== 'project') $('#crumb').textContent = id === 'yard' ? '› המחסן שלי' : '';
}

// a project made by the wizard keeps only its name and values; its structure follows the base design, so improvements reach old projects
async function refreshFromBase(c) {
  if (!c?.template) return c;
  try {
    const base = await loadJson(`designs/${c.template}.json`);
    const d = { ...base, id: c.id, name: c.name, description: c.description ?? base.description, template: c.template,
      params: base.params.map(p => ({ ...p, value: c.params.find(x => x.id === p.id)?.value ?? p.value })) };
    const i = state.custom.findIndex(x => x.id === c.id); if (i >= 0 && JSON.stringify(state.custom[i]) !== JSON.stringify(d)) { state.custom[i] = d; ls.set('cp.customDesigns', state.custom); }
    return d;
  } catch { return c; }
}
async function openById(id) { const c = state.custom.find(d => d.id === id); openDesign(c ? await refreshFromBase(c) : await loadJson(`designs/${id}.json`)); }

async function showHome() {
  ls.del('cp.lastDesign'); state.returnTo = 'home';
  showPage('home');
  const home = $('#page-home');
  const hidden = new Set(ls.get('cp.hiddenDesigns', []));
  const mine = state.custom.filter(d => !hidden.has(d.id));
  const examples = state.index.filter(d => !hidden.has(d.id));
  home.innerHTML = `
    <div class="step-head"><h2>הפרויקטים שלי</h2><p>${mine.length ? 'לחץ על פרויקט כדי להמשיך בו.' : 'עדיין אין פרויקטים. התחל אחד חדש — או פתח דוגמה למטה כדי לראות איך זה עובד.'}</p></div>
    <div class="grid" id="gridMine"></div>
    <div class="step-head" style="margin-top:28px"><h2 style="font-size:20px">דוגמאות</h2><p>פרויקטים מוכנים לעיון. פתיחה של דוגמה לא משנה אותה — "שמור כפרויקט שלי" בתוך הדוגמה יוצר עותק.</p></div>
    <div class="grid" id="gridEx"></div>
    ${hidden.size ? `<p class="muted" style="margin-top:14px">${hidden.size} פריטים מוסתרים · <a href="#" id="unhide">הצג שוב</a></p>` : ''}`;
  const card = (d, custom) => {
    const el = document.createElement('div'); el.className = 'proj';
    el.innerHTML = `<button class="del noprint" title="${custom ? 'מחק פרויקט' : 'הסתר דוגמה'}">✕</button><div class="thumb"><div class="thumb-wait">טוען…</div></div><h3>${esc(d.name)}</h3><p></p><div class="meta"></div>`;
    el.onclick = () => openById(d.id);
    el.querySelector('.del').onclick = e => {
      e.stopPropagation();
      if (!confirm(custom ? `למחוק את הפרויקט "${d.name}"? הנתונים שלו יימחקו.` : `להסתיר את הדוגמה "${d.name}"?`)) return;
      if (custom) { state.custom = state.custom.filter(x => x.id !== d.id); ls.set('cp.customDesigns', state.custom); for (const k of Object.keys(localStorage)) if (k.endsWith('.' + d.id)) ls.del(k); }
      else { hidden.add(d.id); ls.set('cp.hiddenDesigns', [...hidden]); }
      showHome();
    };
    (async () => {
      try {
        const design = custom ? d : await loadJson(`designs/${d.id}.json`);
        const saved = ls.get('cp.values.' + d.id, {});
        const values = Object.fromEntries(design.params.map(p => [p.id, saved[p.id] ?? p.value]));
        const model = buildModel(design, values, state.catalog, autoMapProfiles(design, state.catalog), {});
        const groups = groupParts(model);
        el.querySelector('.thumb').innerHTML = iso(model.instances, { view: design.view, width: 420, height: 220 });
        el.querySelector('p').textContent = design.description || '';
        el.querySelector('.meta').textContent = `${model.bbox.size.map(Math.round).join(' × ')} מ"מ · ${groups.length} חלקים`;
      } catch (e) { el.querySelector('.thumb').textContent = 'שגיאה: ' + e.message; }
    })();
    return el;
  };
  const gm = $('#gridMine');
  for (const d of mine) gm.appendChild(card(d, true));
  const add = document.createElement('div'); add.className = 'proj new';
  add.innerHTML = `<img src="brand/icons/project-new.svg" alt=""><div style="font-size:18px;font-weight:700">פרויקט חדש</div><div class="muted" style="margin-top:6px">בחר מה לבנות, ענה על כמה שאלות — והתוכנית נבנית לבד</div>`;
  add.onclick = showNewProject; gm.appendChild(add);
  const ge = $('#gridEx');
  for (const d of examples) ge.appendChild(card(d, false));
  const imp = document.createElement('div'); imp.className = 'proj new'; imp.style.minHeight = '120px';
  imp.innerHTML = `<img src="brand/icons/project-open.svg" alt="" style="width:40px;height:40px"><div class="muted">צורה אחרת לגמרי?</div><div style="font-weight:700">ייבוא קובץ עיצוב</div>`;
  imp.onclick = () => $('#designFile').click(); ge.appendChild(imp);
  $('#unhide')?.addEventListener('click', e => { e.preventDefault(); ls.set('cp.hiddenDesigns', []); showHome(); });
  window.scrollTo(0, 0);
}

function openDesign(design) {
  state.design = design;
  const saved = per('values', null);
  state.values = Object.fromEntries(design.params.map(p => [p.id, saved?.[p.id] ?? p.value]));
  state.spaces = per('spaces', {});
  state.mapping = autoMapProfiles(design, state.catalog, per('mapping', {}));
  remap();
  state.photo = per('photo', null);
  $('#photo').hidden = !state.photo; if (state.photo) $('#photo').src = state.photo;
  ls.set('cp.lastDesign', design.id);
  if (previewViewer) { previewViewer.destroy(); previewViewer = null; } // the step-2 preview starts fresh for every project
  showPage('project'); $('#crumb').textContent = '› ' + design.name;
  $('#tab-design').dataset.ready = '';
  $('#saveAsMine').hidden = !!state.custom.some(x => x.id === design.id);
  renderSpaces();
  if (!saved) fitToSpace(true, false); // a fresh project starts at the sizes recommended for the place
  renderParams();
  showTab('overview');
  recompute();
  showStep(per('step', 'place'));
}

// ============================================================================
//  new project wizard — only "what", sizes have one home (step 2)
// ============================================================================
const TEMPLATES = [
  { id: 'table', icon: '🪵', name: 'שולחן / ספסל עבודה', desc: 'משטח על רגליים, עם או בלי מדף תחתון, קיר כלים ומדף עליון.', base: 'potting-bench',
    features: [
      { param: 'shelf', label: 'מדף תחתון', type: 'bool', on: 1, off: 0 },
      { param: 'HB', label: 'קיר כלים מאחורי המשטח', type: 'bool', on: 600, off: 0 },
      { param: 'nSlats', label: 'מספר שלבים בקיר', type: 'number', min: 0, max: 10, dependsOn: 'HB' },
      { param: 'topShelf', label: 'מדף עליון על הקיר', type: 'bool', on: 1, off: 0, dependsOn: 'HB' },
    ] },
  { id: 'cabinet', icon: '🚪', name: 'ארון שלבים עם דלתות', desc: 'קופסה מאווררת: עמודים, שלבים בצדדים, דלתות וגג. למערכת השקיה, לפחים, לכלים.', base: 'irrigation-cabinet',
    features: [
      { param: 'doorCount', label: 'דלתות', type: 'choice', options: [{ label: 'בלי דלתות (פתוח מלפנים)', value: 0 }, { label: 'דלת אחת', value: 1 }, { label: 'שתי דלתות', value: 2 }] },
      { param: 'rightSide', label: 'הארון עומד לבד (צד ימין סגור בשלבים)', type: 'bool', on: 1, off: 0 },
    ] },
  { id: 'shelves', icon: '🗄️', name: 'יחידת מדפים', desc: 'ארבעה עמודים ומדפים מקרשים — למחסן, למרפסת או לגינה.', base: 'shelf-unit',
    features: [{ param: 'nShelves', label: 'מספר מדפים', type: 'number', min: 2, max: 8 }] },
  { id: 'pergola', icon: '🏡', name: 'פרגולה צמודה לקיר', desc: 'קורת קיר, עמודים קדמיים על בסיסי מתכת, רפטרים ומרישים, גג פוליקרבונט שקוף.', base: 'pergola-leanto',
    features: [{ param: 'spacing', label: 'מרחק בין רפטרים (מ"מ)', type: 'number', min: 400, max: 900 }] },
  { id: 'workbench', icon: '🛠️', name: 'שולחן עבודה נייד', desc: 'שולחן עבודה על גלגלים לגינה: מסגרות 50×100 על עמודים, משטח ומדף מקרשים עם ניקוז, קיר כלים נמוך מאחור.', base: 'garden-workbench',
    features: [
      { param: 'shelf', label: 'מדף תחתון', type: 'bool', on: 1, off: 0 },
      { param: 'wall', label: 'קיר כלים מאחור (ווים)', type: 'bool', on: 350, off: 0 },
      { param: 'wheelH', label: 'גובה הגלגל כולל התושבת (מ"מ)', type: 'number', min: 60, max: 200 },
    ] },
  { id: 'jig', icon: '📐', name: 'התקן חיתוך למסור עגול', desc: 'מסילת T לחיתוך ישר וניצב: בסיס, סרגל למסור וווו שנצמד לקרש. נמדד לפי המסור שלך.', base: 'crosscut-jig',
    features: [
      { param: 'A', label: 'המסור: מהלהב לקצה הבסיס בצד הרחב (מ"מ)', type: 'number', min: 30, max: 200 },
      { param: 'plateL', label: 'המסור: אורך בסיס המסור (מ"מ)', type: 'number', min: 150, max: 450 },
      { param: 'maxW', label: 'הקרש הרחב ביותר שתחתוך (מ"מ)', type: 'number', min: 100, max: 600 },
    ] },
  { id: 'planter', icon: '🌱', name: 'אדנית', desc: 'קופסה מקרשים אופקיים על עמודי פינה, עם תחתית מרווחת.', base: 'planter-box',
    features: [{ param: 'rows', label: 'מספר שורות קרשים בגובה', type: 'number', min: 1, max: 6 }] },
];

function showNewProject() {
  state.returnTo = 'home';
  showPage('new');
  const page = $('#page-new');
  page.innerHTML = `<div class="step-head"><h2>פרויקט חדש</h2><p>מה אתה רוצה לבנות? המידות יבואו בשלב הבא, לפי המקום.</p></div>
    <div class="choices" id="tplGrid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))"></div>
    <div id="tplForm"></div>
    <div class="step-nav"><button class="btn ghost" id="backHome">${ic('back-rtl')}חזרה</button><span></span></div>`;
  const grid = $('#tplGrid');
  for (const t of TEMPLATES) {
    const b = document.createElement('button'); b.className = 'choice'; b.innerHTML = `<div class="ico">${t.icon}</div><b>${esc(t.name)}</b><span>${esc(t.desc)}</span>`;
    b.onclick = () => { $$('#tplGrid .choice').forEach(x => x.classList.remove('active')); b.classList.add('active'); renderTemplateForm(t); };
    grid.appendChild(b);
  }
  $('#backHome').onclick = showHome;
  window.scrollTo(0, 0);
}

async function renderTemplateForm(t) {
  const base = await loadJson(`designs/${t.base}.json`);
  const P = Object.fromEntries(base.params.map(p => [p.id, p]));
  const box = $('#tplForm');
  let html = `<div class="card"><h3>${t.icon} ${esc(t.name)}</h3>
    <div class="field"><label>שם הפרויקט</label><input id="tplName" value="${esc(t.name)}" style="direction:rtl;text-align:right"></div>`;
  if (t.features.length) html += `<h4>מה לכלול</h4>`;
  for (const f of t.features) {
    const p = P[f.param]; if (!p) continue;
    const dep = f.dependsOn ? ` data-dep="${f.dependsOn}"` : '';
    if (f.type === 'bool') html += `<label class="switch"${dep}><input type="checkbox" data-feature="${f.param}" ${p.value > 0 ? 'checked' : ''}> <span>${esc(f.label)}</span></label>`;
    else if (f.type === 'number') html += `<div class="field"${dep}><label>${esc(f.label)}</label><input type="number" data-param="${f.param}" value="${p.value}" min="${f.min ?? p.min ?? ''}" max="${f.max ?? p.max ?? ''}" step="1"></div>`;
    else if (f.type === 'choice') html += `<div class="field"${dep}><label>${esc(f.label)}</label><select data-param="${f.param}">${f.options.map(o => `<option value="${o.value}" ${+o.value === +p.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`;
  }
  html += `<div class="step-nav"><span class="muted">אחר כך: המקום → המידות → העץ → התוכנית</span><button class="btn primary lg" id="tplCreate">צור את הפרויקט${ic('next-rtl')}</button></div></div>`;
  box.innerHTML = html;
  const syncDeps = () => box.querySelectorAll('[data-dep]').forEach(el => { const dep = box.querySelector(`[data-feature="${el.dataset.dep}"]`); el.hidden = dep && !dep.checked; });
  box.querySelectorAll('[data-feature]').forEach(i => i.onchange = syncDeps); syncDeps();
  box.scrollIntoView({ behavior: 'smooth' });
  $('#tplCreate').onclick = () => {
    const d = JSON.parse(JSON.stringify(base));
    d.id = 'my-' + Date.now().toString(36); d.name = $('#tplName').value.trim() || t.name; d.template = t.base; d.description = t.desc;
    const setVal = (id, v) => { const p = d.params.find(x => x.id === id); if (p) p.value = v; };
    box.querySelectorAll('[data-param]').forEach(i => setVal(i.dataset.param, +i.value));
    box.querySelectorAll('[data-feature]').forEach(i => { const f = t.features.find(x => x.param === i.dataset.feature); setVal(f.param, i.checked ? f.on : f.off); });
    for (const f of t.features) if (f.dependsOn) { const dep = d.params.find(x => x.id === f.dependsOn); if (dep && !(dep.value > 0)) setVal(f.param, P[f.param].min ?? 0); }
    state.custom.push(d); ls.set('cp.customDesigns', state.custom);
    openDesign(d);
  };
}

function saveAsMine() {
  const d = JSON.parse(JSON.stringify(state.design));
  d.id = 'my-' + Date.now().toString(36); d.name = prompt('שם לפרויקט שלך:', state.design.name) || state.design.name;
  for (const p of d.params) p.value = state.values[p.id];
  state.custom.push(d); ls.set('cp.customDesigns', state.custom);
  for (const k of ['spaces', 'manual', 'mapping', 'photo']) { const v = per(k, null); if (v != null) ls.set(`cp.${k}.${d.id}`, v); }
  openDesign(d);
}

// ============================================================================
//  steps
// ============================================================================
const STEPS = ['place', 'sizes', 'wood', 'shop', 'bought', 'plan'];
const ic = (n, cls = 'ic') => `<img class="${cls}" src="brand/icons/${n}.svg" alt="">`;
function showStep(id) {
  if (!STEPS.includes(id)) id = 'place';
  $$('.steppane').forEach(p => p.hidden = p.id !== 'step-' + id);
  $$('#stepper button').forEach(b => { b.classList.toggle('active', b.dataset.step === id); b.classList.toggle('done', STEPS.indexOf(b.dataset.step) < STEPS.indexOf(id)); });
  $('#stepper').style.setProperty('--p', (STEPS.indexOf(id) / (STEPS.length - 1) * 100) + '%');
  setPer('step', id);
  window.scrollTo(0, 0);
  if (id === 'sizes') { renderParams(); renderStatus(); setTimeout(() => { previewViewer?.resize(); mountPreview(); }, 50); }
  if (id === 'wood') renderWoodStep();
  if (id === 'plan') { renderPlanBasis(); if (mainViewer) mainViewer.resize(); }
  if (id === 'bought') renderPurchaseStep();
}

// ---------- step 1: place ----------
function renderSpaces() {
  const box = $('#spaces'); box.innerHTML = '';
  const specs = state.design.spaces || [];
  if (!specs.length) { box.innerHTML = '<p class="muted">לעיצוב הזה אין הגדרת מקום — המשך למידות.</p>'; return; }
  const NICE = { width: 'רוחב פנוי', depth: 'עומק פנוי', height: 'גובה פנוי', reserve: 'רוחב שאתה שומר לרהיט אחר באותו קיר (0 אם אין)' };
  for (const s of specs) {
    for (const [f, def] of Object.entries(s.fields)) {
      const row = document.createElement('div'); row.className = 'field';
      row.innerHTML = `<label>${esc(NICE[f] || def.label)}</label><input type="number" value="${state.spaces?.[s.id]?.[f] ?? def.value}" step="10">`;
      row.querySelector('input').oninput = e => { (state.spaces[s.id] ||= {})[f] = +e.target.value; fitToSpace(false, false); recompute(); };
      box.appendChild(row);
    }
  }
}

// ---------- step 2: sizes ----------
function manualSet() { return new Set(per('manual', [])); }
function setManual(id, on) { const s = manualSet(); on ? s.add(id) : s.delete(id); setPer('manual', [...s]); }
function suggestFor(p) {
  if (!p.suggest) return null;
  try {
    const scope = buildScope(state.design, state.values, profileDims(state.design, state.catalog, state.mapping), state.spaces);
    let v = evalExpr(p.suggest, scope);
    if (p.min != null) v = Math.max(p.min, v); if (p.max != null) v = Math.min(p.max, v);
    return Math.round(v);
  } catch { return null; }
}
// apply the place-based suggestions to every size the user has not set by hand
function fitToSpace(force = false, render = true) {
  const manual = force ? new Set() : manualSet();
  if (force) setPer('manual', []);
  for (const p of state.design.params) { if (manual.has(p.id)) continue; const v = suggestFor(p); if (v != null) state.values[p.id] = v; }
  if (render) { renderParams(); recompute(); }
}
const isBool = p => p.min === 0 && p.max === 1 && (p.step ?? 1) === 1;
function renderParams() {
  const box = $('#params'); if (!box) return; box.innerHTML = '';
  const manual = manualSet();
  for (const p of state.design.params) {
    const label = p.label.replace(/\s*\((1 = כן, 0 = לא|0 = [^)]*)\)\s*$/, '');
    if (p.showIf) { try { if (!evalExpr(p.showIf, { ...state.values })) continue; } catch {} }
    if (p.options) {
      const row = document.createElement('div'); row.className = 'field';
      row.innerHTML = `<label>${esc(label)}</label><span class="seg">${p.options.map(o => `<button type="button" data-v="${o.value}" class="${state.values[p.id] === o.value ? 'active' : ''}">${esc(o.label)}</button>`).join('')}</span>`;
      row.querySelectorAll('button').forEach(b => b.onclick = () => { state.values[p.id] = +b.dataset.v; setManual(p.id, true); recompute(); renderParams(); });
      box.appendChild(row); continue;
    }
    if (isBool(p)) {
      const row = document.createElement('label'); row.className = 'switch';
      row.innerHTML = `<input type="checkbox" ${state.values[p.id] > 0 ? 'checked' : ''}> <span>${esc(label)}</span>`;
      row.querySelector('input').onchange = e => { state.values[p.id] = e.target.checked ? 1 : 0; setManual(p.id, true); recompute(); renderParams(); };
      box.appendChild(row); continue;
    }
    const row = document.createElement('div'); row.className = 'field';
    const sug = suggestFor(p), isManual = manual.has(p.id);
    const hint = sug != null && sug !== state.values[p.id] ? `<small>מומלץ למקום: <span class="suggest" title="${esc(p.suggestNote || '')}">${sug}</span></small>` : '';
    row.innerHTML = `<label>${esc(label)}</label><input type="number" value="${state.values[p.id]}" min="${p.min ?? ''}" max="${p.max ?? ''}" step="${p.step ?? 1}" ${isManual ? 'class="manual"' : ''}>` + hint;
    const inp = row.querySelector('input');
    inp.oninput = e => { const v = +e.target.value; if (v >= (p.min ?? -Infinity) && v <= (p.max ?? Infinity)) { state.values[p.id] = v; setManual(p.id, true); recompute(); } };
    inp.onchange = () => renderParams();
    const s = row.querySelector('.suggest'); if (s) s.onclick = () => { state.values[p.id] = sug; setManual(p.id, false); renderParams(); recompute(); };
    box.appendChild(row);
  }
  const reset = document.createElement('button'); reset.className = 'btn small ghost'; reset.style.marginTop = '8px'; reset.textContent = '↺ חזרה למידות המומלצות למקום';
  reset.onclick = () => fitToSpace(true);
  box.appendChild(reset);
}
function renderStatus() {
  const box = $('#statusCards'); if (!box) return;
  const r = state.result; if (!r || r.error) { box.innerHTML = ''; return; }
  const [W, D, H] = r.model.bbox.size.map(Math.round);
  const cards = [`<div class="stat-card"><b>${W} × ${D} × ${H}</b><span>רוחב × עומק × גובה (מ"מ)</span></div>`];
  const s = (state.design.spaces || [])[0];
  if (s) {
    const v = k => state.spaces?.[s.id]?.[k] ?? s.fields[k]?.value;
    const names = { width: 'רוחב', depth: 'עומק', height: 'גובה' };
    const bad = [['width', W, (v('width') ?? Infinity) - (v('reserve') || 0)], ['depth', D, v('depth') ?? Infinity], ['height', H, v('height') ?? Infinity]].filter(([k, a, lim]) => s.fields[k] && a > lim);
    cards.push(bad.length ? `<div class="stat-card bad"><b>לא נכנס</b><span>${bad.map(([k]) => names[k]).join(', ')} גדול מהמקום</span></div>` : `<div class="stat-card ok"><b>✔ נכנס במקום</b><span>לפי המידות משלב 1</span></div>`);
  }
  cards.push(`<div class="stat-card"><b>${r.groups.length} · ${r.bom.screwCount}</b><span>חלקים שונים · ברגים</span></div>`);
  box.innerHTML = cards.join('');
}
let previewViewer = null;
async function mountPreview() {
  const host = $('#viewer3dPreview'); if (!host || host.closest('.steppane').hidden || !state.result || state.result.error) return;
  const mod = await loadViewer(); if (!mod) { host.innerHTML = iso(state.result.model.instances, { view: state.design.view }); return; }
  if (!previewViewer) { try { previewViewer = mod.createViewer(host, { forceSvg: location.search.includes('svg') }); } catch (e) { console.error(e); return; } }
  previewViewer.show(state.result.model.instances, { dims: modelDims(), keepCamera: previewViewer._shown });
  previewViewer._shown = true;
}

// ---------- step 3: wood ----------
function closestYard(t, w) {
  let best = null, bs = Infinity;
  for (const l of state.catalog.lumber) { if (l.own) continue; const s = Math.abs(Math.min(l.t, l.w) - Math.min(t, w)) * 2 + Math.abs(Math.max(l.t, l.w) - Math.max(t, w)); if (s < bs) { bs = s; best = l; } }
  return best;
}
// best yard wood for every role the user has not chosen by hand
function remap() {
  const manual = new Set(per('mapManual', []));
  const fresh = autoMapProfiles(state.design, state.catalog);
  for (const key of Object.keys(state.design.profiles)) if (!manual.has(key) || !state.catalog.lumber.some(l => l.id === state.mapping[key] && !l.own)) state.mapping[key] = fresh[key];
}
// leftover rows: { itemId (yard id, or an alias when measured differently), L, qty, t, w }
function aliasFor(yard, t, w) {
  const c = state.catalog, a = Math.min(t, w), b = Math.max(t, w);
  if (a === Math.min(yard.t, yard.w) && b === Math.max(yard.t, yard.w)) return yard;
  let it = c.lumber.find(l => l.own && l.yardId === yard.id && Math.min(l.t, l.w) === a && Math.max(l.t, l.w) === b);
  if (!it) { it = { id: `own${a}x${b}_${yard.id}`, name: `שאריות ${a}×${b}`, t: a, w: b, lengths: yard.lengths, pricePerMeter: 0, own: true, yardId: yard.id }; c.lumber.push(it); }
  return it;
}
function renderWoodStep() {
  const r = state.result, c = state.catalog; if (!r || r.error) return;
  const cur = esc(c.currency || '');
  const own = c.woodMode === 'own';
  $('#hasLeftovers').checked = own; $('#woodOwn').hidden = !own;
  // --- leftover rows ---
  const inv = $('#inventoryEditor');
  const yard = yardWoods();
  let html = `<div class="catalog-row inv-head"><span>איזה עץ</span><span>אורך (מ"מ)</span><span>כמות</span><span>מדדתי אחרת</span><span></span></div>`;
  c.inventory.forEach((row, i) => {
    const it = c.lumber.find(l => l.id === row.itemId); const yardId = it ? (it.own ? it.yardId : it.id) : (yard[0]?.id || '');
    html += `<div class="catalog-row inv-row" data-i="${i}"><select data-f="yard">${yard.map(l => `<option value="${l.id}" ${l.id === yardId ? 'selected' : ''}>${l.t}×${l.w} ${esc(l.name)}</option>`).join('')}</select><input type="number" step="10" data-f="L" value="${row.L ?? ''}" placeholder="1950"><input type="number" min="0" data-f="qty" value="${row.qty ?? ''}" placeholder="6"><span class="measured"><input type="number" data-f="t" value="${row.t ?? ''}" placeholder="עובי"> × <input type="number" data-f="w" value="${row.w ?? ''}" placeholder="רוחב"></span><button title="הסר">✕</button></div>`;
  });
  html += `<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn small" id="invAdd">+ עוד קרשים</button>${c.inventory.length ? '<button class="btn small ghost" id="invClear">נקה הכל</button>' : ''}</div>`;
  inv.innerHTML = html;
  const save = () => { saveCatalog(); recompute(); };
  inv.querySelectorAll('.inv-row').forEach(rowEl => {
    const row = c.inventory[+rowEl.dataset.i];
    const upd = () => {
      const y = c.lumber.find(l => l.id === rowEl.querySelector('[data-f=yard]').value); if (!y) return;
      // the measured section is kept on the row as typed; the alias wood exists once both numbers are in
      row.t = +rowEl.querySelector('[data-f=t]').value || null; row.w = +rowEl.querySelector('[data-f=w]').value || null;
      const it = (row.t > 0 && row.w > 0) ? aliasFor(y, row.t, row.w) : y;
      row.itemId = it.id;
      row.L = +rowEl.querySelector('[data-f=L]').value || 0; row.qty = +rowEl.querySelector('[data-f=qty]').value || 0;
      save(); renderWoodStep();
    };
    rowEl.querySelectorAll('input, select').forEach(i => i.onchange = upd);
    rowEl.querySelector('button').onclick = () => { c.inventory.splice(+rowEl.dataset.i, 1); save(); renderWoodStep(); };
  });
  $('#invAdd').onclick = () => { c.inventory.push({ itemId: yard[0]?.id || null, L: null, qty: 1 }); saveCatalog(); renderWoodStep(); inv.querySelector('.inv-row:last-of-type [data-f=L]')?.focus(); };
  $('#invClear')?.addEventListener('click', () => { c.inventory = []; save(); renderWoodStep(); });
  // --- which wood for which part (the shopping list itself is step 4) ---
  const box = $('#woodBuyList');
  const rows = r.cut.plans.map(p => {
    const roles = Object.entries(state.design.profiles).filter(([k, pr]) => !pr.hardware && state.mapping[k] === p.item.id).map(([, pr]) => pr.label).join(', ');
    const used = p.usedOwned ? `<span class="okline">${p.usedOwned} קרשים משאריות</span>` : '';
    const buy = Object.keys(p.counts).length ? `${Object.values(p.counts).reduce((a, b) => a + b, 0)} לקנות` : '<span class="okline">✔ לא צריך לקנות</span>';
    return `<tr><td><b>${esc(woodName(p.item))}</b><br><span class="muted">${esc(roles)}</span></td><td>${used}</td><td>${buy}</td></tr>`;
  });
  box.innerHTML = `<table class="big"><tr><th>עץ</th><th>משאריות</th><th>לקנות</th></tr>${rows.join('')}</table>
    <p class="muted" style="margin-top:8px">עץ לקנייה: <b>${cur} ${r.bom.woodCost.toFixed(0)}</b> · כל הפרויקט: <b>${cur} ${r.bom.total.toFixed(0)}</b>. הרשימה המלאה בשלב הבא.</p>
    <details class="help"><summary>להחליף סוג עץ לתפקיד מסוים</summary><div id="roleMap"></div></details>`;
  const rm = $('#roleMap');
  for (const [key, pr] of Object.entries(state.design.profiles)) {
    if (pr.hardware) continue;
    const row = document.createElement('div'); row.className = 'field';
    row.innerHTML = `<label>${esc(pr.label)} <small>(תוכנן ל-${pr.t}×${pr.w})</small></label><select>${yard.map(l => `<option value="${l.id}" ${state.mapping[key] === l.id ? 'selected' : ''}>${l.t}×${l.w} ${esc(l.name)}${l.lastUsed ? ' ★' : ''}</option>`).join('')}</select>`;
    row.querySelector('select').onchange = e => { state.mapping[key] = e.target.value; const m = new Set(per('mapManual', [])); m.add(key); setPer('mapManual', [...m]); recompute(); renderWoodStep(); };
    rm.appendChild(row);
  }
  // --- shrink-to-leftovers button ---
  const fitBox = $('#fitOwnBox');
  const hasRows = own && c.inventory.some(x => x.qty > 0 && x.L > 0);
  fitBox.hidden = !hasRows;
}
function fitToOwnWood() {
  const c = state.catalog, msg = $('#fitOwnMsg');
  msg.textContent = 'מחשב את הגרסה הגדולה ביותר שנבנית רק מהשאריות…';
  setTimeout(() => {
    // roles keep their yard wood; the search only avoids buying the woods you have leftovers of
    const yardIds = new Set(c.inventory.filter(r => r.qty > 0).map(r => { const l = c.lumber.find(x => x.id === r.itemId); return l ? (l.own ? l.yardId : l.id) : null; }).filter(Boolean));
    if (!yardIds.size) { msg.textContent = 'לא הוזנו שאריות.'; return; }
    const caps = {}; for (const p of state.design.params) if (p.fit && p.suggest) { const v = suggestFor(p); if (v != null) caps[p.id] = v; }
    const res = fitToInventory(state.design, state.values, c, state.mapping, state.spaces, caps);
    if (!res.ok) { msg.innerHTML = `<span class="badline">${esc(res.reason)}</span>`; return; }
    for (const [id, v] of Object.entries(res.values)) { state.values[id] = v; setManual(id, true); }
    recompute();
    const [W, D, H] = state.result.model.bbox.size.map(Math.round);
    const names = [...yardIds].map(id => c.lumber.find(l => l.id === id)).filter(Boolean).map(l => woodName(l)).join(', ');
    msg.innerHTML = `<span class="okline">✔ ${W} × ${D} × ${H} מ"מ — בלי לקנות ${esc(names)}.</span> המידות עודכנו בשלב 2; עצים אחרים נקנים כרגיל.`;
    renderWoodStep();
  }, 30);
}

// ============================================================================
//  yard page (catalog, prices, hardware, transport)
// ============================================================================
function showYard() {
  state.returnTo = state.design && !$('#page-project').hidden ? 'project' : 'home';
  showPage('yard');
  renderCatalog(); renderHardware(); renderTransport();
  $('#yardBack').onclick = () => { if (state.returnTo === 'project' && state.design) { remap(); showPage('project'); $('#crumb').textContent = '› ' + state.design.name; recompute(); renderWoodStep(); } else showHome(); };
  window.scrollTo(0, 0);
}
function renderCatalog() {
  const box = $('#catalogEditor'); box.innerHTML = '';
  const c = state.catalog, cur = esc(c.currency);
  const head = document.createElement('div'); head.className = 'catalog-row head';
  head.innerHTML = `<span>שם</span><span>עובי</span><span>רוחב</span><span>אורכים במלאי (מ"מ)</span><span>מחיר ${cur}</span><span>ל־</span><span></span>`; box.appendChild(head);
  c.lumber.forEach((l, idx) => {
    if (l.own) return;
    const row = document.createElement('div'); row.className = 'catalog-row';
    const priceVal = l.priceMode === 'board' ? (l.prices?.[l.lengths[0]] ?? '') : (l.pricePerMeter ?? '');
    row.innerHTML = `<input value="${esc(l.name)}"><input type="number" value="${l.t}"><input type="number" value="${l.w}"><input value="${l.lengths.join(', ')}"><input type="number" step="0.1" value="${priceVal}"><select><option value="meter" ${l.priceMode !== 'board' ? 'selected' : ''}>מטר</option><option value="board" ${l.priceMode === 'board' ? 'selected' : ''}>קרש</option></select><button title="הסר">✕</button>`;
    const [name, t, w, lens, price] = row.querySelectorAll('input'); const mode = row.querySelector('select');
    const upd = () => {
      l.name = name.value; l.t = +t.value; l.w = +w.value; l.lengths = lens.value.split(/[,\s]+/).map(Number).filter(v => v > 0);
      if (l.priceMode === 'board') { l.prices ||= {}; for (const L of l.lengths) l.prices[L] = +price.value * (L / l.lengths[0]); } else l.pricePerMeter = +price.value;
      saveCatalog();
    };
    [name, t, w, price].forEach(i => i.oninput = upd); lens.onchange = upd;
    mode.onchange = () => { l.priceMode = mode.value; saveCatalog(); renderCatalog(); };
    row.querySelector('button').onclick = () => { if (!confirm(`להסיר את "${l.name}" מהמחסן?`)) return; c.lumber.splice(idx, 1); saveCatalog(); renderCatalog(); };
    box.appendChild(row);
  });
  $('#addLumber').onclick = () => { c.lumber.push({ id: 'new' + Date.now(), name: 'עץ חדש', t: 20, w: 100, lengths: [2400, 3000], pricePerMeter: 10 }); saveCatalog(); renderCatalog(); box.querySelector('.catalog-row:last-of-type input')?.focus(); };
  $('#saveCatalog').onclick = () => download('my-lumber-catalog.json', JSON.stringify(c, null, 2));
  $('#loadCatalog').onclick = () => $('#catalogFile').click();
  $('#catalogFile').onchange = async e => { const f = e.target.files[0]; if (f) { state.catalog = JSON.parse(await f.text()); migrateCatalog(); renderCatalog(); renderHardware(); renderTransport(); } };
  $('#kerf').value = c.kerf ?? 3; $('#trim').value = c.endTrim ?? 10;
  $('#kerf').oninput = e => { c.kerf = +e.target.value; saveCatalog(); };
  $('#trim').oninput = e => { c.endTrim = +e.target.value; saveCatalog(); };
}
function renderTransport() {
  const box = $('#transportEditor'); if (!box) return;
  const t = state.catalog.transport;
  box.innerHTML = `<label class="switch"><input type="checkbox" id="trEnabled" ${t.enabled ? 'checked' : ''}> <span>אני קונה מוטות ארוכים ומוביל ברכב</span></label>
    <div class="price-row" id="transport" style="margin-top:8px;${t.enabled ? '' : 'opacity:.5'}">
      <label>אורך מוט במחסן <input type="number" step="10" data-t="poleLen" value="${t.poleLen}"> מ"מ</label>
      <label>מקסימום שנכנס לרכב <input type="number" step="10" data-t="maxPiece" value="${t.maxPiece}"> מ"מ</label>
      <label>חיתוכים שהמחסן עושה למוט <input type="number" min="1" max="4" data-t="maxCuts" value="${t.maxCuts}"></label>
      <label>שוליים לכל חתיכה <input type="number" step="5" data-t="margin" value="${t.margin}"> מ"מ</label>
    </div><p class="muted">כשזה מופעל, רשימת הקניות נספרת במוטות ותוכנית החיתוך מראה איפה לבקש לחתוך במחסן.</p>`;
  $('#trEnabled').onchange = e => { t.enabled = e.target.checked; saveCatalog(); renderTransport(); };
  box.querySelectorAll('#transport input').forEach(i => i.onchange = () => { t[i.dataset.t] = +i.value; saveCatalog(); });
}
function renderHardware() {
  const box = $('#hardwareEditor'); if (!box) return;
  const hw = state.catalog.hardware; hw.screws ||= [];
  const cur = esc(state.catalog.currency);
  let html = `<div class="catalog-row hw-head"><span>בורג Ø</span><span>אורך</span><span>בחבילה</span><span>${cur}/חבילה</span><span></span></div>`;
  hw.screws.forEach((s, i) => { html += `<div class="catalog-row hw-row" data-i="${i}"><input type="number" value="${s.d}"><input type="number" value="${s.len}"><input type="number" value="${s.pack}"><input type="number" step="0.1" value="${s.price}"><button title="הסר">✕</button></div>`; });
  html += `<button class="btn small" id="addScrew">+ סוג בורג</button>
    <div class="price-row"><label>בורג ללא חבילה מוגדרת: <input type="number" step="0.05" id="hwFallback" value="${hw.screwFallbackPricePerUnit ?? 0.6}"> ${cur}/יח׳</label></div>
    <div class="price-row"><label>שמן/לזורה: <input type="number" step="1" id="hwFinish" value="${hw.finishPricePerLiter ?? 60}"> ${cur}/ליטר</label> <label>כיסוי: <input type="number" id="hwCover" value="${hw.finishCoverageM2PerLiter ?? 10}"> מ"ר/ליטר</label> <label>שכבות: <input type="number" id="hwCoats" value="${hw.finishCoats ?? 2}"></label></div>
    <div class="price-row"><label>דבק: <input type="number" id="hwGlue" value="${hw.gluePrice ?? 0}"> ${cur}</label> <label>נייר לטש: <input type="number" id="hwSand" value="${hw.sandpaperPrice ?? 0}"> ${cur}</label></div>`;
  box.innerHTML = html;
  box.querySelectorAll('.hw-row').forEach(row => {
    const s = hw.screws[+row.dataset.i]; const [d, len, pack, price] = row.querySelectorAll('input');
    row.querySelectorAll('input').forEach(i => i.oninput = () => { s.d = +d.value; s.len = +len.value; s.pack = +pack.value || 1; s.price = +price.value; saveCatalog(); });
    row.querySelector('button').onclick = () => { hw.screws.splice(+row.dataset.i, 1); saveCatalog(); renderHardware(); };
  });
  $('#addScrew').onclick = () => { hw.screws.push({ d: 4, len: 40, pack: 100, price: 25 }); saveCatalog(); renderHardware(); };
  const bind = (id, key) => { $(id).oninput = e => { hw[key] = +e.target.value; saveCatalog(); }; };
  bind('#hwFallback', 'screwFallbackPricePerUnit'); bind('#hwFinish', 'finishPricePerLiter'); bind('#hwCover', 'finishCoverageM2PerLiter'); bind('#hwCoats', 'finishCoats'); bind('#hwGlue', 'gluePrice'); bind('#hwSand', 'sandpaperPrice');
}

function setupPhoto() {
  const dz = $('#photoDrop');
  const take = f => { if (!f) return; const rd = new FileReader(); rd.onload = () => { state.photo = rd.result; try { setPer('photo', rd.result); } catch {} $('#photo').src = rd.result; $('#photo').hidden = false; renderOverview(); }; rd.readAsDataURL(f); };
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); take(e.dataTransfer.files[0]); };
  dz.onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = () => take(i.files[0]); i.click(); };
}

// ============================================================================
//  compute
// ============================================================================
// ---------- step 5: after the purchase ----------
// What was really bought (lengths, counts, measured sections) replaces the shopping list in the cut plan;
// the price of every board comes from the yard list. Steps 1-4 stay as planned.
function renderPurchaseStep() {
  const box = $('#purchaseRows'); if (!box || !state.result || state.result.error) return;
  const c = state.catalog, yard = yardWoods();
  const pur = per('purchase', { done: false, rows: [] });
  const save = () => { setPer('purchase', pur); recompute(); };
  const fromList = () => { const rows = []; for (const p of state.result.cut.plans) { const y = p.item.own ? c.lumber.find(l => l.id === p.item.yardId) : p.item; if (!y) continue; for (const [L, n] of Object.entries(p.counts)) rows.push({ itemId: y.id, L: +L, qty: n }); for (const o of p.oversize) rows.push({ itemId: y.id, L: Math.round(o.len + (+c.endTrim || 0)), qty: 1 }); } return rows; };
  if (!pur.rows.length && !pur.done) pur.rows = fromList();
  $('#purchaseDone').checked = !!pur.done;
  let html = `<div class="catalog-row inv-head"><span>איזה עץ</span><span>אורך (מ"מ)</span><span>כמות</span><span>מדדתי אחרת</span><span></span></div>`;
  pur.rows.forEach((row, i) => {
    html += `<div class="catalog-row inv-row" data-i="${i}"><select data-f="yard">${yard.map(l => `<option value="${l.id}" ${l.id === row.itemId ? 'selected' : ''}>${l.t}×${l.w} ${esc(l.name)}</option>`).join('')}</select><input type="number" step="10" data-f="L" value="${row.L || ''}" placeholder="2450"><input type="number" min="0" data-f="qty" value="${row.qty ?? ''}" placeholder="4"><span class="measured"><input type="number" data-f="t" value="${row.t || ''}" placeholder="עובי"> × <input type="number" data-f="w" value="${row.w || ''}" placeholder="רוחב"></span><button title="הסר">✕</button></div>`;
  });
  html += `<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn small" id="purAdd">+ עוד קרשים</button><button class="btn small ghost" id="purReset">מלא מחדש לפי רשימת הקניות</button></div>`;
  box.innerHTML = html;
  box.querySelectorAll('.inv-row').forEach(rowEl => {
    const row = pur.rows[+rowEl.dataset.i];
    const upd = () => { row.itemId = rowEl.querySelector('[data-f=yard]').value; row.L = +rowEl.querySelector('[data-f=L]').value || 0; row.qty = +rowEl.querySelector('[data-f=qty]').value || 0; row.t = +rowEl.querySelector('[data-f=t]').value || null; row.w = +rowEl.querySelector('[data-f=w]').value || null; save(); renderPurchaseStep(); };
    rowEl.querySelectorAll('input, select').forEach(i => i.onchange = upd);
    rowEl.querySelector('button').onclick = () => { pur.rows.splice(+rowEl.dataset.i, 1); save(); renderPurchaseStep(); };
  });
  $('#purAdd').onclick = () => { pur.rows.push({ itemId: yard[0]?.id, L: null, qty: 1 }); setPer('purchase', pur); renderPurchaseStep(); box.querySelector('.inv-row:last-of-type [data-f=L]')?.focus(); };
  $('#purReset').onclick = () => { pur.rows = fromList(); save(); renderPurchaseStep(); };
  $('#purchaseDone').onchange = e => { pur.done = e.target.checked; if (pur.done) { for (const row of pur.rows) { const y = c.lumber.find(l => l.id === row.itemId); if (y && row.qty > 0) y.lastUsed = Date.now(); } saveCatalog(); } save(); renderPurchaseStep(); };
  const r = state.result, missing = r.cut.plans.filter(p => p.missing > 0);
  $('#purchaseMsg').innerHTML = !pur.done ? `<span class="muted">לא קנית עדיין? דלג — התוכנית תתבסס על רשימת הקניות כמו שהיא.</span>`
    : missing.length ? `<div class="warn soft">חסר עץ ל-${missing.map(p => `${esc(woodName(p.item))} (${p.missing} חלקים)`).join(', ')} — הוסף קרשים או בדוק את האורכים.</div>`
    : `<div class="ok">✔ כל החלקים נחתכים מהקרשים שקנית. עלות העץ לפי מחירי המחסן: ${esc(c.currency || '')} ${r.bom.woodCost.toFixed(0)}.</div>`;
}
function renderPlanBasis() {
  const el = $('#planBasis'); if (!el || !state.result || state.result.error) return;
  const pur = per('purchase', { done: false, rows: [] });
  el.innerHTML = pur.done ? `<b style="color:var(--ok)">התוכנית לפי מה שקנית</b> (שלב 5) · ${state.result.cut.plans.some(p => p.missing > 0) ? '<span class="badline">חסר עץ לחלק מהחלקים — ראה שלב 5</span>' : 'כל החלקים נחתכים מהקרשים שקנית'}.` : 'התוכנית לפי רשימת הקניות. קנית משהו אחר? עדכן בשלב 5.';
}
function persist() { setPer('values', state.values); setPer('spaces', state.spaces); setPer('mapping', state.mapping); }
function recompute() {
  const d = state.design, c = state.catalog;
  let res;
  try {
    const model = buildModel(d, state.values, c, state.mapping, state.spaces);
    const joints = computeJoints(model, d);
    const groups = groupParts(model);
    const t = c.transport;
    const pur = per('purchase', { done: false, rows: [] });
    const boughtRows = pur.done ? pur.rows.filter(r => r.qty > 0 && r.L > 0).map(r => { const y = c.lumber.find(l => l.id === r.itemId); const it = y && r.t > 0 && r.w > 0 ? aliasFor(y, r.t, r.w) : y; return it ? { itemId: it.id, L: r.L, qty: r.qty, bought: true } : null; }).filter(Boolean) : [];
    const cc = boughtRows.length ? { ...c, inventory: [...(c.woodMode === 'own' ? c.inventory : []), ...boughtRows] } : c;
    const hasInv = (c.woodMode === 'own' && c.inventory.some(r => r.qty > 0 && r.L > 0)) || boughtRows.length > 0;
    const cut = hasInv ? cutPlanWithInventory(groups, cc, state.mapping) : t.enabled ? cutPlanFromYard(yardPlan(groups, c, state.mapping, t), c) : cutPlan(groups, c, state.mapping);
    const bom = buildBom(model, groups, joints, cut, cc, d, { have: new Set(per('have', [])), extraPrices: per('extraPrices', {}) });
    const steps = buildSteps(d, model, joints);
    const tools = toolsNeeded(model, groups, bom);
    res = { model, joints, groups, cut, bom, steps, tools, error: null };
  } catch (e) { console.error(e); res = { error: e.message }; }
  state.result = res;
  persist();
  for (const fn of [renderWarnings, renderOverview, renderParts, renderAssembly, renderCut, renderShop, renderDesignTab, renderStatus, mountPreview]) {
    try { fn(); } catch (e) { console.error(fn.name, e); $('#warnings').insertAdjacentHTML('beforeend', `<div class="warn">שגיאה בהצגת ${fn.name}: ${esc(e.message)}</div>`); }
  }
  if (!$('#step-wood').hidden) renderWoodStep();
}
function renderWarnings() {
  const r = state.result, box = $('#warnings');
  if (r.error) { box.innerHTML = `<div class="warn">שגיאה: ${esc(r.error)}</div>`; return; }
  const w = r.model.warnings;
  const bad = w.filter(x => x.startsWith('התנגשות')), soft = w.filter(x => !x.startsWith('התנגשות'));
  box.innerHTML = (bad.length ? `<div class="warn"><b>${bad.length} בעיות בתכנון:</b><br>${bad.map(esc).join('<br>')}</div>` : '') +
    (soft.length ? `<div class="warn soft"><b>${soft.length} הערות:</b> ${[...new Set(soft)].map(esc).join(' · ')}</div>` : '');
}
function showTab(id) {
  $$('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  $$('#step-plan .tabpane').forEach(p => p.hidden = p.id !== 'tab-' + id);
  if (id === 'overview' && mainViewer) mainViewer.resize();
}

// ============================================================================
//  plan tabs
// ============================================================================
function renderOverview() {
  const r = state.result, d = state.design, box = $('#tab-overview');
  if (!r || r.error) { box.innerHTML = ''; return; }
  const { model, bom, groups } = r;
  const [W, D, H] = model.bbox.size.map(Math.round);
  box.innerHTML = shareBar('overview') + `
    <div class="card"><h3>${esc(d.name)}</h3><p class="muted" style="margin:0 0 10px">${esc(d.description || '')}</p>
      <div class="modes noprint" id="modes3d"><button data-mode="full" class="active">${ic('overview')}הרהיט המוגמר</button><button data-mode="explode">${ic('exploded')}מפורק עם מספרים</button><button id="dimsToggle" title="הצג/הסתר מידות">${ic('dimensions')}מידות</button></div>
      <div class="row">
        <div style="flex:2 1 420px"><div class="viewer3d noprint" id="viewer3d"><div class="hint">סובב: גרירה · זום: גלגלת · הזזה: לחצן ימני</div></div><img id="print3dFull" class="printonly print3d" alt=""></div>
        ${state.photo ? `<div style="flex:1 1 240px"><img src="${state.photo}" class="photo" style="max-height:340px"></div>` : ''}
      </div>
      <div style="margin-top:12px">
        <div class="stat"><b>${W} × ${D} × ${H}</b><span>רוחב × עומק × גובה (מ"מ)</span></div>
        <div class="stat"><b>${groups.length}</b><span>חלקים שונים, ${model.instances.length} קרשים</span></div>
        <div class="stat"><b>${bom.screwCount}</b><span>ברגים</span></div>
        <div class="stat"><b>${esc(state.catalog.currency)} ${bom.total.toFixed(0)}</b><span>עלות משוערת</span></div>
        <div class="stat"><b>${bom.woodMeters.toFixed(1)} מ׳</b><span>עץ (${Math.round(bom.waste * 100)}% שאריות)</span></div>
      </div>
      ${checkFit(model)}
    </div>
    <div class="card"><h3>מבטים עם מידות</h3>
      <div class="row">
        <div><div class="facename">מבט מלפנים — רוחב ${W} × גובה ${H}</div><div class="fig">${ortho(model.instances, model.bbox, 'front')}</div></div>
        <div><div class="facename">מבט מהצד — עומק ${D} × גובה ${H}</div><div class="fig">${ortho(model.instances, model.bbox, 'side')}</div></div>
        <div><div class="facename">מבט מלמעלה — רוחב ${W} × עומק ${D}</div><div class="fig">${ortho(model.instances, model.bbox, 'top')}</div></div>
      </div></div>
    <div class="card"><h3>מפת החלקים (מבט מפורק)</h3><p class="muted">כל מספר מופיע פעם אחת ומתאים לרשימת החלקים.</p><img id="print3dExplode" class="printonly print3d" alt=""><div class="fig">${iso(model.instances, { labels: 'group', explode: 0.5, view: d.view, height: 700 })}</div></div>
    <div class="card"><h3>כלים דרושים</h3><div class="tools">${r.tools.map(t => `<div class="tool">${icons[t.icon] || ''}<div><b>${esc(t.name)}</b><span>${esc(t.why)}</span></div></div>`).join('')}</div></div>`;
  bindShare(box);
  mount3d();
}
let mainViewer = null, showDims = true;
function modelDims() {
  const r = state.result, b = r.model.bbox, [x0, y0, z0] = b.min, [x1, y1, z1] = b.max, off = 90;
  const dims = [
    { from: [x0, y0 - off, z0], to: [x1, y0 - off, z0], label: `${Math.round(x1 - x0)}` },
    { from: [x1 + off, y0, z0], to: [x1 + off, y1, z0], label: `${Math.round(y1 - y0)}` },
    { from: [x1 + off, y0 - off, z0], to: [x1 + off, y0 - off, z1], label: `${Math.round(z1 - z0)}` },
  ];
  for (const d of state.design.dims || []) {
    try { dims.push({ from: d.from.map(e => evalExpr(e, r.model.scope)), to: d.to.map(e => evalExpr(e, r.model.scope)), label: d.value == null ? d.label : d.label ? `${d.label} ${Math.round(evalExpr(d.value, r.model.scope))}` : `${Math.round(evalExpr(d.value, r.model.scope))}`, color: 0xb7742c }); } catch (e) { console.warn('dim', d, e); }
  }
  return dims;
}
function overallDims(instances) {
  const b = boxOf(instances), [x0, y0, z0] = b.min, [x1, y1, z1] = b.max, off = 90;
  return [
    { from: [x0, y0 - off, z0], to: [x1, y0 - off, z0], label: `${Math.round(x1 - x0)}` },
    { from: [x1 + off, y0, z0], to: [x1 + off, y1, z0], label: `${Math.round(y1 - y0)}` },
    { from: [x1 + off, y0 - off, z0], to: [x1 + off, y0 - off, z1], label: `${Math.round(z1 - z0)}` },
  ];
}
function viewerArgs(mode, stepN) {
  const r = state.result;
  if (mode === 'explode') return [r.model.instances, { explode: 0.5, labels: true, partDims: showDims }];
  if (mode === 'step') {
    const s = r.steps[stepN - 1];
    const vis = r.model.instances.filter(x => s.visible.has(x.uid));
    return [vis, { highlight: s.highlight, ghost: new Set(vis.filter(x => !s.highlight.has(x.uid)).map(x => x.uid)), screws: s.joints.flatMap(j => j.screws), labels: true, labelFilter: x => s.highlight.has(x.uid), partDims: showDims, dims: showDims && vis.some(x => !x.existing) ? overallDims(vis.filter(x => !x.existing)) : [] }]; // the bench's own posts never count in the measures
  }
  return [r.model.instances, { dims: showDims ? modelDims() : [] }];
}
async function mount3d() {
  const host = $('#viewer3d'); if (!host) return;
  const mod = await loadViewer();
  if (!mod) { host.innerHTML = `<div class="muted" style="padding:20px">המודל התלת־ממדי לא נטען. מוצג שרטוט במקום.</div>` + iso(state.result.model.instances, { view: state.design.view }); return; }
  if (mainViewer) mainViewer.destroy();
  try { mainViewer = mod.createViewer(host, { forceSvg: location.search.includes('svg') }); if (!mainViewer.webgl) host.querySelector('.hint').textContent = 'תצוגה ללא WebGL (מצב SVG) · סובב: גרירה · זום: גלגלת'; }
  catch (e) { console.error(e); host.innerHTML = `<div class="warn" style="margin:10px">התלת־ממד נכשל: ${esc(e.message)}. מוצג שרטוט במקום.</div>` + iso(state.result.model.instances, { view: state.design.view }); return; }
  let mode = 'full';
  const apply = () => mainViewer.show(...viewerArgs(mode, 1));
  apply();
  $$('#modes3d button[data-mode]').forEach(b => b.onclick = () => { $$('#modes3d button[data-mode]').forEach(x => x.classList.remove('active')); b.classList.add('active'); mode = b.dataset.mode; apply(); });
  const dimBtn = $('#dimsToggle');
  dimBtn.classList.toggle('active', showDims); dimBtn.onclick = () => { showDims = !showDims; dimBtn.classList.toggle('active', showDims); apply(); };
}
async function open3dModal(stepN) {
  const mod = await loadViewer(); if (!mod) { alert('המודל התלת־ממדי לא זמין.'); return; }
  const s = state.result.steps[stepN - 1];
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box"><div class="head"><button class="btn small ${showDims ? 'active' : ''}" id="m3dims">${ic('dimensions')}מידות</button><h3>שלב ${s.n}: ${esc(s.title)}</h3><button class="btn small" id="m3prev">◀ הקודם</button><button class="btn small" id="m3next">הבא ▶</button><button class="btn small" id="m3close">סגור ✕</button></div><div class="viewer3d"><div class="hint">סובב: גרירה · זום: גלגלת</div></div></div>`;
  document.body.appendChild(m);
  const v = mod.createViewer(m.querySelector('.viewer3d'), { forceSvg: location.search.includes('svg') });
  let n = stepN;
  const render = () => { n = Math.max(1, Math.min(state.result.steps.length, n)); const st = state.result.steps[n - 1]; m.querySelector('h3').textContent = `שלב ${st.n}: ${st.title}`; v.show(...viewerArgs('step', n)); };
  render();
  m.querySelector('#m3dims').onclick = e => { showDims = !showDims; e.target.classList.toggle('active', showDims); render(); };
  m.querySelector('#m3prev').onclick = () => { n--; render(); };
  m.querySelector('#m3next').onclick = () => { n++; render(); };
  const close = () => { v.destroy(); m.remove(); };
  m.querySelector('#m3close').onclick = close;
  m.onclick = e => { if (e.target === m) close(); };
}
function checkFit(model) {
  const out = [];
  for (const s of state.design.spaces || []) {
    const v = k => state.spaces?.[s.id]?.[k] ?? s.fields[k]?.value;
    const names = { width: 'רוחב', depth: 'עומק', height: 'גובה' };
    const checks = [['width', 0], ['depth', 1], ['height', 2]].filter(([k]) => s.fields[k]);
    const bad = [];
    for (const [k, ax] of checks) { const lim = v(k) - (k === 'width' ? (v('reserve') || 0) : 0); if (model.bbox.size[ax] > lim) bad.push(`${names[k]} ${Math.round(model.bbox.size[ax])} מ"מ > ${lim} מ"מ פנויים`); }
    if (bad.length) out.push(`<div class="warn">גדול מדי למקום: ${bad.join(', ')}</div>`);
    else if (checks.length) out.push(`<div class="ok">✔ מתאים למקום (${checks.map(([k, ax]) => `${names[k]} ${Math.round(model.bbox.size[ax])}/${v(k)}`).join(', ')})</div>`);
  }
  return out.join('');
}

function renderParts() {
  const r = state.result, box = $('#tab-parts');
  if (!r || r.error) { box.innerHTML = ''; return; }
  let html = shareBar('parts') + `<div class="card"><h3>רשימת חלקים</h3><table class="big"><tr><th>מס׳</th><th>חלק</th><th class="num">אורך</th><th class="num">רוחב × עובי</th><th class="num">כמות</th><th>עץ</th></tr>`;
  for (const g of r.groups) html += `<tr><td><span class="partno">${g.no}</span></td><td>${esc(g.name)}</td><td class="num"><b>${fmt(g.len)}</b></td><td class="num">${fmt(g.w)} × ${fmt(g.t)}</td><td class="num">${g.qty}</td><td>${g.prof.hardware ? 'פרזול (קנוי)' : esc(g.prof.item?.name || g.prof.label)}</td></tr>`;
  html += `</table><details class="help"><summary>איך לקרוא את השרטוטים</summary><div class="howto">כל חלק = קרש אחד, מונח עם הפן הרחב למעלה, הקצה השמאלי הוא האפס. <span style="color:#b22">עיגול אדום</span> = חור לבורג: המספר מתחתיו = מרחק מהקצה השמאלי, המספר מימין = מרחק מהצלע (מ"מ). חורי פיילוט קודחים בזמן ההרכבה דרך החור הזה.</div></details></div>`;
  for (const g of r.groups) {
    if (g.prof.hardware) { html += `<div class="card part"><h3><span class="partno">${g.no}</span> ${esc(g.name)} <span class="dims">פרזול · ${g.qty} יח׳ · ${fmt(g.len)} × ${fmt(g.w)} מ"מ</span></h3><p class="muted">חלק מתכת קנוי (מגיע עם חורים). המיקום שלו מופיע בשלב ההרכבה ובתלת־ממד.</p></div>`; continue; }
    html += `<div class="card part"><h3><span class="partno">${g.no}</span> ${esc(g.name)} <span class="dims">${fmt(g.len)} × ${fmt(g.w)} × ${fmt(g.t)} מ"מ · ${g.qty} יח׳</span></h3>`;
    g.variants.forEach((v, vi) => {
      const { faces, sentences } = partSimple(v.holes, g);
      if (g.variants.length > 1) html += `<h4>${['ימין', 'שמאל', 'ג', 'ד'][vi]} — ${v.qty} יח׳ (תמונת מראה)</h4>`;
      for (const f of faces) html += (f.name && faces.length > 1 ? `<div class="facename">${esc(f.name)}</div>` : '') + `<div class="fig">${f.svg}</div>`;
      html += sentences.length ? `<ol class="todo">${sentences.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : `<p class="muted">חיתוך לאורך בלבד — אין חורים לקדוח מראש בחלק הזה.</p>`;
    });
    html += '</div>';
  }
  box.innerHTML = html; bindShare(box);
}
function renderAssembly() {
  const r = state.result, box = $('#tab-assembly');
  if (!r || r.error) { box.innerHTML = ''; return; }
  let html = shareBar('assembly') + `<p class="muted">בכל שלב: החלקים החדשים בכתום, מה שכבר הורכב באפור. הקווים השחורים מראים לאן נכנסים הברגים.</p>`;
  for (const s of r.steps) {
    const vis = r.model.instances.filter(x => s.visible.has(x.uid));
    const ghost = new Set(vis.filter(x => !s.highlight.has(x.uid)).map(x => x.uid));
    const screws = s.joints.flatMap(j => j.screws);
    const pic = vis.length ? iso(vis, { highlight: s.highlight, ghost, screws: screws.slice(0, 80), labels: 'group', labelFilter: x => s.highlight.has(x.uid), view: s.view, height: 460 }) : '';
    const byNo = {};
    for (const x of r.model.instances) if (s.highlight.has(x.uid)) byNo[x.partNo] = (byNo[x.partNo] || 0) + 1;
    html += `<div class="card"><div class="step"><div>
        <h3><span class="num">${s.n}</span>${esc(s.title)}</h3><p style="white-space:pre-line">${esc(s.text)}</p>
        ${Object.keys(byNo).length ? `<div>${Object.entries(byNo).map(([no, n]) => `<span class="pill"><b>#${no}</b> ${esc(r.groups[no - 1]?.name || '')} ×${n}</span>`).join('')}</div>` : ''}
        ${Object.keys(s.screws).length ? `<p style="font-size:13px">${Object.entries(s.screws).map(([k, n]) => `${screwIcon(...k.split('×'))} ×${n}`).join('')}</p>` : ''}
        ${s.tip ? `<p class="tip">💡 ${esc(s.tip)}</p>` : ''}
        ${s.highlight.size ? `<button class="btn small noprint" data-step3d="${s.n}">${ic('exploded')}הצג שלב זה בתלת־ממד</button>` : ''}
      </div><div><img class="printonly print3d" data-step3d-img="${s.n}" alt=""><div class="fig stepsvg">${pic}</div></div></div></div>`;
  }
  box.innerHTML = html; bindShare(box);
  box.querySelectorAll('[data-step3d]').forEach(b => b.onclick = () => open3dModal(+b.dataset.step3d));
}
function renderCut() {
  const r = state.result, box = $('#tab-cut');
  if (!r || r.error) { box.innerHTML = ''; return; }
  const c = state.catalog;
  let html = shareBar('cut') + `<div class="card"><h3>רשימת חיתוך</h3>`;
  for (const p of r.cut.plans) {
    const gs = r.groups.filter(g => state.mapping[g.profile] === p.item.id);
    html += `<h4>${esc(woodName(p.item))}</h4><table class="big"><tr><th>מס׳</th><th>חלק</th><th class="num">אורך</th><th class="num">כמות</th></tr>`;
    for (const g of gs) html += `<tr><td><span class="partno">${g.no}</span></td><td>${esc(g.name)}</td><td class="num"><b>${fmt(g.len)}</b></td><td class="num">${g.qty}</td></tr>`;
    html += '</table>';
  }
  html += '</div>';
  const yard = !!r.cut.yard, inv = !!r.cut.inventory;
  if (yard) {
    const yp = r.cut.yard;
    html += `<div class="card"><h3>🚗 במחסן — איפה לבקש לחתוך כל מוט</h3><details class="help"><summary>הסבר</summary><div class="howto">אתה קונה מוטות של ${yp.poleLen} מ"מ ומשלם על המוט השלם — אז הכל חוזר איתך הביתה, וכל חתיכה חייבת להיכנס לרכב (עד ${yp.maxPiece} מ"מ).</div></details>`;
    html += `${Math.ceil(yp.poleLen / yp.maxPiece) - 1 > yp.maxCuts ? `<div class="warn">מוט של ${yp.poleLen} מ"מ חייב להיחתך ל-${Math.ceil(yp.poleLen / yp.maxPiece)} חתיכות כדי שכולן ייכנסו לרכב — תבקש ${Math.ceil(yp.poleLen / yp.maxPiece) - 1} חיתוכים.</div>` : ''}`;
    for (const p of yp.plans) {
      html += `<h4>${esc(woodName(p.item))} — לקנות ${p.poles.length} מוטות של ${yp.poleLen} מ"מ</h4>`;
      if (p.tooLong.length) html += `<div class="warn">חלקים ארוכים ממה שנכנס לרכב: ${[...new Set(p.tooLong.map(x => `#${x.no} (${x.len} מ"מ)`))].join(', ')}</div>`;
      html += `<table class="big"><tr><th>מוט</th><th>בקש לחתוך ב־ (מ"מ מהקצה)</th><th>החתיכות שלוקחים הביתה</th><th>מה יוצא מכל חתיכה</th></tr>`;
      p.poles.forEach((pole, i) => { html += `<tr${pole.cutsOk ? '' : ' style="background:#fff3f0"'}><td><b>${i + 1}</b></td><td class="num"><b>${pole.cutsAt.join(' , ') || '—'}</b></td><td>${pole.pieces.map(x => x.spare ? `<span class="muted">${x.L}</span>` : `<b>${x.L}</b>`).join(' / ')}</td><td>${pole.pieces.map(x => `<div><b>${x.L}:</b> ${x.spare ? '<span class="muted">רזרבה</span>' : x.cuts.map(cc => `#${cc.no} ${cc.len}`).join(', ')}</div>`).join('')}</td></tr>`; });
      html += '</table>';
    }
    html += `</div>`;
  }
  if (inv) html += `<div class="card"><h3>${ic('parts')}מהשאריות</h3><table class="big"><tr><th>עץ</th><th>יש לי</th><th>בשימוש</th><th>חסר → לקנות</th></tr>${r.cut.plans.map(p => `<tr><td>${esc(woodName(p.item))}</td><td>${Object.entries(p.ownedCounts).sort((a, b) => b[0] - a[0]).map(([L, n]) => `${n} × ${L}`).join(', ') || '—'}</td><td>${p.usedOwned} מתוך ${p.ownedTotal}${p.unusedOwned.length ? ` <span class="muted">(לא נדרש: ${p.unusedOwned.join(', ')})</span>` : ''}</td><td>${p.missing ? `<b style="color:var(--warn)">${p.missing} חלקים</b> → ${Object.entries(p.counts).map(([L, n]) => `${n} × ${L}`).join(', ')}` : '<span style="color:var(--ok)">✔ הכל יש</span>'}</td></tr>`).join('')}</table></div>`;
  for (const p of r.cut.plans) {
    const buyTxt = Object.entries(p.counts).sort((a, b) => b[0] - a[0]).map(([L, n]) => `<b>${n}</b> × ${L} מ"מ`).join(' &nbsp;+&nbsp; ');
    html += `<div class="card"><h3>${yard || inv ? ic('home') + ' בבית — ' : ''}${esc(woodName(p.item))}</h3><div class="buy">${inv ? (buyTxt ? `לקנות בנוסף: ${buyTxt}` : 'הכל מהשאריות') : yard ? `מהמוטות שקנית: ${buyTxt}` : `לקנות: ${buyTxt}`}</div>`;
    p.boards.forEach((b, i) => {
      const title = inv ? (b.owned ? (b.bought ? `קרש שקניתי — ${b.L} מ"מ` : `קרש שיש לי — ${b.L} מ"מ`) : `קרש לקנייה — ${b.L} מ"מ`) : yard ? `חתיכה ${b.L} מ"מ (מוט ${b.fromPole}, חתיכה ${b.pieceIdx})` : `קרש ${i + 1} — ${b.L} מ"מ${b.custom ? ' (אורך מיוחד)' : ''}`;
      const seq = b.cuts.length ? b.cuts.map(x => `<b>#${x.no}</b> ${x.len}`).join(' ← ') : '<span class="muted">לא נדרש לפרויקט הזה</span>';
      html += `<div class="board"><div class="boardtitle">${title}: &nbsp;<span class="seq">${seq}${b.waste > 0 && b.cuts.length ? ` &nbsp;·&nbsp; שארית ${Math.round(b.waste)}` : ''}</span></div><div class="fig">${cutBoardSimple(b)}</div></div>`;
    });
    if (p.oversize.length) html += `<div class="warn">חלקים ארוכים מכל אורך מלאי: ${p.oversize.map(o => `#${o.no} ${o.len} מ"מ`).join(', ')}</div>`;
    html += `</div>`;
  }
  html += `<p class="muted">בחישוב נלקחו בחשבון ${c.kerf} מ"מ לכל חיתוך (עובי הלהב) ו-${c.endTrim} מ"מ לניקוי הקצוות.</p>`;
  box.innerHTML = html; bindShare(box);
}
function renderShop() {
  const r = state.result, box = $('#tab-shop');
  if (!r || r.error) { box.innerHTML = ''; return; }
  const cur = state.catalog.currency || '';
  const bought = new Set(per('bought', []));
  const haveN = r.bom.lines.filter(l => l.have).length;
  let html = shareBar('shop') + `<div class="card"><h3>רשימת קניות</h3>
    <p class="muted" style="margin:0 0 8px">סמן "יש לי" על פריט שכבר יש לך בבית — הוא יורד מהסכום.</p>
    <table><tr><th class="noprint">יש לי</th><th></th><th>פריט</th><th>פירוט</th><th class="num">כמות</th><th class="num">מחיר יחידה</th><th>חישוב</th><th class="num">סה"כ</th></tr>`;
  for (const l of r.bom.lines) {
    const st = l.have ? ' style="opacity:.45;text-decoration:line-through"' : l.owned ? ' style="color:var(--ok)"' : '';
    const price = l.editable ? `<input type="number" step="0.5" class="inline-price" data-extra="${l.extraIndex}" value="${l.unitPrice}" style="width:70px">` : `${cur} ${l.unitPrice.toFixed(2)}`;
    html += `<tr data-key="${esc(l.key)}"><td class="noprint"><input type="checkbox" class="have" ${l.have ? 'checked' : ''}></td><td class="noprint">${l.cat === 'עץ' ? `<input type="checkbox" class="bought" ${bought.has(l.key) ? 'checked' : ''}>` : ''}</td><td style="width:40px"${st}>${icons[l.icon] ? icons[l.icon].replace('width="48" height="48"', 'width="32" height="32"') : ''}</td><td${st}>${esc(l.item)}${l.note ? `<br><small style="color:var(--warn)">${esc(l.note)}</small>` : ''}</td><td${st}>${esc(l.spec)}</td><td class="num"${st}>${l.qty} ${esc(l.unit)}</td><td class="num"${st}>${price}</td><td class="muted" style="font-size:11px"${st}>${esc(l.calc || '')}</td><td class="num"${st}>${cur} ${l.total.toFixed(0)}</td></tr>`;
  }
  html += `<tr><th colspan="7">עץ</th><th class="num">${cur} ${r.bom.woodCost.toFixed(0)}</th></tr><tr><th colspan="7">סה"כ לקנייה${haveN ? ` (${haveN} פריטים שיש לי לא נספרים; עלות מלאה ${cur} ${r.bom.fullTotal.toFixed(0)})` : ''}</th><th class="num">${cur} ${r.bom.total.toFixed(0)}</th></tr></table>
    <p class="muted">${r.bom.area.toFixed(1)} מ"ר שטח לגימור.</p></div>`;
  box.innerHTML = html; bindShare(box);
  box.querySelectorAll('input.have').forEach(cb => cb.onchange = () => { const set = new Set(per('have', [])); const k = cb.closest('tr').dataset.key; cb.checked ? set.add(k) : set.delete(k); setPer('have', [...set]); recompute(); });
  box.querySelectorAll('input.inline-price').forEach(inp => inp.onchange = () => { const m = per('extraPrices', {}); m[inp.dataset.extra] = +inp.value; setPer('extraPrices', m); recompute(); });
}
function renderDesignTab() {
  const box = $('#tab-design');
  if (box.dataset.ready) return;
  box.innerHTML = `<div class="card"><h3>הגדרת העיצוב</h3><p class="muted">המודל הפרמטרי שמאחורי התוכנית. אפשר לערוך וללחוץ "החל", או לשמור כקובץ.</p><textarea class="json" id="designJson"></textarea><div style="margin-top:8px;display:flex;gap:8px"><button class="btn primary" id="applyJson">החל</button><button class="btn" id="saveJson">שמור קובץ עיצוב</button></div></div>`;
  const ta = $('#designJson'); ta.value = JSON.stringify(state.design, null, 2);
  $('#applyJson').onclick = () => { try { const d = JSON.parse(ta.value); const i = state.custom.findIndex(x => x.id === d.id); if (i >= 0) { state.custom[i] = d; ls.set('cp.customDesigns', state.custom); } openDesign(d); } catch (e) { alert('JSON לא תקין: ' + e.message); } };
  $('#saveJson').onclick = () => download(`${state.design.id || 'design'}.json`, ta.value);
  box.dataset.ready = '1';
}

// ============================================================================
//  share / print / export
// ============================================================================
const SECTION_TITLES = { overview: 'סיכום', parts: 'רשימת חלקים וקידוח', assembly: 'שלבי הרכבה', cut: 'תוכנית חיתוך', shop: 'רשימת קניות' };
function sectionText(section) {
  const r = state.result, d = state.design, cur = state.catalog.currency || '';
  const lines = [`Woody · ${d.name} — ${SECTION_TITLES[section]}\n`];
  if (section === 'shop') {
    let cat = '';
    for (const l of r.bom.lines) { if (l.have) continue; if (l.cat !== cat) { cat = l.cat; lines.push(`\n*${cat}*`); } lines.push(`☐ ${l.qty} ${l.unit} — ${l.item}${l.spec ? ` (${l.spec})` : ''} — ${cur}${l.total.toFixed(0)}`); }
    const have = r.bom.lines.filter(l => l.have); if (have.length) lines.push(`\nיש לי כבר: ${have.map(l => l.item).join(', ')}`);
    lines.push(`\n*סה"כ לקנייה: ${cur}${r.bom.total.toFixed(0)}*`);
  } else if (section === 'cut') {
    for (const p of r.cut.plans) {
      lines.push(`\n*${woodName(p.item)}* — לקנות: ${Object.entries(p.counts).sort((a, b) => b[0] - a[0]).map(([L, n]) => `${n}× ${L} מ"מ`).join(', ') || 'כלום'}`);
      for (const g of r.groups.filter(g => state.mapping[g.profile] === p.item.id)) lines.push(`  #${g.no} ${g.name}: ${fmt(g.len)} מ"מ × ${g.qty}`);
      p.boards.forEach((b, i) => lines.push(`  קרש ${i + 1} (${b.L}${b.owned ? ', שאריות' : ''}): ${b.cuts.map(c => `#${c.no} ${c.len}`).join(' → ')}${b.waste > 0 ? ` · שארית ${Math.round(b.waste)}` : ''}`));
    }
    if (r.cut.yard) { const yp = r.cut.yard; lines.push(`\n🚗 *הובלה מהמחסן* (מוטות ${yp.poleLen}, עד ${yp.maxPiece} ברכב, ${yp.maxCuts} חיתוכים למוט)`); for (const p of yp.plans) { lines.push(`*${woodName(p.item)}* — ${p.poles.length} מוטות`); p.poles.forEach((pole, i) => lines.push(`  מוט ${i + 1}: לחתוך ב-${pole.cutsAt.join(' ו-') || '—'} → ${pole.pieces.map(x => x.spare ? `${x.L} (רזרבה)` : `${x.L}`).join(' / ')}`)); } }
  } else if (section === 'parts') {
    for (const g of r.groups) { lines.push(`\n*#${g.no} ${g.name}* — ${fmt(g.len)} × ${fmt(g.w)} × ${fmt(g.t)} מ"מ, ${g.qty} יח׳`); g.variants.forEach((v, vi) => { const { sentences } = partSimple(v.holes, g); if (g.variants.length > 1) lines.push(`  ${['ימין', 'שמאל', 'ג', 'ד'][vi]} (${v.qty} יח׳):`); for (const s of sentences) lines.push(`  • ${s}`); if (!sentences.length) lines.push('  • חיתוך בלבד, ללא חורים'); }); }
  } else if (section === 'assembly') {
    for (const s of r.steps) { lines.push(`\n*${s.n}. ${s.title}*\n${s.text}`); if (s.added.length) lines.push(`חלקים: ${s.added.join(', ')}`); const sc = Object.entries(s.screws).map(([k, n]) => `${n}× ${k}`).join(', '); if (sc) lines.push(`ברגים: ${sc}`); if (s.tip) lines.push(`💡 ${s.tip}`); }
  } else {
    const [W, D, H] = r.model.bbox.size.map(Math.round);
    lines.push(`${d.description || ''}\n\nמידות: ${W} × ${D} × ${H} מ"מ (רוחב × עומק × גובה)\nחלקים: ${r.groups.length} שונים, ${r.model.instances.length} קרשים\nברגים: ${r.bom.screwCount}\nעץ: ${r.bom.woodMeters.toFixed(1)} מ׳\nעלות משוערת: ${cur}${r.bom.total.toFixed(0)}\n\nכלים: ${r.tools.map(t => t.name).join(', ')}`);
  }
  return lines.join('\n');
}
function shareBar(section) {
  return `<div class="sharebar noprint" data-section="${section}"><button class="btn small share-open">${ic('export')}שלח ${SECTION_TITLES[section]}</button><div class="menu" hidden><button data-share="wa">💬 WhatsApp</button><button data-share="mail">✉ אימייל</button><button data-share="copy">📋 העתק טקסט</button>${navigator.share ? '<button data-share="native">⤴ שיתוף…</button>' : ''}</div></div>`;
}
function bindShare(box) {
  box.querySelectorAll('.sharebar .share-open').forEach(b => b.onclick = e => { e.stopPropagation(); const m = b.nextElementSibling; const open = m.hidden; $$('.sharebar .menu').forEach(x => x.hidden = true); m.hidden = !open; });
  document.addEventListener('click', () => $$('.sharebar .menu').forEach(x => x.hidden = true), { once: true });
  box.querySelectorAll('.sharebar [data-share]').forEach(b => b.onclick = async () => {
    const section = b.closest('.sharebar').dataset.section, text = sectionText(section), title = `${state.design.name} — ${SECTION_TITLES[section]}`, how = b.dataset.share;
    if (how === 'copy') { await navigator.clipboard.writeText(text); b.textContent = '✔ הועתק'; setTimeout(() => b.textContent = '📋 העתק טקסט', 1500); }
    else if (how === 'wa') window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    else if (how === 'mail') location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;
    else if (how === 'native') { try { await navigator.share({ title, text }); } catch {} }
  });
}
async function printPlan() {
  $('#printMenu').hidden = true;
  const chosen = $$('#printMenu input[data-tab]').filter(i => i.checked).map(i => i.dataset.tab);
  if (!chosen.length) return;
  $$('.tabpane').forEach(p => p.classList.toggle('print-hide', !chosen.includes(p.id.replace('tab-', ''))));
  $('#printTitle').textContent = state.design.name; $('#printDate').textContent = new Date().toLocaleDateString('he-IL');
  if (viewerMod && mainViewer && (chosen.includes('overview') || chosen.includes('assembly'))) {
    const grab = async (mode, n) => { mainViewer.show(...viewerArgs(mode, n)); await new Promise(r => setTimeout(r, 120)); return mainViewer.snapshot(); };
    if (chosen.includes('overview')) { $('#print3dFull').src = await grab('full'); $('#print3dExplode').src = await grab('explode'); }
    if (chosen.includes('assembly')) for (const s of state.result.steps) { const img = document.querySelector(`#tab-assembly img[data-step3d-img="${s.n}"]`); if (img && s.highlight.size) img.src = await grab('step', s.n); }
    mainViewer.show(...viewerArgs('full', 1));
  }
  window.print();
}
function exportJson() {
  const r = state.result; if (!r || r.error) return;
  download(`${state.design.id}-plan.json`, JSON.stringify({
    design: state.design.id, name: state.design.name, params: state.values, spaces: state.spaces, lumber: state.mapping, overall_mm: r.model.bbox.size.map(Math.round),
    parts: r.groups.map(g => ({ no: g.no, name: g.name, len: g.len, w: g.w, t: g.t, qty: g.qty, variants: g.variants.map(v => ({ qty: v.qty, drilling: partSimple(v.holes, g).sentences, holes: partDrawing(v.holes, g).rows })) })),
    cutPlan: r.cut.plans.map(p => ({ wood: `${p.item.name} ${p.item.t}x${p.item.w}`, buy: p.counts, boards: p.boards.map(b => ({ stock: b.L, owned: !!b.owned, cuts: b.layout.map(c => ({ part: c.no, len: c.len, from: Math.round(c.x) })) })) })),
    shopping: r.bom.lines, total: r.bom.total, tools: r.tools, steps: r.steps.map(s => ({ n: s.n, title: s.title, text: s.text, screws: s.screws })),
  }, null, 2));
}
function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); }

function wireProjectPage() {
  $('#hasLeftovers').onchange = e => { state.catalog.woodMode = e.target.checked ? 'own' : 'buy'; saveCatalog(); recompute(); renderWoodStep(); };
  $('#fitOwnBtn').onclick = fitToOwnWood;
  $('#saveAsMine').onclick = saveAsMine;
  $('#toYardFromWood').onclick = e => { e.preventDefault(); showYard(); };
}

init().catch(e => { $('#page-home').innerHTML = `<div class="warn">${esc(e.message)}</div>`; console.error(e); });
