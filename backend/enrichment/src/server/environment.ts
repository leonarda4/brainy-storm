import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Resolve from this module, not the terminal's working directory. Deployment
// environment variables retain precedence over the shared local .env file.
dotenv.config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });
