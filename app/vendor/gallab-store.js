/* gallab-store.js: tiny client for the hub's document store. Copy this file into a tool
 * (or load it from https://gallab.top/assets/gallab-store.js) and use:
 *
 *   const store = gallabStore("woody", { scope: "family" });   // or scope: "me"
 *   const { doc, version } = await store.load();               // null doc when nothing saved yet
 *   await store.save(doc);                                      // throws GallabConflict if another device saved first
 *
 * It keeps a local copy in localStorage so the tool keeps working offline; save() retries
 * the next time load() or save() is called online. Works on any *.gallab.top site that
 * imports the "datastore" Caddy snippet (same-origin, login cookie sent automatically).
 */
function gallabStore(app, { scope = "me", base = "" } = {}) {
  const path = `${base}/api/${scope === "family" ? "family" : "data"}/${app}`;
  const key = `gallab-store:${scope}:${app}`;
  let version = Number(localStorage.getItem(key + ":version") || 0);

  class GallabConflict extends Error { constructor(info) { super("someone else saved first"); this.info = info; } }

  async function load() {
    try {
      const r = await fetch(path, { credentials: "include", cache: "no-store" });
      if (r.status === 404) return { doc: null, version: 0 };
      if (r.status === 401) throw new Error("not signed in");
      if (!r.ok) throw new Error(`load failed (${r.status})`);
      const doc = await r.json();
      version = Number(r.headers.get("X-Version") || 0);
      try { localStorage.setItem(key, JSON.stringify(doc)); localStorage.setItem(key + ":version", String(version)); } catch {}
      return { doc, version };
    } catch (e) {
      const cached = localStorage.getItem(key);
      if (cached) return { doc: JSON.parse(cached), version, offline: true };
      throw e;
    }
  }

  async function save(doc, { force = false } = {}) {
    try { localStorage.setItem(key, JSON.stringify(doc)); localStorage.setItem(key + ":pending", "1"); } catch {}
    const headers = { "Content-Type": "application/json" };
    if (!force && version) headers["If-Match"] = String(version);
    const r = await fetch(path, { method: "PUT", credentials: "include", headers, body: JSON.stringify(doc) });
    if (r.status === 409) throw new GallabConflict(await r.json());
    if (!r.ok) throw new Error(`save failed (${r.status})`);
    version = (await r.json()).version;
    try { localStorage.setItem(key + ":version", String(version)); localStorage.removeItem(key + ":pending"); } catch {}
    return version;
  }

  const hasPending = () => !!localStorage.getItem(key + ":pending");
  return { load, save, hasPending, get version() { return version; }, GallabConflict };
}
if (typeof module !== "undefined") module.exports = { gallabStore };
