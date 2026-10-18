"""Deterministic, offline Little Prince art. Blender 5.2, metres, Z-up authoring.

Run: blender --background --python generators/blender/prince/build.py
The glTF exporter converts to Y-up. Recipes are the editable source; blend
snapshots are local recovery artifacts. No generated code or paid services.
"""
import bpy, bmesh, math, random, json, pathlib, hashlib, struct, sys
from mathutils import Vector

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / 'assets/optimized/showcase'
SOURCE = ROOT / 'assets/source/showcase/prince'
MAN = ROOT / 'assets/manifests/showcase'
for d in [OUT,SOURCE,MAN]: d.mkdir(parents=True,exist_ok=True)
random.seed(612)
bpy.context.preferences.edit.use_global_undo=False

def material(name,color,metal=0,rough=.7):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1); p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
    # Small baked pigment maps export as embedded PNGs. Pure procedural nodes
    # would silently disappear during glTF export.
    image=bpy.data.images.new(name+' baked pigment',width=64,height=64)
    pixels=[]
    for y in range(64):
        for x in range(64):
            woven='wool' in name or 'canvas' in name
            v=.90+.055*math.sin(x*.71+y*.39)+.07*random.random()
            if woven:v*=.90+.10*((x+y)%2)
            pixels.extend([min(1,c*v) for c in color]+[1])
    image.pixels=pixels;image.pack()
    tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
    m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
    if name in ['Ochre sand','Emerald wool coat','Aviator tobacco canvas','Weathered aluminum']:
        normal=bpy.data.images.new(name+' baked surface normal',width=64,height=64);normal.colorspace_settings.name='Non-Color'
        normal.pixels=[v for y in range(64) for x in range(64) for v in (.5+.065*math.sin(x*1.6+y*.5),.5+.065*math.cos(y*1.8+x*.3),.99,1)]
        normal.pack();nt=m.node_tree.nodes.new('ShaderNodeTexImage');nt.image=normal;nm=m.node_tree.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.35;m.node_tree.links.new(nt.outputs['Color'],nm.inputs['Color']);m.node_tree.links.new(nm.outputs['Normal'],p.inputs['Normal'])
    return m

def reset():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)

def uv(name,loc,scale,mat,segments=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=12,location=loc)
    o=bpy.context.object; o.name=name; o.scale=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(mat)
    for p in o.data.polygons:p.use_smooth=True
    return o

def cone(name,loc,r1,r2,depth,mat,vertices=24):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r1,radius2=r2,depth=depth,location=loc)
    o=bpy.context.object;o.name=name;o.data.materials.append(mat)
    for p in o.data.polygons:p.use_smooth=True
    bevel=o.modifiers.new('Soft tailored edges','BEVEL');bevel.width=.025;bevel.segments=2
    return o

def line(name,points,radius,mat):
    c=bpy.data.curves.new(name,'CURVE'); c.dimensions='3D';c.bevel_depth=radius;c.bevel_resolution=2
    s=c.splines.new('BEZIER');s.bezier_points.add(len(points)-1)
    for b,p in zip(s.bezier_points,points):b.co=p;b.handle_left_type='AUTO';b.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);o.data.materials.append(mat);return o

def cube(name,loc,scale,mat):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
    b=o.modifiers.new('Worn edge radius','BEVEL');b.width=.02;b.segments=2
    return o

def ring(name,loc,major,minor,mat):
    bpy.ops.mesh.primitive_torus_add(major_segments=28,minor_segments=8,location=loc,major_radius=major,minor_radius=minor)
    o=bpy.context.object;o.name=name;o.data.materials.append(mat)
    for p in o.data.polygons:p.use_smooth=True
    return o

