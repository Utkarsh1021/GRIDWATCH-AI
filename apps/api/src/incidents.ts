import type { DB } from '@gridwatch/db';
import { incidents as incidentsTable, tickets as ticketsTable, scheduled_outages as outagesTable } from '@gridwatch/db';
import { localize } from '@gridwatch/localize';
import type { Incident, IncidentStatus, IncidentTimelineEntry, LocatedFault } from '@gridwatch/domain';
import { Runtime } from './runtime.js';
import { EventHub } from './sse.js';
import { env } from './config.js';

const OPEN_STATUSES: IncidentStatus[] = ['detected', 'acknowledged', 'crew_assigned', 'resolved'];

export class Incidents {
  private signatures = new Map<string, string>(); // signature -> incident id
  private byId = new Map<string, Incident>();
  private counter = 0;

  constructor(
    private db: DB,
    private runtime: Runtime,
    private hub: EventHub,
  ) {}

  signature(f: LocatedFault): string {
    return [f.type, f.dt_id ?? '', f.from_pole ?? '', f.to_pole ?? ''].join('|');
  }

  count(): number {
    return this.byId.size;
  }

  async loadOpen() {
    const open = await this.db.select().from(incidentsTable);
    this.byId = new Map();
    this.signatures = new Map();
    for (const r of open) {
      const inc = this.toIncident(r);
      this.byId.set(inc.id, inc);
      this.signatures.set(
        this.signature({
          type: inc.type as LocatedFault['type'],
          dt_id: inc.dt_id,
          from_pole: inc.from_pole,
          to_pole: inc.to_pole,
        } as LocatedFault),
        inc.id,
      );
    }
  }

  private toIncident(r: typeof incidentsTable.$inferSelect): Incident {
    const sig = this.signature({
      type: r.type as LocatedFault['type'],
      dt_id: r.dt_id,
      from_pole: r.from_pole,
      to_pole: r.to_pole,
    } as LocatedFault);
    const existing = this.byId.get(r.id);
    return {
      id: r.id,
      detected_at: r.detected_at.toISOString(),
      type: r.type as Incident['type'],
      scope: r.scope as Incident['scope'],
      confidence: Number(r.confidence),
      dt_id: r.dt_id,
      feeder_id: r.feeder_id ?? '',
      from_pole: r.from_pole,
      to_pole: r.to_pole,
      coords: r.coords_lat && r.coords_lon ? { lat: Number(r.coords_lat), lon: Number(r.coords_lon) } : null,
      pincode: r.pincode,
      affected_pole_ids: (r.affected_pole_ids as string[] | null) ?? [],
      affected_households: r.affected_households,
      status: existing?.status ?? 'detected',
      timeline: (existing?.timeline ?? [{ at: r.detected_at.toISOString(), status: 'detected' as IncidentStatus }]) as IncidentTimelineEntry[],
      ai_brief: r.ai_brief ?? undefined,
      reason: r.reason ?? undefined,
    };
  }

  async tick() {
    const now = Date.now();
    const liveness = this.runtime.liveness(now);
    const outages = await this.db.select().from(outagesTable);
    const scheduledOutages = outages.map((o) => ({
      scope: o.scope as 'feeder' | 'dt',
      target_id: o.target_id,
      start: new Date(o.start).getTime(),
      end: new Date(o.end).getTime(),
    }));

    const { faults } = localize({
      poles: this.runtime.poles,
      transformers: this.runtime.transformers,
      liveness,
      scheduledOutages,
      now,
    });

    const seenSigs = new Set<string>();
    for (const f of faults) {
      const sig = this.signature(f);
      seenSigs.add(sig);
      const existingId = this.signatures.get(sig);
      if (existingId) {
        const inc = this.byId.get(existingId);
        if (inc && OPEN_STATUSES.includes(inc.status)) continue;
      }
      await this.createFromFault(f, now);
    }

    await this.verifyClosed(seenSigs, liveness, now);

    this.hub.send('incidents', await this.list());
  }

  private async createFromFault(f: LocatedFault, now: number) {
    const sig = this.signature(f);
    if (this.signatures.has(sig)) return;
    this.counter++;
    const id = `INC-${Date.now().toString(36).toUpperCase()}-${this.counter}`;
    const at = new Date(now).toISOString();
    const inc: Incident = {
      id,
      detected_at: at,
      type: f.type,
      scope: f.scope,
      confidence: f.confidence,
      dt_id: f.dt_id,
      feeder_id: f.feeder_id,
      from_pole: f.from_pole,
      to_pole: f.to_pole,
      coords: f.coords,
      pincode: f.pincode,
      affected_pole_ids: f.affected_poles,
      affected_households: f.affected_households,
      status: 'detected',
      timeline: [{ at, status: 'detected', note: f.reason }],
    };
    this.byId.set(id, inc);
    this.signatures.set(sig, id);
    await this.persist(inc);
    console.log(`[detect] ${id} ${f.type}/${f.scope} at ${f.coords ? `${f.coords.lat},${f.coords.lon}` : '?'} conf=${f.confidence} poles=${f.affected_poles.length}`);
  }

