// רשימת קניות + עלות מתוך תוכנית החיתוך, החיבורים והתוספות של העיצוב.
// כל שורה מקבלת key יציב כדי שאפשר יהיה לסמן "יש לי בבית" ולשמור את זה.
const wn = i => (i.name.includes(`${i.t}×${i.w}`) || i.name.includes(`${i.t}x${i.w}`)) ? i.name : `${i.name} ${i.t}×${i.w}`;
import { priceFor, priceCalc } from './cutlist.js';
import { evalExpr } from './expr.js';

export function buildBom(model, groups, joints, cut, catalog, design, opts = {}) {
  const have = opts.have || new Set();
  const extraPrices = opts.extraPrices || {};
  const cur = catalog.currency || '';
  const lines = [];
  for (const p of cut.plans) {
    for (const [L, n] of Object.entries(p.ownedCounts || {}).sort((a, b) => b[0] - a[0])) {
      // boards bought for this project (step 5) are priced from the yard list; leftovers from before cost nothing
      const boughtQ = (catalog.inventory || []).filter(r => r.bought && r.itemId === p.item.id && +r.L === +L).reduce((s, r) => s + (+r.qty || 0), 0);
      const yardItem = p.item.own ? catalog.lumber.find(l => l.id === p.item.yardId) || p.item : p.item;
      const nb = Math.min(n, boughtQ), u = nb ? priceFor(yardItem, +L) : 0;
      lines.push({ key: `owned:${p.item.id}:${L}`, cat: 'עץ', icon: 'wood', item: `${wn(p.item)} מ"מ`, spec: `${nb ? 'קניתי' : 'יש לי'} — ${L} מ"מ`, qty: n, unit: 'קרשים', unitPrice: u, calc: nb ? priceCalc(yardItem, +L, cur) + (n > nb ? ` · ${n - nb} מהבית` : '') : 'מהעץ שבבית', total: u * nb, owned: !nb, bought: !!nb });
    }
    for (const [L, n] of Object.entries(p.counts).sort((a, b) => b[0] - a[0])) {
      const u = priceFor(p.item, +L);
      lines.push({ key: `wood:${p.item.id}:${L}`, cat: 'עץ', icon: 'wood', item: `${wn(p.item)} מ"מ`, spec: p.unitLabel ? `מוט ${L} מ"מ (נחתך במחסן ל-${p.poles[0]?.pieces.length || 3} חתיכות)` : `אורך ${L} מ"מ`, qty: n, unit: p.unitLabel || 'קרשים', unitPrice: u, calc: priceCalc(p.item, +L, cur), total: n * u });
    }
    for (const o of p.oversize) {
      const L = Math.round(o.len + (+catalog.endTrim || 0)), u = priceFor(p.item, L);
      lines.push({ key: `wood:${p.item.id}:custom${L}`, cat: 'עץ', icon: 'wood', item: `${wn(p.item)} מ"מ`, spec: `אורך מיוחד ${L} מ"מ`, qty: 1, unit: 'קרשים', unitPrice: u, calc: priceCalc(p.item, L, cur), total: u, note: 'ארוך מכל אורך מלאי — לבדוק במחסן' });
    }
  }
  const screws = {};
  for (const j of joints) for (const s of j.screws) { const k = `${s.d}×${s.len}`; screws[k] = (screws[k] || 0) + 1; }
  const hw = catalog.hardware || {};
  for (const [k, n] of Object.entries(screws).sort()) {
    const [d, len] = k.split('×').map(Number);
    const sku = (hw.screws || []).find(s => +s.d === d && +s.len === len);
    const packs = sku ? Math.ceil(n / sku.pack) : null;
    const fb = +hw.screwFallbackPricePerUnit || 0;
    lines.push({ key: `screw:${k}`, cat: 'ברגים', icon: 'screw', item: `ברגי עץ ${k} מ"מ (לחוץ / נירוסטה)`, spec: sku ? `${packs} חבילות של ${sku.pack}` : `${n} יח׳`, qty: n, unit: 'יח׳',
      unitPrice: sku ? sku.price / sku.pack : fb, calc: sku ? `${packs} × ${sku.price} ${cur} לחבילה` : `${n} × ${fb} ${cur} לבורג`, total: sku ? packs * sku.price : n * fb });
  }
  (design?.extras || []).forEach((e, i) => {
    const price = extraPrices[i] != null ? +extraPrices[i] : +e.price || 0;
    let qty = e.qty; if (typeof qty === 'string') { try { qty = Math.max(0, Math.round(evalExpr(qty, model.scope))); } catch { qty = 0; } }
    if (!qty) return;
    lines.push({ key: `extra:${i}`, cat: 'פרזול', icon: e.icon || 'screwSmall', item: e.name, spec: '', qty, unit: 'יח׳', unitPrice: price, calc: `${qty} × ${price} ${cur}`, total: qty * price, editable: true, extraIndex: i });
  });
  let area = 0;
  for (const x of model.instances) if (!x.existing && !x.hardware) area += 2 * (x.len * x.w + x.len * x.t + x.w * x.t) / 1e6;
  const liters = area * (+hw.finishCoats || 2) / (+hw.finishCoverageM2PerLiter || 10);
  const cans = Math.max(1, Math.ceil(liters));
  lines.push({ key: 'finish:oil', cat: 'גימור', icon: 'oil', item: 'שמן / לזורה לעץ חיצוני', spec: `${area.toFixed(1)} מ"ר × ${hw.finishCoats || 2} שכבות ≈ ${liters.toFixed(1)} ליטר`, qty: cans, unit: 'ליטר', unitPrice: +hw.finishPricePerLiter || 0, calc: `${cans} × ${+hw.finishPricePerLiter || 0} ${cur} לליטר`, total: cans * (+hw.finishPricePerLiter || 0) });
  lines.push({ key: 'finish:glue', cat: 'גימור', icon: 'glue', item: 'דבק עץ חיצוני (אופציונלי)', spec: 'בקבוק 1', qty: 1, unit: 'יח׳', unitPrice: +hw.gluePrice || 0, calc: '', total: +hw.gluePrice || 0 });
  lines.push({ key: 'finish:sand', cat: 'גימור', icon: 'sandpaper', item: 'נייר לטש 80 / 120 / 180', spec: 'סט', qty: 1, unit: 'סט', unitPrice: +hw.sandpaperPrice || 0, calc: '', total: +hw.sandpaperPrice || 0 });

  for (const l of lines) l.have = have.has(l.key);
  const active = lines.filter(l => !l.have);
  const woodCost = active.filter(l => l.cat === 'עץ').reduce((s, l) => s + l.total, 0);
  const total = active.reduce((s, l) => s + l.total, 0);
  const fullTotal = lines.reduce((s, l) => s + l.total, 0);
  const woodMeters = cut.plans.reduce((s, p) => s + (p.boughtMm ?? p.boards.reduce((q, b) => q + b.L, 0)), 0) / 1000;
  const usedMeters = model.instances.reduce((s, x) => s + x.len, 0) / 1000;
  return { lines, woodCost, total, fullTotal, woodMeters, usedMeters, waste: woodMeters ? 1 - usedMeters / woodMeters : 0, area, screwCount: Object.values(screws).reduce((a, b) => a + b, 0), screws };
}

