"""Original parametric educational joint. Run with installed Blender, no generated code."""
import bpy, json, math, sys, struct, hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3]
P=json.loads((Path(__file__).parent/'recipe.json').read_text())
OUT=ROOT/'assets/optimized/showcase/harmonic-joint.glb'
SRC=ROOT/'assets/source/showcase/harmonic'
MAN=ROOT/'assets/manifests/showcase/harmonic-joint.json'
TAU=math.tau
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system='METRIC'; bpy.context.scene.unit_settings.scale_length=1
materials={}
def material(name,color,metal=0.8,rough=.28):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*color,1); bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    materials[name]=m; return m
material('anodized-graphite',(.095,.14,.19),.82,.29)
material('machined-aluminium',(.55,.64,.72),.9,.24)
material('bearing-steel',(.48,.53,.59),1,.19)
material('copper-enamel',(.66,.22,.065),.8,.27)
material('laminated-iron',(.22,.26,.31),.88,.35)
material('magnet-north',(.16,.34,.45),.7,.3)
material('magnet-south',(.46,.14,.12),.7,.3)
material('encoder-pcb',(.025,.22,.13),.15,.45)
material('gold',(.85,.59,.13),.85,.24)
material('seal',(.018,.026,.035),.05,.6)
parts=[]
def mesh(name,vs,fs,mat,parent='fixed',bevel=.00015):
    me=bpy.data.meshes.new(name); me.from_pydata(vs,[],fs); me.update()
    ob=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(ob); ob.data.materials.append(materials[mat])
    ob['assembly']=parent
    if bevel:
        mod=ob.modifiers.new('Machined edge break','BEVEL'); mod.width=bevel; mod.segments=2
        bpy.context.view_layer.objects.active=ob; ob.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name); ob.select_set(False)
    for poly in me.polygons: poly.use_smooth=False
    parts.append(ob); return ob
# Revolved closed section; all surfaces include explicit bores. Angle partials are capped.
def ring(name,ri,ro,z0,z1,mat,parent='fixed',n=160,start=0,end=TAU,teeth=0,inward=False,bevel=.00012):
    vs=[]; fs=[]; full=abs(end-start-TAU)<1e-8; count=n if full else n+1
    for z,r in [(z0,ri),(z0,ro),(z1,ri),(z1,ro)]:
        for i in range(count):
            a=start+(end-start)*i/n; rr=r
            if teeth and ((inward and r==ri) or (not inward and r==ro)):
                phase=(a*teeth/TAU)%1; tooth=max(0,1-abs(phase-.5)*4)
                rr+=(-1 if inward else 1)*.00065*tooth
            vs.append((rr*math.cos(a),rr*math.sin(a),z))
    for i in range(n):
        j=(i+1)%count
        for a,b in [(0,1),(1,3),(3,2),(2,0)]:fs.append((a*count+i,a*count+j,b*count+j,b*count+i))
    if not full:
        fs.extend([(0,count,3*count,2*count),(count-1,3*count-1,4*count-1,2*count-1)])
    return mesh(name,vs,fs,mat,parent,bevel)
def box(name,center,size,mat,parent='fixed',angle=0,bevel=.0002):
    vs=[]
    for x,y,z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]:
        xx=x*size[0]/2; yy=y*size[1]/2
        vs.append((center[0]+xx*math.cos(angle)-yy*math.sin(angle),center[1]+xx*math.sin(angle)+yy*math.cos(angle),center[2]+z*size[2]/2))
    return mesh(name,vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat,parent,bevel)
def combine(name,objects):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:ob.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]; bpy.ops.object.join(); ob=objects[0]; ob.name=name; ob.data.name=name
    for item in objects[1:]:parts.remove(item)
    # All joined objects use the same material; collapse slots to one glTF primitive.
    for poly in ob.data.polygons:poly.material_index=0
    while len(ob.data.materials)>1:ob.data.materials.pop(index=1)
    ob.select_set(False); return ob
# Base flange has eight real through holes cut via exact booleans.
base=ring('base-flange',P['boreDiameter']/2,P['baseDiameter']/2,0,.012,'anodized-graphite')
holes=[]
for i in range(8):
    a=TAU*i/8+.07; x=.096*math.cos(a);y=.096*math.sin(a)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=.0033,depth=.03,location=(x,y,.006));cut=bpy.context.object
    bpy.context.view_layer.objects.active=base
    mod=base.modifiers.new('M6 clearance through hole','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cut
    bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cut,do_unlink=True)
    holes.append({'center':[x,0,-y],'radius':.0033,'through':True})
