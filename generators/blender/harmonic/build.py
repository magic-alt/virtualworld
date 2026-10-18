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
                rr+=(-1 if inward else 1)*P['toothAmplitude']*tooth
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
# Geometry uses fixed authored Python, never generated executable proposals.
sys.path.insert(0,str(Path(__file__).parent))
from assembly import build_assembly
holes=build_assembly(P,ring,box,combine,parts,materials)
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
check('through bore minimum radius',minimum_bore,P['boreDiameter']/2,2e-7)
def radial_edge_min(ob):
    result=math.inf
    for edge in ob.data.edges:
        a,b=[ob.data.vertices[i].co for i in edge.vertices]
        dx=b.x-a.x;dy=b.y-a.y;den=dx*dx+dy*dy
        t=max(0,min(1,-(a.x*dx+a.y*dy)/den)) if den else 0
        result=min(result,math.hypot(a.x+t*dx,a.y+t*dy))
    return result
def radial_vertices(name):
    return [math.hypot(v.co.x,v.co.y) for v in bpy.data.objects[name].data.vertices]
check('radial motor air gap',radial_edge_min(bpy.data.objects['stator-teeth-18'])-max(radial_vertices('rotor-magnets-north')),P['airGap'],2e-7)
check('cup to input support axial clearance',bounds_data['flex-cup'][0][2]-bounds_data['upper-bearing-support-plate'][1][2],.001)
check('output neck to input shaft radial clearance',min(radial_vertices('output-neck'))-max(radial_vertices('hollow-input-shaft')),.001)
diaphragm_bottom=min(v.co.z for v in bpy.data.objects['flex-cup'].data.vertices if v.co.z>.085)
check('wave bearing to diaphragm axial clearance',diaphragm_bottom-bounds_data['wave-bearing-outer-race'][1][2],.002)
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
report={'version':1,'generator':'fixed Blender harmonic/build.py','blender':bpy.app.version_string,'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'dimensions':{k:P[k] for k in ['baseDiameter','housingDiameter','totalHeight','boreDiameter']},'airGap':P['airGap'],'ratio':-100,'minimumBoreRadius':minimum_bore,'checks':checks,'mountingHoles':holes,'parts':[{'name':o.name,'assembly':o['assembly'],'subsystem':o['subsystem'],'path':paths[o.name],'sectionOf':o.get('sectionOf'),'boundsBlenderZUp':bounds_data[o.name]} for o in parts], 'validationScope':'Nominal geometry and kinematic sample; not load, torque, fatigue, thermal or FEA validation. Tooth profiles are illustrative, not manufacturing involutes.','allowedContacts':['cam / wave bearing','wave bearing / flex wall','flex teeth / circular spline teeth','bearing races / rolling elements','rotor carrier / input shaft','stator back iron / teeth / windings','housing / fixed seat / circular spline / outer races','cup diaphragm / output neck / flange','fasteners / retained fixed parts'],'warnings':['Nominal contact interfaces are intentional; mesh intersection does not imply production fit.','No tolerances, rated loads, lubrication, electrical insulation or manufacturing qualification.','Crossroller race section is simplified; rollers alternate +/-45 degrees.']}
# Nominal triangle surface intersection audit, including alternative cutaway assembly.
from mathutils.bvhtree import BVHTree
allowed={frozenset(pair) for pair in P['allowedContactPairs']}
interference={'method':'Blender BVHTree exact nominal triangle-surface overlap; boundary contact included','configurations':[],'unexpected':[],'limitations':'Nominal geometry only; not solid containment, tolerance stack, continuous motion, stress or FEA.'}
deps=bpy.context.evaluated_depsgraph_get()
for section,angle in [(s,a) for s in [False,True] for a in [0,math.pi/4,math.pi/2]]:
    replaced={o.get('sectionOf') for o in parts if o.get('sectionOf')}
    selected=[o for o in parts if (bool(o.get('sectionOf')) or o.name not in replaced) if section] if section else [o for o in parts if not o.get('sectionOf')]
    from mathutils import Matrix
    trees={}
    for ob in selected:
        moving=ob['assembly']; rotation=angle if moving=='input' else -angle/100 if moving in ['flex','output'] else 0
        matrix=Matrix.Rotation(rotation,4,'Z');vertices=[]
        for v in ob.data.vertices:
            co=v.co.copy()
            if ob.name=='flex-cup':
                keys=ob.data.shape_keys.key_blocks;phase=2*(angle+angle/100)
                co+=(keys['WaveCos'].data[v.index].co-v.co)*math.cos(phase)+(keys['WaveSin'].data[v.index].co-v.co)*math.sin(phase)
            vertices.append(matrix@co)
        trees[ob.name]=BVHTree.FromPolygons(vertices,[tuple(poly.vertices) for poly in ob.data.polygons],epsilon=0)
    contacts=[]
    for i,a in enumerate(selected):
        for bb in selected[i+1:]:
            hits=trees[a.name].overlap(trees[bb.name])
            if not hits:continue
            pair=[a.get('sectionOf',a.name),bb.get('sectionOf',bb.name)]
            item={'parts':[a.name,bb.name],'trianglePairs':len(hits),'allowed':frozenset(pair) in allowed}
            contacts.append(item)
            if not item['allowed']:interference['unexpected'].append(item)
    interference['configurations'].append({'section':section,'inputAngle':angle,'parts':len(selected),'contacts':contacts})
# Always retain the complete audit, including failures, for investigation.
report['references']=P['references']
report['reconstruction']='original illustrative compact assembly, not vendor internal CAD; ideal permanent magnet brake, schematic PCB, no engineering confirmation'
report['axialZones']=P['axialZones']
report['interference']=interference
MAN.parent.mkdir(parents=True,exist_ok=True);MAN.write_text(json.dumps(report,indent=2)+'\n')
assert not interference['unexpected'],interference['unexpected']
print('HARMONIC_BUILD '+json.dumps({'parts':len(parts),'checks':len(checks),'bytes':len(b)}))
