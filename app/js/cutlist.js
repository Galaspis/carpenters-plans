// 1D cutting-stock optimizer: decides which stock lengths to buy and how to cut every part from them.

function bestSubset(pieces, cap, kerf) {
  // subset-sum DP on integer mm, each piece costs len + kerf
  const n = pieces.length;
  const reach = new Int16Array(cap + 1).fill(-1);
  const prev = new Int32Array(cap + 1).fill(-1);
  reach[0] = n; // sentinel
  for (let i = 0; i < n; i++) {
    const w = Math.ceil(pieces[i].len + kerf);
    for (let c = cap; c >= w; c--) {
      if (reach[c] === -1 && reach[c - w] !== -1) { reach[c] = i; prev[c] = c - w; }
    }
  }
  let c = cap;
  while (c > 0 && reach[c] === -1) c--;
  const picked = [];
  while (c > 0) { picked.push(reach[c]); c = prev[c]; }
  return picked;
}

// Price of one stock piece of length L: per board (item.prices[L]) when the item is priced that way,
// otherwise running meters × price per meter.
export function priceFor(item, L) {
  if (item.priceMode === 'board' && item.prices && item.prices[L] != null && item.prices[L] !== '') return +item.prices[L];
  return (L / 1000) * (+item.pricePerMeter || 0);
}
export function priceCalc(item, L, cur) {
  if (item.priceMode === 'board' && item.prices && item.prices[L] != null && item.prices[L] !== '') return `מחיר לקרש ${L} מ"מ`;
  return `${(L / 1000).toFixed(2)} מ׳ × ${+item.pricePerMeter || 0} ${cur}/מ׳`;
}

export function packItem(item, pieces, kerf, trim) {
  const lengths = [...item.lengths].map(Number).filter(v => v > 0).sort((a, b) => a - b);
  const maxL = lengths[lengths.length - 1] || 0;
  const oversize = pieces.filter(p => p.len > maxL - trim);
  let remaining = pieces.filter(p => p.len <= maxL - trim).sort((a, b) => b.len - a.len);
  const boards = [];
  while (remaining.length) {
    const first = remaining[0];
    let best = null;
    for (const L of lengths) {
      const cap = Math.floor(L - trim + kerf);
      const capRest = cap - Math.ceil(first.len + kerf);
      if (capRest < 0) continue;
      const restIdx = bestSubset(remaining.slice(1), capRest, kerf).map(i => i + 1);
      const idx = [0, ...restIdx];
      const used = idx.reduce((s, i) => s + remaining[i].len, 0);
      const eff = used / L;
      if (!best || eff > best.eff + 1e-6 || (Math.abs(eff - best.eff) < 1e-6 && used > best.used)) best = { L, idx, used, eff };
    }
    const cuts = best.idx.map(i => remaining[i]).sort((a, b) => b.len - a.len);
    const set = new Set(best.idx);
    remaining = remaining.filter((_, i) => !set.has(i));
    boards.push({ L: best.L, cuts });
  }
  // shrink each board to the shortest stock length its cuts still fit in
  for (const b of boards) {
    const need = b.cuts.reduce((s, c) => s + c.len, 0) + kerf * (b.cuts.length - 1) + trim;
    b.L = lengths.find(L => L >= need) ?? b.L;
  }
  for (const p of oversize) boards.push({ L: Math.ceil(p.len + trim), cuts: [p], custom: true });
  let total = 0;
  for (const b of boards) {
    let x = trim / 2;
    b.layout = b.cuts.map(c => { const seg = { ...c, x }; x += c.len + kerf; return seg; });
    b.used = b.cuts.reduce((s, c) => s + c.len, 0);
    b.waste = b.L - b.used;
    b.cost = priceFor(item, b.L);
    total += b.cost;
  }
  boards.sort((a, b) => b.L - a.L || a.waste - b.waste);
  const counts = {};
  for (const b of boards) counts[b.L] = (counts[b.L] || 0) + 1;
  return { item, boards, counts, cost: total, oversize };
}

/**
 * Transport plan: the yard sells long poles (poleLen) and will make at most maxCuts rough cuts per
 * pole; every piece you take must be <= maxPiece (what fits the car). Returns, per wood type, the
 * poles to buy, where to cut each one, and which parts come out of each piece.
 */
