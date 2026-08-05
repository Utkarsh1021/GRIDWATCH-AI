import type { DB } from '@gridwatch/db';
import { pole_states, poles as polesTable, transformers as transformersTable } from '@gridwatch/db';
import type { PoleModel, TransformerModel } from '@gridwatch/localize';
import type { TelemetryEvent } from '@gridwatch/domain';
import { silenceMs } from './config.js';

export interface PoleRuntime {
  energized: boolean;
  known: boolean;
  lastHeartbeatAt: number | null;
  lastPowerLostAt: number | null;
}

export class Runtime {
  poles: PoleModel[] = [];
  transformers: TransformerModel[] = [];
  poleByDevice = new Map<string, string>();
  poleToDevice = new Map<string, string>();
  deviceFw = new Map<string, string>();
  deviceSeq = new Map<string, number>();
  state = new Map<string, PoleRuntime>();
  private db: DB;

  constructor(db: DB) {
    this.db = db;
  }

  async load() {
    const [pRows, tRows] = await Promise.all([
      this.db.select().from(polesTable),
      this.db.select().from(transformersTable),
    ]);
    this.poles = pRows.map((p) => ({
      id: p.id,
      lat: Number(p.lat),
      lon: Number(p.lon),
      feeder_id: p.feeder_id,
      dt_id: p.dt_id,
      seq_on_line: p.seq_on_line,
      parent_pole_id: p.parent_pole_id,
      pincode: p.pincode,
      has_device: p.device_id != null && p.device_id.length > 0,
      households: 1,
    }));
    this.transformers = tRows.map((t) => ({
      id: t.id,
      feeder_id: t.feeder_id,
      lat: Number(t.lat),
      lon: Number(t.lon),
    }));

    // households per pole: split DT households evenly-ish across its poles
    const hhByDt = new Map<string, number>();
    for (const t of tRows) hhByDt.set(t.id, t.households_served);
    const byDt = new Map<string, PoleModel[]>();
    for (const p of this.poles) {
      if (!byDt.has(p.dt_id)) byDt.set(p.dt_id, []);
      byDt.get(p.dt_id)!.push(p);
    }
    for (const [dtId, ps] of byDt) {
      const hh = hhByDt.get(dtId) ?? 0;
      const share = hh / ps.length;
      for (const p of ps) p.households = Math.max(1, Math.round(share));
    }

    for (const p of pRows) {
      if (p.device_id && p.device_id.length > 0) {
        this.poleByDevice.set(p.device_id, p.id);
        this.poleToDevice.set(p.id, p.device_id);
      }
    }

    // Initial device fw distribution: ~8% on 1.2.x (no power_lost messages)
    let count = 0;
    for (const dev of this.poleByDevice.keys()) {
      count++;
      this.deviceFw.set(dev, count % 12 === 0 ? '1.2.3' : '1.4.2');
    }

    // Rebuild live state from persisted pole_states (or default live/unknown)
    const states = await this.db.select().from(pole_states);
    for (const s of states) {
      const hasDev = this.poleByDevice.get(s.pole_id) != null || this.poles.some((p) => p.id === s.pole_id && p.has_device);
      this.state.set(s.pole_id, {
        energized: s.energized ?? true,
        known: hasDev && (s.known ?? false),
        lastHeartbeatAt: s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : null,
        lastPowerLostAt: s.last_power_lost_at ? new Date(s.last_power_lost_at).getTime() : null,
      });
    }
    for (const p of this.poles) {
      if (!this.state.has(p.id)) {
        this.state.set(p.id, { energized: true, known: false, lastHeartbeatAt: null, lastPowerLostAt: null });
      }
    }
  }

  apply(event: TelemetryEvent, recvAt: number) {
    const poleId = this.poleByDevice.get(event.device_id);
    if (!poleId) return { applied: false, reason: 'unknown-device' };

    if (event.fw) this.deviceFw.set(event.device_id, event.fw);

    // Per-device ordering: seq is monotonic, resets on boot.
    const high = this.deviceSeq.get(event.device_id) ?? -1;
    if (event.event !== 'boot' && event.seq <= high) {
      return { applied: false, reason: 'duplicate-or-out-of-order' };
    }
    if (event.event === 'boot') {
      this.deviceSeq.set(event.device_id, 0);
    } else {
      this.deviceSeq.set(event.device_id, event.seq);
    }

    const st = this.state.get(poleId) ?? { energized: true, known: false, lastHeartbeatAt: null, lastPowerLostAt: null };
    const eventTs = new Date(event.ts).getTime() || recvAt;

    switch (event.event) {
      case 'heartbeat':
        st.energized = event.energized;
        st.known = true;
        st.lastHeartbeatAt = eventTs;
        break;
      case 'power_lost':
        st.energized = false;
        st.known = true;
        st.lastPowerLostAt = eventTs;
        break;
      case 'power_restored':
      case 'boot':
        st.energized = true;
        st.known = true;
        st.lastPowerLostAt = null;
        break;
    }
    this.state.set(poleId, st);
    this.persistState(poleId, st, recvAt).catch(() => {});
    return { applied: true, reason: 'ok' };
  }

  liveness(now: number): Map<string, { dark: boolean; known: boolean }> {
    const out = new Map<string, { dark: boolean; known: boolean }>();
    for (const p of this.poles) {
      const st = this.state.get(p.id);
      if (!st || !st.known) {
        out.set(p.id, { dark: false, known: false });
        continue;
      }
      // Silence detection: device stopped heartbeating long enough => treat as dark.
      const silent = st.lastHeartbeatAt != null && now - st.lastHeartbeatAt > silenceMs;
      const dark = silent || (st.lastPowerLostAt != null && (st.lastHeartbeatAt == null || st.lastPowerLostAt > st.lastHeartbeatAt));
      out.set(p.id, { dark, known: st.known });
    }
    return out;
  }

  poleRuntime(id: string): PoleRuntime | undefined {
    return this.state.get(id);
  }

  deviceFor(poleId: string): string | null {
    return this.poleToDevice.get(poleId) ?? null;
  }

  setSilent(poleId: string, since: number) {
    const st = this.state.get(poleId) ?? { energized: true, known: true, lastHeartbeatAt: null, lastPowerLostAt: null };
    st.known = true;
    st.lastHeartbeatAt = since;
    this.state.set(poleId, st);
  }

  private persistState(poleId: string, st: PoleRuntime, recvAt: number) {
    return this.db
      .insert(pole_states)
      .values({
        pole_id: poleId,
        energized: st.energized,
        known: st.known,
        last_heartbeat_at: st.lastHeartbeatAt ? new Date(st.lastHeartbeatAt) : null,
        last_power_lost_at: st.lastPowerLostAt ? new Date(st.lastPowerLostAt) : null,
        updated_at: new Date(recvAt),
      })
      .onConflictDoUpdate({
        target: pole_states.pole_id,
        set: {
          energized: st.energized,
          known: st.known,
          last_heartbeat_at: st.lastHeartbeatAt ? new Date(st.lastHeartbeatAt) : null,
          last_power_lost_at: st.lastPowerLostAt ? new Date(st.lastPowerLostAt) : null,
          updated_at: new Date(recvAt),
        },
      });
  }
}