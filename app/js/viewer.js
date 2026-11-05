// Interactive 3D viewer. Uses WebGL when available, otherwise Three.js's SVG renderer (works on
// machines where the browser blocks WebGL). Model axes: X right, Y back, Z up.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SVGRenderer } from 'three/addons/renderers/SVGRenderer.js';

const COL = { wood: 0xd9b17c, hl: 0xf4512e, ghost: 0xe6e7e9, edge: 0x202125, ghostEdge: 0xc4c7cb, screw: 0x202125 };
const toThree = ([x, y, z]) => new THREE.Vector3(x, z, -y);

export function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

export function createViewer(container, opts = {}) {
  const webgl = opts.forceSvg ? false : hasWebGL();
  let renderer;
  if (webgl) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;border-radius:8px;cursor:grab';
  } else {
    renderer = new SVGRenderer();
    renderer.setQuality('low');
    renderer.overdraw = 0.4;
    renderer.domElement.style.cssText = 'display:block;border-radius:8px;cursor:grab;background:#EFF0F1';
  }
  container.appendChild(renderer.domElement);
  const labelLayer = document.createElement('div'); labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden'; container.appendChild(labelLayer);
  const scene = new THREE.Scene();
  if (webgl) scene.background = new THREE.Color(0xeff0f1);
  const camera = new THREE.PerspectiveCamera(35, 1, 10, 50000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.1;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb0a090, webgl ? 1.1 : 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, webgl ? 1.4 : 0.8); sun.position.set(1500, 3000, 2000); scene.add(sun);
  const hemi = scene.children.find(o => o.isHemisphereLight);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.5, 64), new THREE.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.95, metalness: 0 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.visible = false; scene.add(floor);
  let realistic = false, woodTex = null;
  const fill = new THREE.DirectionalLight(0xffffff, webgl ? 0.5 : 0.3); fill.position.set(-2000, 1000, -1500); scene.add(fill);
  const group = new THREE.Group(); scene.add(group);
  let labels = []; // { pos: Vector3, el }
  let frame = 0, alive = true, dirty = true, w = 600, h = 420, lastDiag = 0;
  const byUid = new Map(); let anims = [];

  function resize() {
    w = container.clientWidth || 600; h = container.clientHeight || 420;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true;
  }
  const ro = new ResizeObserver(resize); ro.observe(container);
  controls.addEventListener('change', () => { dirty = true; });
  const v = new THREE.Vector3();
  function placeLabels() {
    for (const l of labels) {
      v.copy(l.pos).project(camera);
      const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h;
      l.el.style.left = x + 'px'; l.el.style.top = y + 'px';
      l.el.style.display = v.z > 1 || x < -40 || x > w + 40 || y < -40 || y > h + 40 ? 'none' : '';
    }
  }
  function loop() {
    if (!alive) return;
    frame = requestAnimationFrame(loop);
    controls.update();
    if (anims.length) { const now = performance.now(); anims = anims.filter(a => { const k = Math.min(1, (now - a.t0) / a.dur), e = 1 - Math.pow(1 - k, 3); a.mesh.position.lerpVectors(a.from, a.to, e); if (a.mat) a.mat.opacity = e; return k < 1; }); dirty = true; }
    if (webgl || dirty) { renderer.render(scene, camera); placeLabels(); dirty = false; }
  }
  resize(); loop();

  function label(text, pos, cls) {
    const el = document.createElement('div'); el.className = 'lbl ' + cls; el.textContent = text; labelLayer.appendChild(el);
    labels.push({ pos, el });
  }

  // Pine grain drawn on a canvas: light base, long wavy growth lines, a few knots. Used as the wood map in realistic mode.
  function makeWoodTexture() {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#d9b07c'; g.fillRect(0, 0, c.width, c.height);
    let seed = 7; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let b = 0; b < 14; b++) { const y = rnd() * c.height, hgt = 8 + rnd() * 26; const grd = g.createLinearGradient(0, y, 0, y + hgt); grd.addColorStop(0, 'rgba(160,110,60,0)'); grd.addColorStop(0.5, `rgba(160,110,60,${0.18 + rnd() * 0.2})`); grd.addColorStop(1, 'rgba(160,110,60,0)'); g.fillStyle = grd; g.fillRect(0, y, c.width, hgt); }
    for (let i = 0; i < 160; i++) { // growth lines along x
      const y0 = rnd() * c.height, amp = 2 + rnd() * 6, freq = 0.002 + rnd() * 0.004, ph = rnd() * 6.28, wdt = 0.6 + rnd() * 1.8;
      g.strokeStyle = `rgba(${105 + rnd() * 40 | 0},${65 + rnd() * 30 | 0},${30 + rnd() * 20 | 0},${0.22 + rnd() * 0.33})`; g.lineWidth = wdt; g.beginPath();
      for (let x = 0; x <= c.width; x += 8) { const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * 0.03 + ph) * 0.8; x ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    }
    for (let k = 0; k < 3; k++) { // knots
      const kx = rnd() * c.width, ky = rnd() * c.height, r = 6 + rnd() * 10;
      for (let q = r; q > 0; q -= 1.5) { g.strokeStyle = `rgba(110,70,35,${0.15 + 0.3 * (1 - q / r)})`; g.lineWidth = 1; g.beginPath(); g.ellipse(kx, ky, q * 1.3, q, 0.3, 0, 6.29); g.stroke(); }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  // realistic mode: wood grain, studio light with shadows, dark or light stage
  function setRealistic(on, { dark = true } = {}) {
    if (!webgl) return false;
    realistic = on;
    if (on && !woodTex) woodTex = makeWoodTexture();
    scene.background = new THREE.Color(on ? (dark ? 0x121316 : 0xeff0f1) : 0xeff0f1);
    hemi.intensity = on ? 0.7 : 1.1; sun.intensity = on ? 2.6 : 1.4; sun.castShadow = on;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005;
    fill.intensity = on ? 0.9 : 0.5;
    floor.visible = on;
    return true;
  }
  function material(color, ghost) {
    const o = { color, transparent: ghost, opacity: ghost ? (realistic ? 0.18 : 0.45) : 1 };
    if (realistic && webgl && !ghost && color === COL.wood) { const t = woodTex.clone(); t.needsUpdate = true; return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0, color: 0xffffff }); }
    return webgl ? new THREE.MeshStandardMaterial({ ...o, roughness: 0.85, metalness: 0 }) : new THREE.MeshLambertMaterial(o);
  }
  // dimension line between two model points with end ticks and a label
  function dimension(from, to, text, cls) {
    const a = toThree(from), b = toThree(to);
    const dir = b.clone().sub(a).normalize();
    const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const tick = up.clone().cross(dir).normalize().multiplyScalar(14);
    const mat = new THREE.LineBasicMaterial({ color: cls === 'dim' ? 0xb7742c : 0x222222, depthTest: false });
    const geo = new THREE.BufferGeometry().setFromPoints([a, b, a.clone().add(tick), a.clone().sub(tick), b.clone().add(tick), b.clone().sub(tick)]);
    const line = new THREE.LineSegments(geo, mat); line.renderOrder = 9; group.add(line);
    label(text, a.clone().add(b).multiplyScalar(0.5), cls);
  }


