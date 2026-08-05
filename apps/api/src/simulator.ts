import type { DB } from '@gridwatch/db';
import { scheduled_outages as outagesTable } from '@gridwatch/db';
import { buildBelievedEdges } from '@gridwatch/localize';
import type { TelemetryEvent } from '@gridwatch/domain';
import { Runtime } from './runtime.js';
import { Ingest } from './ingest.js';
import { Incidents } from './incidents.js';
import { silenceMs } from './config.js';

export interface InjectResult {
  kind: string;
  target: string;
  affectedPoles: number;
  messagesEmitted: number;
  messagesDropped: number;
  note: string;
}

export class Simulator {
  constructor(
    private db: DB,
    private runtime: Runtime,
    private ingest: Ingest,
    private incidents: Incidents,
  ) {}

  private deviceFor(poleId: string): string | null {
    return this.runtime.deviceFor(poleId);
  }

  private emit(event: TelemetryEvent, drop: boolean) {
    if (drop) return;
    this.ingest.push(event);
  }

  private powerLostEvent(deviceId: string, poleId: string, seq: number): TelemetryEvent {
    const fw = this.runtime.deviceFw.get(deviceId) ?? '1.4.2';
    const is12 = fw.startsWith('1.2');
    return {
      device_id: deviceId,
      pole_id: poleId,
      event: 'power_lost',
      energized: false,
      ts: new Date().toISOString(),
      seq,
      battery_mv: is12 ? 3400 : Math.round(2600 + Math.random() * 400),
      rssi: -70 - Math.round(Math.random() * 40),
      fw,
    };
  }

  private silentHeartbeatEvent(deviceId: string, poleId: string, seq: number): TelemetryEvent {
    // fw 1.2 / lost dying message: no power_lost, just a stale heartbeat (time-compressed silence)
    return {
      device_id: deviceId,
      pole_id: poleId,
      event: 'heartbeat',
      energized: true,
      ts: new Date(Date.now() - silenceMs - 1000).toISOString(),
      seq,
      battery_mv: 3480,
      rssi: -80,
      fw: this.runtime.deviceFw.get(deviceId) ?? '1.4.2',
    };
  }

  private affectedDownstream(dtId: string, fromPole: string): string[] {
    const edges = buildBelievedEdges(this.runtime.poles, new Map(this.runtime.transformers.map((t) => [t.id, t])));
    const children = new Map<string, string[]>();
    for (const e of edges) {
      if (e.dt_id !== dtId) continue;
      if (!children.has(e.from)) children.set(e.from, []);
      children.get(e.from)!.push(e.to);
    }
    const out: string[] = [];
    const stack = [fromPole];
    while (stack.length) {
      const n = stack.pop()!;
      out.push(n);
      for (const c of children.get(n) ?? []) stack.push(c);
    }
    return out;
  }

  private pickEdge(dtId: string): { from: string; to: string } | null {
    const edges = buildBelievedEdges(this.runtime.poles, new Map(this.runtime.transformers.map((t) => [t.id, t])));
    const candidates = edges.filter((e) => e.dt_id === dtId && this.affectedDownstream(dtId, e.to).length >= 3);
    if (candidates.length === 0) return null;
    const mid = candidates[Math.floor(candidates.length / 2)];
    return { from: mid.from, to: mid.to };
  }

