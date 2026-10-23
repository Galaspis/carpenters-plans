// SVG rendering: isometric 3D views, orthographic views with dimensions, part drawings with
// lettered holes, cut-plan boards. Plain SVG so it prints and exports cleanly.

const WOOD = { top: '#e4c08f', front: '#d9b17c', side: '#b8905c', edge: '#202125' };
const HL = { top: '#ff8d6e', front: '#f4512e', side: '#c93f22', edge: '#202125' };
const GHOST = { top: '#f2f3f4', front: '#e6e7e9', side: '#d7d9dc', edge: '#c4c7cb' };
const METAL = { top: '#8a8f94', front: '#6b7075', side: '#55595d', edge: '#2b2e31' };
const FONT = 'font-family="Arial, Helvetica, sans-serif"';

export function makeProjection(view = {}) {
  const az = ((view.azimuth ?? 35) * Math.PI) / 180;
  const el = ((view.elevation ?? 28) * Math.PI) / 180;
  const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
  // camera at front-right-top: dir = (sa*ce, -ca*ce, se) points from the scene to the camera, proj(dir) = 0
  const proj = ([x, y, z]) => [x * ca + y * sa, -(z * ce) + (x * sa - y * ca) * se];
  return { proj, dir: [sa * ce, -ca * ce, se] };
}

// 2D convex hull (monotone chain) of projected points
function convexHull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = []; for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  lower.pop(); upper.pop(); return lower.concat(upper);
}
// separating-axis test between two convex polygons; a tiny margin treats edge-touching as no overlap
function hullsOverlap(a, b, eps = 0.6) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
      const nx = p2[1] - p1[1], ny = p1[0] - p2[0];
      const len = Math.hypot(nx, ny) || 1;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const q of a) { const d = (q[0] * nx + q[1] * ny) / len; amin = Math.min(amin, d); amax = Math.max(amax, d); }
      for (const q of b) { const d = (q[0] * nx + q[1] * ny) / len; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
      if (amax <= bmin + eps || bmax <= amin + eps) return false;
    }
  }
  return true;
}

function boxFaces(min, max) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  return {
    top:   { n: [0, 0, 1],  p: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
    bottom:{ n: [0, 0, -1], p: [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]] },
    front: { n: [0, -1, 0], p: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
    back:  { n: [0, 1, 0],  p: [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]] },
    side:  { n: [1, 0, 0],  p: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] },
    left:  { n: [-1, 0, 0], p: [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]] },
  };
}

/**
 * Isometric view.
 * opts.highlight: Set of uids drawn in orange; opts.ghost: Set of uids drawn faded;
 * opts.labels: 'group' (one label per part number) | 'all' | false; opts.labelFilter(inst)
 * opts.screws: screws to draw; opts.explode: 0..1
 */
