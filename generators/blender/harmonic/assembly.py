"""Original compact, hollow H-100 internals. Dimensions are metres, Blender Z-up.

Functional topology follows published cup-type strain-wave assemblies. It is not
a vendor CAD reproduction or a manufacturing/electrical design.
"""
import bpy, math
from mathutils import Vector

def build_assembly(p, ring, box, combine, parts, materials):
    tau = math.tau
    def array_boxes(name, count, radius, height, size, mat, parent='fixed', phase=0):
        obs=[]
        for i in range(count):
            a=tau*i/count+phase
            obs.append(box(name+'-element',(radius*math.cos(a),radius*math.sin(a),height),size,mat,parent,a))
        return combine(name,obs)
    def through_holes(ob, radius, bolt_radius, z, count, depth):
        holes=[]
        for i in range(count):
            a=tau*i/count+.07; x=bolt_radius*math.cos(a); y=bolt_radius*math.sin(a)
            bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=radius,depth=depth,location=(x,y,z))
            cut=bpy.context.object; bpy.context.view_layer.objects.active=ob
            mod=ob.modifiers.new('Actual through mounting hole','BOOLEAN'); mod.operation='DIFFERENCE';mod.object=cut
            bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cut,do_unlink=True)
            holes.append({'center':[x,z,-y],'radius':radius,'through':True})
        return holes
    def section(name, ri,ro,z0,z1,mat,n=120,teeth=0):
        ob=ring(name+'-section',ri,ro,z0,z1,mat,n=n,start=math.pi/2,end=tau,teeth=teeth,inward=teeth>0,bevel=0 if teeth else .00008)
        ob['sectionOf']=name
        return ob
    bore=p['boreDiameter']/2
    base=ring('base-flange',bore,.055,0,.004,'anodized-graphite')
    holes=through_holes(base,.0022,.052,.002,8,.014)
    ring('housing-full',.048,.050,.004,.103,'anodized-graphite')
    ob=section('housing',.048,.050,.004,.103,'anodized-graphite');ob.name='housing-section';ob['sectionOf']='housing-full'
    # Fixed rear drive support; real annular PCB and separated functional regions.
    ring('drive-board',.016,.044,.006,.0076,'encoder-pcb')
    array_boxes('drive-standoffs',4,.042,.005,(.003,.003,.002),'machined-aluminium',phase=.3)
    array_boxes('drive-power-stage',6,.023,.0092,(.005,.003,.003),'seal',phase=.2)
    array_boxes('drive-bus-capacitors',3,.036,.011,(.006,.005,.0068),'machined-aluminium',phase=1.05)
    box('drive-control-chip',(-.029,0,.0088),(.007,.008,.0024),'seal')
    box('drive-power-connector',(.036,0,.010),(.010,.009,.0048),'gold')
    box('drive-communication-connector',(0,-.035,.010),(.011,.008,.0048),'seal')
    array_boxes('drive-phase-terminals',3,.032,.0085,(.003,.003,.0018),'gold',phase=2.3)
    # Brake: stationary magnetic circuit and release coil; rotating armature is keyed to input.
    ring('brake-mount-plate',.028,.048,.0145,.016,'machined-aluminium')
    ring('brake-mount-sleeve',.028,.031,.016,.023,'machined-aluminium')
    ring('brake-yoke',.014,.028,.016,.020,'bearing-steel')
    ring('brake-permanent-magnet',.016,.020,.020,.0225,'magnet-north')
    ring('brake-release-coil',.021,.026,.020,.023,'copper-enamel')
    ring('brake-inner-pole',.014,.015,.020,.023,'bearing-steel')
    ring('brake-outer-pole',.027,.028,.020,.023,'bearing-steel')
    ring('brake-armature',.012,.028,.0233,.0243,'bearing-steel','input')
    ring('brake-friction-face',.016,.027,.02315,.0233,'seal','input')
    # Independent input supports and frameless motor with visible coils/magnet segmentation.
    ring('hollow-input-shaft',bore,.012,.0042,.0835,'bearing-steel','input')
    ring('lower-bearing-seat',.020,.031,.0245,.028,'machined-aluminium')
    ring('lower-bearing-support-plate',.031,.048,.026,.028,'machined-aluminium')
    for label,z0,z1 in [('lower',.025,.028),('upper',.0645,.0685)]:
        ring(label+'-input-bearing-inner',.012,.014,z0,z1,'bearing-steel','input')
        ring(label+'-input-bearing-outer',.017,.020,z0,z1,'bearing-steel')
        balls=[]
        for i in range(16):
            a=tau*i/16
            bpy.ops.mesh.primitive_uv_sphere_add(segments=10,ring_count=6,radius=.0015,location=(.0155*math.cos(a),.0155*math.sin(a),(z0+z1)/2))
            ob=bpy.context.object;ob.name=label+'-ball';ob.data.materials.append(materials['bearing-steel']);ob['assembly']='fixed';parts.append(ob);balls.append(ob)
        combine(label+'-bearing-balls',balls)
    ring('upper-bearing-support-plate',.020,.048,.066,.068,'machined-aluminium')
    ring('rotor-bottom-carrier',.012,.033,.0283,.030,'machined-aluminium','input')
    ring('rotor-yoke',.033,.0355,.030,.062,'bearing-steel','input')
    for polarity in range(2):
        magnets=[]
        for i in range(polarity,20,2):
            a=tau*i/20
            magnets.append(ring('magnet',.0355,.0375,.031,.061,'magnet-north' if polarity==0 else 'magnet-south','input',n=6,start=a+.008,end=a+tau/20-.008))
        combine('rotor-magnets-'+('north' if polarity==0 else 'south'),magnets)
    ring('stator-back-iron',.0435,.047,.030,.062,'laminated-iron')
    ring('stator-housing-fit-sleeve',.047,.048,.028,.064,'machined-aluminium')
    teeth=[];coils=[];formers=[]
    for i in range(18):
        a=tau*i/18
        teeth.append(box('tooth',(.0407*math.cos(a),.0407*math.sin(a),.046),(.0056,.0045,.032),'laminated-iron',angle=a,bevel=0))
        for tangent in [-.0028,.0028]:
            formers.append(box('former',(.041*math.cos(a)-tangent*math.sin(a),.041*math.sin(a)+tangent*math.cos(a),.046),(.004,.00045,.032),'seal',angle=a,bevel=0))
        for k in range(5):
            rr=.0395+k*.00065
            for tangent in [-.0034,.0034]:
                coils.append(box('winding-side',(rr*math.cos(a)-tangent*math.sin(a),rr*math.sin(a)+tangent*math.cos(a),.046),(.00045,.0005,.035),'copper-enamel',angle=a,bevel=.00005))
            for zz in [.0285,.0635]:
                coils.append(box('winding-end',(rr*math.cos(a),rr*math.sin(a),zz),(.00045,.0073,.0005),'copper-enamel',angle=a,bevel=.00005))
    combine('stator-teeth-18',teeth);combine('coil-formers-18',formers);combine('copper-windings-90-turns',coils)
    # Encoders have separate stationary readheads and moving code rings.
    ring('encoder-board',.0205,.029,.0305,.0317,'encoder-pcb')
    ring('encoder-code-ring',.012,.020,.0325,.0333,'gold','input')
    box('encoder-readhead',(.0195,0,.032),(.003,.004,.0006),'seal')
    ring('encoder-board-seat',.0275,.032,.0317,.0325,'machined-aluminium')
    ring('encoder-support-tube',.0305,.032,.0325,.066,'machined-aluminium')
    array_boxes('encoder-code-marks',48,.0185,.0334,(.0015,.00025,.0002),'seal','input')
    # Hollow cup strain-wave reduction: closed diaphragm joins the output neck.
    flex=ring('flex-cup',.0260,.0266,.069,.086,'bearing-steel','flex',n=800,teeth=200,bevel=0)
    flex=combine('flex-cup',[flex,ring('cup-diaphragm',.013,.0266,.086,.088,'bearing-steel','flex',bevel=0)])
    flex.shape_key_add(name='Basis')
    for name,phase in [('WaveCos',0),('WaveSin',math.pi/2)]:
        key=flex.shape_key_add(name=name)
        key.value=0
        for i,v in enumerate(flex.data.vertices):
            x,y,z=v.co;r=math.hypot(x,y);a=math.atan2(y,x);t=max(0,min(1,(.086-z)/.004))
            dr=p['morphAmplitude']*math.cos(2*a-phase)*t
            if r: key.data[i].co.x=x+dr*x/r;key.data[i].co.y=y+dr*y/r
    ring('fixed-circular-spline-202',.0273,.048,.075,.086,'machined-aluminium',n=808,teeth=202,inward=True,bevel=0)
    for name,ri,ro,z0,z1,mat in [('elliptical-wave-cam',.012,.025,.076,.083,'gold'),('wave-bearing-inner-race',.025,.0252,.076,.083,'bearing-steel'),('wave-bearing-outer-race',.0257,.026,.075,.084,'bearing-steel')]:
        ob=ring(name,ri,ro,z0,z1,mat,'input',bevel=0)
        for v in ob.data.vertices:
            r=math.hypot(v.co.x,v.co.y)
            if r> .02:
                a=math.atan2(v.co.y,v.co.x);dr=p['morphAmplitude']*math.cos(2*a)
                v.co.x+=dr*math.cos(a);v.co.y+=dr*math.sin(a)
    wave_balls=[]
    for i in range(48):
        a=tau*i/48;r=.02545+p['morphAmplitude']*math.cos(2*a)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=10,ring_count=6,radius=.00025,location=(r*math.cos(a),r*math.sin(a),.0795))
        ob=bpy.context.object;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        ob.name='wave-ball';ob.data.materials.append(materials['bearing-steel']);ob['assembly']='input';parts.append(ob);wave_balls.append(ob)
    combine('wave-bearing-balls-48',wave_balls)
    ring('output-neck',.013,.017,.088,.103,'machined-aluminium','output')
    ring('output-encoder-board',.034,.046,.0865,.0878,'encoder-pcb')
    ring('output-encoder-code-ring',.013,.030,.0883,.0891,'gold','output')
    box('output-encoder-readhead',(.032,0,.087975),(.008,.004,.00035),'seal')
    ring('output-encoder-seat',.045,.048,.086,.0865,'machined-aluminium')
    array_boxes('output-encoder-code-marks',64,.028,.0892,(.0015,.00025,.0002),'seal','output')
    ring('output-bearing-carrier',.017,.033,.100,.103,'machined-aluminium','output')
    ring('crossroller-inner-race',.028,.034,.090,.100,'bearing-steel','output')
    ring('crossroller-outer-race',.038,.048,.090,.100,'bearing-steel')
    rollers=[]
    for i in range(32):
        a=tau*i/32
        bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=.0015,depth=.0045,location=(.036*math.cos(a),.036*math.sin(a),.095))
        ob=bpy.context.object;direction=Vector((math.cos(a)*math.sin(math.pi/4),math.sin(a)*math.sin(math.pi/4),math.cos(math.pi/4)*(1 if i%2==0 else -1)))
        ob.rotation_euler=direction.to_track_quat('Z','Y').to_euler();bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        ob.name='cross-roller';ob.data.materials.append(materials['bearing-steel']);ob['assembly']='fixed';parts.append(ob);rollers.append(ob)
    combine('crossrollers-32-alternating-45deg',rollers)
    ring('outer-bearing-retainer',.040,.048,.100,.103,'anodized-graphite')
    flange=ring('output-flange',bore,.033,.103,p['totalHeight'],'machined-aluminium','output')
    through_holes(flange,.00165,.025,.1065,8,.02)
    bolts=[]
    for i in range(8):
        a=tau*i/8+.07;x=.025*math.cos(a);y=.025*math.sin(a)
        cap=ring('output-cap',.0009,.0024,.108,.1094,'bearing-steel','output',n=24,bevel=.00005)
        # A real counterbore retains the recessed screw head.
        bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=.0025,depth=.004,location=(x,y,.110));cut=bpy.context.object
        bpy.context.view_layer.objects.active=flange;mod=flange.modifiers.new('Recessed screw counterbore','BOOLEAN');mod.object=cut
        bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cut,do_unlink=True)
        for v in cap.data.vertices:v.co.x+=x;v.co.y+=y
        bolts.append(cap)
    combine('output-fasteners-8',bolts)
    array_boxes('retainer-bolts-8',8,.044,.1035,(.003,.003,.002),'bearing-steel')
    box('output-index',(.020,0,.1099),(.008,.0007,.0002),'gold','output',bevel=0)
    ring('rear-bore-seal',.009,.010,.004,.0042,'seal')
    for args in [
        ('stator-back-iron',.0435,.047,.030,.062,'laminated-iron'),
        ('stator-housing-fit-sleeve',.047,.048,.028,.064,'machined-aluminium'),
        ('upper-bearing-support-plate',.020,.048,.066,.068,'machined-aluminium'),
        ('lower-bearing-support-plate',.031,.048,.026,.028,'machined-aluminium'),
        ('brake-mount-plate',.028,.048,.0145,.016,'machined-aluminium'),
        ('fixed-circular-spline-202',.0273,.048,.075,.086,'machined-aluminium',606,202),
        ('crossroller-outer-race',.038,.048,.090,.100,'bearing-steel'),
        ('outer-bearing-retainer',.040,.048,.100,.103,'anodized-graphite'),
    ]: section(*args)
    # Every real mesh belongs to exactly one descriptive subsystem, independent of motion roots.
    for ob in parts:
        name=ob.get('sectionOf',ob.name)
        if name.startswith('brake-'): subsystem='brake'
        elif name.startswith('drive-'): subsystem='drive'
        elif 'encoder' in name: subsystem='encoders'
        elif any(word in name for word in ['stator','rotor','winding','coil-former']): subsystem='motor'
        elif any(word in name for word in ['flex-cup','wave-','circular-spline','input-shaft','input-bearing','bearing-seat','bearing-support','bearing-balls']): subsystem='reducer'
        elif any(word in name for word in ['output','crossroller','retainer']): subsystem='output'
        else: subsystem='housing'
        ob['subsystem']=subsystem
    return holes