// A board ripped at 45°: cross-section in the model's (y, z) plane, extruded along x. Centered like a BoxGeometry.
// 'rail'  = fixed on the furniture, slope rises toward the front (bevel up and out)
// 'cleat' = on the hanging piece, the mirror image, so it drops onto the rail
function prismGeometry(kind, size) {
  const [L, d, h] = size, y0 = -d / 2, y1 = d / 2, z0 = -h / 2, z1 = h / 2, drop = Math.min(d, h - 2);
  const poly = kind === 'rail' ? [[y0, z0], [y1, z0], [y1, z1], [y0, z1 - drop]] : [[y0, z0], [y1, z0 + drop], [y1, z1], [y0, z1]];
  const P = (xx, [yy, zz]) => [xx, zz, -yy]; // model (x,y,z) → three (x, z, -y)
  const tri = []; const quad = (a, b, c, dd) => tri.push(...a, ...b, ...c, ...a, ...c, ...dd);
  const A = poly.map(p => P(-L / 2, p)), B = poly.map(p => P(L / 2, p));
  quad(A[0], A[1], A[2], A[3]); quad(B[3], B[2], B[1], B[0]);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(A[i], B[i], B[j], A[j]); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3)); g.computeVertexNormals(); return g;
}
  function show(instances, opts = {}) {
    const { highlight = new Set(), ghost = new Set(), screws = [], explode = 0, labels: showLabels = false, labelFilter, dims = [], partDims = false } = opts;
    while (group.children.length) { const o = group.children.pop(); o.traverse?.(m => { m.geometry?.dispose(); m.material?.dispose?.(); }); }
    labelLayer.innerHTML = ''; labels = []; byUid.clear();
    if (!instances.length) { dirty = true; return; }
    const center = [0, 0, 0];
    for (const x of instances) for (let k = 0; k < 3; k++) center[k] += (x.min[k] + x.max[k]) / 2 / instances.length;
    const offsetOf = x => explode ? x.min.map((v, k) => ((v + x.max[k]) / 2 - center[k]) * explode) : [0, 0, 0];
    const bb = new THREE.Box3();
    const labelled = new Set();
    for (const x of instances) {
      const off = offsetOf(x);
      const size = x.size, mid = x.min.map((v, k) => v + size[k] / 2 + off[k]);
      const isHL = highlight.has(x.uid), isGhost = ghost.has(x.uid) || x.existing;
      const geo = x.def?.bevel ? prismGeometry(x.def.bevel, size) : new THREE.BoxGeometry(size[0], size[2], size[1]);
      const mesh = new THREE.Mesh(geo, x.def?.glass ? new THREE.MeshLambertMaterial({ color: isHL ? 0xbfd8e8 : 0xdde9f0, transparent: true, opacity: 0.45 }) : x.hardware ? (webgl ? new THREE.MeshStandardMaterial({ color: isHL ? 0x555a60 : 0x7a8086, metalness: 0.7, roughness: 0.35, transparent: isGhost, opacity: isGhost ? (realistic ? 0.18 : 0.45) : 1 }) : new THREE.MeshLambertMaterial({ color: 0x7a8086, transparent: isGhost, opacity: isGhost ? 0.45 : 1 })) : material(isHL ? COL.hl : isGhost ? COL.ghost : COL.wood, isGhost));
      if (x.def?.bevel) mesh.material.side = THREE.DoubleSide;
      mesh.position.copy(toThree(mid)); group.add(mesh); byUid.set(x.uid, { mesh, target: mesh.position.clone() });
      if (realistic && webgl) { mesh.castShadow = !isGhost; mesh.receiveShadow = true; if (mesh.material.map) { const L = x.len || size[0]; mesh.material.map.repeat.set(Math.max(0.5, L / 450), 1); if (x.ax && x.ax.L !== 0) mesh.material.map.rotation = Math.PI / 2; } }
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: isGhost ? COL.ghostEdge : COL.edge, transparent: isGhost, opacity: isGhost ? 0.5 : 1 }));
      edges.position.copy(mesh.position); if (!(realistic && webgl)) group.add(edges);
      for (const mk of x.marks || []) { // a drilled hole or a sawn slot, drawn as a dark shape sitting on the top face
        const dark = new THREE.MeshLambertMaterial({ color: 0x3a3028 });
        const zTop = x.max[2] + off[2] + 0.6;
        if (mk.type === 'slot') { const m2 = new THREE.Mesh(new THREE.BoxGeometry(mk.w || 3, 1.2, mk.l || 40), dark); m2.position.copy(toThree([x.min[0] + off[0] + mk.x, x.min[1] + off[1] + mk.y, zTop])); group.add(m2); }
        else { const m2 = new THREE.Mesh(new THREE.CylinderGeometry(mk.d / 2, mk.d / 2, 1.2, 20), dark); m2.position.copy(toThree([x.min[0] + off[0] + mk.x, x.min[1] + off[1] + mk.y, zTop])); group.add(m2); }
      }
      if (!x.existing) bb.expandByObject(mesh);
      const key = x.partNo;
      if (showLabels && key && !labelled.has(key) && (!labelFilter || labelFilter(x))) {
        labelled.add(key);
        label(String(key), toThree(mid), 'num');
        if (partDims) {
          const L = x.ax.L, T = x.ax.T;
          const from = x.min.map((v, k) => v + off[k]), to = [...from];
          to[L] = x.max[L] + off[L];
          from[T] -= 40; to[T] -= 40;
          const oth = [0, 1, 2].find(k => k !== L && k !== T);
          from[oth] += size[oth] / 2; to[oth] += size[oth] / 2;
          dimension(from, to, `${Math.round(x.len)}`, 'dim');
        }
      }
    }
    for (const s of screws) {
      const off = offsetOf(s.joint?.thr || { min: [0, 0, 0], max: [0, 0, 0] });
      const a = toThree(s.start.map((v, k) => v + off[k])), b = toThree(s.end.map((v, k) => v + off[k]));
      const dirv = b.clone().sub(a).normalize();
      const mat = webgl ? new THREE.MeshStandardMaterial({ color: COL.screw, metalness: 0.6, roughness: 0.4 }) : new THREE.MeshLambertMaterial({ color: COL.screw });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(s.d / 2, s.d / 2, a.distanceTo(b) + 40, 8), mat);
      shaft.position.copy(a.clone().add(b).multiplyScalar(0.5).sub(dirv.clone().multiplyScalar(20)));
      shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirv); group.add(shaft);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(s.d, s.d, 3, 12), mat);
      head.position.copy(a.clone().sub(dirv.clone().multiplyScalar(40))); head.quaternion.copy(shaft.quaternion); group.add(head);
    }
    for (const d of dims) { dimension(d.from, d.to, d.label, d.color ? 'dim' : 'ov'); bb.expandByPoint(toThree(d.from)); bb.expandByPoint(toThree(d.to)); }
    if (floor.visible && !bb.isEmpty()) { const c0 = bb.getCenter(new THREE.Vector3()), s0 = bb.getSize(new THREE.Vector3()); floor.position.set(c0.x, bb.min.y - 0.5, c0.z); floor.scale.set(s0.length() * 3, s0.length() * 3, 1); const r0 = s0.length(); sun.shadow.camera.left = -r0; sun.shadow.camera.right = r0; sun.shadow.camera.top = r0; sun.shadow.camera.bottom = -r0; sun.shadow.camera.near = 10; sun.shadow.camera.far = r0 * 8; sun.position.set(c0.x + r0 * 0.6, c0.y + r0 * 1.6, c0.z + r0 * 0.8); sun.target.position.copy(c0); sun.target.updateMatrixWorld(); sun.shadow.camera.updateProjectionMatrix(); }
    const diagNow = bb.getSize(new THREE.Vector3()).length() || 1;
    const grewALot = lastDiag && Math.abs(diagNow - lastDiag) / lastDiag > 0.15; // the user's view is kept only while the model stays about the same size
    lastDiag = diagNow;
    if (!opts.keepCamera || grewALot) {
      const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
      // frame the whole box (its diagonal, so no corner leaves the view) in a vertical fov of 35°, with margin for the dim labels
      const diag = sz.length() || 1, fovV = camera.fov * Math.PI / 180, fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
      const r = diag * 0.62 / Math.tan(Math.min(fovV, fovH) / 2) / 1.93;
      controls.target.copy(c);
      camera.position.set(c.x + r * 1.1, c.y + r * 0.75, c.z + r * 1.4);
      camera.near = r / 100; camera.far = r * 20; camera.updateProjectionMatrix();
      controls.update();
    }
    dirty = true;
  }
  // image of the current view (PNG for WebGL, SVG with labels otherwise) for printing
  function snapshot() {
    renderer.render(scene, camera); placeLabels();
    if (webgl) return renderer.domElement.toDataURL('image/png');
    const svg = renderer.domElement.cloneNode(true);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.insertAdjacentHTML('afterbegin', `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="#EFF0F1"/>`);
    for (const l of labels) {
      if (l.el.style.display === 'none') continue;
      const x = parseFloat(l.el.style.left) - w / 2, y = parseFloat(l.el.style.top) - h / 2;
      const num = l.el.classList.contains('num'), dim = l.el.classList.contains('dim');
      const tw = l.el.textContent.length * 7 + 10;
      svg.insertAdjacentHTML('beforeend', num ? `<circle cx="${x}" cy="${y}" r="12" fill="#fff" stroke="#222" stroke-width="1.5"/>` : `<rect x="${x - tw / 2}" y="${y - 9}" width="${tw}" height="18" rx="6" fill="#fff" stroke="${dim ? '#b7742c' : '#222'}" stroke-width="1"/>`);
      svg.insertAdjacentHTML('beforeend', `<text x="${x}" y="${y + 4}" text-anchor="middle" font-family="Arial" font-size="12" font-weight="bold" fill="${dim ? '#b7742c' : '#222'}">${l.el.textContent}</text>`);
    }
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.outerHTML);
  }

  // fly the given parts in from above (after a show() that already placed them)
  function flyIn(uids, { dur = 700, height = 250 } = {}) {
    const t0 = performance.now(); let i = 0;
    for (const uid of uids) { const e = byUid.get(uid); if (!e) continue; const from = e.target.clone(); from.y += height; e.mesh.position.copy(from); anims.push({ mesh: e.mesh, from, to: e.target.clone(), t0: t0 + i * 60, dur }); i++; }
    dirty = true;
  }
  function autoRotate(on, speed = 1.2) { controls.autoRotate = on; controls.autoRotateSpeed = speed; dirty = true; }
  function destroy() { alive = false; cancelAnimationFrame(frame); ro.disconnect(); controls.dispose(); renderer.dispose?.(); renderer.domElement.remove(); labelLayer.remove(); }
  return { show, destroy, resize, renderer, snapshot, webgl, setRealistic, flyIn, autoRotate, get realistic() { return realistic; } };
}
