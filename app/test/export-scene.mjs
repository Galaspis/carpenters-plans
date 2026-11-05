// Export a design (with optional values) as a scene JSON for the Blender renderer (render/woody_render.py):
//   node app/test/export-scene.mjs app/designs/cleat-holder.json out.json kind=7 W=260
// Everything is in mm, model axes X right, Y back, Z up (Blender uses the same, so no conversion).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel, autoMapProfiles } from '../js/model.js';
import { computeJoints } from '../js/joints.js';
import { groupParts } from '../js/parts.js';
import { buildSteps } from '../js/assembly.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const [designPath, outPath, ...kv] = process.argv.slice(2);
if (!designPath || !outPath) { console.error('usage: export-scene <design.json> <out.json> [param=value ...]'); process.exit(1); }
const design = JSON.parse(fs.readFileSync(designPath, 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(here, '..', 'catalog', 'default-catalog.json'), 'utf8'));
const values = Object.fromEntries(design.params.map(p => [p.id, p.value]));
for (const a of kv) { const [k, v] = a.split('='); values[k] = +v; }
const mapping = autoMapProfiles(design, catalog);
const model = buildModel(design, values, catalog, mapping, {});
const joints = computeJoints(model, design);
const groups = groupParts(model);
const steps = buildSteps(design, model, joints);

const parts = model.instances.map(x => ({
  uid: x.uid, name: x.def.name, partNo: x.partNo ?? null,
  min: x.min, max: x.max, axisL: x.ax?.L ?? 0,
  hardware: !!x.hardware, existing: !!x.existing, illustration: !!x.def.illustration, contextOnly: !!x.def.contextOnly,
  glass: !!x.def.glass, bevel: x.def.bevel || null, marks: x.marks || [],
}));
const stepsOut = steps.map(s => ({
  n: s.n, title: s.title, text: s.text, tip: s.tip || '',
  add: [...s.highlight], visible: [...s.visible],
  screws: s.joints.flatMap(j => j.screws.map(sc => ({ start: sc.start, end: sc.end, d: sc.d, len: sc.len }))),
}));
const out = { design: { id: design.id, name: design.name, description: design.description || '' }, values, bbox: model.bbox, parts, steps: stepsOut, groups: groups.map(g => ({ no: g.no, name: g.name, qty: g.qty, len: g.len })) };
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`scene: ${parts.length} parts, ${stepsOut.length} steps, ${stepsOut.reduce((a, s) => a + s.screws.length, 0)} screws → ${outPath}`);
