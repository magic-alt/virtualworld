import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/source/showcase/harmonic/harmonic-joint.blend'))
replaced={o.get('sectionOf') for o in bpy.context.scene.objects if o.get('sectionOf')}
for o in bpy.context.scene.objects:
    if o.name in replaced:o.hide_render=True
    if o.get('sectionOf'):o.hide_render=False
# Show wave deformation at zero input phase; section mesh remains physically positioned.
flex=bpy.data.objects['flex-cup'];flex.data.shape_keys.key_blocks['WaveCos'].value=1;flex.data.shape_keys.key_blocks['WaveSin'].value=0
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32
scene.world.color=(.16,.16,.16)
for location,power,size in [((.25,.10,.38),35,.25),((-.20,.18,.20),25,.2),((.03,-.2,.28),25,.2)]:
    bpy.ops.object.light_add(type='AREA',location=location);o=bpy.context.object;o.data.energy=power*.12;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,.08))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(.28,.34,.28));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,.085))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=.29;scene.camera=camera
scene.render.resolution_x=1000;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.render.filepath=str(ROOT/'assets/source/showcase/harmonic/section-preview.png');bpy.ops.render.render(write_still=True)
