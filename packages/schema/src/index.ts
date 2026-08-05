import { z } from 'zod';

export const telemetryEventSchema = z.object({
  device_id: z.string().min(1),
  pole_id: z.string().min(1),
  event: z.enum(['heartbeat', 'power_lost', 'power_restored', 'boot']),
  energized: z.boolean(),
  ts: z.string().datetime(),
  seq: z.number().int().nonnegative(),
  battery_mv: z.number(),
  rssi: z.number(),
  fw: z.string(),
});

export const ingestSchema = z.union([
  telemetryEventSchema,
  z.array(telemetryEventSchema).min(1).max(2000),
]);

export const faultInjectSchema = z.object({
    type: z.enum(['span', 'dt', 'feeder']),
    dtId: z.string().optional(),
    feederId: z.string().optional(),
    fromPole: z.string().optional(),
    toPole: z.string().optional(),
    mode: z.enum(['clean', 'noisy']).default('clean'),
    kind: z.literal('fault').default('fault'),
  });

export const noiseInjectSchema = z.object({
  kind: z.enum(['device-die', 'scheduled-outage', 'duplicate', 'out-of-order']),
  poleId: z.string().optional(),
  targetId: z.string().optional(),
});

export const repairSchema = z.object({
  incidentId: z.string().optional(),
  dtId: z.string().optional(),
  kind: z.literal('repair').default('repair'),
});

export const ackSchema = z.object({
  operator: z.string().default('operator'),
});

export const assignSchema = z.object({
  crew: z.string().min(1),
});

export const resolveSchema = z.object({
  by: z.string().default('operator'),
});

export type TelemetryEventInput = z.infer<typeof telemetryEventSchema>;
export type IngestInput = z.infer<typeof ingestSchema>;
export type FaultInjectInput = z.infer<typeof faultInjectSchema>;
export type NoiseInjectInput = z.infer<typeof noiseInjectSchema>;
export type RepairInput = z.infer<typeof repairSchema>;