  private darken(
    poles: string[],
    mode: 'power_lost' | 'silent',
    clean: boolean,
  ): { emitted: number; dropped: number } {
    let emitted = 0;
    let dropped = 0;
    for (const pid of poles) {
      const dev = this.deviceFor(pid);
      if (!dev) continue; // no device: nothing reports
      // Start above the runtime's current per-device seq so a fault can be
      // re-injected after a repair (repair base is 1,000,000) without dedupe
      // dropping every message.
      const seqBase = (this.runtime.deviceSeq.get(dev) ?? 0) + 1;
      const fw = this.runtime.deviceFw.get(dev) ?? '1.4.2';
      const is12 = fw.startsWith('1.2');
      // In clean mode every affected pole reports power_lost so the dark set forms
      // instantly and contiguously (deterministic demo). In noisy mode honour the
      // real contract: fw 1.2 never sends power_lost; 30% of dying messages drop.
      const sendPowerLost = clean || (mode === 'power_lost' && !is12 && Math.random() < 0.7);
      if (sendPowerLost) {
        this.emit(this.powerLostEvent(dev, pid, seqBase), false);
        emitted++;
      } else {
        this.emit(this.silentHeartbeatEvent(dev, pid, seqBase + 1), false);
        dropped++;
      }
    }
    return { emitted, dropped };
  }

  async injectFault(input: {
    type: 'span' | 'dt' | 'feeder';
    dtId?: string;
    feederId?: string;
    mode?: 'clean' | 'noisy';
  }): Promise<InjectResult> {
    const clean = input.mode !== 'noisy';
    if (input.type === 'span') {
      const dt = input.dtId ?? this.pickRecordedDt();
      if (!dt) return { kind: input.type, target: '', affectedPoles: 0, messagesEmitted: 0, messagesDropped: 0, note: 'no DT found' };
      const edge = this.pickEdge(dt);
      if (!edge) return { kind: input.type, target: dt, affectedPoles: 0, messagesEmitted: 0, messagesDropped: 0, note: 'no suitable span' };
      const affected = this.affectedDownstream(dt, edge.to);
      const r = this.darken(affected, 'power_lost', clean);
      return { kind: 'span', target: `${dt} ${edge.from}-${edge.to}`, affectedPoles: affected.length, messagesEmitted: r.emitted, messagesDropped: r.dropped, note: `span fault ${edge.from}-${edge.to} (${input.mode ?? 'clean'})` };
    }
    if (input.type === 'dt') {
      const dt = input.dtId ?? this.pickRecordedDt();
      if (!dt) return { kind: input.type, target: '', affectedPoles: 0, messagesEmitted: 0, messagesDropped: 0, note: 'no DT found' };
      const affected = this.runtime.poles.filter((p) => p.dt_id === dt).map((p) => p.id);
      const r = this.darken(affected, 'power_lost', clean);
      return { kind: 'dt', target: dt, affectedPoles: affected.length, messagesEmitted: r.emitted, messagesDropped: r.dropped, note: `DT fault ${dt} (${input.mode ?? 'clean'})` };
    }
    // feeder
    const feeder = input.feederId ?? this.pickFeeder();
    if (!feeder) return { kind: input.type, target: '', affectedPoles: 0, messagesEmitted: 0, messagesDropped: 0, note: 'no feeder found' };
    const affected = this.runtime.poles.filter((p) => p.feeder_id === feeder).map((p) => p.id);
    const r = this.darken(affected, 'power_lost', clean);
    return { kind: 'feeder', target: feeder, affectedPoles: affected.length, messagesEmitted: r.emitted, messagesDropped: r.dropped, note: `feeder fault ${feeder} (${input.mode ?? 'clean'})` };
  }

