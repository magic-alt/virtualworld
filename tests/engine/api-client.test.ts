import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../apps/web/src/api';

afterEach(() => vi.unstubAllGlobals());

it.each([
  ['', 500, '响应为空'],
  ['   ', 200, '响应为空'],
  ['{"unfinished":', 200, '无效 JSON'],
  ['<html>Bad Gateway</html>', 502, '无效 JSON'],
  ['null', 200, '无效 JSON'],
])(
  'reports unusable API responses with request and HTTP context (%s, %s)',
  async (body, status, reason) => {
    const fetcher = vi.fn(async () => new Response(body, { status }));
    vi.stubGlobal('fetch', fetcher);
    await expect(api('/api/generations', { method: 'POST' })).rejects.toThrow(
      new RegExp(`/api/generations.*HTTP ${status}.*${reason}`),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it('preserves structured server errors', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ error: '项目版本冲突' }, { status: 409 }));
  await expect(api('/api/projects/p1')).rejects.toThrow('项目版本冲突');
});

it('keeps HTTP context for JSON errors without a message', async () => {
  vi.stubGlobal('fetch', async () => Response.json({}, { status: 503 }));
  await expect(api('/api/projects')).rejects.toThrow(/\/api\/projects.*HTTP 503/);
});

it('returns valid JSON unchanged', async () => {
  vi.stubGlobal('fetch', async () => Response.json([{ id: 'p1' }]));
  await expect(api('/api/projects')).resolves.toEqual([{ id: 'p1' }]);
});
