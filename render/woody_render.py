# Woody video renderer. Run headless:
#   blender -b -P render/woody_render.py -- scene.json out.mp4 [--quality draft|final] [--seconds 20]
# Builds the piece from the scene JSON (app/test/export-scene.mjs), pine materials, dark studio, a camera that circles
# slowly, parts flying in step by step, a driver turning every screw, and renders an MP4 (H.264) with EEVEE.
import bpy, json, sys, math, os, random
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
scene_path, out_path = os.path.abspath(argv[0]), os.path.abspath(argv[1])
quality = argv[argv.index('--quality') + 1] if '--quality' in argv else 'draft'
seconds_cap = float(argv[argv.index('--seconds') + 1]) if '--seconds' in argv else 40.0
S = json.load(open(scene_path, encoding='utf-8'))
MM = 0.001  # mm → m

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.render.fps = 24
FPS = 24
sc.render.resolution_x, sc.render.resolution_y = (960, 540) if quality == 'draft' else (1920, 1080)
sc.render.resolution_percentage = 100
sc.eevee.taa_render_samples = 8 if quality == 'draft' else 64
if hasattr(sc.render.image_settings, 'media_type'): sc.render.image_settings.media_type = 'VIDEO'
sc.render.image_settings.file_format = 'FFMPEG'
sc.render.ffmpeg.format = 'MPEG4'; sc.render.ffmpeg.codec = 'H264'; sc.render.ffmpeg.constant_rate_factor = 'MEDIUM'
sc.render.filepath = out_path
sc.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'

# ---------- materials ----------
def pine_material(name, seed):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nodes, links = nt.nodes, nt.links
    bsdf = nodes['Principled BSDF']; bsdf.inputs['Roughness'].default_value = 0.45
    tex = nodes.new('ShaderNodeNewGeometry'); mapn = nodes.new('ShaderNodeMapping')
    mapn.inputs['Scale'].default_value = (2.0, 45.0, 45.0)  # grain stretched along X (the long axis, set per part below)
    wave = nodes.new('ShaderNodeTexWave'); wave.wave_type = 'BANDS'; wave.bands_direction = 'Y'
    wave.inputs['Scale'].default_value = 1.0; wave.inputs['Distortion'].default_value = 4.0; wave.inputs['Detail'].default_value = 4.0
    noise = nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 40.0; noise.inputs['Detail'].default_value = 6.0
    mix = nodes.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'; mix.inputs['Fac'].default_value = 0.35
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.3; ramp.color_ramp.elements[0].color = (0.52, 0.32, 0.15, 1)
    ramp.color_ramp.elements[1].position = 0.7; ramp.color_ramp.elements[1].color = (0.86, 0.66, 0.42, 1)
    bump = nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.25
    links.new(tex.outputs['Position'], mapn.inputs['Vector']); links.new(mapn.outputs['Vector'], wave.inputs['Vector']); links.new(mapn.outputs['Vector'], noise.inputs['Vector'])
    links.new(wave.outputs['Fac'], mix.inputs[1]); links.new(noise.outputs['Fac'], mix.inputs[2]); links.new(mix.outputs['Color'], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], bsdf.inputs['Base Color']); links.new(wave.outputs['Fac'], bump.inputs['Height']); links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    mapn.inputs['Location'].default_value = (seed * 0.37, seed * 0.11, seed * 0.23)
    return m
