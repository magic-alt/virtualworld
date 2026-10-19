export function godotFiles(): Record<string, string> {
  return {
    'project.godot': `; Godot 4 native interchange project\nconfig_version=5\n[application]\nconfig/name="VirtualWorld Export"\nrun/main_scene="res://main.tscn"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\nenvironment/defaults/default_clear_color=Color(0.05,0.05,0.08,1)\n`,
    'main.tscn':
      '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="VirtualWorld" type="Node3D"]\nscript = ExtResource("1")\n',
    'main.gd': `extends Node3D
func _ready():
 var importer = preload("res://virtualworld_importer.gd").new()
 var world = importer.build_scene()
 if world != null: add_child(world)
`,
    'virtualworld_importer.gd': `@tool
extends RefCounted
# Derived protocol v1. SceneSpecs and original GLBs remain the authoring source.
func read_manifest():
 var value = JSON.parse_string(FileAccess.get_file_as_string("res://engine-manifest.json"))
 if not value is Dictionary or value.get("version") != 1:
  push_error("Unsupported VirtualWorld manifest version")
  return null
 return value
func vec(a): return Vector3(float(a[0]),float(a[1]),float(a[2]))
func safe_model_path(path):
 return path is String and path.begins_with("models/") and path.ends_with(".glb") and not path.contains("..") and not path.contains("\\\\") and not path.contains(":")
func build_scene(scene_id = ""):
 var manifest = read_manifest()
 if manifest == null: return null
 if scene_id == "": scene_id = manifest.entrySceneId
 var spec = null
 for candidate in manifest.scenes:
  if candidate.id == scene_id: spec = candidate
 if spec == null:
  push_error("Unknown scene ID: " + scene_id)
  return null
 var world = Node3D.new()
 world.name = str(spec.id)
 world.set_meta("virtualworld_scene",spec.metadata)
 var objects = {}
 var records = {}
 for item in spec.nodes:
  var wrapper = Node3D.new()
  wrapper.name = str(item.id)
  wrapper.set_meta("virtualworld_id",item.id)
  wrapper.set_meta("virtualworld_metadata",item.metadata)
  wrapper.position = vec(item.translation)
  wrapper.quaternion = Quaternion(float(item.rotation[0]),float(item.rotation[1]),float(item.rotation[2]),float(item.rotation[3]))
  wrapper.scale = vec(item.scale)
  wrapper.visible = item.effectiveVisible
  objects[item.id] = wrapper
  records[item.id] = item
 # Create all wrappers before linking: authored order need not be parent-first.
 for item in spec.nodes:
  var wrapper = objects[item.id]
  var parent_id = item.get("parentId", "")
  if parent_id != "" and not objects.has(parent_id):
   for object in objects.values(): object.free()
   world.free()
   push_error("Missing parent: " + str(parent_id))
   return null
  if parent_id == "": world.add_child(wrapper)
  else: objects[parent_id].add_child(wrapper)
 for item in spec.nodes:
  var wrapper = objects[item.id]
  var model = null
  if item.has("model"):
   var asset = null
   for candidate in manifest.assets:
    if candidate.id == item.model: asset = candidate
   if asset == null or not safe_model_path(asset.path) or not str(asset.sha256).is_valid_hex_number(false) or str(asset.sha256).length() != 64:
    world.free()
    push_error("Unsafe or missing canonical model")
    return null
   var raw_path = "res://raw/" + str(asset.sha256) + ".glb.bin"
   var bytes = FileAccess.get_file_as_bytes(raw_path)
   var hash = HashingContext.new()
   hash.start(HashingContext.HASH_SHA256)
   hash.update(bytes)
   if bytes.size() != int(asset.bytes) or hash.finish().hex_encode() != str(asset.sha256):
    world.free()
    push_error("Missing canonical raw GLB: " + raw_path)
    return null
   var document = GLTFDocument.new()
   var state = GLTFState.new()
   var error = document.append_from_buffer(bytes,"res://",state)
   if error != OK:
    world.free()
    push_error("GLTFDocument import failed: " + str(error))
    return null
   model = document.generate_scene(state)
   if model == null:
    world.free()
    push_error("GLTFDocument generated no scene")
    return null
   wrapper.add_child(model)
  if item.has("collider") and item.effectiveVisible:
   var collider = item.collider
   if collider.shape == "mesh":
    if model != null: add_mesh_collision(model)
   else:
    var body = StaticBody3D.new()
    body.name = "Collision"
    var shape = CollisionShape3D.new()
    if collider.shape == "ball":
     shape.shape = SphereShape3D.new()
     shape.shape.radius = float(collider.size[0])
    else:
     shape.shape = BoxShape3D.new()
     shape.shape.size = vec(collider.size)
    body.add_child(shape)
    wrapper.add_child(body)
 var camera = Camera3D.new()
 camera.name = "Camera"
 camera.position = vec(spec.camera.position)
 world.add_child(camera)
 if camera.position.distance_squared_to(vec(spec.camera.target)) > 0.000001:
  camera.look_at_from_position(camera.position,vec(spec.camera.target))
 camera.current = true
 var lighting = DirectionalLight3D.new()
 lighting.name = "Sun"
 lighting.rotation_degrees = Vector3(-45,-30,0)
 lighting.light_energy = float(spec.environment.lightIntensity)
 world.add_child(lighting)
 var environment = WorldEnvironment.new()
 environment.environment = Environment.new()
 environment.environment.background_mode = Environment.BG_COLOR
 environment.environment.background_color = Color(spec.environment.background)
 environment.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
 environment.environment.ambient_light_color = Color.WHITE
 environment.environment.ambient_light_energy = float(spec.environment.ambientIntensity)
 world.add_child(environment)
 world.set_meta("virtualworld_spawn",spec.spawn)
 return world
func add_mesh_collision(node):
 if node is MeshInstance3D and node.mesh != null:
  var body = StaticBody3D.new()
  body.name = "MeshCollision"
  var shape = CollisionShape3D.new()
  shape.shape = node.mesh.create_trimesh_shape()
  body.add_child(shape)
  node.add_child(body)
 # Iterate a snapshot to avoid visiting freshly created colliders recursively.
 for child in node.get_children():
  if not child is StaticBody3D: add_mesh_collision(child)
func set_owners(node, root):
 for child in node.get_children():
  child.owner = root
  set_owners(child,root)
func save_scene(scene_id, output_path):
 if not output_path.begins_with("res://") or FileAccess.file_exists(output_path):
  push_error("Choose a fresh res:// output path; existing assets are never overwritten")
  return ERR_ALREADY_EXISTS
 var root = build_scene(scene_id)
 if root == null: return ERR_INVALID_DATA
 set_owners(root,root)
 var packed = PackedScene.new()
 var error = packed.pack(root)
 if error == OK: error = ResourceSaver.save(packed,output_path)
 root.free()
 return error
`,
    'inspect.gd': `extends SceneTree
func v(value): return [value.x,value.y,value.z]
func inspect(node, rows):
 if node is Node3D:
  var row = {"path":str(node.get_path()),"type":node.get_class(),"position":v(node.position),"scale":v(node.scale),"quaternion":[node.quaternion.x,node.quaternion.y,node.quaternion.z,node.quaternion.w],"globalTransform":[]}
  for column in [node.global_basis.x,node.global_basis.y,node.global_basis.z,node.global_position]: row.globalTransform.append(v(column))
  if node.has_meta("virtualworld_id"): row.id = node.get_meta("virtualworld_id")
  if node is VisualInstance3D: row.visible = node.is_visible_in_tree()
  if node is MeshInstance3D and node.mesh != null:
   var box = node.mesh.get_aabb()
   var points = []
   for index in range(8): points.append(v(node.global_transform * box.get_endpoint(index)))
   row.boundsCorners = points
   row.surfaces = node.mesh.get_surface_count()
  if node is CollisionShape3D:
   row.disabled = node.disabled
   row.shape = node.shape.get_class()
   if node.shape is SphereShape3D: row.radius = node.shape.radius
   if node.shape is BoxShape3D: row.size = v(node.shape.size)
   if node.shape is ConcavePolygonShape3D: row.faceCount = node.shape.get_faces().size()/3
  rows.append(row)
 if node is WorldEnvironment:
  rows.append({"path":str(node.get_path()),"type":node.get_class(),"background":node.environment.background_color.to_html(),"ambientEnergy":node.environment.ambient_light_energy})
 for child in node.get_children(): inspect(child,rows)
func _initialize():
 call_deferred("inspect_scene")
func inspect_scene():
 var importer = preload("res://virtualworld_importer.gd").new()
 var arguments = OS.get_cmdline_user_args()
 var scene_id = arguments[0] if arguments.size() > 0 else ""
 var world = importer.build_scene(scene_id)
 if world == null:
  quit(1)
  return
 root.add_child(world)
 var rows = []
 inspect(world,rows)
 print(JSON.stringify({"engine":Engine.get_version_info(),"sceneId":world.name,"nodes":rows}))
 if arguments.size() > 1:
  var error = importer.save_scene(scene_id,arguments[1])
  if error != OK:
   world.free()
   quit(1)
   return
 world.free()
 quit(0)
`,
    'export_presets.cfg': `[preset.0]\nname="Desktop"\nplatform="Linux"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter="raw/*.glb.bin,*.json"\nexclude_filter=""\nexport_path="build/virtualworld.x86_64"\n`,
    'README-Godot.md': `# Godot 4 project\nOpen project.godot and run main.tscn. The default is the manifest entrySceneId.\nThe importer API build_scene(scene_id) selects any campaign scene. Call save_scene(scene_id, "res://fresh-name.tscn") to create an editable PackedScene; descendant owners are assigned and existing files are rejected.\nInspect real native transforms, geometry bounds and collider units: godot --headless --path . --script inspect.gd -- scene-id res://fresh-name.tscn\nRaw GLB bytes are packaged under raw/*.glb.bin; export_presets.cfg includes these and JSON explicitly for PCK exports. Models/ contains canonical interchange GLBs.\nSee compatibility.json for unmapped gameplay and approximation findings. No Godot execution is claimed by the generator; record the exact binary used for validation.\n`,
  };
}
