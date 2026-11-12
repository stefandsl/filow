import { getMigrations } from 'better-auth/db/migration';
import { configuredCloud } from './config.mjs';
const { auth, database } = configuredCloud();
try { const migration = await getMigrations(auth.options); await migration.runMigrations(); await auth.$context; }
finally { database.close(); }
