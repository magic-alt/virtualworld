/** Run against a built production server; all story grants come from visible UI clicks. */
import assert from 'node:assert/strict';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.VW_TEST_ORIGIN || 'http://127.0.0.1:3137';
const phase = process.env.VW_PRINCE_PHASE || 'all';
assert.ok(['all', 'application', 'player'].includes(phase), `Unknown prince test phase: ${phase}`);
const deviceScaleFactor = Number(process.env.VW_PRINCE_DEVICE_SCALE_FACTOR || 1);
assert.ok(
  Number.isFinite(deviceScaleFactor) && deviceScaleFactor >= 0.25 && deviceScaleFactor <= 2,
  'VW_PRINCE_DEVICE_SCALE_FACTOR must be between 0.25 and 2',
);
const output = resolve('output/playwright/prince-affordances');
await mkdir(output, { recursive: true });
const reportPath = join(output, `report-${phase}.json`);
const report = {
  phase,
  ok: false,
  status: 'running',
  checks: [],
  errors: [],
  staticRequests: [],
  renderSettings: [],
  encounters: [],
  desertNavigation: [],
  desertActors: [],
  desertInput: [],
  limitations: ['No hardware mobile GPU validation.'],
};
async function checkpoint(stage) {
  report.progress = { stage, at: new Date().toISOString() };
  await writeFile(`${reportPath}.tmp`, JSON.stringify(report, null, 2));
  await rename(`${reportPath}.tmp`, reportPath);
  if (process.connected)
    process.send({ type: 'checkpoint', phase, stage, browserPid: report.browserPid }, () => {});
}
const check = async (text) => {
  report.checks.push(text);
  await checkpoint(text);
  console.log('PASS', text);
};
async function bounded(promise, timeout, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
let browser;
let browserServer;
let activePage;
const ready = async (page, id) => {
  await page.waitForFunction(
    (id) => {
      const runtime = window.virtualworld;
      const metrics = runtime?.getDiagnostics();
      return (
        runtime?.spec.id === id && metrics?.mode === 'explore' && !metrics.loading && metrics.player
      );
    },
    id,
    { timeout: 90000 },
  );
  assert.deepEqual(
    await page.evaluate(() => window.virtualworld.getDiagnostics().errors),
    [],
    `${id} must load its exported assets without runtime errors`,
  );
  await checkpoint(`${id}: runtime ready`);
};
async function waitForMovement(page, start) {
  return page.evaluate(
    (start) =>
      new Promise((resolve, reject) => {
        const runtime = window.virtualworld;
        const up = runtime.getDiagnostics().radialUp || [0, 1, 0];
        let frames = 0;
        let renderFrame = runtime.renderer.info.render.frame;
        let requestedFrame;
        let settled = false;
        let distance = 0;
        let player = start;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cancelAnimationFrame(requestedFrame);
          const result = { start, player, distance, frames };
          if (error) reject(new Error(`${error}: ${JSON.stringify(result)}`));
          else resolve(result);
        };
        const timer = setTimeout(() => finish('No effective movement within 60 seconds'), 60000);
        const frame = () => {
          if (settled) return;
          const currentFrame = runtime.renderer.info.render.frame;
          if (currentFrame === renderFrame) {
            requestedFrame = requestAnimationFrame(frame);
            return;
          }
          renderFrame = currentFrame;
          player = runtime.getDiagnostics().player;
          if (!player?.every(Number.isFinite)) return finish('Player position is not finite');
          const delta = player.map((value, i) => value - start[i]);
          const normal = delta.reduce((sum, value, i) => sum + value * up[i], 0);
          // Ground settling alone must not count as effective directional input.
          distance = Math.sqrt(
            Math.max(0, delta.reduce((sum, value) => sum + value ** 2, 0) - normal ** 2),
          );
          frames++;
          if (distance >= 0.16) return finish();
          // Allow a small real advance around an obstacle, never a zero-movement success.
          if (frames >= 48)
            return finish(distance >= 0.04 ? undefined : 'Movement stuck for 48 rendered frames');
          requestedFrame = requestAnimationFrame(frame);
        };
        requestedFrame = requestAnimationFrame(frame);
      }),
    start,
  );
}
async function stopped(page, label) {
  const result = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const runtime = window.virtualworld;
        let renderFrame = runtime.renderer.info.render.frame;
        let requestedFrame;
        let settled = false;
        let frames = 0;
        let stableFrames = 0;
        let anchor;
        let maxDrift = 0;
        let latest;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cancelAnimationFrame(requestedFrame);
          const result = { frames, stableFrames, maxDrift, ...latest };
          if (error) reject(new Error(`${error}: ${JSON.stringify(result)}`));
          else resolve(result);
        };
        const timer = setTimeout(() => finish('Input did not settle within 60 seconds'), 60000);
        const frame = () => {
          if (settled) return;
          const currentFrame = runtime.renderer.info.render.frame;
          if (currentFrame === renderFrame) {
            requestedFrame = requestAnimationFrame(frame);
            return;
          }
          renderFrame = currentFrame;
          const metrics = runtime.getDiagnostics();
          const player = metrics.player;
          latest = { player, actorClip: metrics.actorClip };
          if (!player?.every(Number.isFinite)) return finish('Stopped player is not finite');
          frames++;
          if (
            metrics.actorClip !== 'Idle' ||
            runtime.char.moving ||
            !runtime.char.controller.computedGrounded()
          ) {
            stableFrames = 0;
            anchor = undefined;
          } else {
            anchor ||= player;
            const drift = Math.hypot(player[0] - anchor[0], player[2] - anchor[2]);
            if (drift > 0.03) return finish('Idle actor continued moving after input ended');
            maxDrift = Math.max(maxDrift, drift);
            if (++stableFrames >= 12) return finish();
          }
          if (frames >= 120) return finish('Input remained active for 120 rendered frames');
          requestedFrame = requestAnimationFrame(frame);
        };
        requestedFrame = requestAnimationFrame(frame);
      }),
  );
  report.desertInput.push({ label, ...result });
  await check(`${label}: position settles on ground and Idle persists for 12 rendered frames`);
}
async function withMovement(page, direction, touch, observe) {
  await page.locator('canvas').focus();
  if (touch) {
    const bounds = await page.getByRole('group', { name: '移动摇杆' }).boundingBox();
    assert.ok(bounds, 'Touch joystick must be visible');
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    try {
      await page.mouse.move(x + direction.right * 34, y - direction.forward * 34);
      return await observe();
    } finally {
      await page.mouse.up();
    }
  }
  const keys = [];
  if (direction.forward > 0.2) keys.push('KeyW');
  if (direction.forward < -0.2) keys.push('KeyS');
  if (direction.right > 0.2) keys.push('KeyD');
  if (direction.right < -0.2) keys.push('KeyA');
  assert.ok(keys.length, 'Navigation must use an effective movement key');
  for (const key of keys) await page.keyboard.down(key);
  try {
    return await observe();
  } finally {
    for (const key of keys) await page.keyboard.up(key);
  }
}
async function desertCast(page, label, playing = true) {
  const cast = await page.evaluate(() => {
    const runtime = window.virtualworld;
    const rigs = [];
    runtime.world.updateMatrixWorld(true);
    // traverseVisible includes every ancestor, so a hidden authored model is not counted.
    runtime.world.traverseVisible((object) => {
      if (!['PrinceRig', 'PilotRig'].includes(object.name)) return;
      let owner = object;
      while (owner.parent?.userData.nodeId === object.userData.nodeId) owner = owner.parent;
      let skinnedMeshes = 0;
      owner.traverseVisible((child) => {
        if (
          child.isSkinnedMesh &&
          (Array.isArray(child.material) ? child.material : [child.material]).some(
            (material) => material.visible,
          )
        )
          skinnedMeshes++;
      });
      rigs.push({
        name: object.name,
        nodeId: object.userData.nodeId,
        position: owner.getWorldPosition(runtime.camera.position.clone()).toArray(),
        skinnedMeshes,
      });
    });
    return {
      rigs,
      actor: runtime.spec.actor,
      player: runtime.getDiagnostics().player,
      previewVisible: runtime.objects.get('prince')?.visible,
      authoredVisible: runtime.spec.nodes.find((node) => node.id === 'prince')?.visible,
    };
  });
  const princes = cast.rigs.filter((rig) => rig.name === 'PrinceRig');
  const pilots = cast.rigs.filter((rig) => rig.name === 'PilotRig');
  assert.equal(princes.length, 1, `${label}: exactly one Prince rig must be effectively visible`);
  assert.equal(pilots.length, 1, `${label}: exactly one pilot rig must be effectively visible`);
  assert.ok(
    cast.rigs.every((rig) => rig.skinnedMeshes > 0),
    `${label}: both rigs must render skin`,
  );
  assert.equal(
    cast.actor.assetId,
    'prince-character',
    `${label}: the Prince is the playable actor`,
  );
  assert.equal(cast.actor.nodeId, 'prince', `${label}: actor replaces the authored Prince preview`);
  assert.equal(princes[0].nodeId, playing ? 'runtime-actor' : 'prince');
  assert.equal(pilots[0].nodeId, 'pilot', `${label}: the visible pilot is an authored NPC`);
  assert.equal(cast.previewVisible, !playing, `${label}: preview visibility follows play state`);
  assert.equal(
    cast.authoredVisible,
    true,
    `${label}: transient play state must not edit SceneSpec`,
  );
  if (playing) {
    assert.ok(cast.player, `${label}: exploration must have a physics-controlled actor`);
    assert.ok(
      princes[0].position.every((value, index) => Math.abs(value - cast.player[index]) < 0.001),
      `${label}: the visible Prince rig must occupy the player position`,
    );
  }
  report.desertActors.push({ label, playing, ...cast });
  await checkpoint(`${label}: visible cast verified`);
  return { prince: princes[0], pilot: pilots[0], player: cast.player };
}
async function observeDesertWalk(page, options) {
  // Wait for rendered movement frames, not a fixed duration on SwiftShader.
  return page.evaluate(
    (options) =>
      new Promise((resolve, reject) => {
        const runtime = window.virtualworld;
        let previous = options.start;
        let frames = 0;
        let edgeFrames = 0;
        let minHeight = previous[1];
        let maxStep = 0;
        let walkClip = false;
        let renderFrame = runtime.renderer.info.render.frame;
        let requestedFrame;
        let settled = false;
        let lastWalkTime;
        let walkTimeAdvance = 0;
        let poseSamples = 0;
        const bones = new Map();
        if (options.sampleAnimation)
          runtime.char.object.traverseVisible((object) => {
            if (!object.isSkinnedMesh) return;
            for (const bone of object.skeleton.bones) {
              if (/^(Left|Right)(Arm|Leg)$/.test(bone.name))
                bones.set(bone.uuid, { bone, reference: undefined, maxAngle: 0 });
            }
          });
        const timer = setTimeout(
          () =>
            finish(`Desert movement timed out: ${JSON.stringify({ options, previous, frames })}`),
          180000,
        );
        const finish = (error, player) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cancelAnimationFrame(requestedFrame);
          if (error) reject(new Error(error));
          else
            resolve({
              start: options.start,
              player,
              frames,
              edgeFrames,
              minHeight,
              maxStep,
              walkClip,
              animation: options.sampleAnimation
                ? {
                    walkTimeAdvance,
                    poseSamples,
                    boneMotion: [...bones.values()].map(({ bone, maxAngle }) => ({
                      name: bone.name,
                      maxAngle,
                    })),
                  }
                : undefined,
            });
        };
        const frame = () => {
          if (settled) return;
          const currentFrame = runtime.renderer.info.render.frame;
          if (currentFrame === renderFrame) {
            requestedFrame = requestAnimationFrame(frame);
            return;
          }
          renderFrame = currentFrame;
          const metrics = runtime.getDiagnostics();
          const player = metrics.player;
          if (!player?.every(Number.isFinite))
            return finish('Desert player position is not finite');
          frames++;
          minHeight = Math.min(minHeight, player[1]);
          maxStep = Math.max(maxStep, Math.hypot(player[0] - previous[0], player[2] - previous[2]));
          walkClip ||= metrics.actorClip === 'Walk';
          if (options.sampleAnimation && metrics.actorClip === 'Walk') {
            const action = runtime.actorAction;
            const time = action.time;
            if (lastWalkTime !== undefined)
              walkTimeAdvance +=
                time >= lastWalkTime
                  ? time - lastWalkTime
                  : action.getClip().duration - lastWalkTime + time;
            lastWalkTime = time;
            // Ignore the 0.18 s Idle→Walk crossfade; sample the live skinned limb pose.
            // Local bone rotations exclude player translation and facing direction.
            if (walkTimeAdvance >= 0.25 && action.isRunning()) {
              poseSamples++;
              for (const sample of bones.values()) {
                sample.reference ||= sample.bone.quaternion.clone();
                sample.maxAngle = Math.max(
                  sample.maxAngle,
                  sample.reference.angleTo(sample.bone.quaternion),
                );
              }
            }
          }
          previous = player;
          // Authored dunes extend down to roughly -2 m; negative elevation is not a fall.
          if (minHeight < -3 || maxStep > 1)
            return finish(
              `Desert walk fell or respawned: ${JSON.stringify({ player, minHeight, maxStep })}`,
            );
          if (options.edge) {
            const { axis, sign, limit, bounds, radius } = options.edge;
            if (
              player[0] < bounds.min[0] + radius - 0.01 ||
              player[0] > bounds.max[0] - radius + 0.01 ||
              player[2] < bounds.min[1] + radius - 0.01 ||
              player[2] > bounds.max[1] - radius + 0.01
            )
              return finish(
                `Actor capsule escaped the safe desert boundary: ${JSON.stringify(player)}`,
              );
            edgeFrames =
              sign * (player[axis] - limit) >= -0.06 && runtime.char.controller.computedGrounded()
                ? edgeFrames + 1
                : 0;
            if (edgeFrames >= 24) return finish(undefined, player);
          } else if (player[0] >= 14) return finish(undefined, player);
          requestedFrame = requestAnimationFrame(frame);
        };
        requestedFrame = requestAnimationFrame(frame);
      }),
    options,
  );
}
async function desertRegression(page, label, touch) {
  const serialized = await page.evaluate(() => JSON.stringify(window.virtualworld.spec));
  const before = await desertCast(page, `${label}: initial explore`);
  await page.screenshot({ path: join(output, `${label}-desert-cast.png`) });
  const direction = await page.evaluate(() => {
    const runtime = window.virtualworld;
    const up = runtime.camera.position.clone().set(0, 1, 0);
    const forward = runtime.camera.getWorldDirection(runtime.camera.position.clone());
    forward.y = 0;
    forward.normalize();
    const right = forward.clone().cross(up);
    return { forward: forward.x, right: right.x };
  });
  // This leg starts at the real spawn and crosses the old 22 m terrain edge through input alone.
  await checkpoint(`${label}: walking from spawn past the old terrain edge`);
  const extended = await withMovement(page, direction, touch, () =>
    observeDesertWalk(page, { start: before.player, sampleAnimation: true }),
  );
  assert.ok(extended.walkClip, `${label}: movement must play the Prince's real Walk clip`);
  const animation = extended.animation;
  assert.ok(
    animation.walkTimeAdvance >= 0.75 && animation.poseSamples >= 6,
    `${label}: Walk advances while rendered poses are sampled`,
  );
  for (const limb of ['Arm', 'Leg'])
    assert.ok(
      animation.boneMotion.some(({ name, maxAngle }) => name.endsWith(limb) && maxAngle > 0.03),
      `${label}: a skinned ${limb} must visibly articulate during Walk`,
    );
  assert.ok(extended.player[0] >= 14, `${label}: walk at least 3 m beyond the old terrain edge`);
  await stopped(page, `${label}: ${touch ? 'joystick' : 'keyboard'} release`);
  const after = await desertCast(page, `${label}: beyond original terrain`);
  assert.ok(after.prince.position[0] - before.prince.position[0] > 13);
  assert.deepEqual(
    after.pilot.position,
    before.pilot.position,
    `${label}: pilot NPC must stay put`,
  );
  report.desertNavigation.push({
    label,
    method: 'real input from spawn past the old +11 m edge',
    ...extended,
  });
  await page.screenshot({ path: join(output, `${label}-desert-extended.png`) });
  await check(
    `${label}: the visible Little Prince articulates arms and legs while walking beyond the original terrain without falling`,
  );
  const navigation = await page.evaluate(() => window.virtualworld.spec.navigation);
  assert.equal(navigation.kind, 'plane');
  assert.ok(navigation.bounds, `${label}: the expanded desert has declared movement bounds`);
  assert.ok(
    navigation.bounds.max[0] - navigation.bounds.min[0] >= 180 &&
      navigation.bounds.max[1] - navigation.bounds.min[1] >= 180,
    `${label}: the navigable desert must be substantially wider than the original 22 m tile`,
  );
  for (const [name, axis, sign] of [
    ['east', 0, 1],
    ['west', 0, -1],
    ['south', 2, 1],
    ['north', 2, -1],
  ]) {
    const setup = await page.evaluate(
      ({ axis, sign }) => {
        const runtime = window.virtualworld;
        const bounds = runtime.spec.navigation.bounds;
        const radius = runtime.spec.actor.height * 0.17;
        const coordinate = axis === 0 ? 0 : 1;
        const limit = (sign > 0 ? bounds.max[coordinate] : bounds.min[coordinate]) - sign * radius;
        const position = runtime.camera.position.clone().set(0, 1, 0);
        position.setComponent(axis, limit - sign);
        // Explicit near-edge setup only: subsequent motion and collision are real runtime frames.
        // Long input-only walks and collision continuity are also covered by the Rapier regression.
        const bodyPosition = position
          .clone()
          .addScaledVector(runtime.char.up, runtime.spec.actor.height / 2);
        runtime.char.body.setTranslation(bodyPosition, true);
        runtime.char.body.setNextKinematicTranslation(bodyPosition);
        runtime.char.object.position.copy(position);
        runtime.controls.target.copy(position).add(runtime.camera.position.clone().set(0, 1, 0));
        runtime.camera.position.copy(position).add(runtime.camera.position.clone().set(0, 6, 0));
        runtime.camera.position.setComponent(axis, position.getComponent(axis) - sign * 7);
        runtime.controls.update();
        return { start: position.toArray(), edge: { axis, sign, limit, bounds, radius } };
      },
      { axis, sign },
    );
    await checkpoint(`${label}: testing ${name} boundary with near-edge setup`);
    const result = await withMovement(page, { forward: 1, right: 0 }, touch, () =>
      observeDesertWalk(page, setup),
    );
    assert.ok(
      Math.abs(result.player[axis] - setup.start[axis]) > 0.5,
      `${label}: input reaches ${name} bound`,
    );
    assert.ok(
      result.walkClip,
      `${label}: continued movement at ${name} boundary uses the walk animation`,
    );
    report.desertNavigation.push({
      label,
      edge: name,
      method: 'labeled near-edge setup, then real input',
      ...result,
    });
    await check(`${label}: ${name} boundary holds the grounded Prince for 24 rendered frames`);
  }
  await check(`${label}: all four desert boundaries keep the Prince on the rendered terrain`);
  for (let cycle = 1; cycle <= 2; cycle++) {
    const toggle = async () => {
      // Keyboard activation leaves a held joystick pointer untouched until the mode exits.
      const view = page.getByRole('button', { name: '切换自由观赏', exact: true });
      await view.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => {
        const metrics = window.virtualworld.getDiagnostics();
        return metrics.mode === 'view' && !metrics.player;
      });
      await desertCast(page, `${label}: view cycle ${cycle}`, false);
      const explore = page.getByRole('button', { name: '切换第三人称探索', exact: true });
      await explore.focus();
      await page.keyboard.press('Enter');
      await ready(page, 'little-prince-desert');
      await desertCast(page, `${label}: explore cycle ${cycle}`);
    };
    if (cycle === 1) await toggle();
    else {
      const start = await page.evaluate(() => window.virtualworld.getDiagnostics().player);
      await withMovement(page, { forward: 0, right: 1 }, touch, async () => {
        await waitForMovement(page, start);
        await toggle();
        await stopped(page, `${label}: active-input exit/re-entry has no movement latch`);
      });
      const reentered = await page.evaluate(() => window.virtualworld.getDiagnostics().player);
      await withMovement(page, { forward: 0, right: 1 }, touch, () =>
        waitForMovement(page, reentered),
      );
      await stopped(
        page,
        `${label}: fresh ${touch ? 'joystick' : 'keyboard'} input works after re-entry and releases`,
      );
    }
    await checkpoint(`${label}: view/explore cycle ${cycle} complete`);
  }
  assert.equal(await page.evaluate(() => JSON.stringify(window.virtualworld.spec)), serialized);
  await check(
    `${label}: repeated view/explore restores one Prince and one pilot without SceneSpec edits`,
  );
}
async function desertEditorCycles(page) {
  await page.goto(`${origin}/?project=little-prince-desert&edit=1`);
  await page.waitForFunction(() => {
    const runtime = window.virtualworld;
    const metrics = runtime?.getDiagnostics();
    return (
      runtime?.spec.id === 'little-prince-desert' && !metrics.loading && metrics.mode === 'edit'
    );
  });
  const serialized = await page.evaluate(() => JSON.stringify(window.virtualworld.spec));
  await desertCast(page, 'desktop: authored editor preview', false);
  for (let cycle = 1; cycle <= 3; cycle++) {
    await page.getByRole('button', { name: '体验', exact: true }).click();
    await page.waitForFunction(() => !!window.virtualworld.getDiagnostics().player);
    await desertCast(page, `desktop: editor play cycle ${cycle}`);
    await page.getByRole('button', { name: '退出体验', exact: true }).click();
    await page.waitForFunction(() => !window.virtualworld.getDiagnostics().player);
    await desertCast(page, `desktop: editor stop cycle ${cycle}`, false);
    await checkpoint(`desktop: editor play/stop cycle ${cycle} complete`);
  }
  assert.equal(await page.evaluate(() => JSON.stringify(window.virtualworld.spec)), serialized);
  assert.deepEqual(await page.evaluate(() => window.virtualworld.getDiagnostics().errors), []);
  await check(
    'desktop: repeated editor play/stop never duplicates the Prince or hides the authored preview',
  );
}
async function approach(page, id, touch) {
  await checkpoint(`Approaching ${id} through ${touch ? 'joystick' : 'keyboard'} input`);
  const deadline = Date.now() + 180000;
  for (let step = 0; step < 100; step++) {
    assert.ok(
      Date.now() < deadline,
      `Could not approach ${id} within the 180-second movement budget`,
    );
    // Read the public diagnostics and camera; drive real keyboard / joystick inputs.
    const direction = await page.evaluate((id) => {
      const runtime = window.virtualworld;
      const metrics = runtime.getDiagnostics();
      const player = runtime.camera.position.clone().fromArray(metrics.player);
      const target = runtime.camera.position
        .clone()
        .fromArray(runtime.spec.nodes.find((n) => n.id === id).position);
      const up = runtime.camera.position.clone().fromArray(metrics.radialUp || [0, 1, 0]);
      const delta = target.sub(player);
      if (runtime.spec.navigation?.kind !== 'sphere') delta.y = 0;
      const distance = delta.length();
      delta.addScaledVector(up, -delta.dot(up)).normalize();
      const forward = runtime.camera.getWorldDirection(runtime.camera.position.clone());
      forward.addScaledVector(up, -forward.dot(up)).normalize();
      const right = forward.clone().cross(up);
      return {
        distance,
        forward: delta.dot(forward),
        right: delta.dot(right),
        player: metrics.player,
      };
    }, id);
    if (direction.distance < 2.25) return;
    await withMovement(page, direction, touch, () => waitForMovement(page, direction.player));
    if (step % 10 === 9)
      await checkpoint(`Approaching ${id}: ${step + 1} effective movement segments`);
  }
  throw new Error(`Could not approach ${id} using real movement input`);
}
async function revealHotspot(page, id) {
  // Portrait views can put a nearby anchor outside the frustum. Scan with actual orbit gestures.
  for (let turn = 0; turn < 9; turn++) {
    if (
      await page.evaluate(
        (id) => window.virtualworld.getDiagnostics().hotspots.some((hotspot) => hotspot.id === id),
        id,
      )
    )
      return;
    const gesture = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const rect = canvas.getBoundingClientRect();
      // OrbitControls measures horizontal rotation against canvas height: approximately 45°.
      const distance = Math.min(rect.height / 8, rect.width * 0.45);
      for (const yFraction of [0.24, 0.4, 0.55, 0.7]) {
        const y = rect.top + rect.height * yFraction;
        for (const xFraction of [0.95, 0.75, 0.55]) {
          const x = rect.left + rect.width * xFraction;
          if (x - distance < rect.left + 10) continue;
          if (
            [0, 0.25, 0.5, 0.75, 1].every(
              (t) => document.elementFromPoint(x - distance * t, y) === canvas,
            )
          ) {
            return {
              x,
              y,
              toX: x - distance,
              before: window.virtualworld.camera.position.toArray(),
            };
          }
        }
      }
    });
    assert.ok(gesture, `No unobstructed canvas gesture available while revealing ${id}`);
    await page.mouse.move(gesture.x, gesture.y);
    await page.mouse.down();
    try {
      await page.mouse.move(gesture.toX, gesture.y, { steps: 12 });
    } finally {
      await page.mouse.up();
    }
    await page.waitForFunction(
      (before) =>
        window.virtualworld.camera.position
          .toArray()
          .some((value, i) => Math.abs(value - before[i]) > 0.001),
      gesture.before,
      { polling: 'raf', timeout: 60000 },
    );
    // Let the renderer refresh projection matrices; do not assume a fixed wall-clock frame rate.
    assert.ok(
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            const timer = setTimeout(() => resolve(false), 60000);
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                clearTimeout(timer);
                resolve(true);
              }),
            );
          }),
      ),
      `No rendered frames while revealing ${id}`,
    );
    await checkpoint(`Revealing ${id}: orbit gesture ${turn + 1} rendered`);
  }
  if (
    await page.evaluate(
      (id) => window.virtualworld.getDiagnostics().hotspots.some((hotspot) => hotspot.id === id),
      id,
    )
  )
    return;
  const diagnostic = await page.evaluate((id) => {
    const runtime = window.virtualworld;
    const node = runtime.spec.nodes.find((node) => node.id === id);
    const point = runtime.camera.position.clone().fromArray(node.position);
    if (runtime.spec.navigation?.kind === 'sphere') {
      const center = point.clone().fromArray(runtime.spec.navigation.center);
      point.addScaledVector(point.clone().sub(center).normalize(), 0.5);
    } else point.y += 0.35;
    return {
      player: runtime.getDiagnostics().player,
      camera: runtime.camera.position.toArray(),
      ndc: point.project(runtime.camera).toArray(),
      hotspots: runtime.getDiagnostics().hotspots,
    };
  }, id);
  throw new Error(
    `Hotspot ${id} remained outside the view after a bounded orbit scan: ${JSON.stringify(diagnostic)}`,
  );
}
async function encounter(page, id, flag, touch) {
  await approach(page, id, touch);
  await revealHotspot(page, id);
  const hotspot = page.locator(`.experience-hotspot[data-node-id="${id}"]`);
  await hotspot.waitFor({ state: 'visible' });
  await page.waitForFunction((id) => {
    const button = document.querySelector(`.experience-hotspot[data-node-id="${id}"]`);
    return button && !button.disabled;
  }, id);
  await hotspot.click();
  await page.getByRole('dialog').waitFor();
  assert.ok(
    await page.evaluate(
      (flag) => window.virtualworld.getDiagnostics().story.flags.includes(flag),
      flag,
    ),
  );
  report.encounters.push({
    id,
    touch,
    ...(await page.evaluate(() => ({
      scene: window.virtualworld.spec.id,
      flags: window.virtualworld.getDiagnostics().story.flags,
      player: window.virtualworld.getDiagnostics().player,
    }))),
  });
  await checkpoint(
    `${touch ? 'Joystick' : 'Keyboard'} encounter ${id} completed through its visible hotspot`,
  );
  console.log('ENCOUNTER', touch ? 'touch' : 'keyboard', report.encounters.at(-1).scene, id);
}
async function closeEncounter(page, standalone) {
  await page
    .getByRole('dialog')
    .getByRole('button', {
      name: standalone ? /^(继续|本章已完成 · 继续探索)$/ : /^(继续探索|本章已完成 · 继续探索)$/,
    })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
}
async function campaign(url, label, touch = false, standalone = false) {
  await checkpoint(`${label}: creating browser context`);
  const context = await browser.newContext({
    viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 720 },
    deviceScaleFactor,
    hasTouch: touch,
    isMobile: touch,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  page.setDefaultNavigationTimeout(90000);
  activePage = page;
  page.on('pageerror', (error) => report.errors.push(`${label}: ${error.message}`));
  if (standalone) {
    const staticOrigin = new URL(url).origin;
    await context.route('**/*', (route) => {
      const request = route.request().url();
      if (request.startsWith('data:') || request.startsWith('blob:')) return route.continue();
      const parsed = new URL(request);
      const blocked = parsed.origin !== staticOrigin || parsed.pathname.startsWith('/api/');
      report.staticRequests.push({ url: request, blocked });
      if (blocked) {
        report.errors.push(`Standalone requested a non-export resource: ${request}`);
        return route.abort();
      }
      return route.continue();
    });
  }
  await page.goto(url);
  await ready(page, 'little-prince-desert');
  const gpu = await page.evaluate(() => window.virtualworld.getDiagnostics().gpu);
  const software = /swiftshader|software|llvmpipe/i.test(gpu || '');
  if (software) {
    // Long navigation checks exercise the supported low-quality UI on software GPUs.
    // Keep normal physics, animation timing, geometry and visible input controls.
    await page.getByRole('button', { name: '播放设置', exact: true }).click();
    await page.getByLabel('画面质量', { exact: true }).selectOption('low');
    await page.getByRole('button', { name: '关闭播放设置', exact: true }).click();
    await page.waitForFunction(() => window.virtualworld.getDiagnostics().quality === 'low');
  }
  report.renderSettings.push({
    label,
    gpu,
    software,
    configuration: software
      ? `Low quality selected through playback settings; requested DPR ${deviceScaleFactor}`
      : `Default playback quality; requested DPR ${deviceScaleFactor}`,
    ...(await page.evaluate(() => {
      const runtime = window.virtualworld;
      const canvas = runtime.renderer.domElement;
      const shadowMaps = [];
      runtime.world.traverse((object) => {
        if (object.isDirectionalLight && object.castShadow)
          shadowMaps.push(object.shadow.mapSize.toArray());
      });
      return {
        quality: runtime.getDiagnostics().quality,
        pixelRatio: runtime.renderer.getPixelRatio(),
        viewport: [innerWidth, innerHeight],
        canvas: [canvas.width, canvas.height],
        shadowMaps,
      };
    })),
  });
  await checkpoint(`${label}: render configuration recorded`);
  await desertRegression(page, label, touch);
  await encounter(page, 'meeting', 'sheep', touch);
  await closeEncounter(page, standalone);
  const replay = page.locator('.experience-hotspot[data-node-id="meeting"]');
  assert.equal(await replay.getAttribute('data-status'), 'completed');
  await replay.click();
  await closeEncounter(page, standalone);
  await encounter(page, 'plane', 'depart', touch);
  await page.getByRole('button', { name: '下一章：每天照料的小星球', exact: true }).waitFor();
  await check(`${label}: visible desert encounters and completed dialogue replay work`);
  await page.screenshot({ path: join(output, `${label}-desert.png`) });
  {
    await page.getByRole('button', { name: '下一章：每天照料的小星球', exact: true }).click();
    await ready(page, 'little-prince-b612');
    for (const id of ['rose', 'volcano', 'sapling', 'sunset']) {
      await encounter(page, id, id, touch);
      if (id !== 'sunset') await closeEncounter(page, standalone);
    }
    await page.getByRole('button', { name: '下一章：玫瑰与狐狸', exact: true }).click();
    await ready(page, 'little-prince-earth');
    for (const [id, flag] of [
      ['garden', 'garden'],
      ['friend', 'friend'],
      ['wheat', 'wheat'],
      ['reflection', 'reflection'],
    ]) {
      await encounter(page, id, flag, touch);
      if (id !== 'reflection') await closeEncounter(page, standalone);
    }
    const dialog = page.getByRole('dialog');
    await dialog.getByText('旅程已完成 · 谢谢你陪伴这些相遇', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: /^下一章：/ }).count(), 0);
    await page.screenshot({ path: join(output, `${label}-complete.png`) });
    await check(
      `${label}: all chapters completed through visible hotspots; correct next/end actions`,
    );
  }
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  if (!touch && !standalone) await desertEditorCycles(page);
  await context.close();
  await checkpoint(`${label}: browser context closed`);
}
try {
  await checkpoint('Launching Chromium');
  browserServer = await chromium.launchServer({
    headless: true,
    host: '127.0.0.1',
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
    timeout: 60000,
  });
  report.browserPid = browserServer.process().pid;
  await checkpoint('Chromium process started');
  browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 60000 });
  report.browser = await browser.version();
  if (phase !== 'player') {
    await campaign(`${origin}/?project=little-prince-desert`, 'desktop');
    await campaign(`${origin}/?project=little-prince-desert`, 'mobile', true);
  }
  if (phase !== 'application' && process.env.VW_PRINCE_PLAYER_URL) {
    await campaign(process.env.VW_PRINCE_PLAYER_URL, 'offline-player', false, true);
  } else if (phase !== 'application') {
    assert.notEqual(phase, 'player', 'VW_PRINCE_PLAYER_URL is required in player phase');
    report.limitations.push(
      'Set VW_PRINCE_PLAYER_URL to exercise an independently served campaign export.',
    );
  }
  assert.deepEqual(report.errors, []);
  report.ok = true;
  report.status = 'passed';
} catch (error) {
  report.ok = false;
  report.status = 'failed';
  report.failure = String(error);
  report.errors.push(String(error));
  process.exitCode = 1;
  // Persist the failure before inspecting a renderer that may no longer respond.
  await checkpoint('Phase failed; collecting bounded diagnostics');
  report.diagnostics = await bounded(
    activePage?.evaluate(() => ({
      scene: window.virtualworld?.spec.id,
      metrics: window.virtualworld?.getDiagnostics(),
      hotspots: [...document.querySelectorAll('.experience-hotspot')].map((button) => ({
        id: button.dataset.nodeId,
        text: button.textContent,
        disabled: button.disabled,
        bounds: button.getBoundingClientRect().toJSON(),
      })),
    })),
    5000,
    'Failure diagnostics',
  ).catch(() => undefined);
  await activePage
    ?.screenshot({ path: join(output, 'failure.png'), timeout: 5000 })
    .catch(() => {});
  console.error(error);
} finally {
  await checkpoint(report.ok ? 'All phase checks completed' : 'Phase failed');
  try {
    await bounded(browserServer?.close(), 5000, 'Chromium shutdown');
    await bounded(browser?.close(), 5000, 'Browser client shutdown');
  } catch (error) {
    report.ok = false;
    report.status = 'failed';
    report.failure ||= String(error);
    report.errors.push(String(error));
    process.exitCode = 1;
    await checkpoint('Browser shutdown failed');
    await bounded(browserServer?.kill(), 5000, 'Chromium forced shutdown').catch((failure) =>
      report.errors.push(String(failure)),
    );
    await checkpoint('Browser forced shutdown attempted');
  }
  if (process.connected) process.disconnect();
}
