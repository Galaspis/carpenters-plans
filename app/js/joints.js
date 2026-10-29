// Detects where boards touch and decides how to fasten them (screws), producing
// screw positions in 3D and matching holes (clearance / countersink / counterbore / pilot) on each board.

const TOUCH_TOL = 0.5;
const MIN_OVERLAP = 15;
const STD_LENGTHS = [16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 120, 140];

export function faceType(inst, k) { return inst.ax.L === k ? 'L' : inst.ax.W === k ? 'W' : 'T'; }

export function toLocal(inst, p) {
  return {
    L: p[inst.ax.L] - inst.min[inst.ax.L],
    W: p[inst.ax.W] - inst.min[inst.ax.W],
    T: p[inst.ax.T] - inst.min[inst.ax.T],
  };
}

function findContact(A, B) {
  for (let k = 0; k < 3; k++) {
    let sign = 0;
    if (Math.abs(A.max[k] - B.min[k]) < TOUCH_TOL) sign = 1;       // B is on the + side of A
    else if (Math.abs(B.max[k] - A.min[k]) < TOUCH_TOL) sign = -1; // B is on the - side of A
    if (!sign) continue;
    const rect = {};
    let ok = true;
    for (let j = 0; j < 3; j++) {
      if (j === k) continue;
      const lo = Math.max(A.min[j], B.min[j]), hi = Math.min(A.max[j], B.max[j]);
      if (hi - lo < MIN_OVERLAP) { ok = false; break; }
      rect[j] = [lo, hi];
    }
    if (ok) return { k, sign, rect, plane: sign > 0 ? A.max[k] : A.min[k] };
  }
  return null;
}

function decide(A, B, k, ov) {
  if (ov?.through) return ov.through === A.def.id ? { thr: A, rec: B } : { thr: B, rec: A };
  const fa = faceType(A, k), fb = faceType(B, k);
  if (fa === 'L' && fb === 'L') return null;            // end to end: no screw joint
  if (fa === 'W' && fb === 'W') return null;            // edge to edge (e.g. neighbouring boards)
  const thin = (X, f) => (f === 'W' || f === 'L') && X.t < 30; // can't screw into thin edges/ends
  if (thin(A, fa) || thin(B, fb)) return null;
  if (fa === 'L') return { thr: B, rec: A };             // screw through B into A's end grain
  if (fb === 'L') return { thr: A, rec: B };
  return A.size[k] <= B.size[k] ? { thr: A, rec: B } : { thr: B, rec: A };
}

function spread(lo, hi, n, margin) {
  const ext = hi - lo;
  if (n === 1) return [lo + ext / 2];
  return Array.from({ length: n }, (_, j) => lo + margin + (ext - 2 * margin) * j / (n - 1));
}

function segDist(p1, q1, p2, q2) {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  const c = dot(d1, r), b = dot(d1, d2), denom = a * e - b * b;
  s = denom > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
  t = (b * s + f) / e;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
  else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
  const c1 = p1.map((v, i) => v + d1[i] * s), c2 = p2.map((v, i) => v + d2[i] * t);
  return Math.hypot(...sub(c1, c2));
}

function screwSpec(thr, rec, k, recFace) {
  const tThr = thr.size[k];
  let cbore = null, tEff = tThr;
  if (tThr > 50) { cbore = { dia: 12, depth: Math.round(tThr - 40) }; tEff = tThr - cbore.depth; }
  const endGrain = recFace === 'L';
  const avail = rec.size[k] - 5;
  let embed = endGrain ? 60 : Math.max(25, Math.min(50, 1.5 * tEff));
  embed = Math.min(embed, avail);
  const d = tEff <= 25 ? 4 : 5;
  const maxLen = tEff + embed;
  const minBite = avail < 20 ? 10 : 15; // thin boards (e.g. 20 mm slats) get a shorter bite
  let len = [...STD_LENGTHS].reverse().find(L => L <= maxLen + 0.1 && L >= tEff + minBite);
  if (!len) return null;
  return { d, len, cbore, tThr, clear: d + 1, pilot: d === 4 ? 2.5 : 3, csk: cbore ? 0 : d * 2 };
}

