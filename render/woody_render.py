# Woody video renderer (v2). Headless:
#   blender -b -P render/woody_render.py -- scene.json out.mp4 [--quality draft|final] [--still N] [--seconds 60]
# From the scene JSON (app/test/export-scene.mjs): the piece with layered pine, a dark curved studio with raytraced
# reflections and depth of field, a circular saw cutting the first board, parts flying in step by step, a cordless
# driver whose bit spins while each screw sinks, a camera that moves in on the work. EEVEE, H.264.
import bpy, json, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
scene_path, out_path = os.path.abspath(argv[0]), os.path.abspath(argv[1])
quality = argv[argv.index('--quality') + 1] if '--quality' in argv else 'draft'
seconds_cap = float(argv[argv.index('--seconds') + 1]) if '--seconds' in argv else 60.0
S = json.load(open(scene_path, encoding='utf-8'))
MM = 0.001

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
FPS = 24; sc.render.fps = FPS
sc.render.resolution_x, sc.render.resolution_y = (854, 480) if quality == 'draft' else (1920, 1080)
sc.eevee.taa_render_samples = 8 if quality == 'draft' else 96
for attr, val in (('use_raytracing', True), ('use_shadows', True)):
    if hasattr(sc.eevee, attr): setattr(sc.eevee, attr, val)
if hasattr(sc.eevee, 'ray_tracing_options'): sc.eevee.ray_tracing_options.resolution_scale = '4' if quality == 'draft' else '1'
sc.view_settings.view_transform = 'AgX'
sc.view_settings.exposure = 0.2

# ------------------------------------------------------------------ materials
def nodes_of(m):
    m.use_nodes = True; return m.node_tree.nodes, m.node_tree.links
def pine_material(name, seed):
    m = bpy.data.materials.new(name); nodes, links = nodes_of(m)
    bsdf = nodes['Principled BSDF']
    geo = nodes.new('ShaderNodeNewGeometry'); mapn = nodes.new('ShaderNodeMapping'); mapn.name = 'Mapping'
    mapn.inputs['Scale'].default_value = (1.6, 55.0, 55.0); mapn.inputs['Location'].default_value = (seed * 0.37, seed * 0.11, seed * 0.23)
    links.new(geo.outputs['Position'], mapn.inputs['Vector'])
    warp = nodes.new('ShaderNodeTexNoise'); warp.inputs['Scale'].default_value = 0.35; warp.inputs['Detail'].default_value = 2.0
    links.new(mapn.outputs['Vector'], warp.inputs['Vector'])
    scl = nodes.new('ShaderNodeVectorMath'); scl.operation = 'SCALE'; scl.inputs['Scale'].default_value = 0.9
    mixv = nodes.new('ShaderNodeVectorMath'); mixv.operation = 'ADD'
    links.new(warp.outputs['Color'], scl.inputs[0]); links.new(mapn.outputs['Vector'], mixv.inputs[0]); links.new(scl.outputs['Vector'], mixv.inputs[1])
    wave = nodes.new('ShaderNodeTexWave'); wave.wave_type = 'BANDS'; wave.bands_direction = 'Y'; wave.wave_profile = 'SAW'
    wave.inputs['Scale'].default_value = 1.0; wave.inputs['Distortion'].default_value = 1.5; wave.inputs['Detail'].default_value = 3.0; wave.inputs['Detail Roughness'].default_value = 0.6
    links.new(mixv.outputs['Vector'], wave.inputs['Vector'])
    rings = nodes.new('ShaderNodeValToRGB'); rings.color_ramp.interpolation = 'EASE'
    rings.color_ramp.elements[0].position = 0.35; rings.color_ramp.elements[0].color = (0.93, 0.78, 0.52, 1)
    rings.color_ramp.elements[1].position = 0.9; rings.color_ramp.elements[1].color = (0.62, 0.40, 0.20, 1)
    links.new(wave.outputs['Fac'], rings.inputs['Fac'])
    pores = nodes.new('ShaderNodeTexNoise'); pores.inputs['Scale'].default_value = 900.0; pores.inputs['Detail'].default_value = 2.0
    links.new(mapn.outputs['Vector'], pores.inputs['Vector'])
    blotch = nodes.new('ShaderNodeTexNoise'); blotch.inputs['Scale'].default_value = 3.0; blotch.inputs['Detail'].default_value = 3.0
    links.new(geo.outputs['Position'], blotch.inputs['Vector'])
    mix1 = nodes.new('ShaderNodeMix'); mix1.data_type = 'RGBA'; mix1.blend_type = 'MULTIPLY'; mix1.inputs['Factor'].default_value = 0.25
    links.new(rings.outputs['Color'], mix1.inputs[6]); links.new(blotch.outputs['Color'], mix1.inputs[7])
    mix2 = nodes.new('ShaderNodeMix'); mix2.data_type = 'RGBA'; mix2.blend_type = 'MULTIPLY'; mix2.inputs['Factor'].default_value = 0.12
    links.new(mix1.outputs[2], mix2.inputs[6]); links.new(pores.outputs['Color'], mix2.inputs[7])
    links.new(mix2.outputs[2], bsdf.inputs['Base Color'])
    rr = nodes.new('ShaderNodeMapRange'); rr.inputs['To Min'].default_value = 0.55; rr.inputs['To Max'].default_value = 0.3
    links.new(wave.outputs['Fac'], rr.inputs['Value']); links.new(rr.outputs['Result'], bsdf.inputs['Roughness'])
    bump = nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.2; bump.inputs['Distance'].default_value = 0.002
    links.new(wave.outputs['Fac'], bump.inputs['Height']); links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Coat Weight'].default_value = 0.15; bsdf.inputs['Coat Roughness'].default_value = 0.25
    return m