def export(name):
    # Apply curve/bevel geometry before collecting accurate runtime counts.
    curves=[o for o in bpy.context.scene.objects if o.type=='CURVE']
    if curves:
        bpy.ops.object.select_all(action='DESELECT')
        for o in curves:o.select_set(True)
        bpy.context.view_layer.objects.active=curves[0];bpy.ops.object.convert(target='MESH');bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.context.scene.objects:
        if o.type=='MESH' and not o.data.uv_layers:
            uvmap=o.data.uv_layers.new(name='UVMap')
            for loop in o.data.loops:
                co=o.data.vertices[loop.vertex_index].co
                uvmap.data[loop.index].uv=(co.x*.25,co.y*.25+co.z*.13)
    if not any(o.type=='ARMATURE' for o in bpy.context.scene.objects):
        # One mesh per material keeps the full rose garden comfortably below
        # the draw-call budget without destroying PBR material boundaries.
        groups={}
        for o in list(bpy.context.scene.objects):
            if o.type=='MESH' and not o.animation_data:groups.setdefault(o.data.materials[0].name,[]).append(o)
        for objects in groups.values():
            bpy.ops.object.select_all(action='DESELECT')
            for o in objects:o.select_set(True)
            bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
    # Blender cannot calculate tangent space on n-gons (coat hems, crater
    # rims). Resolve non-rig modifiers and triangulate the serialized geometry
    # before export rather than relying on a runtime-specific tangent fallback.
    for o in bpy.context.scene.objects:
        if o.type!='MESH':continue
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
        for modifier in list(o.modifiers):
            if modifier.type!='ARMATURE':bpy.ops.object.modifier_apply(modifier=modifier.name)
        bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(name+'.blend')))
    path=OUT/(name+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_tangents=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_force_sampling=True,export_cameras=False,export_lights=False)
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    receipt={'version':1,'id':name,'seed':612,'generator':'Blender 5.2 fixed offline recipe','source':'generators/blender/prince/build.py','sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size,'meshes':len(meshes),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes),'warnings':[]}
    data=path.read_bytes();doc=json.loads(data[20:20+struct.unpack_from('<I',data,12)[0]])
    receipt['triangles']=sum(doc['accessors'][p['indices']]['count']//3 for m in doc['meshes'] for p in m['primitives'])
    receipt['primitives']=sum(len(m['primitives']) for m in doc['meshes'])
    receipt['clips']=[a['name'] for a in doc.get('animations',[])]
    (MAN/(name+'.json')).write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf8')

skin=material('Warm porcelain skin',(.86,.58,.36));gold=material('Honey gold locks',(.95,.60,.08),.08,.38)
green=material('Emerald wool coat',(.095,.29,.19));red=material('Crimson silk scarf',(.65,.045,.025),0,.35)
dark=material('Ink eyes and leather',(.035,.025,.02));white=material('Warm ivory',(.9,.86,.67));sand=material('Ochre sand',(.60,.34,.13));rose=material('Carmine petals',(.7,.025,.07),0,.36)
leaf=material('Leaf green',(.16,.29,.08));orange=material('Fox russet fur',(.65,.19,.035));metal=material('Weathered aluminum',(.38,.43,.40),.65,.5)

def actor(pilot=False):
    random.seed(613 if pilot else 612);reset(); parts=[]
    coat=material('Aviator tobacco canvas',(.26,.17,.085)) if pilot else green
    for side in [-1,1]:
        parts.append(uv('Boot',(.13*side,-.055,.12),(.105,.19,.12),dark))
        parts.append(uv('Trouser',(.12*side,0,.40),(.09,.09,.25),coat))
    parts.append(cone('Tailored double breasted coat',(0,0,.78),.25,.17,.52,coat))
    for side in [-1,1]:
        a=uv('Sleeve',(.25*side,0,.85),(.075,.09,.24),coat);a.rotation_euler[1]=side*-.14;parts.append(a)
        parts.append(uv('Hand',(.28*side,-.015,.64),(.065,.06,.085),skin))
    parts.append(uv('Neck',(0,0,1.10),(.07,.065,.10),skin))
    parts.append(uv('Face',(0,-.015,1.32),(.185,.15,.23),skin,32))
    for s in [-1,1]:
        parts.append(uv('Ear',(.182*s,0,1.32),(.035,.025,.06),skin))
        parts.append(uv('Eye',(.065*s,-.158,1.35),(.018,.012,.027),dark))
        parts.append(line('Upper eyelid',[(.065*s-.025,-.163,1.365),(.065*s,-.17,1.382),(.065*s+.025,-.163,1.365)],.005,skin))
    parts.append(uv('Nose',(0,-.17,1.30),(.025,.04,.038),skin))
    parts.append(line('Small smile',[(-.034,-.151,1.245),(0,-.162,1.236),(.034,-.151,1.245)],.004,dark))
    for i in range(19):
        t=i*2.399;z=1.51+random.uniform(-.015,.045);r=.145
        o=uv('Sculpted golden lock' if not pilot else 'Leather flying cap',(r*math.cos(t),r*math.sin(t),z),(.075,.055,.085),gold if not pilot else dark)
        o.rotation_euler=(random.uniform(-.6,.6),random.uniform(-.6,.6),t);parts.append(o)
    for z in [.68,.81,.94]:parts.append(uv('Brass coat button',(.06,-.187,z),(.014,.012,.014),gold))
    parts.append(line('Scarf collar',[(-.11,-.04,1.09),(0,-.12,1.075),(.11,-.04,1.09),(0,.08,1.10),(-.11,-.04,1.09)],.04,red))
    # Ribbon is an actual softly billowing surface, not a capsule.
    verts=[];faces=[]
    for i in range(17):
        t=i/16; x=.1+t*.68;y=.07+math.sin(t*7)*.07;z=1.08+math.sin(t*4)*.12
        verts.extend([(x,y,z-.055),(x,y,z+.055)])
        if i:faces.append((2*i-2,2*i-1,2*i+1,2*i))
    me=bpy.data.meshes.new('Silk ribbon');me.from_pydata(verts,[],faces);ob=bpy.data.objects.new('Flowing scarf',me);bpy.context.collection.objects.link(ob);ob.data.materials.append(red);parts.append(ob)
    # A small genuine deformation rig, with separately weighted limbs.
    arm=bpy.data.armatures.new('Character skeleton');rig=bpy.data.objects.new('PrinceRig' if not pilot else 'PilotRig',arm);bpy.context.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    for n,head,tail in [('Root',(0,0,0),(0,0,.5)),('Body',(0,0,.5),(0,0,1.1)),('Head',(0,0,1.1),(0,0,1.6)),('LeftLeg',(-.12,0,.55),(-.12,0,.1)),('RightLeg',(.12,0,.55),(.12,0,.1)),('LeftArm',(-.2,0,1),(-.28,0,.65)),('RightArm',(.2,0,1),(.28,0,.65))]:
        b=arm.edit_bones.new(n);b.head=head;b.tail=tail
        if n!='Root':b.parent=arm.edit_bones['Root']
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in parts:
        if o.type=='CURVE':bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False)
        bone='Head' if o.location.z>1.15 else 'Body'
        if o.name.startswith(('Boot','Trouser')):bone='LeftLeg' if o.location.x<0 else 'RightLeg'
        if o.name.startswith(('Sleeve','Hand')):bone='LeftArm' if o.location.x<0 else 'RightArm'
        g=o.vertex_groups.new(name=bone);g.add(list(range(len(o.data.vertices))),1,'REPLACE');m=o.modifiers.new('Character deformation','ARMATURE');m.object=rig
        # Keep skinned meshes at the glTF scene root. Their geometry is in the
        # rig bind space; parenting under the armature causes validator warnings
        # and ambiguous inherited transforms in downstream engines.
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    for clip in ['Idle','Walk','Interact']:
        rig.animation_data_create();action=bpy.data.actions.new(clip);rig.animation_data.action=action
        for f in [1,9,17,25,33]:
            phase=(f-1)/32*math.tau
            for b in rig.pose.bones:
                b.rotation_mode='XYZ';b.rotation_euler=(0,0,0)
                if clip=='Walk' and 'Leg' in b.name:b.rotation_euler.x=math.sin(phase)*.43*(-1 if b.name.startswith('Left') else 1)
                if clip=='Walk' and 'Arm' in b.name:b.rotation_euler.x=math.sin(phase)*.3*(1 if b.name.startswith('Left') else -1)
                if clip=='Idle' and b.name=='Head':b.rotation_euler.y=math.sin(phase)*.05
                if clip=='Interact' and b.name=='RightArm':b.rotation_euler.y=-.65*math.sin(phase/2)
                b.keyframe_insert('rotation_euler',frame=f)
        track=rig.animation_data.nla_tracks.new();track.name=clip;track.strips.new(clip,1,action);rig.animation_data.action=None
    # Blender front is -Y; exporter maps -Y to +Z.
    export('prince-pilot' if pilot else 'prince-character')

def flower(loc,scale=1):
    x,y,z=loc;line('Rose stem',[(x,y,z),(x+.02,y,z+.35*scale)],.012*scale,leaf)
    for i in range(7):
        a=i*math.tau/7;o=uv('Velvet rose petal',(x+math.cos(a)*.05*scale,y+math.sin(a)*.05*scale,z+.36*scale),(.06*scale,.04*scale,.06*scale),rose,12);o.rotation_euler=(.4*math.sin(a),.4*math.cos(a),a)

def fox():
    reset();uv('Supple fox body',(0,.05,.38),(.21,.4,.24),orange)
    uv('Fox chest',(0,-.18,.45),(.18,.19,.25),white);uv('Fox head',(0,-.3,.65),(.2,.18,.18),orange)
    uv('Long pale muzzle',(0,-.48,.59),(.11,.17,.075),white);uv('Nose',(0,-.62,.61),(.045,.04,.03),dark)
    for s in [-1,1]:
        o=cone('Pointed listening ear',(.13*s,-.28,.88),.095,0,.29,orange,12);o.rotation_euler[1]=s*-.2
        uv('Ear velvet',(.13*s,-.335,.87),(.045,.012,.085),dark)
        uv('Bright fox eye',(.15*s,-.43,.69),(.023,.015,.025),dark)
        for y in [-.18,.28]:uv('Fox leg',(.14*s,y,.17),(.055,.065,.19),orange)
    line('Sweeping bushy tail',[(0,.3,.4),(.2,.6,.4),(.45,.75,.28),(.6,.65,.21)],.13,orange)
    uv('White tail brush',(.61,.65,.22),(.17,.11,.10),white)
    for o in bpy.context.scene.objects:
        if not (o.name.startswith('Pointed listening ear') or o.name.startswith('Sweeping bushy tail') or o.name.startswith('Supple fox body')):continue
        o.animation_data_create();action=bpy.data.actions.new('Fox attentive idle');o.animation_data.action=action
        initial=o.rotation_euler.copy()
        for f in [1,17,33,49,65]:
            phase=(f-1)/64*math.tau;o.rotation_euler=initial.copy();o.rotation_euler[2]+=.05*math.sin(phase)
            o.scale.z=1+.018*math.sin(phase);o.keyframe_insert('rotation_euler',frame=f);o.keyframe_insert('scale',frame=f)
        t=o.animation_data.nla_tracks.new();t.name='Idle';t.strips.new('Idle',1,action);o.animation_data.action=None
    export('prince-fox')

def terrain(kind):
    random.seed({'b612':614,'desert':615,'earth':616}[kind]);reset()
    if kind=='b612':
        uv('B612 continuous spherical ground',(0,0,0),(6,6,6),sand,96)
        for i,(x,y) in enumerate([(-1.6,-.8),(1.6,-.7),(.6,1.7)]):
            z=math.sqrt(36-x*x-y*y);cone('Dormant volcano' if i==2 else 'Active volcano',(x,y,z+.22),.52,.23,.75,sand)
            uv('Dark volcanic crater',(x,y,z+.60),(.225,.225,.035),dark)
            rim=material('Volcanic weathered ochre '+str(i),(.32,.16,.07));ring('Worn crater lip',(x,y,z+.59),.23,.055,rim)
            if i<2:
                lava=material('Glowing basalt lava '+str(i),(.95,.14,.015));p=lava.node_tree.nodes.get('Principled BSDF');p.inputs['Emission Color'].default_value=(1,.12,.005,1);p.inputs['Emission Strength'].default_value=2
                uv('Amber lava',(x,y,z+.625),(.14,.14,.012),lava)
                for j in range(4):uv('Soft volcanic vapour',(x+.04*j,y,z+.9+j*.18),(.07+j*.018,.07+j*.018,.11),white,12)
        flower((0,0,6.02),1.4)
        glass=material('Rose protective glass',(.72,.88,.98),0,.08);p=glass.node_tree.nodes.get('Principled BSDF');p.inputs['Transmission Weight'].default_value=.85;p.inputs['Alpha'].default_value=.24;glass.diffuse_color=(.72,.88,.98,.24)
        uv('Crystal rose globe',(0,0,6.4),(.32,.32,.49),glass,32)
        for x,y in [(-2,.9),(1.9,1.3)]:
            z=math.sqrt(36-x*x-y*y);line('Baobab sapling',[(x,y,z),(x,y,z+.45),(x+.14,y,z+.6)],.035,leaf);uv('Sapling leaves',(x+.14,y,z+.61),(.2,.13,.08),leaf)
        # A little wooden sunset chair, with four legs and separate slats.
        for x in [1.25,1.65]:
            for y in [.8,1.2]:cube('Sunset chair leg',(x,y,5.98),(.045,.045,.42),sand)
        for y in [.84,.97,1.10]:cube('Sunset chair seat slat',(1.45,y,6.20),(.5,.10,.035),gold)
        for z in [6.42,6.56]:cube('Sunset chair backrest',(1.45,1.19,z),(.5,.035,.10),gold)
        for x in [1.25,1.65]:cube('Sunset chair upright',(x,1.19,6.39),(.04,.04,.5),sand)
        crater=material('Crater mineral rings',(.43,.235,.10))
        for i in range(24):
            direction=Vector((random.uniform(-1,1),random.uniform(-1,1),random.uniform(-1,1))).normalized();r=random.uniform(.13,.3)
            o=ring('Ancient shallow meteor crater',direction*5.995,r,.018,crater);o.rotation_euler=Vector((0,0,1)).rotation_difference(direction).to_euler()
        sunset=material('Distant sunset gold',(1,.35,.055));sp=sunset.node_tree.nodes.get('Principled BSDF');sp.inputs['Emission Color'].default_value=(1,.22,.025,1);sp.inputs['Emission Strength'].default_value=1.5
        uv('Distant setting sun',(-13,8,3),(1.65,1.65,1.65),sunset,32)
        # Crater dimples and mineral stones follow the same sphere, never float.
        for i in range(90):
            v=Vector((random.uniform(-1,1),random.uniform(-1,1),random.uniform(-1,1))).normalized()*6
            uv('Planet mineral',v,(.05,.07,.035),sand,8)
    else:
        size=22;n=128 if kind=='desert' else 64;verts=[];faces=[]
        for j in range(n+1):
            y=(j/n-.5)*size
            for i in range(n+1):
                x=(i/n-.5)*size;edge=min(1,max(0,(math.hypot(x,y)-3)/4));z=edge*(.35*math.sin(x*.7+y*.22)+.23*math.sin(y*.8)+.12*math.cos(x*1.2))
                if kind=='desert':z+=edge*.018*math.sin(x*14+y*2+math.sin(y))
                verts.append((x,y,z-.08))
                if i and j:a=j*(n+1)+i;faces.append((a,a-1,a-n-2,a-n-1))
        me=bpy.data.meshes.new('Sculpted dune field');me.from_pydata(verts,[],faces);o=bpy.data.objects.new('Sculpted dunes' if kind=='desert' else 'Earth meadow',me);bpy.context.collection.objects.link(o);o.data.materials.append(sand if kind=='desert' else leaf)
        for p in me.polygons:p.use_smooth=True
        if kind=='desert':
            # Vintage monoplane with tapered fuselage, cockpit and broken wing.
            uv('Tapered vintage fuselage',(-3,1,.65),(.55,1.7,.48),metal,32)
            uv('Open dark cockpit',(-3,.65,1.02),(.3,.42,.12),dark)
            windshield=material('Blue cockpit windshield',(.23,.47,.53),.35,.2)
            uv('Raised cockpit windshield',(-3,.21,1.04),(.31,.06,.26),windshield)
            line('Windshield metal frame',[(-3.31,.21,1.02),(-3.24,.21,1.24),(-3,.21,1.3),(-2.76,.21,1.24),(-2.69,.21,1.02)],.018,metal)
            uv('Padded pilot seat',(-3,.82,1.07),(.22,.1,.17),red)
            wing=uv('Broad tapered left wing',(-4.4,.7,.6),(1.8,.55,.08),metal);wing.rotation_euler[1]=.08
            uv('Broken right wing',(-1.6,1.8,.22),(1.1,.4,.08),metal).rotation_euler[2]=-.4
            uv('Tail fin',(-3,2.3,.9),(.06,.45,.65),metal)
            for s in [-1,1]:uv('Landing wheel',(-3+.5*s,-.1,.24),(.12,.24,.24),dark)
            for s in [-1,1]:uv('Single propeller blade',(-3,-.8,.65+s*.45),(.07,.05,.48),dark)
            uv('Propeller brass hub',(-3,-.94,.65),(.12,.15,.12),gold)
            # Cowling seams, exhaust cylinders and visible rivets identify a
            # damaged vintage single-prop aircraft at walking distance.
            for y in [-.52,-.22,1.35]:
                o=ring('Fuselage panel seam',(-3,y,.65),.46,.012,dark);o.rotation_euler[0]=math.pi/2
            for i in range(12):
                a=i*math.tau/12;uv('Cowling rivet',(-3+math.cos(a)*.44,-.54,.65+math.sin(a)*.4),(.018,.018,.018),gold,8)
            for s in [-1,1]:
                for y in [-.3,-.1,.1]:line('Engine exhaust pipe',[(-3+s*.45,y,.6),(-3+s*.63,y,.5)],.03,dark)
            for i in range(160):
                x=random.uniform(-9,9);y=random.uniform(-9,9)
                if math.hypot(x,y)>3.5:
                    z=min(1,max(0,(math.hypot(x,y)-3)/4))*(.35*math.sin(x*.7+y*.22)+.23*math.sin(y*.8)+.12*math.cos(x*1.2))-.05
                    uv('Desert stone',(x,y,z),(.06,.09,.04),sand,8)
        else:
            soil=material('Rose garden earth',(.22,.12,.065));pathmat=material('Garden gravel path',(.55,.43,.26))
            uv('Rose bed soil',(-1.8,1,-.02),(2.1,2.5,.06),soil,32)
            for i in range(44):
                a=i*math.tau/44;uv('Garden bed stone edging',(-1.8+2.1*math.cos(a),1+2.5*math.sin(a),.04),(.10,.12,.08),sand,8)
            for i in range(80):flower((random.uniform(-3.5,-.2),random.uniform(-1,3),0),random.uniform(.65,1.2))
            for i in range(200):
                x=random.uniform(2,5);y=random.uniform(0,4);line('Golden wheat',[(x,y,0),(x+.03,y,.55)],.008,gold);uv('Wheat ear',(x+.03,y,.59),(.025,.025,.09),gold,8)
            # Thousands of tapered grass blades share one mesh and one material.
            grassverts=[];grassfaces=[]
            for i in range(2200):
                x=random.uniform(-9,9);y=random.uniform(-9,9)
                if -4<x<.3 and -1.5<y<3.8:continue
                if abs(x)<.7 and y<1:continue
                edge=min(1,max(0,(math.hypot(x,y)-3)/4));z=edge*(.35*math.sin(x*.7+y*.22)+.23*math.sin(y*.8)+.12*math.cos(x*1.2))-.06
                h=random.uniform(.12,.34);a=random.random()*math.tau;dx=math.cos(a)*.025;dy=math.sin(a)*.025;v=len(grassverts)
                grassverts.extend([(x-dx,y-dy,z),(x+dx,y+dy,z),(x+.06,y+.02,z+h)]);grassfaces.append((v,v+1,v+2))
            gm=bpy.data.meshes.new('Tapered meadow blades');gm.from_pydata(grassverts,[],grassfaces);go=bpy.data.objects.new('Meadow grass',gm);bpy.context.collection.objects.link(go);go.data.materials.append(leaf)
            for i in range(9):uv('Stepping stone',(random.uniform(-.2,.2),-4+i*.48,-.02),(.4,.27,.05),pathmat,12)
            line('Apple tree trunk',[(4,-2,0),(4,-2,1.3),(3.7,-2,2.3)],.15,sand)
            for i in range(12):
                x=4+random.uniform(-.8,.8);y=-2+random.uniform(-.6,.6);z=random.uniform(1.8,2.7);uv('Apple canopy',(x,y,z),(.55,.45,.4),leaf,12);uv('Red apple',(x,y-.35,z-.2),(.08,.08,.08),rose,12)
    export('prince-'+kind)

targets=set(sys.argv[sys.argv.index('--')+1:]) if '--' in sys.argv else {'character','pilot','fox','desert','b612','earth'}
if 'character' in targets:actor()
if 'pilot' in targets:actor(True)
if 'fox' in targets:fox()
for kind in ['desert','b612','earth']:
    if kind in targets:terrain(kind)
print('PRINCE_BUILD_COMPLETE')