def plain_material(name, rgb, rough=0.5, metal=0.0, alpha=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if alpha < 1: b.inputs['Alpha'].default_value = alpha; m.blend_method = 'BLEND'
    return m
MAT_METAL = plain_material('metal', (0.55, 0.57, 0.6), 0.35, 0.9)
MAT_SCREW = plain_material('screw', (0.12, 0.12, 0.13), 0.4, 0.8)
MAT_GHOST = plain_material('ghost', (0.6, 0.6, 0.62), 0.6, 0.0, 0.18)
MAT_GLASS = plain_material('glass', (0.85, 0.92, 0.97), 0.05, 0.0, 0.35)
MAT_FLOOR = plain_material('floor', (0.035, 0.036, 0.04), 0.22)
MAT_TOOL = plain_material('tool', (0.1, 0.45, 0.38), 0.5)
MAT_DARK = plain_material('dark', (0.08, 0.08, 0.09), 0.7)

# ---------- geometry ----------
def add_box(name, mn, mx, mat):
    sx, sy, sz = [(mx[i] - mn[i]) * MM for i in range(3)]
    bpy.ops.mesh.primitive_cube_add(size=1, location=((mn[0] + mx[0]) / 2 * MM, (mn[1] + mx[1]) / 2 * MM, (mn[2] + mx[2]) / 2 * MM))
    o = bpy.context.active_object; o.name = name; o.scale = (sx, sy, sz); o.data.materials.append(mat)
    bev = o.modifiers.new('bevel', 'BEVEL'); bev.width = 0.0012; bev.segments = 2; bev.limit_method = 'ANGLE'
    return o
def add_prism(name, mn, mx, kind, mat):
    L, d, h = [(mx[i] - mn[i]) * MM for i in range(3)]
    drop = min(d, h - 0.002)
    if kind == 'rail': poly = [(0, 0), (d, 0), (d, h), (0, h - drop)]
    else: poly = [(0, 0), (d, drop), (d, h), (0, h)]
    verts, faces = [], []
    for x in (0, L):
        for (y, z) in poly: verts.append((x, y, z))
    faces = [(0, 1, 2, 3), (7, 6, 5, 4)] + [(i, (i + 1) % 4, (i + 1) % 4 + 4, i + 4) for i in range(4)]
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    o.location = (mn[0] * MM, mn[1] * MM, mn[2] * MM); o.data.materials.append(mat)
    return o
def add_cyl(name, p0, p1, r, mat, segs=16):
    a, b = Vector(p0), Vector(p1); d = b - a; L = d.length
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=L, vertices=segs, location=(a + b) / 2)
    o = bpy.context.active_object; o.name = name; o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = d.to_track_quat('Z', 'Y'); o.data.materials.append(mat)
    return o

parts = {}
wood_i = 0
for p in S['parts']:
    if p['contextOnly']: continue
    mn, mx = p['min'], p['max']
    if p['glass']: mat = MAT_GLASS
    elif p['existing']: mat = MAT_GHOST
    elif p['hardware']: mat = MAT_METAL
    else: mat = pine_material('pine%d' % wood_i, wood_i); wood_i += 1
    o = add_prism(p['uid'], mn, mx, p['bevel'], mat) if p['bevel'] else add_box(p['uid'], mn, mx, mat)
    if mat.name.startswith('pine'):
        # grain along the part's long axis: rotate the texture mapping so its X runs along axisL
        mp = mat.node_tree.nodes['Mapping']
        ax = p['axisL']
        mp.inputs['Rotation'].default_value = (0, 0, 0) if ax == 0 else (0, 0, math.pi / 2) if ax == 1 else (0, math.pi / 2, 0)
    # holes and slots drawn as dark shallow shapes on the top face
    for mk in p.get('marks', []):
        z = mx[2] * MM + 0.0003
        if mk['type'] == 'slot':
            bpy.ops.mesh.primitive_cube_add(size=1, location=((mn[0] + mk['x']) * MM, (mn[1] + mk['y']) * MM, z))
            s = bpy.context.active_object; s.scale = (max(mk['w'], 2) * MM, max(mk['l'], 10) * MM, 0.0006); s.data.materials.append(MAT_DARK); s.parent = o; s.matrix_parent_inverse = o.matrix_world.inverted()
        else:
            bpy.ops.mesh.primitive_cylinder_add(radius=mk['d'] / 2 * MM, depth=0.0006, location=((mn[0] + mk['x']) * MM, (mn[1] + mk['y']) * MM, z))
            s = bpy.context.active_object; s.data.materials.append(MAT_DARK); s.parent = o; s.matrix_parent_inverse = o.matrix_world.inverted()
    parts[p['uid']] = o

