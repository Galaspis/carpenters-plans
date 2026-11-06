# Video renderer — PARKED (2026-11-06)

Gal's decision on 2026-11-06: **stop this. Not needed.** It was an experiment to see whether the app could make
reel-style assembly videos (like the Blender animations on woodworking pages). Two drafts of the knife block were
made; the look was not good enough and the project does not need it. Nothing in the app depends on it.

Kept here so it can be picked up some day. The app's own 3D (Three.js, "מציאותי" and "הרכבה מונפשת" buttons) stays as it is.

## What exists

- `app/test/export-scene.mjs` — exports a design (+ parameter values) as a scene JSON for Blender:
  `node app/test/export-scene.mjs app/designs/cleat-holder.json scene.json kind=7 W=260`
- `render/woody_render.py` — Blender 5.2 script (headless): layered pine material, dark studio with raytraced
  reflections and depth of field, a circular-saw cut of the first board, parts flying in per step, a cordless driver
  whose bit spins as each screw sinks, camera moves, H.264 output:
  `"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -P render/woody_render.py -- scene.json out.mp4 [--quality draft|final] [--still FRAME] [--seconds N]`
- Blender 5.2.3 is installed on Gal's PC (winget `BlenderFoundation.Blender`). No CUDA GPU: EEVEE, ~20 s per draft
  frame (854×480), a 20-second clip ≈ 30–40 min. `render/out/` is ignored by git.

## Why it was not good enough

Tools and screws are built from primitives (look like toys next to real reels); wood is procedural; no scanned
models or photographed textures (would need downloaded CC0 assets and Gal's OK). To resume: real tool models
(glTF), photographed wood textures + an HDRI, Cycles for the final, captions, and a "ייצוא לסרטון" button in the app
that downloads the scene JSON for a local render script.
