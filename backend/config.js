import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
