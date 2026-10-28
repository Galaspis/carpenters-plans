// Builds the concrete 3D model (boxes) from a parametric design + parameter values + lumber catalog.
import { evalExpr } from './expr.js';

const TOL = 0.6;

// Map each design profile (e.g. "post": 70x70) to a catalog lumber item.
export function autoMapProfiles(design, catalog, current = {}) {
  const map = {};
  for (const [key, p] of Object.entries(design.profiles)) {
    if (p.hardware) { map[key] = null; continue; } // metal parts: not wood, never mapped to the catalog
    if (current[key] && catalog.lumber.some(l => l.id === current[key])) { map[key] = current[key]; continue; }
    let best = null, bestScore = Infinity;
    for (const l of catalog.lumber) {
      if (l.own) continue; // leftovers are boards of a yard wood, never a wood type of their own
      const [t, w] = [Math.min(l.t, l.w), Math.max(l.t, l.w)];
      let score = Math.abs(t - p.t) * 2 + Math.abs(w - p.w);
      if (l.lastUsed) score -= 8; // buying history: a section you already bought wins a near tie
      if (score < bestScore) { bestScore = score; best = l; }
    }
    map[key] = best ? best.id : null;
  }
  return map;
}

export function profileDims(design, catalog, mapping) {
  const out = {};
  for (const [key, p] of Object.entries(design.profiles)) {
    // when leftovers of this yard wood exist, the geometry uses their measured section
    const inv = catalog.inventory || [];
    const own = (!p.hardware && catalog.woodMode === 'own') ? catalog.lumber.find(l => l.own && l.yardId === mapping[key] && inv.some(r => r.itemId === l.id && r.qty > 0)) : null;
    const item = p.hardware ? null : (own || catalog.lumber.find(l => l.id === mapping[key]));
    const t = item ? Math.min(item.t, item.w) : p.t;
    const w = item ? Math.max(item.t, item.w) : p.w;
    out[key] = { key, label: p.label, t, w, item, hardware: !!p.hardware };
  }
  return out;
}

export function spaceVars(design, spaces) {
  const scope = {};
  for (const s of design.spaces || []) {
    for (const [f, def] of Object.entries(s.fields)) {
      const v = spaces?.[s.id]?.[f];
      scope[`${s.id}_${f}`] = (v === undefined || v === '' || v === null) ? def.value : +v;
    }
  }
  return scope;
}

export function buildScope(design, values, profiles, spaces) {
  const scope = { ...spaceVars(design, spaces) };
  for (const [key, p] of Object.entries(profiles)) { scope[`${key}_t`] = p.t; scope[`${key}_w`] = p.w; }
  for (const p of design.params) scope[p.id] = values[p.id] ?? p.value;
  for (const [name, expr] of Object.entries(design.derived || {})) scope[name] = evalExpr(expr, scope);
  return scope;
}

function assignAxes(size, t, w) {
  const perms = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  let best = null;
  for (const [T, W, L] of perms) {
    if (Math.abs(size[T] - t) < TOL && Math.abs(size[W] - w) < TOL) {
      if (!best || size[L] > size[best.L]) best = { T, W, L };
    }
  }
  return best;
}

export function buildModel(design, values, catalog, mapping, spaces) {
  const warnings = [];
  const profiles = profileDims(design, catalog, mapping);
  const scope = buildScope(design, values, profiles, spaces);
  const instances = [];
  design.parts.forEach((def, defIdx) => {
    const prof = profiles[def.profile];
    if (!prof) { warnings.push(`Part "${def.name}" uses unknown profile "${def.profile}"`); return; }
    const count = Math.round(evalExpr(def.count ?? 1, scope));
    for (let i = 0; i < count; i++) {
      const s = { ...scope, i };
      const at = def.at.map(e => evalExpr(e, s));
      const size = def.size.map(e => evalExpr(e, s));
      if (size.some(v => v <= 0)) { warnings.push(`התנגשות: לחלק "${def.name}" #${i + 1} יש מידה אפס או שלילית [${size.map(r).join(', ')}]`); continue; }
      let ax = assignAxes(size, prof.t, prof.w);
      if (!ax) {
        if (!def.illustration) warnings.push(`החלק "${def.name}" [${size.map(r).join('×')}] לא מתאים לחתך העץ ${prof.t}×${prof.w}`);
        const idx = [0, 1, 2].sort((a, b) => size[a] - size[b]);
        ax = { T: idx[0], W: idx[1], L: idx[2] };
      }
      instances.push({
        uid: `${def.id}#${i}`, def, defIdx, i, object: def.object, hardware: !!prof.hardware, existing: !!def.existing,
        profile: def.profile, prof,
        min: at, max: at.map((v, k) => v + size[k]), size, ax,
        len: size[ax.L], t: size[ax.T], w: size[ax.W],
        holes: [], screws: [],
      });
    }
  });

  // Overlap (collision) check: two boards must never share volume.
  for (let a = 0; a < instances.length; a++) {
    for (let b = a + 1; b < instances.length; b++) {
      const A = instances[a], B = instances[b];
      if (A.def.illustration || B.def.illustration) continue; // a saw blade drawn mid-cut is meant to overlap
      let vol = 1;
      for (let k = 0; k < 3; k++) vol *= Math.max(0, Math.min(A.max[k], B.max[k]) - Math.max(A.min[k], B.min[k]) - 0.5);
      if (vol > 1) warnings.push(`התנגשות: "${A.def.name}" #${A.i + 1} חופף ל-"${B.def.name}" #${B.i + 1}`);
    }
  }

  const own = instances.filter(x => !x.existing);
  const bbox = boxOf(own.length ? own : instances);
  const objectBoxes = {};
  for (const o of design.objects || []) {
    const inst = instances.filter(x => x.object === o.id);
    if (inst.length) objectBoxes[o.id] = boxOf(inst);
  }
  return { scope, profiles, instances, warnings, bbox, objectBoxes };
}

export function boxOf(list) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const x of list) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], x.min[k]); max[k] = Math.max(max[k], x.max[k]); }
  return { min, max, size: max.map((v, k) => v - min[k]) };
}

export const r = v => Math.round(v * 10) / 10;
