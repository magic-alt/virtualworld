export async function api(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  return readJsonResponse(response, path);
}
export async function readJsonResponse(response: Response, path: string) {
  const context = `${path}（HTTP ${response.status}）`;
  const text = await response.text();
  const hint = '请检查 API 服务是否已启动及代理连接是否正常。';
  if (!text.trim()) throw new Error(`${context}：响应为空。${hint}`);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${context}：服务返回无效 JSON。${hint}`);
  }
  if (!body || typeof body !== 'object')
    throw new Error(`${context}：服务返回无效 JSON 数据。${hint}`);
  if (!response.ok)
    throw new Error(typeof body.error === 'string' && body.error ? body.error : context);
  return body;
}
export const json = (body: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
export function readPreference(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage is optional. */
  }
}
