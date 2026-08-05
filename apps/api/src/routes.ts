import { Router, type Request, type Response } from 'express';
import { scheduled_outages as outagesTable } from '@gridwatch/db';
import { and, gte, lte } from 'drizzle-orm';
import { ingestSchema, faultInjectSchema, noiseInjectSchema, ackSchema, assignSchema, resolveSchema } from '@gridwatch/schema';
import type { DB } from '@gridwatch/db';
import type { Ingest } from './ingest.js';
import type { Incidents } from './incidents.js';
import type { Simulator } from './simulator.js';
import type { Runtime } from './runtime.js';
import type { EventHub } from './sse.js';
import { generateBrief } from './ai.js';

export function createRouter(deps: {
  db: DB;
  ingest: Ingest;
  incidents: Incidents;
  simulator: Simulator;
  runtime: Runtime;
  hub: EventHub;
}): Router {
  const { db, ingest, incidents, simulator, runtime, hub } = deps;
  const r = Router();

  r.get('/health', (_req, res) =>
    res.json({ ok: true, incidents: incidents.count(), sseClients: hub.count() }),
  );

  r.post('/ingest', (req, res) => {
    const parsed = ingestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid telemetry', issues: parsed.error.issues.map((i) => i.message) });
      return;
    }
    const events = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
    for (const ev of events) ingest.push(ev);
    res.status(202).json({ accepted: events.length });
  });

  r.get('/api/network/feeders', (_req, res) => {
    res.json([...new Set(runtime.poles.map((p) => p.feeder_id))]);
  });

  r.get('/api/network/transformers', (_req, res) => {
    res.json(runtime.transformers);
  });

  r.get('/api/network/poles', (_req, res) => {
    res.json(runtime.poles.map((p) => ({ ...p, device_id: runtime.poleToDevice.get(p.id) ?? null })));
  });

  r.get('/api/poles/state', (_req, res) => {
    const now = Date.now();
    const liveness = runtime.liveness(now);
    res.json(
      runtime.poles.map((p) => ({
        pole_id: p.id,
        lat: p.lat,
        lon: p.lon,
        dt_id: p.dt_id,
        feeder_id: p.feeder_id,
        dark: liveness.get(p.id)?.dark ?? false,
        known: liveness.get(p.id)?.known ?? false,
      })),
    );
  });

  r.get('/api/incidents', async (_req, res) => {
    res.json(await incidents.list());
  });

  r.get('/api/incidents/:id', async (req, res) => {
    const inc = await incidents.get(req.params.id);
    if (!inc) return res.status(404).json({ error: 'not found' });
    res.json(inc);
  });

  r.post('/api/incidents/:id/acknowledge', async (req, res) => {
    const parsed = ackSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'bad payload' });
    const inc = await incidents.transition(req.params.id, 'acknowledged', { note: `acked by ${parsed.data.operator}` });
    if (!inc) return res.status(404).json({ error: 'not found' });
    res.json(inc);
  });

  r.post('/api/incidents/:id/assign', async (req, res) => {
    const parsed = assignSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'bad payload' });
    const inc = await incidents.transition(req.params.id, 'crew_assigned', { note: `assigned to ${parsed.data.crew}` });
    if (!inc) return res.status(404).json({ error: 'not found' });
    res.json(inc);
  });

  r.post('/api/incidents/:id/resolve', async (req, res) => {
    const parsed = resolveSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'bad payload' });
    const inc = await incidents.transition(req.params.id, 'resolved', { note: `marked resolved by ${parsed.data.by}` });
    if (!inc) return res.status(404).json({ error: 'not found' });
    res.json(inc);
  });

  r.post('/api/incidents/:id/brief', async (req, res) => {
    const inc = await incidents.get(req.params.id);
    if (!inc) return res.status(404).json({ error: 'not found' });
    const brief = await generateBrief(inc);
    if (!brief) {
      res.json({ brief: null, note: 'LLM unavailable; using template' });
      return;
    }
    await incidents.setAiBrief(inc.id, brief);
    res.json({ brief });
  });

  r.get('/api/tickets', async (_req, res) => {
    res.json(await incidents.list());
  });

  r.get('/api/scheduled-outages', async (req, res) => {
    const from = new Date(String(req.query.from ?? new Date(Date.now() - 3600_000).toISOString()));
    const to = new Date(String(req.query.to ?? new Date(Date.now() + 86400_000).toISOString()));
    const rows = await db
      .select()
      .from(outagesTable)
      .where(and(lte(outagesTable.start, to), gte(outagesTable.end, from)));
    res.json(rows);
  });

  r.get('/api/system/stats', async (_req, res) => {
    const incs = await incidents.list();
    res.json({
      ingest: ingest.getStats(),
      openIncidents: incs.filter((i) => i.status !== 'closed' && i.status !== 'verified').length,
      sseClients: hub.count(),
    });
  });

  r.post('/api/simulator/fault', async (req, res) => {
    const parsed = faultInjectSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'bad payload', issues: parsed.error.issues.map((i) => i.message) });
      return;
    }
    const result = await simulator.injectFault({ type: parsed.data.type, dtId: parsed.data.dtId, feederId: parsed.data.feederId, mode: parsed.data.mode });
    res.json(result);
  });

  r.post('/api/simulator/noise', async (req, res) => {
    const parsed = noiseInjectSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'bad payload', issues: parsed.error.issues.map((i) => i.message) });
      return;
    }
    const result = await simulator.injectNoise({ kind: parsed.data.kind, poleId: parsed.data.poleId, targetId: parsed.data.targetId });
    res.json(result);
  });

  r.post('/api/simulator/repair', async (_req, res) => {
    const result = await simulator.repair({});
    res.json(result);
  });

  r.get('/events', (_req, res) => {
    hub.add(res);
  });

  return r;
}