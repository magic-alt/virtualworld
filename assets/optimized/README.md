# Runtime assets

`builtin/` is rebuilt from source recipes. `generated/` contains validated GLB outputs produced by the generation CLI. `uploads/` contains imported runtime files; their manifests distinguish pass-through uploads from validated optimization. URLs under `/assets/optimized/` are served by the local API and rewritten when exported.
