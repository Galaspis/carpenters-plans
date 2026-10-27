// Saw: a woodworking library of saved posts and videos, at woody.gallab.top/saw.
// One shared document for the family in the hub store (/api/family/saw), with a browser copy for offline.
// Enrichment (caption, thumbnail, Hebrew summary) comes from Kort's importer, which Woody's Caddy
// proxies at /api/saw/enrich. Only links are kept: no video files.
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SYNC_ON = typeof gallabStore === 'function' && /\.gallab\.top$/.test(location.hostname);
const store = SYNC_ON ? gallabStore('saw', { scope: 'family' }) : null;
const LOCAL_KEY = 'saw.doc';

const TYPE_LABEL = { project: 'פרויקט', technique: 'טכניקה', tool: 'כלי / ג׳יג', material: 'חומר / גימור', inspiration: 'השראה' };
const PLATFORM_LABEL = { facebook: 'פייסבוק', instagram: 'אינסטגרם', youtube: 'יוטיוב', tiktok: 'טיקטוק', web: 'אתר', manual: '' };
const STATUS_LABEL = { saved: '', want: 'רוצה לבנות', done: 'בניתי' };

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
function scheduleSync() { persistLocal(); render(); if (!store) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 800); }
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
    if (JSON.stringify(doc) !== before) render();
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
    // Tracking noise only; keep the parameters that identify the post (YouTube v=, Facebook story ids...).
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
  if (doc.items[id]) { toast('הקישור הזה כבר שמור'); highlight(id); return; }
  const it = { id, url, platform: platformOf(url), title: '', summary: '', type: 'inspiration', tags: [], materials: [], tools: [], key_points: [], difficulty: '', author: null, thumb: null, status: 'saved', star: false, notes: '', added: Date.now(), updated: Date.now(), pending: true };
  doc.items[id] = it; scheduleSync();
  $('#urlInput').value = ''; $('#textInput').value = ''; hideErr();
  await enrich(it, text);
}
async function enrich(it, text) {
  it.pending = true; it.error = null; render();
  try {
    const r = await fetch('/api/saw/enrich', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: it.url, text: text || undefined }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `שגיאה ${r.status}`);
    const cur = doc.items[it.id]; if (!cur) return; // deleted meanwhile
    Object.assign(cur, {
      title: data.title || cur.title, summary: data.summary || cur.summary, type: data.type || cur.type,
      tags: data.tags || [], materials: data.materials || [], tools: data.tools || [], key_points: data.key_points || [],
      difficulty: data.difficulty || '', author: data.author ?? cur.author, thumb: data.thumbnail_url || cur.thumb,
      platform: data.platform || cur.platform, caption: data.caption || null, pending: false, error: null,
    });
    touch(cur);
  } catch (e) {
    const cur = doc.items[it.id]; if (!cur) return;
    cur.pending = false; cur.error = e.message; touch(cur);
    showErr(`הקישור נשמר, אבל בלי תקציר: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// rendering
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
function render() {
  const items = visible();
  const all = Object.values(doc.items);
  $('#grid').innerHTML = items.map(card).join('');
  $('#empty').hidden = all.length > 0;
  $('#count').textContent = all.length ? (items.length === all.length ? `${all.length} שמורים` : `${items.length} מתוך ${all.length}`) : '';
  const counts = {}; for (const it of all) for (const t of it.tags || []) counts[t] = (counts[t] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 18);
  $('#tagcloud').innerHTML = top.map(([t, n]) => `<button class="chip tag" data-tag="${esc(t)}" aria-pressed="${filter.tag === t}">${esc(t)} <span class="muted">${n}</span></button>`).join('');
}
function card(it) {
  const ph = { facebook: 'f', instagram: '◎', youtube: '▶', tiktok: '♪', web: '🔗' }[it.platform] || '🔗';
  const thumb = it.thumb ? `<img class="thumb" src="${esc(it.thumb)}" alt="" loading="lazy" data-open="${it.id}" onerror="this.outerHTML='<div class=&quot;thumb ph&quot; data-open=&quot;${it.id}&quot;>${ph}</div>'">` : `<div class="thumb ph" data-open="${it.id}">${ph}</div>`;
  return `<article class="item ${it.pending ? 'busy' : ''}" data-id="${it.id}">
    ${thumb}
    <button class="star" aria-pressed="${!!it.star}" data-star="${it.id}" title="מועדף">★</button>
    ${it.status && it.status !== 'saved' ? `<span class="status" data-s="${it.status}">${STATUS_LABEL[it.status]}</span>` : ''}
    ${it.pending ? `<div class="busytag">קורא את הפוסט ומסכם…</div>` : ''}
    <div class="body">
      <h3 class="${it.title ? '' : 'empty'}" data-open="${it.id}">${esc(it.title || (it.error ? 'בלי תקציר — לחצו לערוך' : 'ללא כותרת'))}</h3>
      <p>${esc(it.summary || it.caption || '')}</p>
      <div class="tags">${(it.tags || []).slice(0, 5).map(t => `<span>${esc(t)}</span>`).join('')}</div>
      <div class="foot">
        <span class="plat">${PLATFORM_LABEL[it.platform] || ''}</span>${it.author ? `<span>· ${esc(it.author)}</span>` : ''}
        <span class="sp"></span>
        <a class="iconbtn" href="${esc(it.url)}" target="_blank" rel="noopener" title="פתח את הפוסט המקורי">↗</a>
        <button class="iconbtn" data-open="${it.id}" title="פרטים ועריכה">✎</button>
      </div>
    </div>
  </article>`;
}
function highlight(id) { const el = $(`.item[data-id="${id}"]`); if (!el) return; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.borderColor = 'var(--accent)'; setTimeout(() => el.style.borderColor = '', 1500); }

// ---------------------------------------------------------------------------
// detail / edit dialog
// ---------------------------------------------------------------------------
function openDetail(id) {
  const it = doc.items[id]; if (!it) return;
  const dlg = $('#dlg');
  const list = (title, arr) => arr && arr.length ? `<div class="sec"><b>${title}</b><ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  dlg.innerHTML = `<form class="dl" method="dialog" id="editForm">
    ${it.thumb ? `<img class="big" src="${esc(it.thumb)}" alt="">` : ''}
    <label>כותרת<input name="title" value="${esc(it.title)}" placeholder="כותרת"></label>
    <label>תקציר<textarea name="summary" placeholder="מה רואים ומה לומדים">${esc(it.summary)}</textarea></label>
    <div class="row">
      <label>סוג<select name="type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${it.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>מצב<select name="status"><option value="saved" ${it.status === 'saved' ? 'selected' : ''}>שמור</option><option value="want" ${it.status === 'want' ? 'selected' : ''}>רוצה לבנות</option><option value="done" ${it.status === 'done' ? 'selected' : ''}>בניתי</option></select></label>
    </div>
    <label>תגיות (מופרדות בפסיק)<input name="tags" value="${esc((it.tags || []).join(', '))}"></label>
    <label>הערות שלי<textarea name="notes" placeholder="מידות שלי, מה לשנות, איפה קניתי…">${esc(it.notes || '')}</textarea></label>
    ${list('נקודות לזכור', it.key_points)}${list('חומרים', it.materials)}${list('כלים', it.tools)}
    ${it.difficulty && it.difficulty !== 'לא ידוע' ? `<div class="muted">רמה: ${esc(it.difficulty)}</div>` : ''}
    ${it.caption ? `<details><summary class="muted" style="cursor:pointer">הכיתוב המקורי</summary><p class="muted" style="white-space:pre-wrap">${esc(it.caption)}</p></details>` : ''}
    <div class="muted" style="direction:ltr;text-align:left;word-break:break-all"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.url)}</a></div>
    ${it.error ? `<div class="err">${esc(it.error)}</div>` : ''}
    <div class="actions">
      <button class="btn primary" value="save">שמור</button>
      <button class="btn" type="button" id="retryBtn" ${it.pending ? 'disabled' : ''}>סכם שוב</button>
      <span class="sp"></span>
      <button class="btn ghost" type="button" id="delBtn" style="color:var(--warn)">מחק</button>
      <button class="btn ghost" value="cancel">סגור</button>
    </div>
  </form>`;
  const form = $('#editForm');
  form.onsubmit = e => {
    if (e.submitter?.value !== 'save') return;
    const f = new FormData(form);
    it.title = f.get('title').trim(); it.summary = f.get('summary').trim(); it.type = f.get('type'); it.status = f.get('status');
    it.tags = f.get('tags').split(/[,،]/).map(s => s.trim()).filter(Boolean).slice(0, 10); it.notes = f.get('notes').trim();
    touch(it);
  };
  $('#retryBtn', dlg).onclick = async () => {
    const text = prompt('לא חובה: הדביקו את הכיתוב של הפוסט כדי לעזור לסיכום', '') ?? null;
    if (text === null) return;
    dlg.close(); await enrich(it, text.trim() || null);
  };
  $('#delBtn', dlg).onclick = () => { if (confirm(`למחוק "${it.title || it.url}" מהספרייה?`)) { dlg.close(); removeItem(id); } };
  dlg.showModal();
}

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------
function showErr(msg) { const el = $('#addErr'); el.textContent = msg; el.hidden = false; }
function hideErr() { $('#addErr').hidden = true; }
let toastTimer; function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 2500); }

