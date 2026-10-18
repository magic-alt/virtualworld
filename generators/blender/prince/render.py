"""Local visual review renders; no changes to exported runtime geometry."""
import bpy, pathlib, math
from mathutils import Vector
root=pathlib.Path(__file__).resolve().parents[3]
out=root/'assets/source/showcase/prince'
for name,position,target in [('character',(2.3,-4,2.1),(0,0,.8)),('b612',(11,-15,11),(0,0,1)),('desert',(11,-13,9),(-1,0,0)),('earth',(10,-13,10),(0,0,.5)),('fox',(2,-3,1.7),(0,0,.4))]:
    bpy.ops.wm.open_mainfile(filepath=str(out/('prince-'+name+'.blend')))
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
    scene.render.resolution_x=960;scene.render.resolution_y=720;scene.render.resolution_percentage=100
    scene.world.color=(.28,.28,.28)
    bpy.ops.object.camera_add(location=position);camera=bpy.context.object;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();scene.camera=camera;camera.data.lens=48
    for loc,power,size in [((4,-6,10),1800,7),((-4,-1,5),900,5)]:
        bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(Vector(target)-light.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(out/(name+'-review.png'));bpy.ops.render.render(write_still=True)