def plain(name, rgb, rough=0.5, metal=0.0, alpha=1.0, coat=0.0):
    m = bpy.data.materials.new(name); nodes, links = nodes_of(m)
    b = nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    b.inputs['Coat Weight'].default_value = coat
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        if hasattr(m, 'surface_render_method'): m.surface_render_method = 'BLENDED'
        else: m.blend_method = 'BLEND'
    return m
MAT_METAL = plain('metal', (0.62, 0.64, 0.66), 0.3, 0.95)
MAT_STEEL = plain('steel', (0.5, 0.5, 0.52), 0.45, 0.9)
MAT_SCREW = plain('screw', (0.2, 0.2, 0.21), 0.45, 0.85)
MAT_GHOST = plain('ghost', (0.7, 0.72, 0.75), 0.3, 0.0, 0.14)
MAT_GLASS = plain('glass', (0.85, 0.92, 0.97), 0.05, 0.0, 0.3)
MAT_FLOOR = plain('floor', (0.03, 0.031, 0.035), 0.18, 0.0, 1.0, 0.3)
MAT_BACK = plain('backdrop', (0.012, 0.012, 0.014), 0.8)
MAT_TEAL = plain('teal', (0.02, 0.42, 0.40), 0.35, 0.0, 1.0, 0.3)
MAT_RUBBER = plain('rubber', (0.05, 0.05, 0.05), 0.85)
MAT_DARKMARK = plain('darkmark', (0.05, 0.04, 0.03), 0.8)

# ------------------------------------------------------------------ helpers
def bevel(o, w=0.0015, segs=3):
    b = o.modifiers.new('bevel', 'BEVEL'); b.width = w; b.segments = segs; b.limit_method = 'ANGLE'; return o
def smooth(o):
    for p in o.data.polygons: p.use_smooth = True
def add_box(name, mn, mx, mat, bev=0.0015):
    bpy.ops.mesh.primitive_cube_add(size=1, location=tuple((mn[i] + mx[i]) / 2 * MM for i in range(3)))
    o = bpy.context.active_object; o.name = name; o.scale = tuple((mx[i] - mn[i]) * MM for i in range(3)); o.data.materials.append(mat)
    bpy.ops.object.transform_apply(scale=True)
    if bev: bevel(o, bev)
    return o