export function yardPlan(groups, catalog, mapping, t) {
  const poleLen = +t.poleLen || 5100, maxPiece = +t.maxPiece || 2400, maxCuts = Math.max(1, +t.maxCuts || 2), margin = +t.margin ?? 30;
  const kerf = +catalog.kerf || 0, trim = +catalog.endTrim || 0;
  const out = [];
  const byItem = new Map();
  for (const g of groups) {
    const item = catalog.lumber.find(l => l.id === mapping[g.profile]); if (!item) continue;
    if (!byItem.has(item.id)) byItem.set(item.id, { item, pieces: [] });
    for (let i = 0; i < g.qty; i++) byItem.get(item.id).pieces.push({ len: Math.round(g.len), no: g.no });
  }
  for (const { item, pieces } of byItem.values()) {
    const longest = Math.max(...pieces.map(p => p.len));
    const tooLong = pieces.filter(p => p.len + trim + margin > maxPiece);
    // candidate piece lengths (multiples of 50) the yard can cut; pack parts onto them
    const minLen = Math.min(...pieces.map(p => p.len)) + trim + margin;
    const cand = []; for (let L = Math.ceil(minLen / 50) * 50; L <= maxPiece; L += 50) cand.push(L);
    if (!cand.length) cand.push(maxPiece);
    const fake = { ...item, lengths: cand, priceMode: 'meter' };
    const packed = packItem(fake, pieces.filter(p => !tooLong.includes(p)), kerf, trim + margin);
    // bin-pack the pieces onto poles: a pole holds pieces p1..pk; k cuts if they leave a remainder, k-1 if exact
    const ps = packed.boards.map(b => ({ L: b.L, cuts: b.cuts })).sort((a, b) => b.L - a.L);
    const poles = [];
    for (const p of ps) {
      let placed = false;
      for (const pole of poles) {
        const used = pole.pieces.reduce((s, x) => s + x.L, 0) + kerf * pole.pieces.length;
        const rem = poleLen - used - p.L - kerf;
        if (rem < -0.5) continue;
        const k = pole.pieces.length + 1;
        // You pay for the whole pole, so EVERYTHING comes home: the remainder must also be cut into
        // pieces <= maxPiece (spares). The last part-piece may simply run to the end if it still fits.
        const absorb = rem > 1 && p.L + rem <= maxPiece;
        const spareChunks = rem <= 1 || absorb ? 0 : Math.ceil(rem / maxPiece);
        const cutsNeeded = k + spareChunks - 1;
        if (cutsNeeded > maxCuts) continue;
        pole.pieces.push(p); pole.absorb = absorb; placed = true; break;
      }
      if (!placed) {
        const rem = poleLen - p.L;
        const absorb = p.L + rem <= maxPiece;
        if (!absorb && Math.ceil(rem / maxPiece) > maxCuts - 1) { /* even alone this pole can't be brought home */ }
        poles.push({ pieces: [p], absorb });
      }
    }
    for (const pole of poles) {
      const sum = pole.pieces.reduce((s, p) => s + p.L, 0) + kerf * (pole.pieces.length - 1);
      let leftover = Math.round(poleLen - sum);
      if (pole.absorb && leftover > 0) { pole.pieces[pole.pieces.length - 1].L += leftover; pole.pieces[pole.pieces.length - 1].extra = leftover; leftover = 0; }
      // split the leftover into spare pieces that fit the car
      if (leftover > 1) {
        const n = Math.ceil(leftover / maxPiece), each = Math.floor((leftover - kerf * (n - 1)) / n);
        for (let i = 0; i < n; i++) pole.pieces.push({ L: i === n - 1 ? leftover - kerf * (n - 1) - each * (n - 1) : each, cuts: [], spare: true });
        leftover = 0;
      }
      let x = 0; pole.cutsAt = [];
      pole.pieces.forEach((p, i) => { x += p.L + (i ? kerf : 0); if (x < poleLen - 1) pole.cutsAt.push(Math.round(x)); });
      pole.cutsOk = pole.cutsAt.length <= maxCuts;
      pole.leftover = 0;
      pole.leftoverFits = true;
    }
    poles.forEach((pole, pi) => pole.pieces.forEach((pc, k) => { pc.pole = pi + 1; pc.idx = k + 1; }));
    out.push({ item, poles, tooLong, longest, piecesCount: ps.length });
  }
  return { plans: out, poleLen, maxPiece, maxCuts, margin, oneCutMinPiece: Math.ceil(poleLen / 2) };
}

