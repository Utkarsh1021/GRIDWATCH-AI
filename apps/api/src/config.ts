import { config } from 'dotenv';
config();

export const env = {
  postgresUrl: process.env.POSTGRES_URL ?? 'postgres://gridwatch:gridwatch@db:5432/gridwatch',
  port: Number(process.env.PORT ?? 3001),
  seedOnStart: (process.env.SEED_ON_START ?? 'true') === 'true',
  seedScale: (process.env.SEED_SCALE ?? 'small') as 'small' | 'full',
  heartbeatMs: Number(process.env.HEARTBEAT_MS ?? 900000),
  debounceMs: Number(process.env.DEBOUNCE_MS ?? 30000),
  silenceGraceMs: Number(process.env.SILENCE_GRACE_MS ?? 120000),
  verifyThreshold: Number(process.env.VERIFY_THRESHOLD ?? 0.9),
  detectionTickMs: Number(process.env.DETECTION_TICK_MS ?? 15000),
  fleetEnabled: (process.env.FLEET_ENABLED ?? 'true') === 'true',
  fleetHeartbeatMs: Number(process.env.FLEET_HEARTBEAT_MS ?? 900000),
  aiApiKey: process.env.AI_API_KEY ?? '',
  aiModel: process.env.AI_MODEL ?? 'gpt-4o-mini',
};

export const silenceMs = env.heartbeatMs * 2 + env.silenceGraceMs;