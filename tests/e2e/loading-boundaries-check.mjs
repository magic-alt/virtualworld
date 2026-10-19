import assert from 'node:assert/strict';

/** Reuses the caller's production server/browser; never reserves a port or starts a build. */
export async function checkLoadingBoundaries(browser, origin, check) {
  const idleGate = async (context) => {
    await context.addInitScript(() => {
      let sequence = 0;
      const pending = new Map();
      window.requestIdleCallback = (callback) => {
        pending.set(++sequence, callback);
        return sequence;
      };
      window.cancelIdleCallback = (id) => pending.delete(id);
      window.__previewIdleCount = () => pending.size;
      window.__flushPreviewIdle = () => {
        const callbacks = [...pending.values()];
        pending.clear();
        callbacks.forEach((callback) => callback({ didTimeout: false, timeRemaining: () => 50 }));
      };
    });
  };
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  try {
    await idleGate(context);
    const page = await context.newPage();
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(origin);
    await page.getByRole('heading', { level: 1 }).filter({ hasText: '让想象' }).waitFor();
    await page.waitForFunction(() => window.__previewIdleCount() > 0);
    assert.equal(await page.locator('.home-preview-poster').isVisible(), true);
    assert.equal(await page.locator('canvas').count(), 0);
    assert.equal(
      requests.some((url) => /\/(?:LivePreview|WorldExperience)-[^/]+\.js/.test(url)),
      false,
    );
    assert.equal(
      requests.some((url) => url.includes('/assets/optimized/')),
      false,
    );
    check('Home poster appears before idle without renderer, experience modules or model requests');

    await page.route(/\/assets\/LivePreview-[^/]+\.js(?:\?.*)?$/, (route) => route.abort());
    await page.evaluate(() => window.__flushPreviewIdle());
    await page.getByRole('status').filter({ hasText: '实时预览暂不可用' }).waitFor();
    assert.equal(await page.locator('.home-preview-poster').isVisible(), true);
    assert.equal(await page.locator('canvas').count(), 0);
    check('Failed lazy preview leaves a visible poster and useful status');
  } finally {
    await context.close();
  }

  const unmountContext = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  try {
    await idleGate(unmountContext);
    const page = await unmountContext.newPage();
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await page.route(/\/assets\/LivePreview-[^/]+\.js(?:\?.*)?$/, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(origin);
    await page.waitForFunction(() => window.__previewIdleCount() > 0);
    const previewRequest = page.waitForRequest(/\/assets\/LivePreview-[^/]+\.js(?:\?.*)?$/);
    await page.evaluate(() => window.__flushPreviewIdle());
    await previewRequest;
    const opened = page.getByRole('button').filter({ hasText: '精密之中的宇宙' });
    await opened.click();
    await page.waitForURL(/project=demo-harmonic-joint/);
    release();
    await page.waitForFunction(
      () => window.virtualworld && !window.virtualworld.getDiagnostics().loading,
    );
    assert.equal(await page.locator('.home-preview').count(), 0);
    assert.equal(await page.locator('canvas').count(), 1);
    assert.equal(await page.evaluate(() => window.virtualworld.spec.id), 'demo-harmonic-joint');
    check('Entering an experience while preview import is pending leaves one live runtime');
  } finally {
    await unmountContext.close();
  }
}