// הכלים הדרושים, נגזרים מהתוכנית
export function toolsNeeded(model, groups, bom) {
  const holes = groups.flatMap(g => g.variants.flatMap(v => v.holes));
  const dias = [...new Set(holes.map(h => h.dia))].sort((a, b) => a - b);
  const tools = [
    { icon: 'tape', name: 'מטר ועיפרון', why: 'סימון אורכים ומיקומי חורים' },
    { icon: 'saw', name: 'מסור (ידני, גרונג או עגול)', why: `${model.instances.length} חיתוכים ישרים` },
    { icon: 'drill', name: 'מקדחה / מברגה', why: `${holes.length} חורים, ${bom.screwCount} ברגים` },
    { icon: 'bit', name: `מקדחים לעץ Ø ${dias.join(', ')} מ"מ`, why: 'חורי מעבר (אדום) וחורי פיילוט (כחול)' },
  ];
  if (holes.some(h => h.csk)) tools.push({ icon: 'countersink', name: 'מקדח שקע (countersink)', why: 'כדי שראש הבורג ישקע בפני העץ' });
  if (holes.some(h => h.cbore)) tools.push({ icon: 'counterbore', name: 'מקדח כוס / פורסטנר Ø12', why: 'שקע עמוק בקורות עבות כדי שהבורג יגיע' });
  tools.push({ icon: 'driver', name: 'ביט למברגה (טורקס / פיליפס לפי הברגים)', why: '' });
  tools.push({ icon: 'square', name: 'זווית 90°', why: 'בדיקת ניצבות המסגרות' });
  tools.push({ icon: 'clamp', name: 'מלחציים (2 לפחות)', why: 'להחזיק חלקים בזמן ההברגה' });
  tools.push({ icon: 'sandpaper', name: 'נייר לטש / מלטשת', why: '' });
  return tools;
}