export function iso(instances, opts = {}) {
  const { highlight = new Set(), ghost = new Set(), screws = [], labels = false, width = 900, height = 600, view = {}, explode = 0 } = opts;
  const { proj, dir } = makeProjection(view);
  const center = [0, 0, 0];
  if (explode && instances.length) for (const x of instances) for (let k = 0; k < 3; k++) center[k] += (x.min[k] + x.max[k]) / 2 / instances.length;
  const offsets = new Map();
  const boxes = instances.map(x => {
    let min = x.min, max = x.max;
    if (explode) {
      const c = x.min.map((v, k) => (v + x.max[k]) / 2);
      const off = c.map((v, k) => (v - center[k]) * explode);
      offsets.set(x.uid, off);
      min = min.map((v, k) => v + off[k]); max = max.map((v, k) => v + off[k]);
    }
    const corners = [];
    for (let i = 0; i < 8; i++) corners.push(proj([i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]));
    const sx = corners.map(p => p[0]), sy = corners.map(p => p[1]);
    return { inst: x, min, max, s: [Math.min(...sx), Math.min(...sy), Math.max(...sx), Math.max(...sy)], hull: convexHull(corners) };
  });
  // Draw order: boards are non-overlapping axis-aligned boxes, so for any pair that overlaps on
  // screen a separating axis tells which one is behind (the one on the side the camera is not).
  const n = boxes.length, after = Array.from({ length: n }, () => []), indeg = new Array(n).fill(0);
  iso.lastEdges = []; iso.lastBoxes = boxes;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const A = boxes[a], B = boxes[b];
    if (A.s[2] <= B.s[0] || B.s[2] <= A.s[0] || A.s[3] <= B.s[1] || B.s[3] <= A.s[1]) continue; // no screen overlap (cheap test)
    if (!hullsOverlap(A.hull, B.hull)) continue; // exact test on the projected outlines: avoids false "in front" edges
    let best = null;
    for (let k = 0; k < 3; k++) {
      if (!dir[k]) continue;
      let gap, aBehind;
      if (A.max[k] <= B.min[k] + 0.5) { gap = B.min[k] - A.max[k]; aBehind = dir[k] > 0; }
      else if (B.max[k] <= A.min[k] + 0.5) { gap = A.min[k] - B.max[k]; aBehind = dir[k] < 0; }
      else continue;
      if (!best || gap > best.gap) best = { gap, aBehind, k };
    }
    if (!best) continue;
    const [first, second] = best.aBehind ? [a, b] : [b, a];
    after[first].push(second); indeg[second]++;
    (iso.lastEdges ||= []).push([first, second, best.k, Math.round(best.gap)]);
  }
  const order = [];
  const queue = boxes.map((_, i) => i).filter(i => indeg[i] === 0);
  const done = new Array(n).fill(false);
  iso.stats = { cycles: 0, edges: after.reduce((s, a) => s + a.length, 0) };
  while (order.length < n) {
    if (!queue.length) { // cycle (should not happen with non-overlapping boards): fall back to depth
      iso.stats.cycles++;
      const rest = boxes.map((b, i) => i).filter(i => !done[i]).sort((i, j) => depthOf(boxes[i]) - depthOf(boxes[j]));
      queue.push(rest[0]);
    }
    const i = queue.shift(); if (done[i]) continue; done[i] = true; order.push(i);
    for (const j of after[i]) if (--indeg[j] === 0) queue.push(j);
  }
  function depthOf(b) { const c = b.min.map((v, k) => (v + b.max[k]) / 2); return c[0] * dir[0] + c[1] * dir[1] + c[2] * dir[2]; }
  iso.lastOrder = order.map(i => boxes[i].inst);
  const faces = [];
  for (const i of order) {
    const { inst: x, min, max } = boxes[i];
    const pal = highlight.has(x.uid) ? (x.hardware ? { ...METAL, edge: '#000' } : HL) : (ghost.has(x.uid) || x.existing) ? GHOST : x.hardware ? METAL : WOOD;
    for (const [name, f] of Object.entries(boxFaces(min, max))) {
      const facing = f.n[0] * dir[0] + f.n[1] * dir[1] + f.n[2] * dir[2];
      if (facing <= 0) continue;
      const fill = name === 'top' || name === 'bottom' ? pal.top : name === 'front' || name === 'back' ? pal.front : pal.side;
      faces.push({ pts: f.p.map(proj), fill, stroke: pal.edge, inst: x, name });
    }
  }
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const f of faces) for (const [px, py] of f.pts) { minx = Math.min(minx, px); miny = Math.min(miny, py); maxx = Math.max(maxx, px); maxy = Math.max(maxy, py); }
  if (!isFinite(minx)) return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"></svg>`;
  const pad = 46;
  const sc = Math.min((width - 2 * pad) / (maxx - minx), (height - 2 * pad) / (maxy - miny));
  const ox = pad + ((width - 2 * pad) - (maxx - minx) * sc) / 2, oy = pad + ((height - 2 * pad) - (maxy - miny) * sc) / 2;
  const X = p => ((p[0] - minx) * sc + ox), Y = p => ((p[1] - miny) * sc + oy);
  let out = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" ${FONT}>`;
  for (const f of faces) out += `<polygon points="${f.pts.map(p => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(' ')}" fill="${f.fill}" stroke="${f.stroke}" stroke-width="${ghost.has(f.inst.uid) ? 0.5 : 0.9}" stroke-linejoin="round"/>`;
  // screws: head outside the board, dashed shaft into it
  for (const s of screws) {
    const off = offsets.get(s.joint?.thr?.uid) || [0, 0, 0];
    const st = s.start.map((v, k) => v + off[k]);
    const head = st.map((v, k) => v - s.dir[k] * 70);
    const tip = s.end.map((v, k) => v + off[k]);
    const a = proj(head), b = proj(st), c = proj(tip);
    out += `<line x1="${X(a)}" y1="${Y(a)}" x2="${X(b)}" y2="${Y(b)}" stroke="#222" stroke-width="2.2"/>`;
    out += `<line x1="${X(b)}" y1="${Y(b)}" x2="${X(c)}" y2="${Y(c)}" stroke="#222" stroke-width="1" stroke-dasharray="3 2"/>`;
    out += `<circle cx="${X(a)}" cy="${Y(a)}" r="3" fill="#222"/>`;
  }
  // callouts: one per part number (or per instance). The number sits outside the drawing with a
  // leader line to the board, like an IKEA sheet; candidates are nudged apart so they never overlap.
  if (labels) {
    const centers = new Map(); // uid -> [cx, cy, inst]
    for (const f of faces) {
      if (!f.inst.partNo || (opts.labelFilter && !opts.labelFilter(f.inst))) continue;
      const c = centers.get(f.inst.uid) || [0, 0, 0, f.inst];
      for (const p of f.pts) { c[0] += X(p); c[1] += Y(p); c[2]++; }
      centers.set(f.inst.uid, c);
    }
    const imgC = [width / 2, height / 2];
    const picks = new Map(); // key -> {cx, cy, inst, d}
    for (const [, c] of centers) {
      const cx = c[0] / c[2], cy = c[1] / c[2];
      const key = labels === 'group' ? c[3].partNo : c[3].uid;
      const d = Math.hypot(cx - imgC[0], cy - imgC[1]);
      if (!picks.has(key) || d > picks.get(key).d) picks.set(key, { cx, cy, inst: c[3], d });
    }
    const placed = [];
    const R = 13;
    const free = (x, y) => placed.every(p => Math.hypot(p[0] - x, p[1] - y) >= 2 * R + 3) && x > R && x < width - R && y > R && y < height - R;
    for (const { cx, cy, inst } of [...picks.values()].sort((a, b) => b.d - a.d)) {
      const ang0 = Math.atan2(cy - imgC[1], cx - imgC[0]);
      let lx = cx, ly = cy, ok = false;
      for (let dist = 40; dist <= 160 && !ok; dist += 20) {
        for (const da of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) {
          const a = ang0 + da;
          lx = cx + Math.cos(a) * dist; ly = cy + Math.sin(a) * dist;
          if (free(lx, ly)) { ok = true; break; }
        }
      }
      if (!ok) { lx = cx; ly = cy; }
      placed.push([lx, ly]);
      out += `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="#222" stroke-width="0.9"/><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.2" fill="#222"/>`;
      out += `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="${R}" fill="#fff" stroke="#222" stroke-width="1.4"/><text x="${lx.toFixed(1)}" y="${(ly + 4.5).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="bold" fill="#222">${inst.partNo}</text>`;
    }
  }
  return out + '</svg>';
}

