import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export * from './schema.js';
export * from './network.js';
export * from './seed.js';

export type DB = ReturnType<typeof createDb>;

export function createDb(url: string) {
  const client = postgres(url, { max: 20 });
  return drizzle(client, { schema });
}

export { schema };