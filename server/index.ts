import { createApplication } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const runtime = createApplication(config);
runtime.server.listen(config.port, config.host, () => {
  console.log(`DeskLink is listening at ${config.origin}`);
});
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await runtime.close();
    process.exit(0);
  });
}