  async injectNoise(input: { kind: 'device-die' | 'scheduled-outage' | 'duplicate' | 'out-of-order'; poleId?: string; targetId?: string }): Promise<InjectResult> {
    if (input.kind === 'device-die') {
      const pole = input.poleId ?? this.pickPoleWithDevice();
      const dev = this.deviceFor(pole);
      if (!dev) return { kind: input.kind, target: pole, affectedPoles: 0, messagesEmitted: 0, messagesDropped: 0, note: 'pole has no device' };
      this.emit(this.silentHeartbeatEvent(dev, pole, 999000), false);
      return { kind: 'device-die', target: pole, affectedPoles: 0, messagesEmitted: 1, messagesDropped: 0, note: `device ${dev} went silent, power was fine` };
    }
    if (input.kind === 'scheduled-outage') {
      const target = input.targetId ?? this.runtime.poles[0]?.feeder_id ?? 'F-01';
      const start = new Date(Date.now() - 60_000);
      const end = new Date(Date.now() + 3600_000);
      const id = `SO-${Date.now()}`;
      await this.db.insert(outagesTable).values({ id, scope: 'feeder', target_id: target, start, end, reason: 'Simulator load shedding' });
      const affected = this.runtime.poles.filter((p) => p.feeder_id === target).map((p) => p.id);
      this.darken(affected, 'power_lost', false);
      return { kind: 'scheduled-outage', target, affectedPoles: affected.length, messagesEmitted: 0, messagesDropped: 0, note: `scheduled outage on ${target}, suppressed` };
    }
    if (input.kind === 'duplicate') {
      const pole = input.poleId ?? this.pickPoleWithDevice();
      const dev = this.deviceFor(pole);
      if (!dev) return { kind: input.kind, target: pole, affectedPoles: 0, messagesEmitted: 0, messagesDropped: 0, note: 'pole has no device' };
      const ev = this.powerLostEvent(dev, pole, 1);
      this.emit(ev, false);
      this.emit(ev, false); // duplicate
      return { kind: 'duplicate', target: pole, affectedPoles: 0, messagesEmitted: 1, messagesDropped: 1, note: 'sent same message twice, deduped' };
    }
    const pole = input.poleId ?? this.pickPoleWithDevice();
    const dev = this.deviceFor(pole);
    if (!dev) return { kind: input.kind, target: pole, affectedPoles: 0, messagesEmitted: 0, messagesDropped: 0, note: 'pole has no device' };
    const ev = this.powerLostEvent(dev, pole, 5);
    this.emit({ ...ev, ts: new Date().toISOString() }, false); // seq 5 arrives first
    this.emit({ ...ev, seq: 1, ts: new Date().toISOString() }, false); // seq 1 (stale) arrives after
    return { kind: 'out-of-order', target: pole, affectedPoles: 0, messagesEmitted: 2, messagesDropped: 1, note: 'out-of-order seq dropped' };
  }

  async repair(input: { dtId?: string; feederId?: string }): Promise<InjectResult> {
    const open = await this.incidents.list();
    const target = open.find((i) => i.status !== 'closed' && i.status !== 'verified');
    if (!target) return { kind: 'repair', target: '', affectedPoles: 0, messagesEmitted: 0, messagesDropped: 0, note: 'no open incident to repair' };
    const affected = target.affected_pole_ids;
    let emitted = 0;
    for (const pid of affected) {
      const dev = this.deviceFor(pid);
      if (!dev) continue;
      // Start above the runtime's current per-device seq so restorations are
      // never deduped away, no matter how high previous fault/repair seqs went.
      const seq = (this.runtime.deviceSeq.get(dev) ?? 0) + 1;
      this.emit(
        { device_id: dev, pole_id: pid, event: 'power_restored', energized: true, ts: new Date().toISOString(), seq, battery_mv: 3480, rssi: -80, fw: '1.4.2' },
        false,
      );
      emitted++;
    }
    return { kind: 'repair', target: target.id, affectedPoles: affected.length, messagesEmitted: emitted, messagesDropped: 0, note: `restoration telemetry for ${target.id}` };
  }

  private pickRecordedDt(): string | null {
    const poles = this.runtime.poles;
    const dtIds = [...new Set(poles.map((p) => p.dt_id))];
    const recorded = dtIds.filter((dt) => poles.some((p) => p.dt_id === dt && p.parent_pole_id != null));
    const pool = recorded.length > 0 ? recorded : dtIds;
    return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  private pickFeeder(): string | null {
    const feeders = [...new Set(this.runtime.poles.map((p) => p.feeder_id))];
    return feeders.length > 0 ? feeders[Math.floor(Math.random() * feeders.length)] : null;
  }

  private pickPoleWithDevice(): string {
    const candidates = this.runtime.poles.filter((p) => p.has_device);
    return candidates[Math.floor(Math.random() * candidates.length)].id;
  }
}