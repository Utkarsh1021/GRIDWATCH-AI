import { generateNetwork } from './network.js';
import type { DB } from './index.js';
import { feeders, poles, scheduled_outages, transformers, pole_states, edges, edges_history } from './schema.js';

export interface SeedResult {
  feeders: number;
  transformers: number;
  recordedDts: number;
  missingDts: number;
  poles: number;
  polesWithDevice: number;
}

export async function seedDatabase(db: DB, scale: 'small' | 'full' = 'small'): Promise<SeedResult> {
  await db.delete(edges_history);
  await db.delete(edges);
  await db.delete(scheduled_outages);
  await db.delete(pole_states);
  await db.delete(poles);
  await db.delete(transformers);
  await db.delete(feeders);

  const opts =
    scale === 'full'
      ? { substations: 4, feedersPerSubstation: 8, dtsPerFeeder: 13, polesPerDt: [40, 70] as [number, number] }
      : { substations: 4, feedersPerSubstation: 2, dtsPerFeeder: 3, polesPerDt: [40, 70] as [number, number] };

  const net = generateNetwork(opts);

  const now = new Date();

  // Feeders
  await db.insert(feeders).values(net.feeders.map((f) => ({ id: f.id, substation_id: f.substation_id, name: f.name })));

  // Transformers
  await db.insert(transformers).values(
    net.transformers.map((t) => ({
      id: t.id,
      feeder_id: t.feeder_id,
      lat: String(t.lat),
      lon: String(t.lon),
      capacity_kva: t.capacity_kva,
      households_served: t.households_served,
    })),
  );

  // Poles
  await db.insert(poles).values(
    net.poles.map((p) => ({
      id: p.id,
      lat: String(p.lat),
      lon: String(p.lon),
      feeder_id: p.feeder_id,
      dt_id: p.dt_id,
      seq_on_line: p.seq_on_line,
      parent_pole_id: p.parent_pole_id,
      pole_type: p.pole_type,
      ward: p.ward,
      pincode: p.pincode,
      device_id: p.device_id,
    })),
  );

  // Initial pole states: all live, known where a device exists
  await db.insert(pole_states).values(
    net.poles.map((p) => ({
      pole_id: p.id,
      energized: true,
      known: p.device_id != null,
      updated_at: now,
    })),
  );

  // A few scheduled outages in the future (mock feed)
  const in1h = new Date(now.getTime() + 3600_000);
  const in1hEnd = new Date(now.getTime() + 7200_000);
  const tomorrow = new Date(now.getTime() + 86400_000);
  await db.insert(scheduled_outages).values([
    { id: 'SO-DEMO-001', scope: 'feeder', target_id: net.feeders[0].id, start: in1h, end: in1hEnd, reason: 'Planned maintenance - jumper replacement' },
    { id: 'SO-DEMO-002', scope: 'dt', target_id: net.transformers[1].id, start: in1h, end: in1hEnd, reason: 'Load shedding' },
    { id: 'SO-DEMO-003', scope: 'feeder', target_id: net.feeders[net.feeders.length - 1].id, start: tomorrow, end: tomorrow, reason: 'Annual maintenance' },
  ]);

  const recordedDts = net.transformers.filter((t) => t.recorded).length;
  const polesWithDevice = net.poles.filter((p) => p.device_id != null).length;

  return {
    feeders: net.feeders.length,
    transformers: net.transformers.length,
    recordedDts,
    missingDts: net.transformers.length - recordedDts,
    poles: net.poles.length,
    polesWithDevice,
  };
}