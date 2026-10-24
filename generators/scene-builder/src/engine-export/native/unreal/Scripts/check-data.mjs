import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';

const fail = (message) => {
  throw new Error(message);
};
const array = (value, label) => (Array.isArray(value) ? value : fail(`${label} must be an array`));
const safeId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function checkData(project, requestedScene) {
  const directory = realpathSync(join(project, 'Content/VirtualWorldData'));
  const manifest = JSON.parse(readFileSync(join(directory, 'engine-manifest.json'), 'utf8'));
  if (manifest.version !== 1 || manifest.target !== 'unreal')
    fail('Expected VirtualWorld Unreal manifest version 1');
  if (
    manifest.coordinates?.handedness !== 'right' ||
    manifest.coordinates?.up !== 'Y' ||
    manifest.coordinates?.units !== 'metres' ||
    manifest.coordinates?.quaternion !== 'xyzw'
  )
    fail('Unsupported manifest coordinates');
  const models = new Map();
  for (const asset of array(manifest.assets, 'assets')) {
    if (
      !/^[a-f0-9]{64}$/.test(asset.id) ||
      asset.id !== asset.sha256 ||
      asset.path !== `models/${asset.id}.glb`
    )
      fail(`Unsafe canonical model path or digest: ${asset.path}`);
    if (models.has(asset.id)) fail(`Duplicate canonical model ${asset.id}`);
    const path = realpathSync(join(directory, asset.path));
    const contained = relative(directory, path);
    if (contained.startsWith('..') || isAbsolute(contained))
      fail(`Canonical model path escapes data directory: ${asset.path}`);
    if (
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes < 20 ||
      asset.bytes > 512 * 1024 * 1024 ||
      statSync(path).size !== asset.bytes
    )
      fail(`Canonical model length mismatch: ${asset.path}`);
    const bytes = readFileSync(path);
    if (sha(bytes) !== asset.sha256) fail(`Canonical model hash mismatch: ${asset.path}`);
    if (
      bytes.readUInt32LE(0) !== 0x46546c67 ||
      bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== bytes.length ||
      bytes.readUInt32LE(16) !== 0x4e4f534a
    )
      fail(`Invalid GLB header: ${asset.path}`);
    const length = bytes.readUInt32LE(12);
    if (length % 4 || length > bytes.length - 20)
      fail(`Invalid GLB JSON chunk length: ${asset.path}`);
    const gltf = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
    for (const value of [...(gltf.buffers ?? []), ...(gltf.images ?? [])])
      if (value.uri && !value.uri.startsWith('data:'))
        fail(`External dependency in canonical GLB: ${asset.path}`);
    models.set(asset.id, gltf);
  }
  const scenes = new Map();
  for (const scene of array(manifest.scenes, 'scenes')) {
    if (!safeId(scene.id) || scenes.has(scene.id))
      fail(`Invalid or duplicate scene ID: ${scene.id}`);
    const metadata = JSON.parse(scene.metadataJson);
    if (metadata.id !== scene.id) fail(`Scene metadata ID mismatch: ${scene.id}`);
    const nodes = new Map();
    for (const node of array(scene.nodes, `${scene.id}.nodes`)) {
      if (!safeId(node.id) || nodes.has(node.id)) fail(`Invalid or duplicate node ID: ${node.id}`);
      if (node.model && !models.has(node.model))
        fail(`Missing canonical model binding: ${node.id}`);
      nodes.set(node.id, node);
    }
    for (const node of nodes.values()) {
      const seen = new Set([node.id]);
      let parent = node.parentId;
      while (parent) {
        if (!nodes.has(parent) || seen.has(parent)) fail(`Missing or cyclic parent of ${node.id}`);
        seen.add(parent);
        parent = nodes.get(parent).parentId;
      }
    }
    if (metadata.actor) {
      if (!scene.actorModel || !models.has(scene.actorModel))
        fail(`Missing actorModel whole-GLB binding: ${scene.id}`);
      const actor = models.get(scene.actorModel);
      if (!actor.skins?.length) fail(`Actor model has no skin: ${scene.id}`);
      const clips = new Set((actor.animations ?? []).map((item) => item.name));
      for (const name of Object.values(metadata.actor.clips))
        if (!clips.has(name)) fail(`Missing actor animation ${name}: ${scene.id}`);
      if (metadata.actor.nodeId && !nodes.has(metadata.actor.nodeId))
        fail(`Missing actor preview node: ${scene.id}`);
    }
    const mechanism = metadata.mechanism;
    if (mechanism) {
      const bindingIds = [
        ...(mechanism.kind === 'cad-joint'
          ? [mechanism.modelNodeId]
          : [mechanism.waveNodeId, mechanism.flexNodeId, mechanism.outputNodeId]),
        ...(mechanism.fixedNodeIds ?? []),
        ...(mechanism.fullHousingIds ?? []),
        ...(mechanism.sectionHousingIds ?? []),
        ...(mechanism.subsystems ?? []).flatMap((s) => s.nodeIds),
      ];
      for (const id of bindingIds)
        if (!nodes.has(id)) fail(`Missing mechanism node binding ${id}: ${scene.id}`);
      if (mechanism.kind === 'cad-joint') {
        checkCadMechanism(mechanism, nodes, models);
      } else {
        if (!(mechanism.flexTeeth > 0 && mechanism.ringTeeth > mechanism.flexTeeth))
          fail(`Invalid signed transmission dimensions: ${scene.id}`);
        let found = false;
        for (const node of nodes.values()) {
          let parent = node.id;
          while (parent && parent !== mechanism.flexNodeId) parent = nodes.get(parent)?.parentId;
          if (!parent || !node.model) continue;
          for (const mesh of models.get(node.model).meshes ?? []) {
            const names = mesh.extras?.targetNames ?? [];
            if (names.includes(mechanism.cosMorph) && names.includes(mechanism.sinMorph))
              found = true;
          }
        }
        if (!found)
          fail(
            `Missing named signed morph bindings ${mechanism.cosMorph}/${mechanism.sinMorph}: ${scene.id}`,
          );
      }
    }
    scenes.set(scene.id, scene);
  }
  if (!scenes.has(manifest.entrySceneId)) fail('Unknown entrySceneId');
  if (requestedScene && !scenes.has(requestedScene)) fail(`Unknown scene: ${requestedScene}`);
  if (manifest.campaign) {
    const previous = new Set();
    for (const chapter of array(manifest.campaign.chapters, 'campaign.chapters')) {
      if (!scenes.has(chapter.id) || previous.has(chapter.id))
        fail(`Missing or duplicate campaign chapter: ${chapter.id}`);
      for (const required of chapter.requires ?? [])
        if (!previous.has(required)) fail(`Invalid campaign prerequisite: ${required}`);
      previous.add(chapter.id);
    }
  }
  return {
    kind: 'data-preflight',
    nativeExecution: false,
    scenes: scenes.size,
    models: models.size,
    sceneId: requestedScene ?? manifest.entrySceneId,
  };
}