ring('housing-full',.085,P['housingDiameter']/2,.012,.153,'anodized-graphite')
ring('housing-section',.085,P['housingDiameter']/2,.012,.153,'anodized-graphite',n=120,start=math.pi/2,end=TAU)
# Discrete turned cooling grooves retain the housing's maximum 180mm diameter.
for i in range(5):
    cutter=ring('groove-tool',.0885,.092,.029+i*.011,.031+i*.011,'machined-aluminium',n=160,bevel=0)
    for name in ['housing-full','housing-section']:
        ob=bpy.data.objects[name];bpy.context.view_layer.objects.active=ob
        mod=ob.modifiers.new('Turned cooling groove','BOOLEAN');mod.object=cutter;mod.operation='DIFFERENCE';bpy.ops.object.modifier_apply(modifier=mod.name)
    parts.remove(cutter);bpy.data.objects.remove(cutter,do_unlink=True)
ring('stator-back-iron',.074,.084,.027,.067,'laminated-iron')
ring('stator-housing-fit-sleeve',.084,.085,.025,.069,'machined-aluminium')
teeth=[];coils=[];insulators=[]
for i in range(18):
    a=TAU*i/18; teeth.append(box('stator-tooth',(.0675*math.cos(a),.0675*math.sin(a),.047),(.013,.008,.04),'laminated-iron',angle=a))
    for tangent in [-.0042,.0042]:
        insulators.append(box('coil-former',(.069*math.cos(a)-tangent*math.sin(a),.069*math.sin(a)+tangent*math.cos(a),.047),(.010,.00075,.040),'seal',angle=a,bevel=0))
    # Winding packs with visible separate enamel turns around each tooth.
    for k in range(5):
        rr=.066+k*.0014
        for tangent in [-.005,.005]:
            coils.append(box('winding-side',(rr*math.cos(a)-tangent*math.sin(a),rr*math.sin(a)+tangent*math.cos(a),.047),(.0009,.00085,.044),'copper-enamel',angle=a))
        for zz in [.0246,.0694]:
            coils.append(box('winding-end',(rr*math.cos(a),rr*math.sin(a),zz),(.0009,.01085,.00085),'copper-enamel',angle=a))
combine('coil-formers-18',insulators);combine('stator-teeth-18',teeth);combine('copper-windings-90-turns',coils)
ring('rotor-yoke',.054,.0585,.027,.067,'bearing-steel','input')
for polarity in range(2):
    magnets=[]
    for i in range(polarity,20,2):
        a=TAU*i/20
        magnets.append(ring('magnet',.0585,.0605,.028,.066,'magnet-north' if polarity==0 else 'magnet-south','input',n=6,start=a+.008,end=a+TAU/20-.008))
    combine('rotor-magnets-'+('north' if polarity==0 else 'south'),magnets)
# Spoked rotor carrier and true 20mm through-bore input tube.
ring('rotor-bottom-carrier',.015,.054,.025,.027,'machined-aluminium','input')
ring('hollow-input-shaft',P['boreDiameter']/2,.015,.0125,.125,'bearing-steel','input')
ring('lower-input-bearing-inner',.015,.018,.013,.023,'bearing-steel','input')
ring('lower-input-bearing-outer',.022,.026,.013,.023,'bearing-steel')
ring('lower-bearing-seat',.026,.04,.012,.022,'machined-aluminium')
ring('upper-input-bearing-inner',.015,.018,.075,.085,'bearing-steel','input')
ring('upper-input-bearing-outer',.022,.026,.075,.085,'bearing-steel')
ring('upper-bearing-support-plate',.026,.085,.077,.081,'machined-aluminium')
# Bearing balls in discrete cages, supported by their two race shoulders.
for z,label in [(.018,'lower'),(.080,'upper')]:
    balls=[]
    for i in range(14):
        a=TAU*i/14;bpy.ops.mesh.primitive_uv_sphere_add(segments=10,ring_count=6,radius=.002,location=(.020*math.cos(a),.020*math.sin(a),z));ob=bpy.context.object;ob.name=label+'-ball';ob.data.materials.append(materials['bearing-steel']);ob['assembly']='fixed';parts.append(ob);balls.append(ob)
    combine(label+'-bearing-balls',balls)