/** Cut plan in the same shape as cutPlan(), but the "boards" are the pieces brought home from the poles. */
export function cutPlanFromYard(yp, catalog) {
  const kerf = +catalog.kerf || 0, trim = +catalog.endTrim || 0;
  const plans = yp.plans.map(p => {
    const boards = [];
    for (const pole of p.poles) for (const pc of pole.pieces) {
      if (pc.spare) continue;
      let x = trim / 2 + (yp.margin || 0) / 2;
      const layout = pc.cuts.map(c => { const seg = { ...c, x }; x += c.len + kerf; return seg; });
      const used = pc.cuts.reduce((s, c) => s + c.len, 0);
      boards.push({ L: pc.L, cuts: pc.cuts, layout, used, waste: pc.L - used, cost: 0, fromPole: pc.pole, pieceIdx: pc.idx });
    }
    const cost = p.poles.length * priceFor(p.item, yp.poleLen);
    return { item: p.item, boards, counts: { [yp.poleLen]: p.poles.length }, cost, oversize: p.tooLong, poles: p.poles, boughtMm: p.poles.length * yp.poleLen, unitLabel: 'מוטות' };
  });
  return { plans, cost: plans.reduce((s, p) => s + p.cost, 0), yard: yp };
}

/**
 * Cut plan when you already own wood (catalog.inventory = [{itemId, L, qty}]): parts are packed onto
 * the owned pieces first (longest piece first, best subset per piece); whatever doesn't fit is packed
 * onto stock lengths to buy. Same result shape as cutPlan(); owned boards have owned:true.
 */
export function cutPlanWithInventory(groups, catalog, mapping) {
  const kerf = +catalog.kerf || 0, trim = +catalog.endTrim || 0;
  const inv = (catalog.inventory || []).filter(r => r.qty > 0 && r.L > 0);
  const byItem = new Map();
  for (const g of groups) {
    const item = catalog.lumber.find(l => l.id === mapping[g.profile]); if (!item) continue;
    if (!byItem.has(item.id)) byItem.set(item.id, { item, pieces: [] });
    for (let i = 0; i < g.qty; i++) byItem.get(item.id).pieces.push({ len: Math.round(g.len), no: g.no });
  }
  const plans = [...byItem.values()].map(({ item, pieces }) => {
    const owned = [];
    const aliasIds = new Set(catalog.lumber.filter(l => l.own && l.yardId === item.id).map(l => l.id));
    for (const r of inv.filter(r => r.itemId === item.id || aliasIds.has(r.itemId))) for (let i = 0; i < r.qty; i++) owned.push({ L: +r.L, bought: !!r.bought });
    owned.sort((a, b) => b.L - a.L);
    let remaining = pieces.slice().sort((a, b) => b.len - a.len);
    const boards = [];
    for (const { L, bought } of owned) {
      const cap = Math.floor(L - trim + kerf);
      const idx = remaining.length ? bestSubset(remaining, cap, kerf) : [];
      const cuts = idx.map(i => remaining[i]).sort((a, b) => b.len - a.len);
      const set = new Set(idx); remaining = remaining.filter((_, i) => !set.has(i));
      boards.push({ L, cuts, owned: true, bought });
    }
    const buy = remaining.length ? packItem(item, remaining, kerf, trim) : { boards: [], counts: {}, cost: 0, oversize: [] };
    for (const b of buy.boards) b.owned = false;
    const all = [...boards, ...buy.boards];
    for (const b of all) {
      let x = trim / 2;
      b.layout = b.cuts.map(c => { const seg = { ...c, x }; x += c.len + kerf; return seg; });
      b.used = b.cuts.reduce((s, c) => s + c.len, 0); b.waste = b.L - b.used; b.cost = b.owned ? 0 : priceFor(item, b.L);
    }
    const ownedCounts = {}; for (const b of boards) ownedCounts[b.L] = (ownedCounts[b.L] || 0) + 1;
    const usedOwned = boards.filter(b => b.cuts.length).length;
    return { item, boards: all, counts: buy.counts, ownedCounts, ownedTotal: boards.length, usedOwned, unusedOwned: boards.filter(b => !b.cuts.length).map(b => b.L), cost: buy.cost, oversize: buy.oversize, missing: remaining.length, boughtMm: buy.boards.reduce((s, b) => s + b.L, 0), ownedMm: boards.reduce((s, b) => s + b.L, 0) };
  });
  return { plans, cost: plans.reduce((s, p) => s + p.cost, 0), inventory: true };
}

export function cutPlan(groups, catalog, mapping) {
  const kerf = +catalog.kerf || 0, trim = +catalog.endTrim || 0;
  const byItem = new Map();
  for (const g of groups) {
    const itemId = mapping[g.profile];
    const item = catalog.lumber.find(l => l.id === itemId);
    if (!item) continue;
    if (!byItem.has(item.id)) byItem.set(item.id, { item, pieces: [] });
    for (let i = 0; i < g.qty; i++) byItem.get(item.id).pieces.push({ len: Math.round(g.len), no: g.no });
  }
  const plans = [...byItem.values()].map(({ item, pieces }) => packItem(item, pieces, kerf, trim));
  return { plans, cost: plans.reduce((s, p) => s + p.cost, 0) };
}
