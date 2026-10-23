// Headless smoke test: node app/test/run.mjs [design.json ...]   (no args = all designs in index.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel, autoMapProfiles } from '../js/model.js';
import { computeJoints } from '../js/joints.js';
import { groupParts } from '../js/parts.js';
import { cutPlan } from '../js/cutlist.js';
import { buildBom, toolsNeeded } from '../js/bom.js';
import { buildSteps } from '../js/assembly.js';
import { iso, ortho, partDrawing } from '../js/render.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(here, '../catalog/default-catalog.json'), 'utf8'));
const files = process.argv.slice(2).length ? process.argv.slice(2)
  : JSON.parse(fs.readFileSync(path.join(here, '../designs/index.json'), 'utf8')).map(d => path.join(here, `../designs/${d.id}.json`));
const verbose = !process.env.QUIET;
let failed = 0;

for (const file of files) {
  const design = JSON.parse(fs.readFileSync(file, 'utf8'));
  const values = Object.fromEntries(design.params.map(p => [p.id, p.value]));
  const mapping = autoMapProfiles(design, catalog);
  const model = buildModel(design, values, catalog, mapping, {});
  const joints = computeJoints(model, design);
  const groups = groupParts(model);
  const cut = cutPlan(groups, catalog, mapping);
  const bom = buildBom(model, groups, joints, cut, catalog, design);
  const steps = buildSteps(design, model, joints);
  const tools = toolsNeeded(model, groups, bom);

  console.log(`\n=== ${design.id}: ${design.name} ===`);
  console.log('Bbox:', model.bbox.size.map(Math.round).join(' x '), '| boards', model.instances.length, '| joints', joints.length, '| screws', bom.screwCount, '| total', bom.total.toFixed(0), catalog.currency, '| waste', (bom.waste * 100).toFixed(0) + '%');
  if (verbose) {
    for (const g of groups) console.log(`  #${g.no} ${g.name.padEnd(22)} ${g.len}×${g.w}×${g.t}  x${g.qty}  ${g.variants.length > 1 ? g.variants.length + ' variants' : g.holes.length + ' holes'}`);
    for (const p of cut.plans) console.log('  cut', p.item.t + 'x' + p.item.w, JSON.stringify(p.counts), 'waste', p.boards.map(b => Math.round(b.waste)).join('/'));
    for (const s of steps) console.log(`  step ${s.n}. ${s.title} — ${JSON.stringify(s.screws)}`);
    console.log('  tools:', tools.map(t => t.name).join(' | '));
  }
  if (model.warnings.length) { failed++; console.log('WARNINGS:'); for (const w of model.warnings) console.log('  !', w); }
  else console.log('no warnings');

  const out = path.join(here, 'out'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `${design.id}-iso.svg`), iso(model.instances, { labels: 'group', explode: 0.5, view: design.view }));
  fs.writeFileSync(path.join(out, `${design.id}-front.svg`), ortho(model.instances, model.bbox, 'front'));
  const st = steps.find(s => s.joints.length && s.visible.size > s.highlight.size) || steps[1];
  const vis = model.instances.filter(x => st.visible.has(x.uid));
  fs.writeFileSync(path.join(out, `${design.id}-step.svg`), iso(vis, { highlight: st.highlight, ghost: new Set(vis.filter(x => !st.highlight.has(x.uid)).map(x => x.uid)), screws: st.joints.flatMap(j => j.screws), labels: 'group', labelFilter: x => st.highlight.has(x.uid), view: design.view, height: 460 }));
  const g0 = groups.find(g => g.holes.length) || groups[0];
  const pd = partDrawing(g0.variants[0].holes, g0);
  fs.writeFileSync(path.join(out, `${design.id}-part.svg`), pd.faces[0].svg);
  if (pd.faces.some(f => f.svg.includes('NaN'))) { failed++; console.log('  ! NaN in part drawing'); }
  // every step must draw the screws for that step; last step must contain all boards
  const last = steps[steps.length - 1];
  if (last.visible.size !== model.instances.length) { failed++; console.log('  ! not all boards placed by the last step'); }
}
console.log(failed ? `\n${failed} problem(s)` : '\nALL OK');
process.exit(failed ? 1 : 0);
