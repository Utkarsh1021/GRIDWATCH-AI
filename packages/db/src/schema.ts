import { jsonb, index, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex, boolean } from 'drizzle-orm/pg-core';

export const feeders = pgTable(
  'feeders',
  {
    id: text('id').primaryKey(),
    substation_id: text('substation_id').notNull(),
    name: text('name').notNull(),
  },
  (t) => [index('feeders_substation_idx').on(t.substation_id)],
);

export const transformers = pgTable('transformers', {
  id: text('id').primaryKey(),
  feeder_id: text('feeder_id').notNull(),
  lat: numeric('lat').notNull(),
  lon: numeric('lon').notNull(),
  capacity_kva: integer('capacity_kva').notNull(),
  households_served: integer('households_served').notNull(),
});

export const poles = pgTable(
  'poles',
  {
    id: text('id').primaryKey(),
    lat: numeric('lat').notNull(),
    lon: numeric('lon').notNull(),
    feeder_id: text('feeder_id').notNull(),
    dt_id: text('dt_id').notNull(),
    seq_on_line: integer('seq_on_line'),
    parent_pole_id: text('parent_pole_id'),
    pole_type: text('pole_type').notNull(),
    ward: text('ward').notNull(),
    pincode: text('pincode'),
    device_id: text('device_id'),
  },
  (t) => [
    index('poles_dt_idx').on(t.dt_id),
    index('poles_feeder_idx').on(t.feeder_id),
    index('poles_parent_idx').on(t.parent_pole_id),
  ],
);

export const edges = pgTable(
  'edges',
  {
    id: serial('id').primaryKey(),
    dt_id: text('dt_id').notNull(),
    from_pole: text('from_pole').notNull(),
    to_pole: text('to_pole').notNull(),
    source: text('source').notNull(),
    confidence: numeric('confidence').notNull().default('1'),
  },
  (t) => [
    index('edges_dt_idx').on(t.dt_id),
    uniqueIndex('edges_unique').on(t.dt_id, t.from_pole, t.to_pole),
  ],
);

export const telemetry_events = pgTable(
  'telemetry_events',
  {
    id: serial('id').primaryKey(),
    device_id: text('device_id').notNull(),
    pole_id: text('pole_id').notNull(),
    event: text('event').notNull(),
    energized: boolean('energized').notNull(),
    seq: integer('seq').notNull(),
    fw: text('fw').notNull(),
    recv_at: timestamp('recv_at', { withTimezone: true }).notNull(),
    event_ts: timestamp('event_ts', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('telemetry_uniq').on(t.device_id, t.seq),
    index('telemetry_recv_idx').on(t.recv_at),
    index('telemetry_replied_pole_idx').on(t.pole_id),
  ],
);

export const pole_states = pgTable('pole_states', {
  pole_id: text('pole_id').primaryKey(),
  energized: boolean('energized').notNull().default(true),
  known: boolean('known').notNull().default(false),
  last_heartbeat_at: timestamp('last_heartbeat_at', { withTimezone: true }),
  last_power_lost_at: timestamp('last_power_lost_at', { withTimezone: true }),
  last_power_restored_at: timestamp('last_power_restored_at', { withTimezone: true }),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const incidents = pgTable('incidents', {
  id: text('id').primaryKey(),
  detected_at: timestamp('detected_at', { withTimezone: true }).notNull(),
  type: text('type').notNull(),
  scope: text('scope').notNull(),
  confidence: numeric('confidence').notNull(),
  dt_id: text('dt_id'),
  feeder_id: text('feeder_id').notNull(),
  from_pole: text('from_pole'),
  to_pole: text('to_pole'),
  coords_lat: numeric('coords_lat'),
  coords_lon: numeric('coords_lon'),
  pincode: text('pincode'),
  affected_pole_ids: jsonb('affected_pole_ids').notNull(),
  affected_households: integer('affected_households').notNull(),
  reason: text('reason'),
  ai_brief: text('ai_brief'),
});

export const tickets = pgTable('tickets', {
  id: text('id').primaryKey(),
  incident_id: text('incident_id').notNull(),
  status: text('status').notNull(),
  timeline: jsonb('timeline').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const scheduled_outages = pgTable('scheduled_outages', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(),
  target_id: text('target_id').notNull(),
  start: timestamp('start', { withTimezone: true }).notNull(),
  end: timestamp('end', { withTimezone: true }).notNull(),
  reason: text('reason').notNull(),
});

export const edges_history = pgTable('edges_history', {
  id: serial('id').primaryKey(),
  pole_a: text('pole_a').notNull(),
  pole_b: text('pole_b').notNull(),
  co_dark_count: integer('co_dark_count').notNull().default(0),
});