def add_prism(name, mn, mx, kind, mat):
    L, d, h = [(mx[i] - mn[i]) * MM for i in range(3)]; drop = min(d, h - 0.002)
    poly = [(0, 0), (d, 0), (d, h), (0, h - drop)] if kind == 'rail' else [(0, 0), (d, drop), (d, h), (0, h)]
    verts = [(x, y, z) for x in (0, L) for (y, z) in poly]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4)] + [(i, (i + 1) % 4, (i + 1) % 4 + 4, i + 4) for i in range(4)]
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o); o.location = (mn[0] * MM, mn[1] * MM, mn[2] * MM); o.data.materials.append(mat)
    return bevel(o, 0.001, 2)
def cyl(name, r, depth, mat, loc=(0, 0, 0), segs=32, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=segs, location=loc)
    o = bpy.context.active_object; o.name = name; o.data.materials.append(mat)
    if parent is not None: o.parent = parent
    return o
def box(name, size, mat, loc=(0, 0, 0), parent=None, bev=0.002):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc); o = bpy.context.active_object; o.name = name; o.scale = size; o.data.materials.append(mat)
    bpy.ops.object.transform_apply(scale=True)
    if bev: bevel(o, bev)
    if parent is not None: o.parent = parent
    return o
def key_vis(objs, frame, visible):
    for o in objs:
        o.hide_render = not visible; o.keyframe_insert('hide_render', frame=frame); o.hide_viewport = not visible; o.keyframe_insert('hide_viewport', frame=frame)
def key_loc(o, frame, loc): o.location = loc; o.keyframe_insert('location', frame=frame)

# ------------------------------------------------------------------ the piece
parts, part_info = {}, {}
wood_i = 0
for p in S['parts']:
    if p['contextOnly']: continue
    mn, mx = p['min'], p['max']
    if p['glass']: mat = MAT_GLASS
    elif p['existing']: mat = MAT_GHOST
    elif p['hardware']: mat = MAT_STEEL
    else: mat = pine_material('pine%d' % wood_i, wood_i); wood_i += 1
    o = add_prism(p['uid'], mn, mx, p['bevel'], mat) if p['bevel'] else add_box(p['uid'], mn, mx, mat)
    if mat.name.startswith('pine'):
        mp = mat.node_tree.nodes['Mapping']; ax = p['axisL']
        mp.inputs['Rotation'].default_value = (0, 0, 0) if ax == 0 else (0, 0, math.pi / 2) if ax == 1 else (0, math.pi / 2, 0)
    for mk in p.get('marks', []):
        z = mx[2] * MM + 0.0002; loc = ((mn[0] + mk['x']) * MM, (mn[1] + mk['y']) * MM, z)
        if mk['type'] == 'slot': s_ = box('slot', (max(mk['w'], 2) * MM, max(mk['l'], 10) * MM, 0.0004), MAT_DARKMARK, loc, bev=0)
        else: s_ = cyl('hole', mk['d'] / 2 * MM, 0.0004, MAT_DARKMARK, loc, 24)
        s_.parent = o; s_.matrix_parent_inverse = o.matrix_world.inverted()
    parts[p['uid']] = o; part_info[p['uid']] = p

bb = S['bbox']; cx, cy, cz = [(bb['min'][i] + bb['max'][i]) / 2 * MM for i in range(3)]
size = [(bb['max'][i] - bb['min'][i]) * MM for i in range(3)]
diag = math.sqrt(sum(v * v for v in size)) or 0.3
zmin = bb['min'][2] * MM

# ------------------------------------------------------------------ studio
bpy.ops.mesh.primitive_plane_add(size=diag * 14, location=(cx, cy, zmin - 0.0004)); floor = bpy.context.active_object; floor.name = 'floor'; floor.data.materials.append(MAT_FLOOR)
bpy.ops.mesh.primitive_plane_add(size=diag * 14, location=(cx, cy + diag * 4.5, zmin + diag * 7 - 0.0004)); back = bpy.context.active_object; back.name = 'backdrop'
back.rotation_euler = (math.pi / 2, 0, 0); back.data.materials.append(MAT_BACK)
world = bpy.data.worlds.new('studio'); sc.world = world; world.use_nodes = True
wb = world.node_tree.nodes['Background']; wb.inputs['Color'].default_value = (0.06, 0.065, 0.075, 1); wb.inputs['Strength'].default_value = 0.6
def area(name, loc, energy, sz, color=(1, 1, 1), shape='SQUARE', ratio=1.0):
    bpy.ops.object.light_add(type='AREA', location=loc); l = bpy.context.active_object; l.name = name
    l.data.energy = energy; l.data.size = sz; l.data.color = color; l.data.shape = shape
    if shape == 'RECTANGLE': l.data.size_y = sz * ratio
    l.rotation_mode = 'QUATERNION'; l.rotation_quaternion = (Vector((cx, cy, cz)) - Vector(loc)).to_track_quat('-Z', 'Y'); return l