/** CAD bindings identify final serialized mesh nodes, never duplicated display names. */
export function checkCadMechanism(mechanism, nodes, models) {
  const model = nodes.get(mechanism.modelNodeId)?.model;
  if (!model || !models.has(model) || mechanism.modelSha256 !== model)
    fail('CAD mechanism canonical model SHA-256 mismatch');
  if (!/^[a-f0-9]{64}$/.test(mechanism.sourceSha256)) fail('Invalid CAD source SHA-256 provenance');
  const config = mechanism.dynamics;
  const positive = ['inertia', 'driveTorque', 'brakeTorque', 'holdTorque'];
  const nonnegative = [
    'viscousDrag',
    'engageDelay',
    'engageRamp',
    'releaseDelay',
    'releaseRamp',
    'armatureTravel',
  ];
  for (const name of [...positive, ...nonnegative])
    if (!Number.isFinite(config?.[name]) || config[name] < (positive.includes(name) ? 1e-9 : 0))
      fail(`Invalid CAD SI dynamics parameter ${name}`);
  if (
    config.inertia > 1e3 ||
    ['driveTorque', 'brakeTorque', 'holdTorque', 'viscousDrag'].some(
      (name) => config[name] > 1e6,
    ) ||
    config.armatureTravel > 0.01 ||
    config.holdTorque < config.brakeTorque ||
    config.provenance !== 'demonstration-assumption'
  )
    fail('Invalid CAD dynamics limits or provenance');
  for (const name of ['engageDelay', 'engageRamp', 'releaseDelay', 'releaseRamp'])
    if (config[name] > 60 || (config[name] > 0 && config[name] < 1e-9))
      fail(`Invalid CAD transition ${name}`);
  const gear = mechanism.gear;
  if (gear?.status === 'user-specified') {
    if (
      !Number.isFinite(gear.reductionRatio) ||
      gear.reductionRatio <= 0 ||
      !['flexspline', 'circular-spline'].includes(gear.fixedMember) ||
      typeof gear.evidence !== 'string' ||
      !gear.evidence.length
    )
      fail('Invalid user-specified CAD reduction or provenance');
  } else if (gear?.status === 'evidenced') {
    if (
      !Number.isSafeInteger(gear.flexTeeth) ||
      gear.flexTeeth <= 0 ||
      !Number.isSafeInteger(gear.ringTeeth) ||
      gear.ringTeeth <= gear.flexTeeth ||
      gear.fixedRing !== true ||
      typeof gear.evidence !== 'string' ||
      !gear.evidence.length
    )
      fail('Invalid evidenced fixed-ring CAD reduction');
  } else if (gear !== undefined && gear.status !== 'unresolved') {
    fail('Invalid CAD reduction status');
  }
  const bearings = new Map();
  for (const bearing of array(mechanism.bearings, 'CAD bearings')) {
    if (
      !safeId(bearing.id) ||
      bearings.has(bearing.id) ||
      ![
        bearing.pitchRadius,
        bearing.ballRadius,
        bearing.innerSpeedFactor,
        bearing.outerSpeedFactor,
      ].every(Number.isFinite) ||
      bearing.ballRadius <= 0 ||
      bearing.pitchRadius <= bearing.ballRadius
    )
      fail('Invalid or duplicate CAD radial bearing');
    bearings.set(bearing.id, bearing);
  }
  const seen = new Set(),
    gltf = models.get(model);
  const vector = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  for (const binding of array(mechanism.bindings, 'CAD bindings')) {
    const index = binding.gltfNodeIndex;
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      seen.has(index) ||
      !Number.isSafeInteger(gltf.nodes?.[index]?.mesh) ||
      !gltf.meshes?.[gltf.nodes[index].mesh]
    )
      fail(`Invalid or stale CAD mesh node binding ${index}`);
    seen.add(index);
    if (
      !vector(binding.pivot) ||
      !vector(binding.axis) ||
      Math.abs(Math.hypot(...binding.axis) - 1) >= 1e-6 ||
      (binding.center !== undefined && !vector(binding.center))
    )
      fail(`Invalid CAD SI pivot/axis/center ${index}`);
    if (
      ![
        'input',
        'output',
        'flexspline',
        'circular-spline',
        'ball',
        'inner-race',
        'outer-race',
        'armature',
        'fixed',
        'unknown',
      ].includes(binding.role)
    )
      fail(`Invalid CAD role ${index}`);
    if (
      ['ball', 'inner-race', 'outer-race'].includes(binding.role) &&
      !bearings.has(binding.bearingId)
    )
      fail(`Missing CAD bearing for ${index}`);
    for (const flag of ['inspectionCut', 'inspectionHidden'])
      if (binding[flag] !== undefined && typeof binding[flag] !== 'boolean')
        fail(`Invalid CAD inspection flag ${flag}`);
    if (binding.role === 'ball' && !vector(binding.center))
      fail(`CAD ball ${index} requires measured center`);
  }
}