bb = S['bbox']; cx, cy, cz = [(bb['min'][i] + bb['max'][i]) / 2 * MM for i in range(3)]
diag = math.sqrt(sum(((bb['max'][i] - bb['min'][i]) * MM) ** 2 for i in range(3))) or 0.3
zmin = bb['min'][2] * MM

# ---------- stage: floor, world, lights ----------
bpy.ops.mesh.primitive_plane_add(size=diag * 8, location=(cx, cy, zmin - 0.0005)); floor = bpy.context.active_object; floor.name = 'floor'; floor.data.materials.append(MAT_FLOOR)
world = bpy.data.worlds.new('studio'); sc.world = world; world.use_nodes = True
wb = world.node_tree.nodes['Background']; wb.inputs['Color'].default_value = (0.02, 0.02, 0.025, 1); wb.inputs['Strength'].default_value = 1.0
def area(name, loc, energy, size, color=(1, 1, 1)):
    bpy.ops.object.light_add(type='AREA', location=loc); l = bpy.context.active_object; l.name = name
    l.data.energy = energy; l.data.size = size; l.data.color = color
    l.rotation_mode = 'QUATERNION'; l.rotation_quaternion = (Vector((cx, cy, cz)) - Vector(loc)).to_track_quat('-Z', 'Y'); return l
area('key', (cx + diag * 1.2, cy - diag * 1.4, cz + diag * 1.6), 180 * diag ** 2, diag * 1.2, (1, 0.96, 0.9))
area('fill', (cx - diag * 1.8, cy - diag * 0.6, cz + diag * 0.8), 70 * diag ** 2, diag * 2.0, (0.9, 0.95, 1))
area('rim', (cx + diag * 0.3, cy + diag * 1.8, cz + diag * 1.4), 120 * diag ** 2, diag * 0.8)

# ---------- camera: slow orbit, slightly above ----------
bpy.ops.object.camera_add(); cam = bpy.context.active_object; cam.name = 'cam'; sc.camera = cam; cam.data.lens = 42
bpy.ops.object.empty_add(location=(cx, cy, cz)); target = bpy.context.active_object; target.name = 'target'
con = cam.constraints.new('TRACK_TO'); con.target = target; con.track_axis = 'TRACK_NEGATIVE_Z'; con.up_axis = 'UP_Y'
R = diag * 2.4

# ---------- timeline: parts fly in per step, then the driver turns the screws ----------
steps = [s for s in S['steps'] if s['add'] or s['screws']]
FLY = int(FPS * 1.4); STAGGER = int(FPS * 0.35); SCREW = int(FPS * 1.1); PAUSE = int(FPS * 0.8)
frame = 1
# everything starts hidden except context parts
for uid, o in parts.items():
    p = next(q for q in S['parts'] if q['uid'] == uid)
    if p['existing']: continue
    o.hide_render = True; o.keyframe_insert('hide_render', frame=1); o.hide_viewport = True; o.keyframe_insert('hide_viewport', frame=1)
def show_at(o, f):
    o.hide_render = False; o.keyframe_insert('hide_render', frame=f); o.hide_viewport = False; o.keyframe_insert('hide_viewport', frame=f)

# driver tool built from primitives, parented to an empty we animate
bpy.ops.object.empty_add(location=(0, 0, 0)); drv = bpy.context.active_object; drv.name = 'driver'
def tool_part(prim, **kw):
    if prim == 'cyl': bpy.ops.mesh.primitive_cylinder_add(**kw)
    else: bpy.ops.mesh.primitive_cube_add(**kw)
    o = bpy.context.active_object; o.parent = drv; return o