// --- dimension helpers ---
const DEFS = `<defs><marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,2 L10,5 L0,8 z" fill="#222"/></marker></defs>`;
function hdim(x1, x2, y, text, above = true) {
  const ty = above ? y - 4 : y + 13;
  return `<g stroke="#222" stroke-width="0.8" fill="none"><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" marker-start="url(#arr)" marker-end="url(#arr)"/></g><text x="${(x1 + x2) / 2}" y="${ty}" font-size="11" text-anchor="middle" fill="#222">${text}</text>`;
}
function vdim(x, y1, y2, text) {
  return `<g stroke="#222" stroke-width="0.8" fill="none"><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" marker-start="url(#arr)" marker-end="url(#arr)"/></g><text x="${x + 4}" y="${(y1 + y2) / 2 + 4}" font-size="11" fill="#222">${text}</text>`;
}
function ext(x1, y1, x2, y2) { return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#222" stroke-width="0.5"/>`; }

// --- Orthographic views ---
export function ortho(instances, bbox, which, opts = {}) {
  const { width = 460, height = 360, title = '' } = opts;
  const ax = which === 'front' ? [0, 2] : which === 'side' ? [1, 2] : [0, 1];
  const depthAx = which === 'front' ? 1 : which === 'side' ? 0 : 2;
  const flipY = which !== 'top';
  const W = bbox.size[ax[0]], H = bbox.size[ax[1]];
  const pad = 56;
  const sc = Math.min((width - 2 * pad) / W, (height - 2 * pad) / H);
  const X = v => pad + (v - bbox.min[ax[0]]) * sc;
  const Y = v => flipY ? height - pad - (v - bbox.min[ax[1]]) * sc : pad + (v - bbox.min[ax[1]]) * sc;
  // far boards first; nearer boards are drawn lighter so layers stay readable
  const sorted = [...instances].sort((a, b) => (which === 'front' ? b.min[depthAx] - a.min[depthAx] : a.min[depthAx] - b.min[depthAx]));
  const dMin = bbox.min[depthAx], dMax = bbox.max[depthAx];
  let out = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" ${FONT}>${DEFS}`;
  for (const x of sorted) {
    const x0 = X(x.min[ax[0]]), x1 = X(x.max[ax[0]]), y0 = Y(x.min[ax[1]]), y1 = Y(x.max[ax[1]]);
    let near = (x.min[depthAx] - dMin) / Math.max(1, dMax - dMin); if (which === 'front') near = 1 - near;
    const shade = Math.round(near * 28);
    const fill = x.ax.L === depthAx ? `rgb(${176 + shade},${128 + shade},${63 + shade})` : `rgb(${201 + shade},${154 + shade},${94 + shade})`;
    out += `<rect x="${Math.min(x0, x1).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${Math.abs(x1 - x0).toFixed(1)}" height="${Math.abs(y1 - y0).toFixed(1)}" fill="${fill}" stroke="${WOOD.edge}" stroke-width="0.7"/>`;
  }
  const top = Math.min(Y(bbox.min[ax[1]]), Y(bbox.max[ax[1]])), bot = Math.max(Y(bbox.min[ax[1]]), Y(bbox.max[ax[1]]));
  out += ext(X(bbox.min[ax[0]]), top, X(bbox.min[ax[0]]), top - 22) + ext(X(bbox.max[ax[0]]), top, X(bbox.max[ax[0]]), top - 22);
  out += hdim(X(bbox.min[ax[0]]), X(bbox.max[ax[0]]), top - 16, Math.round(W));
  out += ext(X(bbox.max[ax[0]]), top, X(bbox.max[ax[0]]) + 22, top) + ext(X(bbox.max[ax[0]]), bot, X(bbox.max[ax[0]]) + 22, bot);
  out += vdim(X(bbox.max[ax[0]]) + 16, top, bot, Math.round(H));
  out += `<text x="${width / 2}" y="${height - 6}" font-size="12" text-anchor="middle" fill="#555">${title}</text></svg>`;
  return out;
}

// --- Simple part drawing ---------------------------------------------------------------------
// Only clearance holes (screw passes through THIS board) are drawn; pilot holes are drilled during
// assembly through the other board's hole. Each hole shows its absolute distance from the left end.
const SIMPLE_FACES = { 'T-1': 'פן הרחב', 'T1': 'פן הרחב השני', 'W-1': 'צלע הצרה', 'W1': 'צלע הצרה השנייה', 'L-1': 'קצה השמאלי', 'L1': 'קצה הימני' };

export function partSimple(holes, dims, opts = {}) {
  const { width = 900 } = opts;
  const { len: L, w: Wd, t: T } = dims;
  const clear = holes.filter(h => h.kind !== 'pilot');
  const byFace = new Map();
  for (const h of clear) { const k = `${h.axis}${h.side}`; if (!byFace.has(k)) byFace.set(k, []); byFace.get(k).push(h); }
  const order = ['T-1', 'W-1', 'T1', 'W1', 'L-1', 'L1'].filter(k => byFace.has(k));
  const faces = [], sentences = [];
  const padL = 24, padR = 90, padT = 34, padB = 44;
  const sc = Math.min((width - padL - padR) / Math.max(L, 1), 2.2);
  const drawFace = (k, hs) => {
    const isEnd = k.startsWith('L');
    const fw = (isEnd ? T : L) * sc, fh = Math.max((k.startsWith('W') ? T : Wd) * sc, 22);
    const cross = k.startsWith('W') ? 'T' : 'W';
    const crossLen = k.startsWith('W') ? T : Wd;
    const height = padT + fh + padB;
    let out = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" ${FONT}>${DEFS}`;
    out += `<rect x="${padL}" y="${padT}" width="${fw.toFixed(1)}" height="${fh.toFixed(1)}" fill="${WOOD.top}" stroke="${WOOD.edge}" stroke-width="1.2"/>`;
    out += hdim(padL, padL + fw, padT - 12, fmt(isEnd ? T : L)) + vdim(padL + fw + 12, padT, padT + fh, fmt(crossLen));
    const xs = new Map(); // x -> list of cross positions
    for (const h of hs) {
      const px = padL + (isEnd ? h.pos.T : h.pos.L) * sc, c = isEnd ? h.pos.W : h.pos[cross];
      const py = padT + fh - c * sc;
      const r = Math.max(4, h.dia * sc / 2);
      out += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r.toFixed(1)}" fill="#fff" stroke="#b22" stroke-width="1.6"/>`;
      if (h.cbore) out += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(h.cbore.dia * sc / 2).toFixed(1)}" fill="none" stroke="#b22" stroke-width="0.8" stroke-dasharray="3 2"/>`;
      const key = Math.round(isEnd ? h.pos.T : h.pos.L);
      if (!xs.has(key)) xs.set(key, []);
      xs.get(key).push(Math.round(c));
    }
    // absolute distance from the left end under each hole column (alternate rows when crowded)
    const cols = [...xs.keys()].sort((a, b) => a - b);
    let lastX = -1e9, row = 0;
    for (const vx of cols) {
      const px = padL + vx * sc;
      row = px - lastX < 34 ? 1 - row : 0; lastX = px;
      const yT = padT + fh + 16 + row * 14;
      out += `<line x1="${px.toFixed(1)}" y1="${(padT + fh).toFixed(1)}" x2="${px.toFixed(1)}" y2="${(yT - 10).toFixed(1)}" stroke="#b22" stroke-width="0.7"/>`;
      out += `<text x="${px.toFixed(1)}" y="${yT}" font-size="12" font-weight="bold" text-anchor="middle" fill="#b22">${vx}</text>`;
    }
    // distance from the bottom edge, on the right, for each distinct cross position
    const crosses = [...new Set([...xs.values()].flat())].sort((a, b) => a - b);
    crosses.forEach((c, i) => {
      const py = padT + fh - c * sc;
      out += `<line x1="${(padL + fw).toFixed(1)}" y1="${py.toFixed(1)}" x2="${(padL + fw + 56).toFixed(1)}" y2="${py.toFixed(1)}" stroke="#b22" stroke-width="0.7" stroke-dasharray="2 2"/>`;
      out += `<text x="${(padL + fw + 60).toFixed(1)}" y="${(py + 4).toFixed(1)}" font-size="12" font-weight="bold" fill="#b22">${c}</text>`;
    });
    return out + '</svg>';
  };
  for (const k of order) {
    const hs = byFace.get(k);
    faces.push({ key: k, name: 'ה' + SIMPLE_FACES[k], svg: drawFace(k, hs) });
    // sentences: group by diameter / cross distance / screw
    const groups = new Map();
    for (const h of hs) {
      const isEnd = k.startsWith('L');
      const c = Math.round(isEnd ? h.pos.W : h.pos[k.startsWith('W') ? 'T' : 'W']);
      const gk = `${h.dia}|${c}|${h.screw}|${h.cbore ? h.cbore.depth : 0}`;
      if (!groups.has(gk)) groups.set(gk, { dia: h.dia, c, screw: h.screw, cbore: h.cbore, csk: h.csk, xs: [] });
      groups.get(gk).xs.push(Math.round(k.startsWith('L') ? h.pos.T : h.pos.L));
    }
    for (const g of groups.values()) {
      const xs = [...new Set(g.xs)].sort((a, b) => a - b);
      const n = g.xs.length;
      let s = `${n} ${n === 1 ? 'חור' : 'חורים'} Ø${g.dia} ב${SIMPLE_FACES[k]} · ${g.c} מהצלע · ${xs.join(' / ')} מהקצה השמאלי · בורג ${g.screw}`;
      s += g.cbore ? ` · כוס Ø${g.cbore.dia} עומק ${g.cbore.depth}` : ' · שקע';
      sentences.push(s);
    }
  }
  if (!order.length) {
    const fh = Math.max(Wd * sc, 22);
    faces.push({ key: 'T-1', name: '', svg: `<svg viewBox="0 0 ${width} ${padT + fh + 20}" xmlns="http://www.w3.org/2000/svg" ${FONT}>${DEFS}<rect x="${padL}" y="${padT}" width="${(L * sc).toFixed(1)}" height="${fh}" fill="${WOOD.top}" stroke="${WOOD.edge}" stroke-width="1.2"/>${hdim(padL, padL + L * sc, padT - 12, fmt(L))}${vdim(padL + L * sc + 12, padT, padT + fh, fmt(Wd))}</svg>` });
  }
  const pilots = holes.length - clear.length;
  return { faces, sentences, pilots };
}

