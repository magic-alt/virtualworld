import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { readServerConfig } from '../../apps/web/server/config';
import { OperationGate } from '../../apps/web/server/admission';

it('keeps local defaults and refuses accidental public unauthenticated binding', () => {
  expect(readServerConfig({})).toMatchObject({
    host: '127.0.0.1',
    port: 3001,
    accessPolicy: { mode: 'local' },
  });
  // An absent override preserves createApp's existing local upload library.
  // Passing an explicit dataRoot switches uploads to dataRoot/asset-library.
  expect(readServerConfig({}).dataRoot).toBeUndefined();
  for (const env of [
    { VW_HOST: '0.0.0.0' },
    { VW_SERVER_MODE: 'typo' },
    { PORT: '123abc' },
    { PORT: '0' },
    { VW_MAX_PENDING_GENERATIONS: '0' },
  ]) {
    expect(() => readServerConfig(env)).toThrow();
  }
});

it('requires an explicit HTTPS origin, durable data directory and strong gateway credential for hosted mode', () => {
  const env = {
    VW_SERVER_MODE: 'hosted',
    VW_PUBLIC_ORIGIN: 'https://studio.example',
    VW_GATEWAY_SECRET: 'test-secret-32-characters-or-more-long',
    VW_DATA_ROOT: '/tmp/vw-config-data',
  };
  const config = readServerConfig(env);
  expect(config.host).toBe('0.0.0.0');
  expect(config.generatedRoot).toBe(resolve('/tmp/vw-config-data/workspace'));
  expect(config.accessPolicy).toMatchObject({
    mode: 'hosted',
    publicOrigin: 'https://studio.example',
  });
  for (const patch of [
    { VW_PUBLIC_ORIGIN: 'http://studio.example' },
    { VW_PUBLIC_ORIGIN: 'https://studio.example/path' },
    { VW_PUBLIC_ORIGIN: 'https://user:password@studio.example' },
    { VW_GATEWAY_SECRET: '' },
    { VW_GATEWAY_SECRET: 'short' },
    { VW_DATA_ROOT: '' },
  ])
    expect(() => readServerConfig({ ...env, ...patch })).toThrow();
});

it('bounds operations and releases capacity after successful work and failures', async () => {
  const gate = new OperationGate(1, 'test');
  let finish!: () => void;
  const first = gate.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  let executed = false;
  await expect(
    gate.run(async () => {
      executed = true;
    }),
  ).rejects.toMatchObject({ statusCode: 429 });
  expect(executed).toBe(false);
  finish();
  await first;
  await expect(
    gate.run(async () => {
      throw new Error('failed work');
    }),
  ).rejects.toThrow('failed work');
  await expect(gate.run(async () => 'next')).resolves.toBe('next');
  expect(gate.active).toBe(0);
});
