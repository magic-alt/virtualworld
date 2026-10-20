using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace VirtualWorld
{
    /// <summary>Native Unity player for a derived catalog. Authored metadata remains immutable.</summary>
    public sealed class VirtualWorldSceneRuntime : MonoBehaviour
    {
        public VirtualWorldCatalog catalog;
        public string initialSceneId;
        public bool resumeLastChapter;
        public Font uiFont;
        public Camera viewCamera;
        public SceneSpec Spec { get; private set; }
        public StoryState Story { get; private set; }
        public VirtualWorldCharacter Character { get; private set; }
        public VirtualWorldMechanism Mechanism { get; private set; }
        public IReadOnlyDictionary<string, Transform> Nodes { get { return nodes; } }
        NativeManifest manifest;
        GameObject sceneRoot, actorRoot;
        Light sun, fill;
        VirtualWorldOrbit orbit;
        VirtualWorldAnimator actorAnimation;
        VirtualWorldAnimator[] animations = Array.Empty<VirtualWorldAnimator>();
        readonly Dictionary<string, Transform> nodes = new Dictionary<string, Transform>();
        NodeSpec dialogue;
        string dialogueText, error;
        bool paused, suspended, jumpRequested;
        Vector2 touchMovement, scrollPosition;
        Vector3 lastMouse, mouseDown;
        float interactUntil;
        int viewportWidth, viewportHeight;
        float Sidebar { get { return Mathf.Min(320, Screen.width * .35f); } }

        void Start()
        {
            try
            {
                manifest = catalog.ReadManifest();
                if (uiFont == null) uiFont = catalog.uiFont;
                if (uiFont == null) throw new InvalidOperationException("Bundled UI font is missing. Run Scripts/prepare-font.mjs and import the manifest again.");
                if (viewCamera == null)
                {
                    var cameraObject = new GameObject("VirtualWorld Camera");
                    cameraObject.transform.SetParent(transform, false);
                    viewCamera = cameraObject.AddComponent<Camera>();
                    cameraObject.AddComponent<AudioListener>();
                }
                viewCamera.fieldOfView = 42;
                viewCamera.nearClipPlane = .03f;
                orbit = gameObject.AddComponent<VirtualWorldOrbit>(); orbit.viewCamera = viewCamera;
                sun = CreateLight("Sun", new Color(1, .94f, .85f), Quaternion.Euler(45, -30, 0));
                fill = CreateLight("Fill", new Color(.67f, .78f, 1), Quaternion.Euler(30, 150, 0));
                Resize();
                string id = String.IsNullOrEmpty(initialSceneId) ? manifest.entrySceneId : initialSceneId;
                // A configured web surface may select only a scene already present in this build.
                string query = QueryScene();
                if (!String.IsNullOrEmpty(query))
                {
                    if (!manifest.scenes.Any(scene => scene.id == query)) throw new InvalidOperationException("Requested scene is not in this Unity build: " + query);
                    id = query;
                }
                else if (resumeLastChapter) id = VirtualWorldProgress.Resume(manifest, id);
                // An explicitly exported/selected entry remains directly runnable. Chapter UI still gates transitions.
                LoadScene(id, true);
            }
            catch (Exception failure) { Fail(failure); }
        }
        Light CreateLight(string label, Color color, Quaternion rotation)
        {
            var item = new GameObject(label); item.transform.SetParent(transform, false); item.transform.rotation = rotation;
            var light = item.AddComponent<Light>(); light.type = LightType.Directional; light.color = color;
            return light;
        }
        string QueryScene()
        {
            if (!Uri.TryCreate(Application.absoluteURL, UriKind.Absolute, out var url)) return null;
            foreach (string pair in url.Query.TrimStart('?').Split('&'))
            {
                string[] parts = pair.Split(new[] { '=' }, 2);
                if (parts.Length == 2 && parts[0] == "sceneId") return Uri.UnescapeDataString(parts[1]);
            }
            return null;
        }
        public void LoadScene(string id, bool entry = false)
        {
            if (!entry && !VirtualWorldProgress.Unlocked(manifest, id)) return;
            try
            {
                var data = manifest.scenes.First(scene => scene.id == id);
                var native = catalog.Find(id);
                if (sceneRoot != null) { sceneRoot.SetActive(false); Destroy(sceneRoot); }
                if (actorRoot != null) { actorRoot.SetActive(false); Destroy(actorRoot); }
                Character = null; Mechanism = null; actorAnimation = null;
                nodes.Clear(); dialogue = null; error = null; paused = false; touchMovement = Vector2.zero;
                Spec = data.ReadSpec(); Story = VirtualWorldProgress.Load(Spec);
                sceneRoot = Instantiate(native.prefab, transform); sceneRoot.name = Spec.id;
                foreach (var identity in sceneRoot.GetComponentsInChildren<VirtualWorldMetadata>(true))
                    if (!String.IsNullOrEmpty(identity.nodeId)) nodes.Add(identity.nodeId, identity.transform);
                foreach (var node in Spec.nodes)
                {
                    if (node.animation == null) continue;
                    var player = nodes[node.id].GetComponentInChildren<VirtualWorldAnimator>(true);
                    if (player == null) throw new InvalidOperationException("Animation binding is missing for " + node.id);
                    player.Play(node.animation.clip, node.animation.loop, node.animation.speed);
                }
                ConfigureEnvironment();
                orbit.SetView(NativeCoordinates.Position(Spec.camera.position), NativeCoordinates.Position(Spec.camera.target), Vector3.up);
                if (Spec.actor != null)
                {
                    if (native.actorPrefab == null) throw new InvalidOperationException("Actor model is missing for " + Spec.id);
                    actorRoot = new GameObject("Player"); actorRoot.transform.SetParent(transform, false);
                    var visual = Instantiate(native.actorPrefab, actorRoot.transform);
                    if (!TryBounds(visual.transform, out var bounds, false) || bounds.size.y <= .0001f) throw new InvalidOperationException("Actor has no measurable geometry");
                    visual.transform.localScale *= Spec.actor.height / bounds.size.y;
                    TryBounds(visual.transform, out bounds, false);
                    visual.transform.localPosition -= Vector3.up * (bounds.min.y - actorRoot.transform.position.y);
                    if (!String.IsNullOrEmpty(Spec.actor.nodeId)) nodes[Spec.actor.nodeId].gameObject.SetActive(false);
                    Character = actorRoot.AddComponent<VirtualWorldCharacter>(); Character.Initialize(Spec, Spec.actor.height, sceneRoot.transform);
                    actorAnimation = visual.GetComponent<VirtualWorldAnimator>();
                    if (actorAnimation == null) throw new InvalidOperationException("Actor clips are not bound");
                    actorAnimation.Play(Spec.actor.clips.idle);
                    Vector3 target = Character.transform.position + Character.Up;
                    Vector3 back = NativeCoordinates.Tangent(new Vector3(-1, 0, 1), Character.Up);
                    orbit.SetView(target + Character.Up * 4 + back * 7, target, Character.Up);
                    viewCamera.nearClipPlane = .03f; viewCamera.farClipPlane = 1000;
                }
                if (Spec.mechanism != null)
                {
                    Mechanism = sceneRoot.AddComponent<VirtualWorldMechanism>();
                    Mechanism.Initialize(Spec, nodes); FitWorld("default");
                }
                animations = GetComponentsInChildren<VirtualWorldAnimator>(true);
                VirtualWorldProgress.Remember(manifest, id);
                Physics.SyncTransforms();
            }
            catch (Exception failure) { Fail(failure); }
        }
        void ConfigureEnvironment()
        {
            ColorUtility.TryParseHtmlString(Spec.environment.background, out var background);
            viewCamera.clearFlags = CameraClearFlags.SolidColor; viewCamera.backgroundColor = background;
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(.84f, .89f, 1) * Spec.environment.ambientIntensity;
            RenderSettings.fog = Spec.environment.fog > 0;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = background; RenderSettings.fogDensity = Spec.environment.fog;
            sun.intensity = Spec.environment.lightIntensity; sun.shadows = LightShadows.Soft;
            fill.intensity = Spec.mode == "industrial" ? 2 : .8f;
        }
        void Resize()
        {
            if (viewCamera == null) return;
            viewportWidth = Screen.width; viewportHeight = Screen.height;
            viewCamera.pixelRect = new Rect(Sidebar, 0, Mathf.Max(1, Screen.width - Sidebar), Mathf.Max(1, Screen.height));
            viewCamera.aspect = Mathf.Max(1, Screen.width - Sidebar) / Mathf.Max(1, Screen.height);
        }
        void Update()
        {
            if (Spec == null || error != null) return;
            try
            {
                if (viewportWidth != Screen.width || viewportHeight != Screen.height) { Resize(); if (Mechanism != null) FitWorld("current"); }
                if (Input.GetKeyDown(KeyCode.Escape)) { if (dialogue != null) dialogue = null; else paused = !paused; }
                bool blocked = paused || suspended;
                float dt = blocked ? 0 : Mathf.Min(Time.deltaTime, .05f);
                foreach (var animation in animations) if (animation != null) animation.SetPaused(blocked);
                var mouse = Input.mousePosition;
                bool overUI = mouse.x < Sidebar || (dialogue != null && mouse.y < Screen.height * .42f);
                if (Input.GetMouseButtonDown(0)) mouseDown = mouse;
                if (!blocked && !overUI)
                {
                    Vector2 drag = (Input.GetMouseButton(1) || (Mechanism != null && Input.GetMouseButton(0))) ? (Vector2)(mouse - lastMouse) : Vector2.zero;
                    Vector2 pan = Input.GetMouseButton(2) && Character == null ? (Vector2)(mouse - lastMouse) : Vector2.zero;
                    orbit.Tick(drag, Input.mouseScrollDelta.y, pan);
                    if (Mechanism != null && Input.GetMouseButtonUp(0) && (mouse - mouseDown).sqrMagnitude < 16) PickPart(mouse);
                }
                lastMouse = mouse;
                if (Character != null)
                {
                    var input = touchMovement;
                    if (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow)) input.y += 1;
                    if (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow)) input.y -= 1;
                    if (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow)) input.x -= 1;
                    if (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow)) input.x += 1;
                    bool jump = Input.GetKeyDown(KeyCode.Space) || jumpRequested;
                    jumpRequested = false;
                    Vector3 up = Character.Up;
                    Character.Tick(dialogue == null ? input : Vector2.zero, dialogue == null && jump, dt, viewCamera);
                    orbit.Follow(Character.transform.position + Character.Up, up, Character.Up);
                    actorAnimation.Play(Time.time < interactUntil ? Spec.actor.clips.interact : Character.Moving && !blocked ? Spec.actor.clips.walk : Spec.actor.clips.idle);
                    if (!blocked && dialogue == null && Input.GetKeyDown(KeyCode.E))
                    {
                        var nearest = Nearby().OrderBy(node => VirtualWorldProgress.Status(node.interaction, Story) == "available" ? 0 : 1).ThenBy(node => Distance(node.id)).FirstOrDefault();
                        if (nearest != null) Interact(nearest);
                    }
                }
                if (Mechanism != null) Mechanism.Tick(dt, blocked);
            }
            catch (Exception failure) { Fail(failure); }
        }
        IEnumerable<NodeSpec> Nearby() { return Spec.nodes.Where(node => node.interaction != null && nodes[node.id].gameObject.activeInHierarchy && Distance(node.id) <= 2.6f); }
        float Distance(string id)
        {
            if (Character == null) return 0;
            Vector3 position = nodes[id].position;
            if (Spec.navigation == null || Spec.navigation.kind != "sphere") position.y = Character.transform.position.y;
            return Vector3.Distance(position, Character.transform.position);
        }
        public void Interact(NodeSpec node)
        {
            if (paused || suspended || node.interaction == null || !nodes[node.id].gameObject.activeInHierarchy || Distance(node.id) > 2.6f) return;
            Story = VirtualWorldProgress.Advance(node.interaction, Story);
            VirtualWorldProgress.Save(Spec, Story);
            dialogue = node; dialogueText = Story.message; interactUntil = Time.time + 1.2f;
        }
        void PickPart(Vector3 screen)
        {
            if (!Physics.Raycast(viewCamera.ScreenPointToRay(screen), out var hit, viewCamera.farClipPlane, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore)) return;
            var identity = hit.collider.GetComponentInParent<VirtualWorldMetadata>();
            if (identity == null) return;
            var subsystem = Mechanism.Subsystems.FirstOrDefault(item => item.nodeIds.Contains(identity.nodeId));
            if (subsystem != null) Mechanism.Select(subsystem.id);
            var node = Spec.nodes.FirstOrDefault(item => item.id == identity.nodeId);
            if (node != null && node.interaction != null) Interact(node);
        }
        public void FitWorld(string view, string subsystemId = null)
        {
            Bounds bounds = default; bool found = false;
            var members = Mechanism == null || subsystemId == null ? null : Mechanism.Subsystems.FirstOrDefault(s => s.id == subsystemId)?.nodeIds;
            foreach (var node in Spec.nodes)
            {
                if (node.kind != "mesh" || (members != null && !members.Contains(node.id))) continue;
                if (TryBounds(nodes[node.id], out var part, true)) { if (!found) bounds = part; else bounds.Encapsulate(part); found = true; }
            }
            if (found) orbit.Fit(bounds, view, NativeCoordinates.Position(Spec.camera.position) - NativeCoordinates.Position(Spec.camera.target));
        }
        public static bool TryBounds(Transform root, out Bounds bounds, bool visibleOnly)
        {
            bounds = default; bool found = false;
            foreach (var renderer in root.GetComponentsInChildren<Renderer>(true))
            {
                if (visibleOnly && (!renderer.enabled || !renderer.gameObject.activeInHierarchy)) continue;
                if (!found) bounds = renderer.bounds; else bounds.Encapsulate(renderer.bounds); found = true;
            }
            return found;
        }
        bool PlanetOccludes(Vector3 point)
        {
            if (Spec.navigation == null || Spec.navigation.kind != "sphere") return false;
            var direction = point - viewCamera.transform.position;
            float length = direction.magnitude;
            if (length < 1e-5f) return false;
            direction /= length;
            var offset = viewCamera.transform.position - NativeCoordinates.Position(Spec.navigation.center);
            float radius = Spec.navigation.radius * .998f;
            float b = Vector3.Dot(offset, direction), discriminant = b * b - offset.sqrMagnitude + radius * radius;
            if (discriminant < 0) return false;
            float distance = -b - Mathf.Sqrt(discriminant);
            return distance >= 0 && distance < length - .02f;
        }
        void OnGUI()
        {
            if (uiFont != null) GUI.skin.font = uiFont;
            GUI.skin.label.wordWrap = true;
            GUILayout.BeginArea(new Rect(0, 0, Sidebar, Screen.height), GUI.skin.box);
            scrollPosition = GUILayout.BeginScrollView(scrollPosition);
            GUILayout.Label("VirtualWorld · Unity");
            if (error != null) { GUILayout.Label(error); if (Spec != null && GUILayout.Button("Retry scene")) LoadScene(Spec.id, true); }
            if (Spec != null && error == null)
            {
                GUILayout.Label(Spec.name);
                if (GUILayout.Button(paused ? "Resume" : "Pause")) paused = !paused;
                GUILayout.Label("Scenes / Chapters");
                foreach (var scene in manifest.scenes)
                {
                    GUI.enabled = scene.id != Spec.id && VirtualWorldProgress.Unlocked(manifest, scene.id);
                    if (GUILayout.Button(scene.name + (scene.id == Spec.id ? " · current" : ""))) LoadScene(scene.id);
                }
                GUI.enabled = true;
                if (Mechanism != null) DrawMechanism(); else DrawStory();
                GUILayout.Space(12);
                GUILayout.Label("WASD / arrows: move · Space: jump · E: interact\nRight drag: orbit · Wheel: zoom · Esc: pause");
            }
            GUILayout.EndScrollView(); GUILayout.EndArea();
            if (Spec == null || error != null) return;
            DrawHotspots(); DrawDialogue();
        }
        void DrawStory()
        {
            GUILayout.Space(8); GUILayout.Label("Journey");
            foreach (var task in Spec.tasks) GUILayout.Label((Story.flags.Contains(task.flag) ? "✓ " : "○ ") + task.label);
            if (Story.completed) GUILayout.Label("Chapter completed");
            if (GUILayout.Button("Reset journey"))
            {
                if (Spec.campaign != null && manifest.campaign != null) VirtualWorldProgress.ResetCampaign(manifest); else VirtualWorldProgress.Reset(Spec);
                Story = new StoryState(); dialogue = null;
            }
            GUILayout.Space(8);
            foreach (var node in Nearby()) if (GUILayout.Button(node.interaction.title + " · " + VirtualWorldProgress.Status(node.interaction, Story))) Interact(node);
            if (Character != null)
            {
                GUILayout.Label("Touch controls");
                float x = 0, y = 0;
                if (GUILayout.RepeatButton("↑")) y += 1;
                GUILayout.BeginHorizontal();
                if (GUILayout.RepeatButton("←")) x -= 1;
                if (GUILayout.RepeatButton("↓")) y -= 1;
                if (GUILayout.RepeatButton("→")) x += 1;
                GUILayout.EndHorizontal(); touchMovement = new Vector2(x, y);
                if (GUILayout.Button("Jump")) jumpRequested = true;
            }
        }
        void DrawMechanism()
        {
            var motion = Mechanism.Motion;
            GUILayout.Label("Input " + motion.ActualSpeed.ToString("F2") + " rpm / Output " + (motion.ActualSpeed * motion.Ratio).ToString("F3") + " rpm");
            GUILayout.Label("Signed ratio " + motion.Ratio.ToString("F4"));
            float speed = GUILayout.HorizontalSlider((float)motion.Speed, -30, 30);
            motion.SetSpeed(speed);
            if (GUILayout.Button(motion.Moving ? "Stop motion" : "Start motion")) motion.SetMoving(!motion.Moving);
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Step −")) { motion.Step(-Math.PI / 12); Mechanism.ApplyPose(); }
            if (GUILayout.Button("Step +")) { motion.Step(Math.PI / 12); Mechanism.ApplyPose(); }
            if (GUILayout.Button("Zero")) { motion.Reset(); Mechanism.ApplyPose(); }
            GUILayout.EndHorizontal();
            bool section = GUILayout.Toggle(Mechanism.Section, "Section view");
            if (section != Mechanism.Section) Mechanism.SetSection(section);
            GUILayout.Label("Explode");
            float explosion = GUILayout.HorizontalSlider(Mechanism.Explosion, 0, 1);
            if (!Mathf.Approximately(explosion, Mechanism.Explosion)) { Mechanism.SetExplosion(explosion); FitWorld("current"); }
            if (Mechanism.Subsystems.Any(subsystem => subsystem.optional == "brake"))
            {
                bool installed = GUILayout.Toggle(motion.BrakeInstalled, "Brake installed");
                if (installed != motion.BrakeInstalled) Mechanism.InstallBrake(installed);
                GUI.enabled = motion.BrakeInstalled;
                bool powered = GUILayout.Toggle(motion.BrakePowered, "Brake power (release)");
                if (powered != motion.BrakePowered) motion.PowerBrake(powered);
                GUI.enabled = true;
                if (motion.Locked) GUILayout.Label("Power-off brake holds position");
            }
            GUILayout.BeginHorizontal();
            foreach (string view in new[] { "default", "front", "side", "top", "bottom" }) if (GUILayout.Button(view)) FitWorld(view);
            GUILayout.EndHorizontal();
            foreach (var subsystem in Mechanism.Subsystems)
            {
                GUI.enabled = Mechanism.Available(subsystem);
                bool visible = !Mechanism.HiddenSubsystems.Contains(subsystem.id);
                bool next = GUILayout.Toggle(visible, subsystem.name);
                if (next != visible) Mechanism.SetVisible(subsystem.id, next);
                GUILayout.BeginHorizontal();
                if (GUILayout.Button("Inspect")) Mechanism.Select(subsystem.id);
                if (GUILayout.Button("Isolate")) { Mechanism.Isolate(subsystem.id); FitWorld("current", subsystem.id); }
                if (GUILayout.Button("Focus")) { Mechanism.Select(subsystem.id); FitWorld("current", subsystem.id); }
                GUILayout.EndHorizontal(); GUI.enabled = true;
            }
            if (GUILayout.Button("Show all subsystems")) { Mechanism.Isolate(null); foreach (var subsystem in Mechanism.Subsystems) Mechanism.SetVisible(subsystem.id, true); }
            if (GUILayout.Button("Reset presentation")) { Mechanism.ResetPresentation(); FitWorld("default"); }
            var selected = Mechanism.Subsystems.FirstOrDefault(s => s.id == Mechanism.SelectedSubsystem);
            if (selected != null) { GUILayout.Label(selected.name); GUILayout.Label(selected.description); }
            GUILayout.Label(Spec.mechanism.referenceNotes ?? "");
        }
        void DrawHotspots()
        {
            foreach (var node in Spec.nodes)
            {
                if (node.interaction == null || !nodes[node.id].gameObject.activeInHierarchy) continue;
                Vector3 point = nodes[node.id].position;
                if (TryBounds(nodes[node.id], out var bounds, true)) point = bounds.center;
                if (PlanetOccludes(point)) continue;
                if (Spec.navigation != null && Spec.navigation.kind == "sphere") point += NativeCoordinates.Up(point, NativeCoordinates.Position(Spec.navigation.center)) * .5f;
                else if (Spec.mechanism == null) point += Vector3.up * .35f;
                var screen = viewCamera.WorldToScreenPoint(point);
                if (screen.z < 0 || screen.x < Sidebar + 80 || screen.x > Screen.width - 80 || screen.y < 20 || screen.y > Screen.height - 20) continue;
                GUI.enabled = !paused && Distance(node.id) <= 2.6f;
                if (GUI.Button(new Rect(screen.x - 90, Screen.height - screen.y - 16, 180, 32), node.interaction.title)) Interact(node);
            }
            GUI.enabled = true;
        }
        void DrawDialogue()
        {
            if (dialogue == null) return;
            float width = Mathf.Min(650, Screen.width - Sidebar - 24);
            GUILayout.BeginArea(new Rect(Sidebar + 12, Screen.height * .6f, width, Screen.height * .4f - 12), GUI.skin.box);
            GUILayout.Label(dialogue.interaction.title); GUILayout.Label(dialogueText);
            if (VirtualWorldProgress.Available(dialogue.interaction, Story))
                foreach (var choice in dialogue.interaction.choices ?? Array.Empty<DialogueChoice>())
                    if (GUILayout.Button(choice.label)) dialogueText = choice.text;
            if (GUILayout.Button("Continue")) dialogue = null;
            GUILayout.EndArea();
        }
        void OnApplicationPause(bool value) { suspended = value; }
        void OnApplicationFocus(bool focused) { suspended = !focused; }
        void Fail(Exception failure) { error = failure.Message; paused = true; Debug.LogException(failure, this); }
    }
}