export function cutBoardSimple(board, width = 900) {
  const h = 56, pad = 8;
  const sc = (width - 2 * pad) / board.L;
  let out = `<svg viewBox="0 0 ${width} ${h + 8}" xmlns="http://www.w3.org/2000/svg" ${FONT}>`;
  out += `<rect x="${pad}" y="4" width="${(board.L * sc).toFixed(1)}" height="${h}" fill="#efe3cf" stroke="#8a6a3c"/>`;
  for (const c of board.layout) {
    const x = pad + c.x * sc, w = c.len * sc;
    out += `<rect x="${x.toFixed(1)}" y="4" width="${w.toFixed(1)}" height="${h}" fill="${WOOD.top}" stroke="${WOOD.edge}" stroke-width="1.2"/>`;
    if (w > 44) out += `<text x="${(x + w / 2).toFixed(1)}" y="${h / 2 - 2}" text-anchor="middle" font-size="15" font-weight="bold" fill="#222">#${c.no}</text><text x="${(x + w / 2).toFixed(1)}" y="${h / 2 + 16}" text-anchor="middle" font-size="13" fill="#222">${c.len}</text>`;
    else out += `<text x="${(x + w / 2).toFixed(1)}" y="${h / 2 + 5}" text-anchor="middle" font-size="11" font-weight="bold" fill="#222">#${c.no}</text>`;
  }
  if (board.waste > 0) { const x = pad + (board.L - board.waste) * sc; out += `<text x="${(x + board.waste * sc / 2).toFixed(1)}" y="${h / 2 + 5}" text-anchor="middle" font-size="11" fill="#8a6a3c">${Math.round(board.waste)}</text>`; }
  return out + '</svg>';
}

