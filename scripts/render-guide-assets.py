"""Render bundled guide images from MB-Lab assets, without executing its add-on.

Development only: Blender 4.3.2. See docs/GUIDE_ASSETS.md for pinned sources,
their license, checksums, and the packaging command. Never used by the app.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    args.output_dir.mkdir(parents=True, exist_ok=True)
    sources = json.loads((Path(__file__).parent / "guide-sources.json").read_text())
    for filename, source in sources["files"].items():
        actual = hashlib.sha256((args.source_dir / filename).read_bytes()).hexdigest()
        if actual != source["sha256"]:
            raise ValueError(f"Source checksum mismatch: {filename}")

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    with bpy.data.libraries.load(str(args.source_dir / "mblab-library.blend"), link=False) as (available, loaded):
        loaded.objects = ["MBLab_anime_female"]
    model = loaded.objects[0]
    bpy.context.collection.objects.link(model)
    weights = json.loads((args.source_dir / "anime-female-weights.json").read_text())
    joints = json.loads((args.source_dir / "anime-female-joints.json").read_text())
    original = [vertex.co.copy() for vertex in model.data.vertices]

    # Lower the arms using the asset's existing joint positions and skin weights.
    # Head, face, neck, and shoulder shapes come from the downloaded mesh.
    for side in ("L", "R"):
        indices = joints[f"upperarm_{side}_head"]
        pivot = sum((original[index] for index in indices), Vector()) / len(indices)
        arm_weights = [0.0] * len(original)
        for name, items in weights.items():
            if name.endswith(f"_{side}") and any(part in name for part in ("arm", "hand", "thumb", "index", "middle", "ring", "pinky")):
                for index, weight in items:
                    arm_weights[index] += weight
        rotation = Matrix.Rotation(math.radians(65 if side == "L" else -65), 4, "Y")
        for index, weight in enumerate(arm_weights):
            if weight:
                posed = pivot + rotation @ (original[index] - pivot)
                model.data.vertices[index].co = original[index].lerp(posed, min(weight, 1.0))

    # Keep only the head, neck, shoulders, and upper chest.
    mesh = bmesh.new()
    mesh.from_mesh(model.data)
    bmesh.ops.bisect_plane(mesh, geom=list(mesh.verts) + list(mesh.edges) + list(mesh.faces), dist=0.00001, plane_co=(0, 0, 1.32), plane_no=(0, 0, 1), clear_inner=True, clear_outer=False)
    mesh.to_mesh(model.data)
    mesh.free()
    for polygon in model.data.polygons:
        polygon.use_smooth = True
    subdivision = model.modifiers.new("Smooth contour", "SUBSURF")
    subdivision.levels = subdivision.render_levels = 1

    for index, grey in enumerate((0.12, 0.6, 0.6, 0.75)):
        material = bpy.data.materials.new(f"Guide grey {index}")
        material.use_nodes = True
        shader = material.node_tree.nodes.get("Principled BSDF")
        shader.inputs["Base Color"].default_value = (grey, grey, grey, 1)
        shader.inputs["Roughness"].default_value = 0.8
        if index == 3:
            texture = material.node_tree.nodes.new("ShaderNodeTexImage")
            texture.image = bpy.data.images.load(str(args.source_dir / "anime-female-albedo.png"))
            saturation = material.node_tree.nodes.new("ShaderNodeHueSaturation")
            saturation.inputs["Saturation"].default_value = 0
            material.node_tree.links.new(texture.outputs["Color"], saturation.inputs["Color"])
            material.node_tree.links.new(saturation.outputs["Color"], shader.inputs["Base Color"])
        model.data.materials[index] = material

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 256
    scene.cycles.use_denoising = False
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 6
    scene.render.resolution_x = scene.render.resolution_y = 960
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.35
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = -0.9
    target = Vector((0, -0.025, 1.505))
    for location, power in (((-1.5, -2, 3), 55), ((1.5, -1, 2), 18)):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.data.energy = power
        light.data.shape = "DISK"
        light.data.size = 2
        light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()

    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.lens = 90
    scene.camera = camera
    scene.render.use_freestyle = True
    lines = bpy.context.view_layer.freestyle_settings.linesets[0]
    lines.select_crease = False
    lines.select_material_boundary = True
    lines.linestyle.color = (0.18, 0.18, 0.18)
    lines.linestyle.thickness = 1.7
    for name, degrees in (("front", 0), ("profile-right", -90), ("three-quarter-right", -45)):
        angle = math.radians(degrees)
        camera.location = (1.32 * math.sin(angle), -1.32 * math.cos(angle) - 0.025, 1.505)
        camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(args.output_dir / f"guide-{name}.png")
        bpy.ops.render.render(write_still=True)


main()
