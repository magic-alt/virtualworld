import 'dotenv/config';
import { createApp } from './app';
const app = await createApp({ dataRoot: process.env.VW_DATA_ROOT });
const port = Number(process.env.PORT || 3001);
await app.listen({ host: '127.0.0.1', port });
console.log(`VirtualWorld local service: http://127.0.0.1:${port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit());
  });