// --- Part drawing with lettered holes (kept for data export) ------------------------------------
export const FACE_NAMES = {
  'T-1': 'פן A (הפן הרחב, כלפי מעלה)', 'T1': 'פן B (הפן הרחב השני)',
  'W-1': 'צלע A (הצד הצר)', 'W1': 'צלע B (הצד הצר השני)',
  'L-1': 'קצה שמאל', 'L1': 'קצה ימין',
};
const LETTERS = 'אבגדהוזחטיכלמנסעפצקרשת';

/**
 * Part drawing, one SVG per face that has holes (numbers only inside the SVG — Hebrew labels are
 * returned separately so the HTML can place them with correct bidi).
 * Returns { faces: [{ key, name, svg }], rows } ; rows = hole table.
 */
export function partDrawing(holes, dims, opts = {}) {
  const { width = 900 } = opts;
  const { len: L, w: Wd, t: T } = dims;
  const byFace = new Map();
  for (const h of holes) { const k = `${h.axis}${h.side}`; if (!byFace.has(k)) byFace.set(k, []); byFace.get(k).push(h); }
  const order = ['T-1', 'W-1', 'T1', 'W1', 'L-1', 'L1'].filter(k => byFace.has(k));
  const rows = [], faces = [];
  let letter = 0;
  const assign = h => { h.letter = LETTERS[letter++ % LETTERS.length]; return h.letter; };
  const padL = 30, padR = 60, padT = 30, padB = 48;
  const sc = Math.min((width - padL - padR) / Math.max(L, 1), 2.2);
  const x0 = padL;
  const drawFace = (k, hs) => {
    const isEnd = k.startsWith('L');
    const fw = (isEnd ? T : L) * sc, fh = Math.max((k.startsWith('W') ? T : Wd) * sc, 18);
    const cross = k.startsWith('W') ? 'T' : 'W';
    const crossLen = k.startsWith('W') ? T : Wd;
    const height = padT + fh + padB;
    let out = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" ${FONT}>${DEFS}`;
    out += `<rect x="${x0}" y="${padT}" width="${fw.toFixed(1)}" height="${fh.toFixed(1)}" fill="${WOOD.top}" stroke="${WOOD.edge}"/>`;
    if (isEnd) {
      for (const h of hs) {
        const lt = assign(h);
        out += hole(x0 + h.pos.T * sc, padT + fh - h.pos.W * sc, h, sc, lt);
        rows.push(row(h, k, lt, h.pos.T, h.pos.W));
      }
      out += hdim(x0, x0 + fw, padT + fh + 16, Math.round(T), false) + vdim(x0 + fw + 10, padT, padT + fh, fmt(Wd));
      return out + '</svg>';
    }
    const xs = [];
    for (const h of hs) {
      const lt = assign(h);
      out += hole(x0 + h.pos.L * sc, padT + fh - h.pos[cross] * sc, h, sc, lt);
      xs.push(Math.round(h.pos.L * 2) / 2);
      rows.push(row(h, k, lt, h.pos.L, h.pos[cross]));
    }
    const ux = [...new Set(xs)].sort((a, b) => a - b);
    const yd = padT + fh + 16;
    let prev = 0;
    for (const vx of ux) {
      out += ext(x0 + vx * sc, padT + fh, x0 + vx * sc, yd + 4);
      if (vx - prev >= 1) out += hdim(x0 + prev * sc, x0 + vx * sc, yd, fmt(vx - prev), false);
      prev = vx;
    }
    if (L - prev >= 1) out += hdim(x0 + prev * sc, x0 + L * sc, yd, fmt(L - prev), false);
    out += ext(x0, padT + fh, x0, yd + 4) + ext(x0 + L * sc, padT + fh, x0 + L * sc, yd + 4);
    out += hdim(x0, x0 + fw, padT - 12, fmt(L));
    out += vdim(x0 + fw + 10, padT, padT + fh, fmt(crossLen));
    return out + '</svg>';
  };
  for (const k of order) faces.push({ key: k, name: FACE_NAMES[k], svg: drawFace(k, byFace.get(k).slice().sort((a, b) => a.pos.L - b.pos.L || a.pos.W - b.pos.W)) });
  if (!order.length) {
    const fh = Math.max(Wd * sc, 18);
    faces.push({ key: 'T-1', name: FACE_NAMES['T-1'], svg: `<svg viewBox="0 0 ${width} ${padT + fh + padB}" xmlns="http://www.w3.org/2000/svg" ${FONT}>${DEFS}<rect x="${x0}" y="${padT}" width="${(L * sc).toFixed(1)}" height="${fh}" fill="${WOOD.top}" stroke="${WOOD.edge}"/>${hdim(x0, x0 + L * sc, padT - 12, fmt(L))}${vdim(x0 + L * sc + 10, padT, padT + fh, fmt(Wd))}</svg>` });
  }
  return { faces, rows };
}

