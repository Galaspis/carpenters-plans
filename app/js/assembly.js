// Turns the design's step list into concrete assembly steps with the screws each step uses.

export function buildSteps(design, model, joints) {
  const byDef = {};
  for (const x of model.instances) (byDef[x.def.id] ||= []).push(x);
  // existing parts (another piece of furniture) are visible from the start; joints to them wait for the step that names them
  const placed = new Set(model.instances.filter(x => x.existing).map(x => x.uid));
  const steps = [];
  const usedJoints = new Set();
  const toExisting = j => j.a.existing || j.b.existing;
  for (const s of design.steps) {
    const adds = (s.add || []).flatMap(id => byDef[id] || []);
    const addIds = new Set(adds.map(x => x.uid));
    const jointsHere = joints.filter(j => !usedJoints.has(j) && (addIds.has(j.a.uid) || addIds.has(j.b.uid)) && (placed.has(j.a.uid) || placed.has(j.b.uid) || (addIds.has(j.a.uid) && addIds.has(j.b.uid))) && (!toExisting(j) || addIds.has(j.a.uid) && addIds.has(j.b.uid) || (j.a.existing ? addIds.has(j.a.uid) : addIds.has(j.b.uid))));
    jointsHere.forEach(j => usedJoints.add(j));
    adds.forEach(x => placed.add(x.uid));
    const screws = {};
    for (const j of jointsHere) for (const sc of j.screws) { const k = `${sc.d}×${sc.len}`; screws[k] = (screws[k] || 0) + 1; }
    const partNos = [...new Set(adds.filter(x => !x.existing).map(x => x.partNo))].sort((a, b) => a - b);
    const nameOf = x => `${x.group?.name ?? x.def.name}`;
    const added = {};
    adds.forEach(x => { const n = nameOf(x); added[n] = (added[n] || 0) + 1; });
    steps.push({
      n: steps.length + 1, title: s.title, text: s.text || '', tip: s.tip,
      added: Object.entries(added).map(([name, n]) => `${n}× ${name}`),
      partNos, screws, joints: jointsHere,
      visible: new Set(placed), highlight: new Set(adds.filter(x => !x.existing).map(x => x.uid)), view: s.view || design.view,
    });
  }
  const missing = model.instances.filter(x => !placed.has(x.uid));
  if (missing.length) {
    const addIds = new Set(missing.map(x => x.uid));
    const jointsHere = joints.filter(j => !usedJoints.has(j));
    const screws = {};
    for (const j of jointsHere) for (const sc of j.screws) { const k = `${sc.d}×${sc.len}`; screws[k] = (screws[k] || 0) + 1; }
    missing.forEach(x => placed.add(x.uid));
    steps.push({ n: steps.length + 1, title: 'חלקים נוספים', text: 'חבר את שאר החלקים.', added: [...new Set(missing.map(x => x.def.name))], partNos: [...new Set(missing.map(x => x.partNo))], screws, joints: jointsHere, visible: new Set(placed), highlight: addIds, view: design.view });
  }
  return steps;
}
