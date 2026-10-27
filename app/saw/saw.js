// Saw: a woodworking library of saved posts and videos, at woody.gallab.top/saw.
// One shared document for the family in the hub store (/api/family/saw), with a browser copy for offline.
// Enrichment (caption, thumbnail, Hebrew summary) comes from Kort's importer, which Woody's Caddy
// proxies at /api/saw/enrich. Only links are kept: no video files.
// Views: the list (photo cards, newest one featured) and a full-screen detail page (#i=<id>).
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SYNC_ON = typeof gallabStore === 'function' && /\.gallab\.top$/.test(location.hostname);
const store = SYNC_ON ? gallabStore('saw', { scope: 'family' }) : null;
const LOCAL_KEY = 'saw.doc';

const TYPE_LABEL = { project: 'פרויקט', technique: 'טכניקה', tool: 'כלי / ג׳יג', material: 'חומר / גימור', inspiration: 'השראה' };
const PLATFORM_LABEL = { facebook: 'פייסבוק', instagram: 'אינסטגרם', youtube: 'יוטיוב', tiktok: 'טיקטוק', web: 'אתר', manual: '' };
const PLATFORM_GLYPH = { facebook: 'f', instagram: '◎', youtube: '▶', tiktok: '♪', web: '🪵' };
const STATUS_LABEL = { saved: 'שמור', want: 'רוצה לבנות', done: 'בניתי' };
const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  level: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20h16M6 20v-6M12 20V9M18 20V4"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};

// ---------------------------------------------------------------------------
// document: { app:'saw', items:{ id: item }, deleted:{ id: when } }
// Every item carries `updated`; when two devices disagree the newer item wins.
// ---------------------------------------------------------------------------
let doc = loadLocal();
function emptyDoc() { return { app: 'saw', items: {}, deleted: {} }; }
function loadLocal() { try { return normalizeDoc(JSON.parse(localStorage.getItem(LOCAL_KEY))); } catch { return emptyDoc(); } }
function normalizeDoc(d) { if (!d || typeof d !== 'object') return emptyDoc(); return { app: 'saw', items: d.items || {}, deleted: d.deleted || {} }; }
function persistLocal() { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(doc)); } catch {} }
function mergeDocs(a, b) {
  const out = emptyDoc();
  for (const [id, when] of [...Object.entries(a.deleted), ...Object.entries(b.deleted)]) out.deleted[id] = Math.max(out.deleted[id] || 0, when);
  for (const src of [a, b]) for (const [id, it] of Object.entries(src.items)) {
    if ((out.deleted[id] || 0) >= (it.updated || 0)) continue;
    if (!out.items[id] || (it.updated || 0) > (out.items[id].updated || 0)) out.items[id] = it;
  }
  return out;
}
let syncing = false, syncAgain = false, syncTimer = null;
function scheduleSync() { persistLocal(); renderAll(); if (!store) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 800); }
async function syncNow() {
  if (!store) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true; setSync('busy');
  try {
    const { doc: remote, offline } = await store.load();
    if (offline) { setSync('off'); return; }
    const before = JSON.stringify(doc);
    doc = mergeDocs(doc, normalizeDoc(remote));
    persistLocal();
    if (JSON.stringify(doc) !== before) renderAll();
    if (!remote || JSON.stringify(normalizeDoc(remote)) !== JSON.stringify(doc)) {
      try { await store.save(doc); }
      catch (e) { if (e instanceof store.GallabConflict) syncAgain = true; else throw e; }
    }
    setSync('ok');
  } catch (e) { console.warn('sync', e.message); setSync('off'); }
  finally { syncing = false; if (syncAgain) { syncAgain = false; setTimeout(syncNow, 500); } }
}
function setSync(s) { const el = $('#syncDot'); el.dataset.state = s; el.title = s === 'ok' ? 'מסונכרן בין המכשירים' : s === 'busy' ? 'מסתנכרן…' : 'לא מחובר — עובד מהעותק המקומי'; }