E = diag ** 2
area('key', (cx + diag * 1.0, cy - diag * 1.5, cz + diag * 1.8), 260 * E, diag * 1.4, (1, 0.95, 0.88), 'RECTANGLE', 0.6)
area('fill', (cx - diag * 2.0, cy - diag * 0.5, cz + diag * 0.9), 70 * E, diag * 2.2, (0.88, 0.93, 1))
area('rim', (cx + diag * 0.2, cy + diag * 1.6, cz + diag * 1.6), 160 * E, diag * 0.6, (1, 1, 1), 'RECTANGLE', 3.0)
area('top', (cx, cy, cz + diag * 3.0), 50 * E, diag * 3.0)

# ------------------------------------------------------------------ camera
bpy.ops.object.camera_add(); cam = bpy.context.active_object; cam.name = 'cam'; sc.camera = cam; cam.data.lens = 45
bpy.ops.object.empty_add(location=(cx, cy, cz)); target = bpy.context.active_object; target.name = 'target'
con = cam.constraints.new('TRACK_TO'); con.target = target; con.track_axis = 'TRACK_NEGATIVE_Z'; con.up_axis = 'UP_Y'
cam.data.dof.use_dof = True; cam.data.dof.focus_object = target; cam.data.dof.aperture_fstop = 5.6 if quality != 'draft' else 8.0
R0 = max(diag * 2.3, 0.75)  # never closer than a real camera would be to a hand tool
def cam_key(frame, ang_deg, dist, height, look=None):
    a = math.radians(ang_deg)
    key_loc(cam, frame, (cx + dist * math.sin(a), cy - dist * math.cos(a), cz + height))
    key_loc(target, frame, look if look is not None else (cx, cy, cz))

# ------------------------------------------------------------------ tools
def make_driver():
    root = bpy.data.objects.new('driver', None); bpy.context.collection.objects.link(root)
    spin = bpy.data.objects.new('spin', None); bpy.context.collection.objects.link(spin); spin.parent = root
    bit = cyl('bit', 0.0032, 0.05, MAT_STEEL, (0, 0, 0.025), 6, spin)
    chuck = cyl('chuck', 0.011, 0.03, MAT_METAL, (0, 0, 0.065), 32, spin); smooth(chuck)
    ring = cyl('ring', 0.014, 0.012, MAT_RUBBER, (0, 0, 0.086), 32, spin); smooth(ring)
    nose = cyl('nose', 0.019, 0.05, MAT_TEAL, (0, 0, 0.115), 32, root); smooth(nose); bevel(nose, 0.004, 4)
    bodyo = cyl('body', 0.026, 0.11, MAT_TEAL, (0, 0, 0.19), 32, root); smooth(bodyo); bevel(bodyo, 0.008, 5)
    cap = cyl('cap', 0.022, 0.02, MAT_RUBBER, (0, 0, 0.255), 32, root); smooth(cap)
    grip = box('grip', (0.034, 0.11, 0.042), MAT_TEAL, (0, -0.06, 0.18), root, 0.006); grip.rotation_euler = (math.radians(-12), 0, 0)
    gripr = box('gripr', (0.036, 0.05, 0.045), MAT_RUBBER, (0, -0.045, 0.18), root, 0.005); gripr.rotation_euler = (math.radians(-12), 0, 0)
    box('battery', (0.05, 0.03, 0.075), MAT_RUBBER, (0, -0.125, 0.19), root, 0.004)
    box('trigger', (0.014, 0.02, 0.012), MAT_RUBBER, (0, -0.02, 0.135), root, 0.002)
    return root, spin
