import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.POSTGRES_URL ?? 'postgres://gridwatch:gridwatch@localhost:5432/gridwatch',
  },
  strict: true,
  verbose: true,
});