bit = tool_part('cyl', radius=0.003, depth=0.06, location=(0, 0, 0.03)); bit.data.materials.append(MAT_METAL)
chuck = tool_part('cyl', radius=0.013, depth=0.025, location=(0, 0, 0.072)); chuck.data.materials.append(MAT_METAL)
body = tool_part('cyl', radius=0.022, depth=0.12, location=(0, 0, 0.145)); body.data.materials.append(MAT_TOOL)
handle = tool_part('cube', size=1, location=(0, -0.05, 0.17)); handle.scale = (0.034, 0.04, 0.11); handle.data.materials.append(MAT_DARK)
drv.hide_render = True; drv.keyframe_insert('hide_render', frame=1)
for ch in (bit, chuck, body, handle): ch.hide_render = True; ch.keyframe_insert('hide_render', frame=1)
def driver_visible(f, on):
    for ob in (drv, bit, chuck, body, handle): ob.hide_render = not on; ob.keyframe_insert('hide_render', frame=f)

screw_objs = []
captions = []
for s in steps:
    captions.append((frame, s['title']))
    # parts fly in from above, staggered
    for i, uid in enumerate(s['add']):
        o = parts.get(uid)
        if not o: continue
        f0 = frame + i * STAGGER
        show_at(o, f0)
        home = o.location.copy()
        o.location = home + Vector((0, 0, diag * 0.6)); o.keyframe_insert('location', frame=f0)
        o.location = home; o.keyframe_insert('location', frame=f0 + FLY)
    frame += FLY + STAGGER * max(0, len(s['add']) - 1) + PAUSE
    # screws: driver arrives, spins, the screw sinks in
    for sc_ in s['screws'][:24]:
        a, b = Vector(sc_['start']) * MM, Vector(sc_['end']) * MM
        d = (b - a); L = 0.05; n = d.normalized()
        shaft = add_cyl('screw', a - n * 0.02, b, sc_['d'] / 2 * MM, MAT_SCREW, 8)
        head = add_cyl('head', a - n * 0.04, a - n * 0.037, sc_['d'] * MM, MAT_SCREW, 12)
        for ob in (shaft, head): ob.hide_render = True; ob.keyframe_insert('hide_render', frame=1); ob.hide_render = False; ob.keyframe_insert('hide_render', frame=frame)
        q = (-n).to_track_quat('Z', 'Y')
        for ob in (shaft, head):
            home = ob.location.copy(); ob.location = home - n * L; ob.keyframe_insert('location', frame=frame + int(SCREW * 0.3)); ob.location = home; ob.keyframe_insert('location', frame=frame + SCREW)
        drv.rotation_mode = 'QUATERNION'; drv.rotation_quaternion = q
        drv.location = a - n * 0.04 - n * L; drv.keyframe_insert('location', frame=frame); driver_visible(frame, True)
        drv.keyframe_insert('location', frame=frame + int(SCREW * 0.3))
        drv.location = a - n * 0.04; drv.keyframe_insert('location', frame=frame + SCREW)
        drv.keyframe_insert('rotation_quaternion', frame=frame)
        frame += SCREW
        screw_objs += [shaft, head]
    if s['screws']:
        driver_visible(frame + 1, False); frame += PAUSE
    if frame > seconds_cap * FPS: break
end = frame + int(FPS * 2.5)
sc.frame_start, sc.frame_end = 1, end

# camera orbit over the whole clip
for f in range(1, end + 1, 6):
    t = (f - 1) / max(1, end - 1); ang = math.radians(-35 + 70 * t)
    cam.location = (cx + R * math.sin(ang), cy - R * math.cos(ang), cz + diag * 0.75); cam.keyframe_insert('location', frame=f)
# (keyframes are Bezier by default in Blender 5)
sc.frame_set(1)
print('frames', end, 'seconds', round(end / FPS, 1), 'parts', len(parts), 'screws', len(screw_objs) // 2)
if '--still' in argv:
    if hasattr(sc.render.image_settings, 'media_type'): sc.render.image_settings.media_type = 'IMAGE'
    sc.render.image_settings.file_format = 'PNG'; sc.render.filepath = out_path; sc.frame_set(int(argv[argv.index('--still') + 1])); bpy.ops.render.render(write_still=True)
else:
    bpy.ops.render.render(animation=True)
print('done', out_path)
