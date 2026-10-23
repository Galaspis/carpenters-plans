// Finds the largest version of a design that can be built from the wood you already own.
// Parameters flagged "fit": true are searched. "fitStage": 1 = the main object (searched first, with
// stage-2 params at their minimum); "fitStage": 2 = extras (shelf, wall…) searched afterwards from the
// leftovers. The first param of a stage is scanned large→small and stops at the first fit.
import { buildModel } from './model.js';
import { groupParts } from './parts.js';
import { cutPlanWithInventory } from './cutlist.js';

function gridFor(p, maxN, cap) {
  const step = p.step || 1;
  const hi = Math.min(p.max ?? p.value, cap ?? Infinity), lo = p.min ?? p.value;
  const n = Math.floor(Math.max(0, hi - lo) / step), k = Math.max(1, Math.ceil(n / maxN));
  const vals = [];
  for (let v = Math.floor(hi / step) * step; v >= lo - 1e-9; v -= step * k) vals.push(Math.round(v / step) * step);
  if (!vals.includes(lo)) vals.push(lo);
  return [...new Set(vals)].sort((a, b) => b - a);
}

function search(design, values, catalog, mapping, spaces, params, caps) {
  const [main, ...rest] = params;
  const mainGrid = gridFor(main, 30, caps[main.id]);
  const restGrids = rest.map(p => gridFor(p, 8, caps[p.id]));
  const missingOf = vals => {
    const model = buildModel(design, vals, catalog, mapping, spaces);
    if (model.warnings.some(w => w.startsWith('התנגשות'))) return Infinity;
    const cut = cutPlanWithInventory(groupParts(model), catalog, mapping);
    // only woods you actually have leftovers of must come out whole; the rest is bought anyway
    return cut.plans.reduce((s, p) => s + (p.ownedTotal > 0 ? p.missing + p.oversize.length : 0), 0);
  };
  const combos = [];
  const rec = (i, cur) => { if (i === rest.length) { combos.push({ ...cur }); return; } for (const v of restGrids[i]) { cur[rest[i].id] = v; rec(i + 1, cur); } };
  rec(0, {});
  let best = null, evals = 0;
  for (const combo of combos) {
    for (const w of mainGrid) {
      const vals = { ...values, ...combo, [main.id]: w };
      evals++;
      let miss; try { miss = missingOf(vals); } catch { miss = Infinity; }
      if (miss > 0) continue;
      const score = params.reduce((s, p, k) => { const span = Math.max(1, Math.min(p.max ?? 1, caps[p.id] ?? Infinity) - (p.min ?? 0)); return s + ((vals[p.id] - (p.min ?? 0)) / span) * (k === 0 ? 3 : k === 1 ? 1.5 : 0.5); }, 0);
      if (!best || score > best.score) best = { score, values: Object.fromEntries(params.map(p => [p.id, vals[p.id]])) };
      break;
    }
  }
  return { best, evals };
}

/** caps: {paramId: maxValue} e.g. from the room size. Returns {ok, values, evals, stages}. */
export function fitToInventory(design, values, catalog, mapping, spaces, caps = {}) {
  const fitParams = design.params.filter(p => p.fit);
  if (!fitParams.length) return { ok: false, reason: 'לעיצוב הזה אין מידות שניתן להתאים אוטומטית' };
  const s1 = fitParams.filter(p => (p.fitStage ?? 1) === 1), s2 = fitParams.filter(p => p.fitStage === 2);
  let vals = { ...values }, evals = 0;
  for (const p of s2) vals[p.id] = p.min ?? 0; // extras off while sizing the main object
  if (s1.length) {
    const r = search(design, vals, catalog, mapping, spaces, s1, caps); evals += r.evals;
    if (!r.best) return { ok: false, reason: 'גם הגרסה הקטנה ביותר לא נכנסת בעץ שיש לך', evals };
    Object.assign(vals, r.best.values);
  }
  if (s2.length) {
    const r = search(design, vals, catalog, mapping, spaces, s2, caps); evals += r.evals;
    if (r.best) Object.assign(vals, r.best.values);
  }
  return { ok: true, values: Object.fromEntries(fitParams.map(p => [p.id, vals[p.id]])), evals };
}