function hole(px, py, h, sc, letter) {
  const r = Math.max(3, h.dia * sc / 2);
  const col = h.kind === 'pilot' ? '#1f6fb2' : '#b22';
  let s = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r.toFixed(1)}" fill="${h.kind === 'pilot' ? '#cfe3f5' : '#fff'}" stroke="${col}" stroke-width="1.2"/>`;
  if (h.csk) s += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(h.csk * sc / 2).toFixed(1)}" fill="none" stroke="${col}" stroke-width="0.6"/>`;
  if (h.cbore) s += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(h.cbore.dia * sc / 2).toFixed(1)}" fill="none" stroke="${col}" stroke-width="0.6" stroke-dasharray="2 1"/>`;
  s += `<circle cx="${(px + 14).toFixed(1)}" cy="${(py - 12).toFixed(1)}" r="8" fill="#fff" stroke="${col}" stroke-width="0.8"/><text x="${(px + 14).toFixed(1)}" y="${(py - 8.5).toFixed(1)}" font-size="10" text-anchor="middle" fill="${col}" font-weight="bold">${letter}</text>`;
  return s;
}

function row(h, face, letter, a, b) {
  return { letter, face: FACE_NAMES[face], fromEnd: fmt(a), fromEdge: fmt(b), dia: h.dia, depth: h.through ? 'מפולש' : `${h.depth} מ"מ`, kind: h.kind, csk: h.csk, cbore: h.cbore, screw: h.screw };
}

