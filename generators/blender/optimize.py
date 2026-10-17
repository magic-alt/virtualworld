"""Fixed batch processor. No prompts, eval, generated Python or arbitrary operators."""
import argparse
import json
import sys
from pathlib import Path


def parse_args(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--ratio', type=float, default=1.0)
    args = parser.parse_args(argv)
    if not 0.05 <= args.ratio <= 1:
        parser.error('ratio must be 0.05..1')
    if args.input.suffix.lower() != '.glb' or args.output.suffix.lower() != '.glb':
        parser.error('only GLB is supported')
    if args.input.resolve() == args.output.resolve():
        parser.error('source and output must differ')
    return args


def main(argv):
    args = parse_args(argv)
    import bpy
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(args.input.resolve()))
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH' and args.ratio < 1:
            modifier = obj.modifiers.new(name='DeterministicDecimate', type='DECIMATE')
            modifier.ratio = args.ratio
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(args.output.resolve()), export_format='GLB',
                              export_apply=True, export_yup=True)
    print(json.dumps({'blender': bpy.app.version_string, 'output': str(args.output.resolve())}))


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