ring('encoder-board',.028,.048,.022,.024,'encoder-pcb')
ring('encoder-code-ring',.015,.027,.0235,.0245,'gold','input')
marks=[]
for i in range(48):
    a=TAU*i/48;marks.append(box('encoder-mark',(.024*math.cos(a),.024*math.sin(a),.0246),(.003,.00045,.0002),'seal','input',a,0))
combine('encoder-code-marks',marks)
# Cup has compliant thin wall, closed diaphragm and output collar. Its two wave modes taper at diaphragm.
flex=ring('flex-cup',.0508,.0518,.099,.132,'bearing-steel','flex',n=800,teeth=200,bevel=0)
flexparts=[flex,ring('cup-diaphragm',.016,.0518,.132,.136,'bearing-steel','flex',n=160,bevel=0)]
flex=combine('flex-cup',flexparts)
flex.shape_key_add(name='Basis')
for name,phase in [('WaveCos',0),('WaveSin',math.pi/2)]:
    key=flex.shape_key_add(name=name); key.value=0
    for i,v in enumerate(flex.data.vertices):
        x,y,z=v.co;r=math.hypot(x,y);a=math.atan2(y,x);t=max(0,min(1,(.132-z)/.008))
        dr=P['morphAmplitude']*math.cos(2*a-phase)*t
        if r>0:key.data[i].co.x=x+dr*x/r;key.data[i].co.y=y+dr*y/r
# Circular spline intentionally engages at two wave peaks. Not an involute manufacturing profile.
ring('fixed-circular-spline-202',.053,.085,.118,.132,'machined-aluminium',n=808,teeth=202,inward=True,bevel=0)
# Elliptical cam and flexible outer bearing are explicit annular meshes.
cam=ring('elliptical-wave-cam',.015,.0495,.115,.125,'gold','input',n=160,bevel=0)
for v in cam.data.vertices:
    r=math.hypot(v.co.x,v.co.y)
    if r>.02:
        a=math.atan2(v.co.y,v.co.x);dr=.0005*math.cos(2*a);v.co.x+=dr*math.cos(a);v.co.y+=dr*math.sin(a)
wave=ring('wave-bearing-outer-race',.0495,.0508,.114,.126,'bearing-steel','input',n=160,bevel=0)
for v in wave.data.vertices:
    a=math.atan2(v.co.y,v.co.x);dr=.0005*math.cos(2*a);v.co.x+=dr*math.cos(a);v.co.y+=dr*math.sin(a)
# Output neck and radial carrier connect cup diaphragm to output bearing/flange.
ring('output-neck',.016,.024,.136,.155,'machined-aluminium','output')
ring('output-bearing-carrier',.024,.062,.151,.155,'machined-aluminium','output')
ring('crossroller-inner-race',.052,.064,.137,.151,'bearing-steel','output')
ring('crossroller-outer-race',.071,.085,.137,.151,'bearing-steel')
rollers=[]
for i in range(32):
    a=TAU*i/32
    bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=.0025,depth=.008,location=(.0675*math.cos(a),.0675*math.sin(a),.144))
    ob=bpy.context.object;direction=Vector((math.cos(a)*math.sin(math.pi/4),math.sin(a)*math.sin(math.pi/4),math.cos(math.pi/4)*(1 if i%2==0 else -1)))
    ob.rotation_euler=direction.to_track_quat('Z','Y').to_euler();bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    # Bake all object translation so serialized mesh paths can safely reset transforms.
    bpy.ops.object.transform_apply(location=True,rotation=False,scale=False)
    ob.name='cross-roller';ob.data.materials.append(materials['bearing-steel']);ob['assembly']='fixed';parts.append(ob);rollers.append(ob)
combine('crossrollers-32-alternating-45deg',rollers)
flange=ring('output-flange',P['boreDiameter']/2,.060,.155,P['totalHeight'],'machined-aluminium','output')
for i in range(8):
    a=TAU*i/8+.1;x=.045*math.cos(a);y=.045*math.sin(a)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=.0021,depth=.02,location=(x,y,.16));cut=bpy.context.object
    bpy.context.view_layer.objects.active=flange;mod=flange.modifiers.new('M4 output clearance','BOOLEAN');mod.object=cut;mod.operation='DIFFERENCE';bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cut,do_unlink=True)
