/** Run against a built production server; all story grants come from visible UI clicks. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.VW_TEST_ORIGIN || 'http://127.0.0.1:3137';
const phase = process.env.VW_PRINCE_PHASE || 'all';
assert.ok(['all', 'application', 'player'].includes(phase), `Unknown prince test phase: ${phase}`);
const output = resolve('output/playwright/prince-affordances');
await mkdir(output, { recursive: true });
const report = {
  phase,
  checks: [],
  errors: [],
  staticRequests: [],
  renderSettings: [],
  encounters: [],
  limitations: ['No hardware mobile GPU validation.'],
};
const check = (text) => {
  report.checks.push(text);
  console.log('PASS', text);
};
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  timeout: 60000,
});
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
};
async function waitForMovement(page, start) {
  return page.evaluate(
    (start) =>
      new Promise((resolve, reject) => {
        let frames = 0;
        const timer = setTimeout(
          () => reject(new Error('No effective movement frames within 60 seconds')),
          60000,
        );
        const frame = () => {
          const player = window.virtualworld.getDiagnostics().player;
          const distance = Math.hypot(...player.map((value, i) => value - start[i]));
          frames++;
          if (distance >= 0.16 || frames >= 12) {
            clearTimeout(timer);
            resolve({ distance, frames });
          } else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    start,
  );
}
async function approach(page, id, touch) {
  for (let step = 0; step < 100; step++) {
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
    await page.locator('canvas').focus();
    if (touch) {
      const bounds = await page.getByRole('group', { name: '移动摇杆' }).boundingBox();
      assert.ok(bounds, 'Touch joystick must be visible');
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + direction.right * 34, y - direction.forward * 34);
      await waitForMovement(page, direction.player);
      await page.mouse.up();
    } else {
      const keys = [];
      if (direction.forward > 0.2) keys.push('KeyW');
      if (direction.forward < -0.2) keys.push('KeyS');
      if (direction.right > 0.2) keys.push('KeyD');
      if (direction.right < -0.2) keys.push('KeyA');
      for (const key of keys) await page.keyboard.down(key);
      await waitForMovement(page, direction.player);
      for (const key of keys) await page.keyboard.up(key);
    }
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
  const context = await browser.newContext({
    viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 960 },
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
  if (/swiftshader|software|llvmpipe/i.test(gpu || '')) {
    // Long navigation checks exercise the supported low-quality UI on software GPUs.
    // Default-quality rendering is qualified separately by runtime-quality/harmonic checks.
    await page.getByRole('button', { name: '播放设置', exact: true }).click();
    await page.getByLabel('画面质量', { exact: true }).selectOption('low');
    await page.getByRole('button', { name: '关闭播放设置', exact: true }).click();
  }
  report.renderSettings.push({
    label,
    gpu,
    quality: await page.evaluate(() => window.virtualworld.getDiagnostics().quality),
  });
  await encounter(page, 'meeting', 'sheep', touch);
  await closeEncounter(page, standalone);
  const replay = page.locator('.experience-hotspot[data-node-id="meeting"]');
  assert.equal(await replay.getAttribute('data-status'), 'completed');
  await replay.click();
  await closeEncounter(page, standalone);
  await encounter(page, 'plane', 'depart', touch);
  await page.getByRole('button', { name: '下一章：每天照料的小星球', exact: true }).waitFor();
  check(`${label}: visible desert encounters and completed dialogue replay work`);
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
    check(`${label}: all chapters completed through visible hotspots; correct next/end actions`);
  }
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  await context.close();
}
try {
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
} catch (error) {
  report.ok = false;
  report.failure = String(error);
  report.diagnostics = await activePage
    ?.evaluate(() => ({
      scene: window.virtualworld?.spec.id,
      metrics: window.virtualworld?.getDiagnostics(),
      hotspots: [...document.querySelectorAll('.experience-hotspot')].map((button) => ({
        id: button.dataset.nodeId,
        text: button.textContent,
        disabled: button.disabled,
        bounds: button.getBoundingClientRect().toJSON(),
      })),
    }))
    .catch(() => undefined);
  await activePage?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
  console.error(error);
} finally {
  await writeFile(join(output, `report-${phase}.json`), JSON.stringify(report, null, 2));
  await browser.close();
}
