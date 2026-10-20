using UnityEngine;

namespace VirtualWorld
{
    public sealed class VirtualWorldOrbit : MonoBehaviour
    {
        public Camera viewCamera;
        public Vector3 Target { get; private set; }
        Vector3 offset, cameraUp = Vector3.up;
        float minimum = .001f, maximum = 200;
        public void SetView(Vector3 position, Vector3 target, Vector3 up)
        {
            Target = target; offset = position - target; cameraUp = up.normalized;
            if (offset.sqrMagnitude < 1e-10f) offset = Vector3.back;
            Apply();
        }
        public void Follow(Vector3 target, Vector3 oldUp, Vector3 newUp)
        {
            var transport = Quaternion.FromToRotation(oldUp, newUp);
            offset = transport * offset; cameraUp = transport * cameraUp;
            Target = target; Apply();
        }
        public void Tick(Vector2 drag, float scroll, Vector2 pan)
        {
            var right = Vector3.Cross(cameraUp, -offset).normalized;
            var rotation = Quaternion.AngleAxis(drag.x * .25f, cameraUp) * Quaternion.AngleAxis(-drag.y * .25f, right);
            offset = rotation * offset;
            cameraUp = rotation * cameraUp;
            float distance = Mathf.Clamp(offset.magnitude * Mathf.Exp(-scroll * .15f), minimum, maximum);
            offset = offset.normalized * distance;
            Target += (viewCamera.transform.right * -pan.x + viewCamera.transform.up * -pan.y) * distance * .0015f;
            Apply();
        }
        public void Fit(Bounds bounds, string view = "default", Vector3? authoredDirection = null)
        {
            Vector3 direction;
            switch (view)
            {
                case "front": direction = Vector3.back; break;
                case "side": direction = Vector3.left; break;
                case "top": direction = Vector3.up; break;
                case "bottom": direction = Vector3.down; break;
                case "current": direction = offset.normalized; break;
                default: direction = authoredDirection ?? new Vector3(-1, .65f, -1); break;
            }
            if (direction.sqrMagnitude < 1e-10f) direction = Vector3.back;
            direction.Normalize();
            float vertical = viewCamera.fieldOfView * Mathf.Deg2Rad * .5f;
            float horizontal = Mathf.Atan(Mathf.Tan(vertical) * viewCamera.aspect);
            float radius = Mathf.Max(.001f, bounds.extents.magnitude);
            float distance = radius * 1.18f / Mathf.Sin(Mathf.Min(vertical, horizontal));
            minimum = Mathf.Max(.0001f, radius * .01f); maximum = Mathf.Max(2, distance * 30);
            viewCamera.nearClipPlane = Mathf.Max(.00001f, distance / 1000);
            viewCamera.farClipPlane = Mathf.Max(10, distance * 100);
            SetView(bounds.center + direction * distance, bounds.center,
                view == "current" ? cameraUp : Mathf.Abs(direction.y) > .99f ? Vector3.forward : Vector3.up);
        }
        void Apply()
        {
            if (Vector3.Cross(cameraUp, -offset).sqrMagnitude < 1e-10f) cameraUp = NativeCoordinates.Tangent(Vector3.forward, offset.normalized);
            viewCamera.transform.SetPositionAndRotation(Target + offset, Quaternion.LookRotation(-offset, cameraUp));
        }
    }
}