  private async verifyClosed(seenSigs: Set<string>, liveness: Map<string, { dark: boolean; known: boolean }>, now: number) {
    for (const [id, inc] of this.byId) {
      if (inc.status === 'closed' || inc.status === 'verified') continue;
      const live = inc.affected_pole_ids.filter((p) => {
        const s = liveness.get(p);
        return !!s && s.known && !s.dark;
      }).length;
      const ratio = inc.affected_pole_ids.length > 0 ? live / inc.affected_pole_ids.length : 1;

      if (ratio >= env.verifyThreshold) {
        await this.transition(id, ratio >= env.verifyThreshold ? 'verified' : inc.status, {
          note: `telemetry: ${live}/${inc.affected_pole_ids.length} affected poles live`,
        });
        await this.transition(id, 'closed', { note: 'auto-verified from telemetry' });
      } else if (inc.status === 'resolved' && !seenSigs.has(this.signatureFromIncident(inc))) {
        await this.transition(id, 'disputed', { note: `marked fixed but ${inc.affected_pole_ids.length - live} affected poles still dark` });
      }
    }
  }

  private signatureFromIncident(inc: Incident): string {
    return [inc.type, inc.dt_id ?? '', inc.from_pole ?? '', inc.to_pole ?? ''].join('|');
  }

  async transition(id: string, status: IncidentStatus, opts?: { note?: string }) {
    const inc = this.byId.get(id);
    if (!inc) return null;
    inc.status = status;
    inc.timeline.push({ at: new Date().toISOString(), status, note: opts?.note });
    await this.persist(inc);
    if (status === 'closed' || status === 'verified') {
      this.signatures.delete(this.signatureFromIncident(inc));
    }
    this.hub.send('incidents', await this.list());
    return inc;
  }

  private async persist(inc: Incident) {
    const { coords } = inc;
    await this.db
      .insert(incidentsTable)
      .values({
        id: inc.id,
        detected_at: new Date(inc.detected_at),
        type: inc.type,
        scope: inc.scope,
        confidence: String(inc.confidence),
        dt_id: inc.dt_id,
        feeder_id: inc.feeder_id,
        from_pole: inc.from_pole,
        to_pole: inc.to_pole,
        coords_lat: coords ? String(coords.lat) : null,
        coords_lon: coords ? String(coords.lon) : null,
        pincode: inc.pincode,
        affected_pole_ids: inc.affected_pole_ids,
        affected_households: inc.affected_households,
        reason: inc.timeline.find((t) => t.note)?.note ?? null,
        ai_brief: inc.ai_brief ?? null,
      })
      .onConflictDoUpdate({
        target: incidentsTable.id,
        set: {
          scope: inc.scope,
          confidence: String(inc.confidence),
          ai_brief: inc.ai_brief ?? null,
        },
      });
    await this.db
      .insert(ticketsTable)
      .values({
        id: `T-${inc.id}`,
        incident_id: inc.id,
        status: inc.status,
        timeline: inc.timeline,
        created_at: new Date(inc.detected_at),
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: ticketsTable.id,
        set: { status: inc.status, timeline: inc.timeline, updated_at: new Date() },
      });
  }

  async list(): Promise<Incident[]> {
    const rows = await this.db.select().from(incidentsTable).orderBy(incidentsTable.detected_at);
    const incs = rows.map((r) => this.toIncident(r));
    for (const inc of incs) {
      const mem = this.byId.get(inc.id);
      if (mem) {
        inc.status = mem.status;
        inc.timeline = mem.timeline;
        inc.ai_brief = mem.ai_brief ?? undefined;
      }
    }
    return incs.sort((a, b) => (a.status === 'closed' ? 1 : 0) - (b.status === 'closed' ? 1 : 0) || b.detected_at.localeCompare(a.detected_at));
  }

  async get(id: string): Promise<Incident | null> {
    const all = await this.list();
    return all.find((i) => i.id === id) ?? null;
  }

  async setAiBrief(id: string, brief: string) {
    const inc = this.byId.get(id);
    if (inc) {
      inc.ai_brief = brief;
      await this.persist(inc);
    }
  }
}