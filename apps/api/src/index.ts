import { buildServer } from './server.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const app = buildServer();

app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