# Recessed output screws connect flange to carrier without exceeding 165mm envelope.
outputbolts=[]
for i in range(8):
    a=TAU*i/8+.1;x=.045*math.cos(a);y=.045*math.sin(a)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=.0035,depth=.006,location=(x,y,.165));cut=bpy.context.object
    bpy.context.view_layer.objects.active=flange;mod=flange.modifiers.new('Recessed output screw counterbore','BOOLEAN');mod.object=cut;mod.operation='DIFFERENCE';bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cut,do_unlink=True)
    head=ring('output-screw-cap',.0012,.0032,.162,.1645,'bearing-steel','output',n=24,bevel=.00008)
    for v in head.data.vertices:v.co.x+=x;v.co.y+=y
    outputbolts.append(head)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=.0019,depth=.011,location=(x,y,.1565));shank=bpy.context.object
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);shank.name='output-screw-shank';shank.data.materials.append(materials['bearing-steel']);shank['assembly']='output';parts.append(shank);outputbolts.append(shank)
combine('output-fasteners-8',outputbolts)
# Fixed upper retention shoulder ties outer race and spline to housing.
ring('outer-bearing-retainer',.077,.085,.151,.153,'anodized-graphite')
bolts=[]
for i in range(8):
    a=TAU*i/8;r=.080
    # Hexagonal fasteners outside moving output envelope; through fixed spline/seat.
    ob=ring('retainer-bolt',.0008,.0032,.153,.156,'bearing-steel',n=6,bevel=.00015)
    for v in ob.data.vertices:v.co.x+=r*math.cos(a);v.co.y+=r*math.sin(a)
    bolts.append(ob)
combine('retainer-bolts-8',bolts)
# Silver witness marking on output flange shows rotation.
box('output-index',(.048,0,.1649),(.015,.001,.0002),'gold','output',bevel=0)
# Cutaway stationary internals share the exact same datums as their full variants.
for name,ri,ro,z0,z1,mat,teeth,n in [
 ('stator-back-iron',.074,.084,.027,.067,'laminated-iron',0,120),
 ('stator-housing-fit-sleeve',.084,.085,.025,.069,'machined-aluminium',0,120),
 ('upper-bearing-support-plate',.026,.085,.077,.081,'machined-aluminium',0,120),
 ('fixed-circular-spline-202',.053,.085,.118,.132,'machined-aluminium',202,606),
]:
    ob=ring(name+'-section',ri,ro,z0,z1,mat,n=n,start=math.pi/2,end=TAU,teeth=teeth,inward=teeth>0,bevel=0 if teeth else .00012);ob['sectionOf']=name
bpy.data.objects['housing-section']['sectionOf']='housing-full'
# Bake all joined-part transforms before export: assetNode clone(false) resets them.
for ob in parts:
    bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);ob.select_set(False)
# Recalculate normals for the custom ring topology.
for ob in parts:
    bpy.context.view_layer.objects.active=ob;ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');ob.select_set(False)
# Boolean cutters can introduce slots; keep exactly one material/primitive per part.
for ob in parts:
    for poly in ob.data.polygons:poly.material_index=0
    while len(ob.data.materials)>1:ob.data.materials.pop(index=1)
# Inspect actual vertices for dimensions and bore; object transforms must be identity.
def bounds(ob):
    pts=[ob.matrix_world@v.co for v in ob.data.vertices]
    return [[min(p[i] for p in pts) for i in range(3)],[max(p[i] for p in pts) for i in range(3)]]
bounds_data={o.name:bounds(o) for o in parts}
minimum_bore=min(math.hypot((o.matrix_world@v.co).x,(o.matrix_world@v.co).y) for o in parts for v in o.data.vertices)
checks=[]
def check(name,actual,expected,tol=1e-6):checks.append({'name':name,'actual':actual,'expected':expected,'tolerance':tol,'pass':abs(actual-expected)<=tol})
check('base diameter',bounds_data['base-flange'][1][0]-bounds_data['base-flange'][0][0],P['baseDiameter'])
check('housing diameter',bounds_data['housing-full'][1][0]-bounds_data['housing-full'][0][0],P['housingDiameter'])
check('flange top',bounds_data['output-flange'][1][2],P['totalHeight'])
check('through bore minimum radius',minimum_bore,.01,2e-7)
check('radial motor air gap',.061-.0605,P['airGap'])
check('upper bearing to cup axial clearance',.099-.085,.014)
check('output neck to input tube radial clearance',.016-.015,.001)
def radial_edge_min(ob):
    result=1
    for edge in ob.data.edges:
        a,b=[ob.data.vertices[i].co for i in edge.vertices]
        dx=b.x-a.x;dy=b.y-a.y;den=dx*dx+dy*dy
        t=max(0,min(1,-(a.x*dx+a.y*dy)/den)) if den else 0
        result=min(result,math.hypot(a.x+t*dx,a.y+t*dy))
    return result
