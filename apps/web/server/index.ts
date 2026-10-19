import 'dotenv/config';
import { createApp } from './app';
import { readServerConfig } from './config';
const config = readServerConfig();
const app = await createApp(config);
try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  await app.close();
  throw error;
}
console.log(
  `VirtualWorld ${config.accessPolicy.mode} service listening on ${config.host}:${config.port}`,
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit());
  });
