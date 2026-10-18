"""Original product exterior reconstructed from official eRob90 V6 envelope drawings.

This creates source-native geometry; no downloaded vendor mesh enters the bundle.
All coordinates here are final Blender Z-up metres, after the internal frame bake.
"""
import bpy, math


def add_exterior(p, ring, box, combine, parts, materials):
    tau=math.tau; body=p['exteriorReference']['bodyLength']; features=[]
    def tag(ob, subsystem='housing', variant=None):
        ob['subsystem']=subsystem
        if variant: ob['sectionOf']=variant
        return ob
    def pair(a,b):
        item=[a,b]
        if item not in p['allowedContactPairs']:p['allowedContactPairs'].append(item)
    def variants(name,ri,ro,z0,z1,mat,subsystem='housing'):
        full=tag(ring(name,ri,ro,z0,z1,mat,n=192,bevel=0),subsystem)
        cut=tag(ring(name+'-section',ri,ro,z0,z1,mat,n=144,start=math.pi/2,end=tau,bevel=0),subsystem,name)
        return full,cut
    def cutter(target,tool):
        bpy.context.view_layer.objects.active=target
        mod=target.modifiers.new('Measured interface recess','BOOLEAN');mod.operation='DIFFERENCE';mod.object=tool
        bpy.ops.object.modifier_apply(modifier=mod.name)
    def cylinder_cut(targets,x,y,r,z,depth,vertices=24):
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth,location=(x,y,z));tool=bpy.context.object
        for target in targets:cutter(target,tool)
        bpy.data.objects.remove(tool,do_unlink=True)
    def screw(x,y,z,outer=.0024):
        ob=ring('socket-head',.0001,outer,z,z+.0014,'bearing-steel',n=24,bevel=.00006)
        cylinder_cut([ob],0,0,.0011,z+.0007,.004,6)
        for v in ob.data.vertices:v.co.x+=x;v.co.y+=y
        return ob
    # The fixed front mounting ring surrounds, but never caps, the rotating output.
    fronts=variants('output-fixed-mount-ring',.040,.050,.00504,.0072,'anodized-graphite','output')
    pitch=p['exteriorReference']['fixedMountPitchDiameter']/2;heads=[];cut_heads=[]
    for i in range(12):
        a=tau*i/12+.07;x=pitch*math.cos(a);y=pitch*math.sin(a)
        cylinder_cut(fronts,x,y,.00165,.006,.007)
        features.append({'kind':'fixed-mount-hole','centerBlender':[x,y,0],'radius':.00165})
        a+=math.pi/12;x=pitch*math.cos(a);y=pitch*math.sin(a)
        cylinder_cut(fronts,x,y,.00265,.00584,.0020)
        # These heads are inside actual counterbores, with an open hex socket.
        ob=screw(x,y,.00519);heads.append(ob)
        if not(x>0 and y>0):
            clone=ob.copy();clone.data=ob.data.copy();bpy.context.collection.objects.link(clone);parts.append(clone);cut_heads.append(clone)
    tag(combine('output-fixed-screws-12',heads),'output')
    tag(combine('output-fixed-screws-12-section',cut_heads),'output','output-fixed-screws-12')
    pair('output-fixed-mount-ring','crossroller-outer-race')
    # Raised pilot and machining lands give the output face its real stepped silhouette.
    # The moving flange itself is the raised pilot, above its smaller bearing carrier.
    # Real front case band is annular: it surrounds the reducer, never caps the output face.
    variants('reducer-case-band',.048,.050,.0072,.03024,'anodized-graphite','housing')
    for other in ['crossroller-outer-race','fixed-circular-spline-202','output-encoder-seat','upper-bearing-support-plate']:
        pair('reducer-case-band',other)
    pair('reducer-case-band','output-fixed-mount-ring')
    pair('reducer-case-band','housing-full')
    # Thin seam bands sit on the motor shell rather than forming an oversized flange.
    for name,z0,z1 in [('housing-front-seam',.0310,.03165),('housing-rear-seam',.0748,.07545)]:
        variants(name,.050,.05012,z0,z1,'seal')
        pair(name,'housing-full')
    # Fixed rear shell, protected face, and the continuous hollow cable sleeve.
    variants('rear-cover-skirt',.046,.050,.0792,.0832,'machined-aluminium')
    covers=variants('rear-interface-cover',.00902,.050,.0832,body,'machined-aluminium')
    variants('rear-bore-collar',.00902,.0108,.07632,.0832,'machined-aluminium')
    pair('base-flange','rear-cover-skirt');pair('rear-cover-skirt','rear-interface-cover')
    pair('rear-bore-collar','rear-interface-cover');pair('rear-bore-seal','rear-bore-collar')
    # Socket body openings are real cuts in the rear plate. Layout is illustrative,
    # with measured XT30/JST proportions, avoiding the removed cutaway quadrant.
    ports=[
        ('rear-power-socket',(-.012,.028),(.0124,.0052),2,'48V',math.pi/2),
        ('rear-can-sockets',(-.029,.012),(.0078,.0064),6,'CAN',0),
        ('rear-ethercat-sockets',(.025,-.024),(.0146,.0057),8,'ECAT',-.5),
        ('rear-io-socket',(-.020,-.026),(.018,.0057),12,'I/O',0),
        ('rear-battery-socket',(-.033,-.005),(.0044,.0044),2,'BAT',0),
    ]
    pins=[];legends=[]
    for name,(x,y),(w,h),count,label,angle in ports:
        # Recessed connector frame: polygonal shell around a visibly empty cavity.
        low=body-.0007;high=body+.0037777777
        plastic='connector-yellow' if name=='rear-power-socket' else 'connector-ivory'
        socket=box(name,(x,y,(low+high)/2),(w,h,high-low),plastic,angle=angle,bevel=.00012)
        if name=='rear-power-socket':
            for offset in [-.0031,.0031]:
                px=x+offset*math.cos(angle);py=y+offset*math.sin(angle)
                cylinder_cut([socket],px,py,.0013,body+.004,.0078)
                cylinder_cut(covers,px,py,.0013,body+.001,.014)
        else:
            cavities=[(0,0,w-.0012,h-.0012)]
            if name=='rear-can-sockets':cavities=[(0,t*h/4,w-.0012,h/2-.0012) for t in [-1,1]]
            if name=='rear-ethercat-sockets':cavities=[(t*w/4,0,w/2-.0012,h-.0012) for t in [-1,1]]
            for cx,cy,cw,ch in cavities:
                px=x+cx*math.cos(angle)-cy*math.sin(angle);py=y+cx*math.sin(angle)+cy*math.cos(angle)
                opening=box('temporary-cavity',(px,py,body+.004),(cw,ch,.0078),'seal',angle=angle,bevel=0)
                cutter(socket,opening)
                parts.remove(opening);bpy.data.objects.remove(opening,do_unlink=True)
                opening=box('temporary-cover-opening',(px,py,body+.001),(cw,ch,.014),'seal',angle=angle,bevel=0)
                for target in covers:cutter(target,opening)
                parts.remove(opening);bpy.data.objects.remove(opening,do_unlink=True)
        tag(socket,'drive');pair(name,'rear-interface-cover')
        # Latch rail on one side is one solid part of the socket housing.
        latch=box('latch',(x-math.sin(angle)*(h/2+.00035),y+math.cos(angle)*(h/2+.00035),body+.0012),(w*.55,.0007,.0012),plastic,angle=angle)
        socket=combine(name,[socket,latch]);tag(socket,'drive')
        for j in range(count):
            xx=(j-(count-1)/2)*(w-.002)/max(1,count-1);yy=0
            if name=='rear-can-sockets':xx=(j%3-1)*.0025;yy=(j//3-.5)*h/2
            if name=='rear-power-socket':xx=(j-.5)*.0062
            px=x+xx*math.cos(angle)-yy*math.sin(angle);py=y+xx*math.sin(angle)+yy*math.cos(angle)
            if name=='rear-power-socket':
                ob=ring('power-contact',.00065,.00095,body-.0002,body+.0025,'gold',n=24,bevel=0)
                for v in ob.data.vertices:v.co.x+=px;v.co.y+=py
                pins.append(ob)
            else:pins.append(box('interface-pin',(px,py,body+.0010),(.00035,.00035,.0024),'gold',bevel=.000025))
        bpy.ops.object.text_add(location=(x,y-(abs(w*math.sin(angle))+abs(h*math.cos(angle)))/2-.003,body+.00004))
        ob=bpy.context.object;ob.rotation_euler.z=math.pi;ob.data.body=label;ob.data.size=.0018;ob.data.align_x='CENTER';ob.data.extrude=.00001
        ob.data.materials.append(materials['seal']);bpy.ops.object.convert(target='MESH')
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        ob['assembly']='fixed';parts.append(ob);legends.append(ob)
        features.append({'kind':'rear-socket','name':name,'pins':count,'label':label,'centerBlender':[x,y,body],'size':[w,h,high-low]})
    tag(combine('rear-interface-pins',pins),'drive')
    tag(combine('rear-interface-legends',legends),'drive')
    # Rear retaining screws on a compact circle, not a projecting mounting halo.
    rear_heads=[];rear_cut=[]
    for i in range(4):
        a=tau*i/4+.32;x=.042*math.cos(a);y=.042*math.sin(a)
        cylinder_cut(covers,x,y,.00255,body-.00035,.0017)
        ob=screw(x,y,body-.0012);rear_heads.append(ob)
        if not(x>0 and y>0):
            clone=ob.copy();clone.data=ob.data.copy();bpy.context.collection.objects.link(clone);parts.append(clone);rear_cut.append(clone)
    tag(combine('rear-cover-screws',rear_heads))
    tag(combine('rear-cover-screws-section',rear_cut),variant='rear-cover-screws')
    # Explicit physical interfaces, not an entire-subsystem intersection exemption.
    for name,*_ in ports:pair(name,'rear-interface-pins')
    pair('rear-interface-cover','rear-interface-legends')
    pair('rear-interface-cover','rear-cover-screws')
    return features