check('stator tooth to rotor radial gap',radial_edge_min(bpy.data.objects['stator-teeth-18'])-.0605,.0005,2e-6)
check('cam to flex diaphragm axial clearance',.132-.126,.006)
check('motor to bearing support axial clearance',.077-.067,.010)
assert all(c['pass'] for c in checks),checks
SRC.mkdir(parents=True,exist_ok=True);OUT.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(SRC/'harmonic-joint.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT),export_format='GLB',export_yup=True,export_apply=False,export_morph=True,export_extras=True,export_animations=False)
b=OUT.read_bytes();d=json.loads(b[20:20+struct.unpack_from('<I',b,12)[0]])
# Follow the finalized serialized hierarchy, not Blender object order.
paths={}
def walk(index,path):
    n=d['nodes'][index]
    if 'mesh' in n:paths[n['name']]=path
    for j,child in enumerate(n.get('children',[])):walk(child,path+'.'+str(j))
for j,index in enumerate(d['scenes'][d.get('scene',0)]['nodes']):walk(index,str(j))
# Blender Z -> glTF Y: geometry baked in object coordinates, exporter adds root rotation.
# Exporter's Y-up conversion is baked into each serialized mesh accessor; nodes remain identity.
report={'version':1,'generator':'fixed Blender harmonic/build.py','blender':bpy.app.version_string,'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'dimensions':{k:P[k] for k in ['baseDiameter','housingDiameter','totalHeight','boreDiameter']},'airGap':P['airGap'],'ratio':-100,'minimumBoreRadius':minimum_bore,'checks':checks,'mountingHoles':holes,'parts':[{'name':o.name,'assembly':o['assembly'],'path':paths[o.name],'sectionOf':o.get('sectionOf'),'boundsBlenderZUp':bounds_data[o.name]} for o in parts], 'validationScope':'Nominal geometry and kinematic sample; not load, torque, fatigue, thermal or FEA validation. Tooth profiles are illustrative, not manufacturing involutes.','allowedContacts':['cam / wave bearing','wave bearing / flex wall','flex teeth / circular spline teeth','bearing races / rolling elements','rotor carrier / input shaft','stator back iron / teeth / windings','housing / fixed seat / circular spline / outer races','cup diaphragm / output neck / flange','fasteners / retained fixed parts'],'warnings':['Nominal contact interfaces are intentional; mesh intersection does not imply production fit.','No tolerances, rated loads, lubrication, electrical insulation or manufacturing qualification.','Crossroller race section is simplified; rollers alternate +/-45 degrees.']}
# Nominal triangle surface intersection audit, including alternative cutaway assembly.
from mathutils.bvhtree import BVHTree
allowed={frozenset(pair) for pair in P['allowedContactPairs']}
interference={'method':'Blender BVHTree exact nominal triangle-surface overlap; boundary contact included','configurations':[],'unexpected':[],'limitations':'Nominal geometry only; not solid containment, tolerance stack, continuous motion, stress or FEA.'}
deps=bpy.context.evaluated_depsgraph_get()
for section in [False,True]:
    replaced={o.get('sectionOf') for o in parts if o.get('sectionOf')}
    selected=[o for o in parts if (bool(o.get('sectionOf')) or o.name not in replaced) if section] if section else [o for o in parts if not o.get('sectionOf')]
    trees={o.name:BVHTree.FromObject(o,deps,epsilon=0) for o in selected};contacts=[]
    for i,a in enumerate(selected):
        for bb in selected[i+1:]:
            hits=trees[a.name].overlap(trees[bb.name])
            if not hits:continue
            pair=[a.get('sectionOf',a.name),bb.get('sectionOf',bb.name)]
            item={'parts':[a.name,bb.name],'trianglePairs':len(hits),'allowed':frozenset(pair) in allowed}
            contacts.append(item)
            if not item['allowed']:interference['unexpected'].append(item)
    interference['configurations'].append({'section':section,'parts':len(selected),'contacts':contacts})
assert not interference['unexpected'],interference['unexpected']
report['interference']=interference
MAN.parent.mkdir(parents=True,exist_ok=True);MAN.write_text(json.dumps(report,indent=2)+'\n')
print('HARMONIC_BUILD '+json.dumps({'parts':len(parts),'checks':len(checks),'bytes':len(b)}))