def make_saw():
    root = bpy.data.objects.new('saw', None); bpy.context.collection.objects.link(root)
    box('plate', (0.30, 0.14, 0.003), MAT_METAL, (0, 0, 0.0015), root, 0.001)
    blade = cyl('blade', 0.092, 0.002, MAT_STEEL, (0.02, 0.0, 0.05), 48, root); blade.rotation_euler = (0, math.pi / 2, 0)
    guard = cyl('guard', 0.1, 0.022, MAT_TEAL, (0.02, 0.0, 0.065), 48, root); guard.rotation_euler = (0, math.pi / 2, 0); smooth(guard)
    motor = cyl('motor', 0.045, 0.12, MAT_TEAL, (-0.06, 0.0, 0.075), 32, root); motor.rotation_euler = (0, math.pi / 2, 0); smooth(motor); bevel(motor, 0.006, 4)
    box('sawhandle', (0.035, 0.05, 0.09), MAT_RUBBER, (-0.02, -0.11, 0.11), root, 0.006)
    box('hbar', (0.035, 0.14, 0.03), MAT_RUBBER, (-0.02, -0.06, 0.16), root, 0.006)
    box('knob', (0.04, 0.04, 0.04), MAT_RUBBER, (0.02, 0.09, 0.09), root, 0.008)
    return root, blade
def family(root): return [root] + [c for c in bpy.data.objects if c.parent == root or (c.parent and c.parent.parent == root)]

# ------------------------------------------------------------------ timeline
FLY, STAG, SCREW, PAUSE, CUT = int(FPS * 1.4), int(FPS * 0.3), int(FPS * 1.2), int(FPS * 0.7), int(FPS * 2.6)
frame = 1
all_part_objs = [o for uid, o in parts.items() if not part_info[uid]['existing']]
key_vis(all_part_objs, 1, False)

# --- cutting: the longest board lies in front, the saw crosses it, it splits ---
real = [p for p in S['parts'] if not p['existing'] and not p['hardware'] and not p['contextOnly']]
if real:
    bp = max(real, key=lambda p: max(p['max'][i] - p['min'][i] for i in range(3)))
    dims = sorted((bp['max'][i] - bp['min'][i]) * MM for i in range(3)); t, w, L = dims
    stock = max(L * 1.6, 0.9); bx, by = cx, cy - max(diag * 1.0, 0.35)
    mat_b = pine_material('stock', 99)
    mk = lambda nm, x0, x1: add_box(nm, [x0 / MM, (by - w / 2) / MM, zmin / MM], [x1 / MM, (by + w / 2) / MM, (zmin + t) / MM], mat_b)
    whole = mk('stock_whole', bx - stock / 2, bx + stock / 2)
    left = mk('stock_left', bx - stock / 2, bx - stock / 2 + L)
    right = mk('stock_right', bx - stock / 2 + L + 0.003, bx + stock / 2)
    saw, blade = make_saw(); sawfam = family(saw)
    key_vis([left, right], 1, False); key_vis([whole] + sawfam, 1, True)
    ctx = [o for uid, o in parts.items() if part_info[uid]['existing']]; key_vis(ctx, 1, False)
    cutx = bx - stock / 2 + L; y0, y1 = by - w / 2 - 0.14, by + w / 2 + 0.08
    key_loc(saw, frame + int(FPS * 0.6), (cutx - 0.02, y0, zmin + t)); key_loc(saw, frame + CUT, (cutx - 0.02, y1, zmin + t))
    blade.rotation_mode = 'XYZ'
    for f in range(frame, frame + CUT + 1, 2):
        blade.rotation_euler = ((f - frame) * 0.9, math.pi / 2, 0); blade.keyframe_insert('rotation_euler', frame=f)
    fsplit = frame + int(CUT * 0.72)
    key_vis([whole], fsplit, False); key_vis([left, right], fsplit, True)
    f_end = frame + CUT + int(FPS * 0.6)
    key_vis(sawfam + [left, right], f_end, False); key_vis(ctx, f_end, True)
    cam_key(frame, -40, max(R0, 1.0), max(diag * 0.6, 0.45), (cutx, by, zmin + t)); cam_key(f_end, -10, max(R0, 1.0), max(diag * 0.55, 0.4), (cutx, by, zmin + t))
    frame = f_end + int(FPS * 0.3)

