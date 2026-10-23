// Groups model instances into numbered parts. Boards of the same definition and the same length
// share ONE number; if their hole patterns differ (e.g. left/right legs) they become variants of
// that number ("גרסה א / ב"). Rotation of a board is allowed when comparing hole patterns.

const rd = v => Math.round(v * 2) / 2;

function transforms(square) {
  const out = [];
  for (const swap of square ? [false, true] : [false]) {
    for (let m = 0; m < 8; m++) {
      const f = { L: !!(m & 1), W: !!(m & 2), T: !!(m & 4) };
      const flips = (f.L ? 1 : 0) + (f.W ? 1 : 0) + (f.T ? 1 : 0);
      if ((flips + (swap ? 1 : 0)) % 2 !== 0) continue; // proper rotations only
      out.push({ swap, f });
    }
  }
  return out;
}

function applyT(h, tr, dims) {
  let pos = { ...h.pos }, axis = h.axis, side = h.side;
  for (const a of ['L', 'W', 'T']) {
    if (tr.f[a]) { pos[a] = dims[a] - pos[a]; if (axis === a) side = -side; }
  }
  if (tr.swap) {
    pos = { L: pos.L, W: pos.T, T: pos.W };
    if (axis === 'W') axis = 'T'; else if (axis === 'T') axis = 'W';
  }
  return { ...h, pos, axis, side };
}

function sig(holes) {
  return holes.map(h => `${h.axis}${h.side}:${rd(h.pos.L)},${rd(h.pos.W)},${rd(h.pos.T)}:${h.dia}:${h.kind}`).sort().join('|');
}

// canonical orientation: prefer holes on face T-1 (top) and W-1, lowest signature wins
function canonical(inst) {
  const dims = { L: inst.len, W: inst.w, T: inst.t };
  const square = Math.abs(inst.w - inst.t) < 0.6;
  let best = null;
  for (const tr of transforms(square)) {
    const holes = inst.holes.map(h => applyT(h, tr, dims));
    const score = holes.reduce((s, h) => s + (h.axis === 'T' && h.side === -1 ? 0 : h.axis === 'W' && h.side === -1 ? 1 : h.axis === 'L' ? 2 : 3), 0);
    const s = sig(holes);
    if (!best || score < best.score || (score === best.score && s < best.s)) best = { s, holes, score };
  }
  return best;
}

export function groupParts(model) {
  const groups = [];
  const byKey = new Map();
  for (const inst of model.instances) {
    if (inst.existing) continue; // parts that are already there (another piece of furniture, a wall post)
    const key = `${inst.def.id}|${rd(inst.len)}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, def: inst.def, defIdx: inst.defIdx, profile: inst.profile, prof: inst.prof,
            len: inst.len, w: inst.w, t: inst.t, instances: [], variants: [] };
      byKey.set(key, g); groups.push(g);
    }
    g.instances.push(inst);
    inst.group = g;
    const c = canonical(inst);
    let v = g.variants.find(v => v.sig === c.s);
    if (!v) { v = { sig: c.s, holes: c.holes, instances: [] }; g.variants.push(v); }
    v.instances.push(inst);
    inst.variant = v;
  }
  groups.sort((a, b) => a.defIdx - b.defIdx || b.len - a.len);
  const perDef = {};
  groups.forEach(g => { perDef[g.def.id] = (perDef[g.def.id] || 0) + 1; });
  const idx = {};
  groups.forEach((g, i) => {
    g.no = i + 1;
    g.qty = g.instances.length;
    g.holes = g.variants[0].holes;
    if (perDef[g.def.id] > 1) { idx[g.def.id] = (idx[g.def.id] || 0) + 1; g.name = `${g.def.name} ${Math.round(g.len)}`; }
    else g.name = g.def.name;
    g.variants.forEach((v, k) => { v.qty = v.instances.length; v.label = g.variants.length > 1 ? `גרסה ${['א', 'ב', 'ג', 'ד'][k]}` : ''; });
    for (const inst of g.instances) inst.partNo = g.no;
  });
  return groups;
}