export function cutBoardSvg(board, kerf, width = 900) {
  const h = 44, pad = 10;
  const sc = (width - 2 * pad) / board.L;
  let out = `<svg viewBox="0 0 ${width} ${h + 26}" xmlns="http://www.w3.org/2000/svg" ${FONT}>`;
  out += `<rect x="${pad}" y="4" width="${(board.L * sc).toFixed(1)}" height="${h - 8}" fill="#f3e3c7" stroke="#8a6a3c"/>`;
  for (const c of board.layout) {
    const x = pad + c.x * sc, w = c.len * sc;
    out += `<rect x="${x.toFixed(1)}" y="4" width="${w.toFixed(1)}" height="${h - 8}" fill="${WOOD.top}" stroke="${WOOD.edge}"/>`;
    out += `<text x="${(x + w / 2).toFixed(1)}" y="${h / 2 + 1}" text-anchor="middle" font-size="11" fill="#222"><tspan font-weight="bold">#${c.no}</tspan> ${c.len}</text>`;
    out += `<line x1="${(x + w).toFixed(1)}" y1="${h - 4}" x2="${(x + w).toFixed(1)}" y2="${h + 4}" stroke="#b22" stroke-width="1"/>`;
    out += `<text x="${(x + w).toFixed(1)}" y="${h + 14}" text-anchor="middle" font-size="9" fill="#b22">${Math.round(c.x + c.len)}</text>`;
  }
  out += `<text x="${pad}" y="${h + 14}" font-size="9" fill="#666">0</text>`;
  out += `<text x="${width - pad}" y="${h + 24}" text-anchor="end" font-size="10" fill="#444">קרש ${board.L} מ"מ · שארית ${Math.round(board.waste)} מ"מ</text></svg>`;
  return out;
}

export const fmt = v => (Math.round(v * 10) / 10).toString();