# --- assembly ---
driver, spin = make_driver(); drv_objs = family(driver)
key_vis(drv_objs, 1, False)
screw_count = 0
steps = [s for s in S['steps'] if s['add'] or s['screws']]
cam_key(frame, -30, R0, diag * 0.7)
total_est = seconds_cap * FPS
for s in steps:
    for i, uid in enumerate(s['add']):
        o = parts.get(uid)
        if not o: continue
        f0 = frame + i * STAG; key_vis([o], f0, True)
        home = o.location.copy(); key_loc(o, f0, home + Vector((0, 0, diag * 0.5))); key_loc(o, f0 + FLY, home)
    frame += FLY + STAG * max(0, len(s['add']) - 1) + PAUSE
    for sc_ in s['screws'][:24]:
        a, b = Vector(sc_['start']) * MM, Vector(sc_['end']) * MM
        n = (b - a).normalized(); L = 0.05
        shaft = cyl('screw', sc_['d'] / 2 * MM, (b - a).length + 0.004, MAT_SCREW, (a + b) / 2, 12)
        head = cyl('head', sc_['d'] * MM, 0.0025, MAT_SCREW, a - n * 0.0012, 24); smooth(head)
        for ob in (shaft, head): ob.rotation_mode = 'QUATERNION'; ob.rotation_quaternion = n.to_track_quat('Z', 'Y')
        key_vis([shaft, head], 1, False); key_vis([shaft, head], frame, True)
        for ob in (shaft, head):
            home = ob.location.copy(); key_loc(ob, frame, home - n * L); key_loc(ob, frame + int(SCREW * 0.35), home - n * L); key_loc(ob, frame + SCREW, home)
        driver.rotation_mode = 'QUATERNION'; driver.rotation_quaternion = (-n).to_track_quat('Z', 'Y'); driver.keyframe_insert('rotation_quaternion', frame=frame)
        key_vis(drv_objs, frame, True)
        key_loc(driver, frame, a - n * (L + 0.08)); key_loc(driver, frame + int(SCREW * 0.35), a - n * L); key_loc(driver, frame + SCREW, a)
        spin.rotation_mode = 'XYZ'
        for f in range(frame + int(SCREW * 0.35), frame + SCREW + 1, 2):
            spin.rotation_euler = (0, 0, (f - frame) * 0.7); spin.keyframe_insert('rotation_euler', frame=f)
        cam_key(frame, -30 + 60 * min(1.0, frame / total_est), R0 * 0.9, max(diag * 0.5, 0.3), tuple(a + n * 0.02))
        frame += SCREW; screw_count += 1
    if s['screws']: key_vis(drv_objs, frame + 1, False); frame += PAUSE
    cam_key(frame, -30 + 60 * min(1.0, frame / total_est), R0, diag * 0.7)
    if frame > seconds_cap * FPS: break
end = frame + int(FPS * 2.5)
cam_key(end, 40, R0 * 1.05, diag * 0.75)
sc.frame_start, sc.frame_end = 1, end
sc.frame_set(1)
print('frames', end, 'seconds', round(end / FPS, 1), 'parts', len(parts), 'screws', screw_count)

if hasattr(sc.render.image_settings, 'media_type'): sc.render.image_settings.media_type = 'IMAGE' if '--still' in argv else 'VIDEO'
if '--still' in argv:
    sc.render.image_settings.file_format = 'PNG'; sc.render.filepath = out_path; sc.frame_set(int(argv[argv.index('--still') + 1])); bpy.ops.render.render(write_still=True)
else:
    sc.render.image_settings.file_format = 'FFMPEG'; sc.render.ffmpeg.format = 'MPEG4'; sc.render.ffmpeg.codec = 'H264'; sc.render.ffmpeg.constant_rate_factor = 'MEDIUM'
    sc.render.filepath = out_path; bpy.ops.render.render(animation=True)
print('done', out_path)