$('#addForm').onsubmit = e => { e.preventDefault(); addLink($('#urlInput').value, $('#textInput').value.trim() || null); };
$('#toggleText').onclick = () => { const t = $('#textInput'); t.hidden = !t.hidden; if (!t.hidden) t.focus(); };
$('#search').oninput = e => { filter.q = e.target.value; render(); };
$('#filters').onclick = e => {
  const b = e.target.closest('.chip'); if (!b) return;
  if (b.dataset.type !== undefined) { filter.type = b.dataset.type; $$('#filters .chip[data-type]').forEach(c => c.setAttribute('aria-pressed', c === b)); }
  if (b.dataset.status) { filter.status = filter.status ? '' : b.dataset.status; b.setAttribute('aria-pressed', !!filter.status); }
  if (b.dataset.star) { filter.star = !filter.star; b.setAttribute('aria-pressed', filter.star); }
  render();
};
$('#tagcloud').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; filter.tag = filter.tag === b.dataset.tag ? '' : b.dataset.tag; render(); };
$('#grid').onclick = e => {
  const star = e.target.closest('[data-star]'); if (star) { const it = doc.items[star.dataset.star]; if (it) { it.star = !it.star; touch(it); } return; }
  const open = e.target.closest('[data-open]'); if (open) openDetail(open.dataset.open);
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });

// Share target (manifest share_target → /saw/?url=…&text=…&title=…). Facebook often puts the link in `text`.
async function init() {
  render();
  if (store) await Promise.race([syncNow(), new Promise(r => setTimeout(r, 5000))]);
  const p = new URLSearchParams(location.search);
  const shared = p.get('url') || p.get('text') || p.get('title');
  if (shared) {
    history.replaceState(null, '', location.pathname);
    const url = cleanUrl(shared);
    if (url) await addLink(url, null);
    else { $('#urlInput').value = shared; showErr('לא מצאתי קישור במה ששותף. הדביקו את הקישור ושמרו.'); }
  }
}
init();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('../sw.js').catch(() => {});