// ---------------------------------------------------------------------------
// items
// ---------------------------------------------------------------------------
function idFor(url) { let h = 0; for (const c of url) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 'l' + h.toString(36) + url.length.toString(36); }
function cleanUrl(raw) {
  const m = String(raw || '').match(/https?:\/\/[^\s<>"']+/i); if (!m) return null;
  try {
    const u = new URL(m[0].replace(/[),.;!?]+$/, ''));
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|igsh|igshid|mibextid|si|feature|rdid|share_url)/i.test(k)) u.searchParams.delete(k);
    u.hash = '';
    return u.toString();
  } catch { return null; }
}
function platformOf(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (h.includes('instagram.com')) return 'instagram';
    if (h.includes('facebook.com') || h === 'fb.watch' || h.includes('fb.com')) return 'facebook';
    if (h.includes('tiktok.com')) return 'tiktok';
    if (h.includes('youtube.com') || h === 'youtu.be') return 'youtube';
  } catch {}
  return 'web';
}
function touch(it) { it.updated = Date.now(); doc.items[it.id] = it; scheduleSync(); }
function removeItem(id) { delete doc.items[id]; doc.deleted[id] = Date.now(); scheduleSync(); }

async function addLink(raw, text) {
  const url = cleanUrl(raw);
  if (!url) { showErr('זה לא נראה כמו קישור.'); return; }
  const id = idFor(url);
  if (doc.items[id]) { toast('הקישור הזה כבר שמור'); closeSheet(); openDetail(id); return; }
  const it = { id, url, platform: platformOf(url), title: '', summary: '', type: 'inspiration', tags: [], materials: [], tools: [], key_points: [], difficulty: '', author: null, thumb: null, status: 'saved', star: false, notes: '', added: Date.now(), updated: Date.now(), pending: true };
  doc.items[id] = it; scheduleSync();
  $('#urlInput').value = ''; $('#textInput').value = ''; hideErr(); closeSheet();
  await enrich(it, text);
}
async function enrich(it, text) {
  it.pending = true; it.error = null; renderAll();
  try {
    const r = await fetch('/api/saw/enrich', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: it.url, text: text || undefined }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `שגיאה ${r.status}`);
    const cur = doc.items[it.id]; if (!cur) return;
    Object.assign(cur, {
      title: data.title || cur.title, summary: data.summary || cur.summary, type: data.type || cur.type,
      tags: data.tags || [], materials: data.materials || [], tools: data.tools || [], key_points: data.key_points || [],
      difficulty: data.difficulty || '', author: data.author ?? cur.author, thumb: data.thumbnail_url || cur.thumb,
      platform: data.platform || cur.platform, caption: data.caption || null, duration: data.duration_seconds || null, pending: false, error: null,
    });
    touch(cur);
  } catch (e) {
    const cur = doc.items[it.id]; if (!cur) return;
    cur.pending = false; cur.error = e.message; touch(cur);
    toast('הקישור נשמר, אבל בלי תקציר');
  }
}

