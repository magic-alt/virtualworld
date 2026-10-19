import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AccessPolicySchema, LOOPBACK_HOSTS, type AccessPolicy } from './config';
import { HttpError } from './store';

function authority(value: string | undefined) {
  if (!value || !/^[A-Za-z0-9.\[\]:-]+$/.test(value)) return null;
  try {
    return new URL(`http://${value}`);
  } catch {
    return null;
  }
}
/** Gateway authentication protects one SHARED workspace; it is not per-user authorization. */
export function registerAccess(app: FastifyInstance, input: AccessPolicy) {
  const policy = AccessPolicySchema.parse(input);
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expected = policy.mode === 'hosted' ? digest(policy.gatewaySecret) : undefined;
  const publicHost = policy.mode === 'hosted' ? new URL(policy.publicOrigin).host : undefined;
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Request-Id', req.id).header('X-Content-Type-Options', 'nosniff');
    if (req.routeOptions.url === '/healthz' && ['GET', 'HEAD'].includes(req.method)) return;
    const host = authority(req.headers.host);
    if (policy.mode === 'hosted') {
      const token = req.headers['x-virtualworld-gateway'];
      if (
        !host ||
        host.host !== publicHost ||
        typeof token !== 'string' ||
        token.length > 256 ||
        !timingSafeEqual(expected!, digest(token))
      )
        throw new HttpError(403, '需要通过已认证的团队入口访问');
      if (req.headers.origin !== undefined && req.headers.origin !== policy.publicOrigin)
        throw new HttpError(403, '拒绝跨站点访问');
    } else {
      if (!host || !LOOPBACK_HOSTS.includes(host.hostname))
        throw new HttpError(403, '本地服务只接受回环地址访问');
      if (req.headers.origin !== undefined) {
        let allowed = false;
        try {
          const origin = new URL(req.headers.origin);
          allowed =
            origin.origin === req.headers.origin &&
            ['http:', 'https:'].includes(origin.protocol) &&
            LOOPBACK_HOSTS.includes(origin.hostname) &&
            [String(policy.port), '5173'].includes(origin.port);
        } catch {}
        if (!allowed) throw new HttpError(403, '拒绝来自其他站点的本地服务访问');
      }
    }
  });
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.split('?')[0].startsWith('/api/') || req.routeOptions.url === '/healthz')
      reply.header('Cache-Control', 'private, no-store');
    else if (policy.mode === 'hosted') {
      const cache = String(reply.getHeader('Cache-Control') || 'max-age=0, must-revalidate');
      reply.header('Cache-Control', `private, ${cache.replace(/\bpublic,?\s*/g, '')}`);
    }
    return payload;
  });
}
