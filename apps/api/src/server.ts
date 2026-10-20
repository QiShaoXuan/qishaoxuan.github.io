import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { safeDiagnostic } from './diagnostics.js';
import type { DiagnosticStage } from './diagnostics.js';

let stage: DiagnosticStage = 'config';

try {
  const config = loadConfig();
  stage = 'build';
  const app = await buildApp(config);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await app.close();
    } catch (error) {
      app.log.error({ outcome: 'error', ...safeDiagnostic(error, 'shutdown') }, 'shutdown');
      process.exitCode = 1;
    }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  stage = 'listen';
  await app.listen({ host: config.host, port: config.port });
  app.log.info({ env: config.release?.environment ?? 'local', commit: config.release?.commit }, 'startup');
} catch (error) {
  console.error(JSON.stringify({ level: 'error', outcome: 'startup_failed', ...safeDiagnostic(error, stage) }));
  process.exitCode = 1;
}