export function computeJoints(model, design) {
  const { instances, warnings } = model;
  const overrides = design.joints || [];
  const joints = [];
  const segs = new Map(instances.map(x => [x.uid, []]));

  for (let a = 0; a < instances.length; a++) {
    for (let b = a + 1; b < instances.length; b++) {
      const A = instances[a], B = instances[b];
      if (A.existing && B.existing) continue; // two things that are already there (a wall and a side wall) are never screwed together
      const c = findContact(A, B);
      if (!c) continue;
      const ov = overrides.find(o => (o.a === A.def.id && o.b === B.def.id) || (o.a === B.def.id && o.b === A.def.id));
      if (ov?.method === 'none') continue;
      const dec = decide(A, B, c.k, ov);
      if (!dec) continue;
      const { thr, rec } = dec;
      const k = c.k;
      if (thr.size[k] > 150) { warnings.push(`אי אפשר להבריג דרך "${thr.def.name}" (${Math.round(thr.size[k])} מ"מ עובי)`); continue; }
      const recFace = faceType(rec, k);
      const spec = screwSpec(thr, rec, k, recFace);
      if (!spec) { warnings.push(`לא נמצא בורג מתאים: "${thr.def.name}" → "${rec.def.name}" (החלק דק מדי)`); continue; }

      const dir = rec.min[k] >= thr.max[k] - TOUCH_TOL ? 1 : -1;
      const entry = dir > 0 ? thr.min[k] : thr.max[k];
      const [p, q] = [0, 1, 2].filter(j => j !== k);
      const extP = c.rect[p][1] - c.rect[p][0], extQ = c.rect[q][1] - c.rect[q][0];
      const [ia, ib] = extP >= extQ ? [p, q] : [q, p];
      const extA = Math.max(extP, extQ), extB = Math.min(extP, extQ);
      const na = ov?.count ?? (extA < 50 ? 1 : extA <= 200 ? 2 : Math.min(6, Math.ceil(extA / 250) + 1));
      const nb = extB >= 120 ? 2 : 1;
      const posA = spread(c.rect[ia][0], c.rect[ia][1], na, Math.min(25, extA * 0.2));
      const posB = spread(c.rect[ib][0], c.rect[ib][1], nb, Math.min(25, extB * 0.25));

      const joint = { a: A, b: B, thr, rec, k, dir, spec, screws: [] };
      const sep = spec.d + 4;
      for (const pa of posA) {
        for (const pb of posB) {
          // try nominal position, then nudge to avoid other screws inside the same boards
          const tries = [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8], [16, 0], [-16, 0], [0, 16], [0, -16], [24, 0], [-24, 0]];
          let placed = null;
          for (const [da, db] of tries) {
            const ua = pa + da, ub = pb + db;
            if (ua < c.rect[ia][0] + 8 || ua > c.rect[ia][1] - 8) continue;
            if (ub < c.rect[ib][0] + 6 || ub > c.rect[ib][1] - 6) continue;
            const start = [0, 0, 0]; start[ia] = ua; start[ib] = ub; start[k] = entry + dir * (spec.cbore ? spec.cbore.depth : 0);
            const end = [...start]; end[k] = start[k] + dir * spec.len;
            const clash = [...segs.get(thr.uid), ...segs.get(rec.uid)].some(s => segDist(start, end, s.start, s.end) < (s.d + spec.d) / 2 + 3 || false);
            if (!clash) { placed = { start, end }; break; }
          }
          if (!placed) { warnings.push(`התנגשות ברגים בין "${thr.def.name}" ל-"${rec.def.name}": בורג אחד הושמט`); continue; }
          const screw = { ...placed, d: spec.d, len: spec.len, dir: [0, 0, 0], k, joint };
          screw.dir[k] = dir;
          segs.get(thr.uid).push(screw); segs.get(rec.uid).push(screw);
          joint.screws.push(screw);

          const entryPt = [...placed.start]; entryPt[k] = entry;
          const contactPt = [...placed.start]; contactPt[k] = c.plane;
          thr.holes.push({
            axis: faceType(thr, k), side: dir > 0 ? -1 : 1, pos: toLocal(thr, entryPt),
            dia: spec.clear, depth: thr.size[k], through: true, csk: spec.csk, cbore: spec.cbore, kind: 'clear',
            screw: `${spec.d}×${spec.len}`,
          });
          const pen = Math.abs(placed.end[k] - c.plane);
          rec.holes.push({
            axis: recFace, side: dir > 0 ? -1 : 1, pos: toLocal(rec, contactPt),
            dia: spec.pilot, depth: Math.round(pen), through: false, csk: 0, cbore: null, kind: 'pilot',
            screw: `${spec.d}×${spec.len}`,
          });
          thr.screws.push(screw);
        }
      }
      if (joint.screws.length) joints.push(joint);
    }
  }
  return joints;
}