// ---------------------------------------------------------------------------
// list view
// ---------------------------------------------------------------------------
const filter = { type: '', status: '', star: false, tag: '', q: '' };
function visible() {
  const q = filter.q.trim().toLowerCase();
  return Object.values(doc.items).filter(it =>
    (!filter.type || it.type === filter.type) &&
    (!filter.status || it.status === filter.status) &&
    (!filter.star || it.star) &&
    (!filter.tag || (it.tags || []).includes(filter.tag)) &&
    (!q || [it.title, it.summary, it.notes, it.author, it.caption, ...(it.tags || []), ...(it.materials || []), ...(it.tools || [])].join(' ').toLowerCase().includes(q)),
  ).sort((a, b) => (b.added || 0) - (a.added || 0));
}
const anyFilter = () => filter.type || filter.status || filter.star || filter.tag || filter.q.trim();
function renderList() {
  const items = visible();
  const all = Object.values(doc.items);
  $('#grid').innerHTML = items.map((it, i) => card(it, i === 0 && !anyFilter() && all.length > 1)).join('');
  $('#empty').hidden = all.length > 0;
  $('#count').textContent = all.length ? (items.length === all.length ? `${all.length} שמורים` : `${items.length} מתוך ${all.length}`) : '';
  $('#clearFilters').hidden = !anyFilter();
  const TYPE_PLURAL = { project: 'פרויקטים', technique: 'טכניקות', tool: 'כלים וג׳יגים', material: 'חומרים וגימור', inspiration: 'השראה' };
  $('#secTitle').textContent = filter.tag ? `#${filter.tag}` : filter.type ? TYPE_PLURAL[filter.type] : filter.status ? STATUS_LABEL[filter.status] : filter.star ? 'מועדפים' : 'הספרייה';
  const counts = {}; for (const it of all) for (const t of it.tags || []) counts[t] = (counts[t] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20);
  const tc = $('#tagChips');
  tc.hidden = top.length === 0;
  tc.innerHTML = top.map(([t]) => `<button class="chip tag" data-tag="${esc(t)}" aria-pressed="${filter.tag === t}">#${esc(t)}</button>`).join('');
  $$('#typeChips .chip[data-type]').forEach(c => c.setAttribute('aria-pressed', c.dataset.type === filter.type));
  $$('#typeChips .chip[data-status]').forEach(c => c.setAttribute('aria-pressed', c.dataset.status === filter.status));
  $('#starFilter').setAttribute('aria-pressed', filter.star);
  $('#clearSearch').hidden = !filter.q;
}
function thumbHtml(it, cls = '') {
  const glyph = PLATFORM_GLYPH[it.platform] || '🪵';
  return it.thumb
    ? `<img class="${cls}" src="${esc(it.thumb)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;ph ${cls}&quot;>${glyph}</div>'">`
    : `<div class="ph ${cls}">${glyph}</div>`;
}
function card(it, featured) {
  const title = it.title || (it.pending ? 'קורא את הפוסט…' : it.error ? 'בלי תקציר — לחצו להשלים' : PLATFORM_LABEL[it.platform] || 'ללא כותרת');
  return `<article class="pcard ${featured ? 'featured' : ''}" data-open="${it.id}">
    ${thumbHtml(it)}
    <div class="shade"></div>
    ${it.status && it.status !== 'saved' ? `<span class="pill" data-s="${it.status}">${STATUS_LABEL[it.status]}</span>` : ''}
    <button class="star" aria-pressed="${!!it.star}" data-star="${it.id}" title="מועדף">★</button>
    <div class="text">
      ${featured && it.type ? `<span class="typepill">${TYPE_LABEL[it.type] || ''}</span>` : ''}
      <h3>${esc(title)}</h3>
      ${featured && it.summary ? `<p class="desc">${esc(it.summary)}</p>` : ''}
      <div class="meta">${!featured && it.type ? `<span>${TYPE_LABEL[it.type] || ''}</span>` : ''}${it.author ? `<span>· ${esc(it.author)}</span>` : `<span>${!featured && it.type ? '· ' : ''}${PLATFORM_LABEL[it.platform] || ''}</span>`}</div>
    </div>
    ${it.pending ? `<div class="busy">קורא את הפוסט ומסכם…</div>` : ''}
  </article>`;
}

