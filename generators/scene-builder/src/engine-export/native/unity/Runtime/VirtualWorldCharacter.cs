using UnityEngine;

namespace VirtualWorld
{
    /// <summary>Kinematic capsule queries work with arbitrary radial up; no global gravity mutation.</summary>
    public sealed class VirtualWorldCharacter : MonoBehaviour
    {
        public Vector3 Up { get; private set; } = Vector3.up;
        public bool Moving { get; private set; }
        public bool Grounded { get; private set; }
        public float Height { get; private set; }
        SceneSpec spec;
        Vector3 center, spawn, lastGrounded, heading;
        bool spherical;
        float radius, verticalSpeed, recoveryFloor;
        const float Skin = .015f;

        public void Initialize(SceneSpec scene, float height, Transform worldRoot)
        {
            spec = scene; Height = height; radius = height * .17f;
            spawn = NativeCoordinates.Position(scene.spawn);
            lastGrounded = spawn;
            spherical = scene.navigation != null && scene.navigation.kind == "sphere";
            center = spherical ? NativeCoordinates.Position(scene.navigation.center) : Vector3.zero;
            Up = spherical ? NativeCoordinates.Up(spawn, center) : Vector3.up;
            heading = NativeCoordinates.Tangent(Vector3.forward, Up);
            transform.SetPositionAndRotation(spawn, Quaternion.LookRotation(heading, Up));
            recoveryFloor = -12;
            if (scene.navigation != null && scene.navigation.bounds != null)
            {
                float lowest = spawn.y;
                foreach (var collider in worldRoot.GetComponentsInChildren<Collider>())
                    if (!collider.isTrigger) lowest = Mathf.Min(lowest, collider.bounds.min.y);
                recoveryFloor = lowest - Height - .1f;
            }
            Physics.SyncTransforms();
        }
        public void Tick(Vector2 input, bool jump, float dt, Camera camera)
        {
            dt = Mathf.Min(dt, .04f);
            if (dt <= 0) return;
            if (spherical) Up = NativeCoordinates.Up(transform.position, center);
            var forward = NativeCoordinates.Tangent(camera.transform.forward, Up);
            var right = Vector3.Cross(Up, forward).normalized;
            var direction = Vector3.ClampMagnitude(forward * input.y + right * input.x, 1);
            Moving = direction.sqrMagnitude > .0001f;
            Grounded = ProbeGround();
            if (Grounded)
            {
                lastGrounded = transform.position;
                if (verticalSpeed < 0) verticalSpeed = -.1f;
                if (jump) { verticalSpeed = 5.2f; Grounded = false; }
            }
            verticalSpeed -= 14 * dt;
            Vector3 desired = (direction * 3.6f + Up * verticalSpeed) * dt;
            Vector3 target = ConstrainPlane(transform.position + desired);
            Vector3 next = Sweep(transform.position, target - transform.position);
            next = ConstrainPlane(next);
            if (spherical)
            {
                var relative = next - center;
                // Navigation describes the planet surface; collision queries still stop against props.
                if (relative.magnitude < spec.navigation.radius + Skin)
                {
                    next = center + relative.normalized * (spec.navigation.radius + Skin);
                    if (verticalSpeed < 0) verticalSpeed = 0;
                }
                Up = NativeCoordinates.Up(next, center);
                if (relative.magnitude > spec.navigation.radius + 30) { next = spawn; verticalSpeed = 0; }
            }
            else if (next.y < recoveryFloor) { next = lastGrounded + Vector3.up * Skin; verticalSpeed = 0; }
            if (Moving) heading = NativeCoordinates.Tangent(direction, Up);
            else heading = NativeCoordinates.Tangent(heading, Up);
            transform.SetPositionAndRotation(next, Quaternion.LookRotation(heading, Up));
        }
        bool ProbeGround()
        {
            return Physics.SphereCast(transform.position + Up * (radius + .05f), radius * .95f,
                -Up, out var hit, .15f, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore)
                && Vector3.Dot(hit.normal, Up) > .45f;
        }
        Vector3 Sweep(Vector3 foot, Vector3 movement)
        {
            // Slide on native geometry. This intentionally does not reproduce Rapier's solver.
            for (int i = 0; i < 5 && movement.sqrMagnitude > 1e-10f; i++)
            {
                var bottom = foot + Up * (radius + Skin);
                var top = foot + Up * (Height - radius);
                float distance = movement.magnitude;
                if (!Physics.CapsuleCast(bottom, top, radius, movement / distance, out var hit,
                    distance + Skin, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore))
                { foot += movement; break; }
                float travel = Mathf.Max(0, hit.distance - Skin);
                foot += movement / distance * travel;
                movement = Vector3.ProjectOnPlane(movement * (1 - Mathf.Clamp01(travel / distance)), hit.normal);
                if (Vector3.Dot(hit.normal, Up) > .45f && verticalSpeed < 0) { verticalSpeed = 0; Grounded = true; }
                if (Vector3.Dot(hit.normal, Up) < -.45f && verticalSpeed > 0) verticalSpeed = 0;
            }
            return foot;
        }
        Vector3 ConstrainPlane(Vector3 position)
        {
            if (spherical || spec.navigation == null || spec.navigation.bounds == null) return position;
            var bounds = spec.navigation.bounds;
            float clearance = radius + .02f;
            // Reflection reverses the source X interval; the Z interval is unchanged.
            position.x = Mathf.Clamp(position.x, -bounds.max[0] + clearance, -bounds.min[0] - clearance);
            position.z = Mathf.Clamp(position.z, bounds.min[1] + clearance, bounds.max[1] - clearance);
            return position;
        }
    }
}
