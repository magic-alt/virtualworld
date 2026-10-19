import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function blockInitialContext(page) {
  await page.addInitScript(() => {
    window.__webglTestBlocked = true;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (kind === 'webgl2' && window.__webglTestBlocked) return null;
      return getContext.call(this, kind, ...args);
    };
  });
}
export async function ready(page, id) {
  await page.waitForFunction(
    (expected) => {
      const runtime = window.virtualworld;
      return (
        runtime &&
        (!expected || runtime.spec.id === expected) &&
        !runtime.getDiagnostics().loading &&
        runtime.getGraphicsState().status === 'ready'
      );
    },
    id,
    { timeout: 45000 },
  );
  await page.getByTestId('graphics-status-panel').waitFor({ state: 'hidden' });
  await page.evaluate(() => window.virtualworld.setQuality('low'));
}
export async function snapshot(page) {
  return page.evaluate(() => {
    const runtime = window.virtualworld;
    const diagnostics = runtime.getDiagnostics();
    return {
      frame: runtime.renderer.info.render.frame,
      player: diagnostics.player,
      paused: diagnostics.paused,
      mechanism: diagnostics.mechanism,
      graphics: runtime.getGraphicsState(),
      spec: JSON.stringify(runtime.spec),
    };
  });
}
export async function lose(page) {
  await page.evaluate(() => {
    const runtime = window.virtualworld;
    const extension = runtime.renderer.getContext().getExtension('WEBGL_lose_context');
    if (!extension)
      throw new Error('This browser lacks the required real WEBGL_lose_context extension');
    window.__webglTestCanvas = runtime.renderer.domElement;
    window.__webglTestExtension = extension;
    extension.loseContext();
  });
  await page.waitForFunction(() => window.virtualworld.getGraphicsState().status === 'lost');
  const panel = page.getByTestId('graphics-status-panel');
  await panel.waitFor({ state: 'visible' });
  assert.equal(await panel.getAttribute('role'), 'status');
  assert.equal(
    await panel.getByRole('button', { name: '重试加载画面', exact: true }).isDisabled(),
    true,
  );
}
export async function restore(page, id) {
  await page.evaluate(() => window.__webglTestExtension.restoreContext());
  await ready(page, id);
  assert.equal(
    await page.evaluate(() => window.virtualworld.renderer.domElement === window.__webglTestCanvas),
    true,
    'Context restoration should retain the owning canvas',
  );
}
export async function capture(page, output, name, report) {
  const result = await page.evaluate(async () => {
    const runtime = window.virtualworld;
    const url = runtime.screenshot();
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, 64, 64);
    const pixels = context.getImageData(0, 0, 64, 64).data;
    const colors = new Set();
    let opaque = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      if (pixels[i + 3] === 255) opaque++;
    }
    return {
      width: image.width,
      height: image.height,
      colors: colors.size,
      opaque,
      gpu: runtime.getDiagnostics().gpu,
      errors: runtime.getDiagnostics().errors,
      data: url.split(',')[1],
    };
  });
  await writeFile(join(output, `${name}.png`), Buffer.from(result.data, 'base64'));
  delete result.data;
  report.captures.push({ name, ...result });
  assert.deepEqual(result.errors, [], 'Recovered runtime reported asset/resource errors');
  assert.ok(result.width > 0 && result.height > 0);
  assert.equal(result.opaque, 4096, 'Recovered capture must be fully opaque');
  assert.ok(result.colors > 20, `Recovered scene is blank/nearly blank (${result.colors} colors)`);
  return result;
}
export async function assertFrozen(page, delay = 250) {
  const before = await snapshot(page);
  await page.waitForTimeout(delay);
  const after = await snapshot(page);
  assert.equal(after.frame, before.frame, 'Lost context must not submit render frames');
  assert.deepEqual(after.player, before.player, 'Lost context must not advance character physics');
  assert.equal(
    after.mechanism?.inputAngle,
    before.mechanism?.inputAngle,
    'Lost context must not advance mechanism',
  );
  return after;
}
export async function verifySplatPixels(page, report, output) {
  const result = await page.evaluate(async () => {
    const runtime = window.virtualworld;
    const paused = runtime.getDiagnostics().paused;
    runtime.setPaused(true);
    runtime.isolate('splat-cloud');
    runtime.camera.position.set(0, 4, 3);
    runtime.controls.target.set(0, 4, -5);
    runtime.controls.update();
    // Allow Spark's public render/update pipeline to sort the new camera view before sampling.
    for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
    const splat = runtime.objects.get('splat-cloud');
    if (!splat) throw new Error('Mixed fixture did not load its splat');
    async function pixels() {
      // Visibility changes reach Spark through its asynchronous render/sort pipeline.
      for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
      const image = new Image();
      image.src = runtime.screenshot();
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, 64, 64);
      return { data: context.getImageData(0, 0, 64, 64).data, png: image.src.split(',')[1] };
    }
    const shown = await pixels();
    const background = Array.from(shown.data.slice(0, 3));
    let changed = 0;
    const colors = new Set();
    for (let i = 0; i < shown.data.length; i += 4) {
      const [r, g, b] = shown.data.slice(i, i + 3);
      colors.add(`${r},${g},${b}`);
      if (
        Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]) >
        12
      )
        changed++;
    }
    runtime.isolate();
    runtime.setPaused(paused);
    return {
      changed,
      colors: colors.size,
      splats: runtime.getDiagnostics().splats,
      png: shown.png,
      camera: runtime.camera.position.toArray(),
      target: runtime.controls.target.toArray(),
    };
  });
  if (output)
    await writeFile(
      join(output, `splat-visible-${report.splatPixels?.length ?? 0}.png`),
      Buffer.from(result.png, 'base64'),
    );
  delete result.png;
  report.splatPixels ??= [];
  report.splatPixels.push(result);
  assert.ok(result.colors > 20, `Isolated splat image has only ${result.colors} colors`);
  assert.ok(
    result.changed > 8,
    `Isolated splat does not contribute colored pixels above uniform background (${result.changed} samples)`,
  );
}