// ---------------------------------------------------------------------------
// detail view (full screen), #i=<id>
// ---------------------------------------------------------------------------
let openId = null, tab = 'points';
function openDetail(id) {
  if (!doc.items[id]) return;
  openId = id; tab = 'points';
  if (location.hash !== '#i=' + id) history.pushState({ saw: id }, '', '#i=' + id);
  renderDetail();
}
function closeDetail(viaHistory) {
  openId = null;
  $('#detail').hidden = true; $('#list').hidden = false;
  document.body.style.overflow = '';
  if (!viaHistory && location.hash.startsWith('#i=')) history.back();
}
window.addEventListener('popstate', () => {
  const m = location.hash.match(/^#i=(.+)$/);
  if (m && doc.items[m[1]]) { openId = m[1]; tab = tab || 'points'; renderDetail(); }
  else if (openId) closeDetail(true);
});
function fmtDuration(s) { if (!s) return null; const m = Math.round(s / 60); return m < 1 ? `${Math.round(s)} שנ׳` : `${m} דק׳`; }
function renderDetail() {
  const it = doc.items[openId]; if (!it) { closeDetail(); return; }
  const d = $('#detail');
  const isVideo = ['facebook', 'instagram', 'youtube', 'tiktok'].includes(it.platform);
  const metas = [];
  if (it.type) metas.push(`<span class="m">${ICON.globe}${TYPE_LABEL[it.type]}</span>`);
  if (it.difficulty && it.difficulty !== 'לא ידוע') metas.push(`<span class="m">${ICON.level}${esc(it.difficulty)}</span>`);
  if (it.duration) metas.push(`<span class="m">${ICON.clock}${fmtDuration(it.duration)}</span>`);
  if (it.author) metas.push(`<span class="m">${ICON.user}${esc(it.author)}</span>`);
  else metas.push(`<span class="m">${ICON.user}${PLATFORM_LABEL[it.platform] || 'אתר'}</span>`);
  const numbered = (arr) => arr && arr.length ? `<ul>${arr.map((x, i) => `<li><span class="n">${i + 1}</span><span>${esc(x)}</span></li>`).join('')}</ul>` : '';
  const plain = (arr) => arr && arr.length ? `<ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  let panel = '';
  if (tab === 'points') {
    panel = numbered(it.key_points) || `<p class="none">${it.pending ? 'קורא את הפוסט…' : it.error ? 'אין תקציר: ' + esc(it.error) : 'אין נקודות שמורות לפוסט הזה.'}</p>`;
    if (it.caption) panel += `<details><summary>הכיתוב המקורי</summary><div class="caption">${esc(it.caption)}</div></details>`;
  } else if (tab === 'stuff') {
    panel = (it.materials?.length ? `<h4>חומרים</h4>${plain(it.materials)}` : '') + (it.tools?.length ? `<h4>כלים</h4>${plain(it.tools)}` : '');
    if (!panel) panel = `<p class="none">הפוסט לא מזכיר חומרים או כלים.</p>`;
  } else {
    panel = `<textarea id="notesInput" placeholder="מידות שלי, מה לשנות, איפה קניתי…">${esc(it.notes || '')}</textarea><p class="muted" style="margin:6px 0 0">נשמר אוטומטית</p>`;
  }
  d.innerHTML = `
    <div class="hero">
      ${thumbHtml(it)}
      <div class="shade"></div>
      <div class="herobar">
        <button class="cbtn" id="dBack" title="חזרה">${ICON.back}</button>
        <span class="sp"></span>
        <button class="cbtn ${it.star ? 'on' : ''}" id="dStar" title="מועדף">★</button>
        <button class="cbtn" id="dMore" title="עוד">${ICON.more}</button>
      </div>
      ${isVideo ? `<a class="play" href="${esc(it.url)}" target="_blank" rel="noopener" title="פתח את הסרטון">${ICON.play}</a>` : ''}
      <div class="menu" id="dMenu" hidden>
        <button id="mEdit">עריכה</button>
        <button id="mRetry" ${it.pending ? 'disabled' : ''}>סכם שוב</button>
        <button id="mCopy">העתק קישור</button>
        <button id="mDelete" style="color:var(--warn)">מחק</button>
      </div>
    </div>
    <div class="dsheet">
      <h1>${esc(it.title || (it.pending ? 'קורא את הפוסט…' : 'ללא כותרת'))}</h1>
      ${it.summary ? `<p class="lead">${esc(it.summary)}</p>` : it.error ? `<div class="err">${esc(it.error)}</div>` : ''}
      <div class="metarow">${metas.join('<span class="div"></span>')}</div>
      <div class="statusrow">${['saved', 'want', 'done'].map(s => `<button class="chip" data-status="${s}" aria-pressed="${(it.status || 'saved') === s}">${STATUS_LABEL[s]}</button>`).join('')}</div>
      ${it.tags?.length ? `<div class="dtags">${it.tags.map(t => `<button data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}
      <div class="tabs" role="tablist">
        <button role="tab" data-tab="points" aria-selected="${tab === 'points'}">נקודות</button>
        <button role="tab" data-tab="stuff" aria-selected="${tab === 'stuff'}">חומרים וכלים</button>
        <button role="tab" data-tab="notes" aria-selected="${tab === 'notes'}">הערות שלי</button>
      </div>
      <div class="panel">${panel}</div>
    </div>
    <div class="dock">
      <a class="btn primary" href="${esc(it.url)}" target="_blank" rel="noopener">${ICON.link} פתח את הפוסט המקורי</a>
    </div>`;
  d.hidden = false; $('#list').hidden = true; document.body.style.overflow = 'hidden';
  $('#dBack').onclick = () => closeDetail();
  $('#dStar').onclick = () => { it.star = !it.star; touch(it); };
  $('#dMore').onclick = e => { e.stopPropagation(); $('#dMenu').hidden = !$('#dMenu').hidden; };
  d.onclick = () => { const m = $('#dMenu'); if (m) m.hidden = true; };
  $('#mEdit').onclick = () => openEdit(it);
  $('#mRetry').onclick = async () => { const text = prompt('לא חובה: הדביקו את הכיתוב של הפוסט כדי לעזור לסיכום', '') ?? null; if (text === null) return; await enrich(it, text.trim() || null); };
  $('#mCopy').onclick = async () => { try { await navigator.clipboard.writeText(it.url); toast('הקישור הועתק'); } catch { prompt('הקישור:', it.url); } };
  $('#mDelete').onclick = () => { if (confirm(`למחוק "${it.title || it.url}" מהספרייה?`)) { closeDetail(); removeItem(it.id); } };
  $$('.statusrow .chip', d).forEach(b => b.onclick = () => { it.status = b.dataset.status; touch(it); });
  $$('.dtags button', d).forEach(b => b.onclick = () => { filter.tag = b.dataset.tag; closeDetail(); renderList(); window.scrollTo(0, 0); });
  $$('.tabs button', d).forEach(b => b.onclick = () => { tab = b.dataset.tab; renderDetail(); });
  const notes = $('#notesInput'); if (notes) { let t; notes.oninput = () => { clearTimeout(t); t = setTimeout(() => { it.notes = notes.value.trim(); it.updated = Date.now(); persistLocal(); if (store) { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1200); } }, 500); }; }
}
function renderAll() { renderList(); if (openId) { const keep = $('#notesInput'); if (keep && document.activeElement === keep) return; renderDetail(); } }

// ---------------------------------------------------------------------------
// edit dialog
// ---------------------------------------------------------------------------
function openEdit(it) {
  const dlg = $('#dlg');
  dlg.innerHTML = `<form method="dialog" id="editForm">
    <h2>עריכה</h2>
    <label>כותרת<input name="title" value="${esc(it.title)}" placeholder="כותרת"></label>
    <label>תקציר<textarea name="summary" placeholder="מה רואים ומה לומדים">${esc(it.summary)}</textarea></label>
    <div class="row2">
      <label>סוג<select name="type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${it.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>רמה<select name="difficulty">${['לא ידוע', 'קל', 'בינוני', 'מתקדם'].map(v => `<option ${(it.difficulty || 'לא ידוע') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    <label>תגיות (מופרדות בפסיק)<input name="tags" value="${esc((it.tags || []).join(', '))}"></label>
    <label>נקודות לזכור (שורה לכל נקודה)<textarea name="points">${esc((it.key_points || []).join('\n'))}</textarea></label>
    <div class="row2">
      <label>חומרים (שורה לכל פריט)<textarea name="materials">${esc((it.materials || []).join('\n'))}</textarea></label>
      <label>כלים (שורה לכל פריט)<textarea name="tools">${esc((it.tools || []).join('\n'))}</textarea></label>
    </div>
    <div class="actions">
      <button class="btn primary" value="save" style="flex:1">שמור</button>
      <button class="btn ghost" value="cancel">ביטול</button>
    </div>
  </form>`;
  const form = $('#editForm');
  const lines = s => String(s).split('\n').map(x => x.trim()).filter(Boolean);
  form.onsubmit = e => {
    if (e.submitter?.value !== 'save') return;
    const f = new FormData(form);
    it.title = f.get('title').trim(); it.summary = f.get('summary').trim(); it.type = f.get('type'); it.difficulty = f.get('difficulty');
    it.tags = f.get('tags').split(/[,،]/).map(s => s.trim()).filter(Boolean).slice(0, 10);
    it.key_points = lines(f.get('points')); it.materials = lines(f.get('materials')); it.tools = lines(f.get('tools'));
    touch(it);
  };
  dlg.showModal();
}

// ---------------------------------------------------------------------------
// add sheet + wiring
// ---------------------------------------------------------------------------
function openSheet() { $('#sheet').classList.add('open'); $('#scrim').classList.add('open'); setTimeout(() => $('#urlInput').focus(), 250); }
function closeSheet() { $('#sheet').classList.remove('open'); $('#scrim').classList.remove('open'); hideErr(); }
function showErr(msg) { const el = $('#addErr'); el.textContent = msg; el.hidden = false; if (!$('#sheet').classList.contains('open')) openSheet(); }
function hideErr() { $('#addErr').hidden = true; }
let toastTimer; function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 2500); }

$('#fab').onclick = openSheet;
$('#scrim').onclick = closeSheet;
$('#sheet').onsubmit = e => { e.preventDefault(); addLink($('#urlInput').value, $('#textInput').value.trim() || null); };
$('#toggleText').onclick = () => { const t = $('#textInput'); t.hidden = !t.hidden; if (!t.hidden) t.focus(); };
$('#search').oninput = e => { filter.q = e.target.value; renderList(); };
$('#clearSearch').onclick = () => { $('#search').value = ''; filter.q = ''; renderList(); };
$('#starFilter').onclick = () => { filter.star = !filter.star; renderList(); };
$('#clearFilters').onclick = () => { Object.assign(filter, { type: '', status: '', star: false, tag: '', q: '' }); $('#search').value = ''; renderList(); };
$('#typeChips').onclick = e => {
  const b = e.target.closest('.chip'); if (!b) return;
  if (b.dataset.type !== undefined) { filter.type = b.dataset.type; filter.status = ''; }
  if (b.dataset.status) { filter.status = filter.status === b.dataset.status ? '' : b.dataset.status; filter.type = ''; }
  renderList();
};
$('#tagChips').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; filter.tag = filter.tag === b.dataset.tag ? '' : b.dataset.tag; renderList(); };
$('#grid').onclick = e => {
  const star = e.target.closest('[data-star]'); if (star) { e.stopPropagation(); const it = doc.items[star.dataset.star]; if (it) { it.star = !it.star; touch(it); } return; }
  const open = e.target.closest('[data-open]'); if (open) openDetail(open.dataset.open);
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
window.addEventListener('error', e => toast('שגיאה בדף: ' + (e.message || e.type)));

// Incoming share. Two doors:
//  - manifest share_target (Android / desktop Chrome): /saw/?url=…&text=…&title=…
//  - iPhone Shortcut: /saw/#url=… — the link rides in the hash because the login gate
//    (auth.gallab.top) drops the query string when it bounces a request, even silently.
function incomingShare() {
  const p = new URLSearchParams(location.search);
  const fromQuery = p.get('url') || p.get('text') || p.get('title');
  if (fromQuery) return fromQuery;
  const h = location.hash.replace(/^#/, '');
  if (!h || h.startsWith('i=')) return null;
  const raw = h.replace(/^(url|text)=/, '');
  try { return decodeURIComponent(raw); } catch { return raw; }
}
async function init() {
  renderList();
  const shared = incomingShare();
  const wanted = location.hash.match(/^#i=(.+)$/)?.[1] || null;
  if (store) await Promise.race([syncNow(), new Promise(r => setTimeout(r, 5000))]);
  if (shared) {
    history.replaceState(null, '', location.pathname);
    const url = cleanUrl(shared);
    if (url) { toast('התקבל מהשיתוף'); await addLink(url, null); }
    else { $('#urlInput').value = shared; showErr('לא מצאתי קישור במה ששותף. הדביקו את הקישור ושמרו.'); }
  } else if (wanted && doc.items[wanted]) { openId = wanted; renderDetail(); }
}
init();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('../sw.js').catch(() => {});
