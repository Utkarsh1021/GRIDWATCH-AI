import type { TelemetryEvent } from '@gridwatch/domain';
import { Runtime } from './runtime.js';
import { Ingest } from './ingest.js';

// Emits background heartbeats for every device-bearing pole that is currently
// powered, on a ~heartbeatMs cadence. Without this, the demo network silently
// decays to "all dark" once silence-detection trips (~2 heartbeat intervals),
// which destroys live/dark boundary detection and confuses the console.
export class FleetHeartbeater {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private runtime: Runtime,
    private ingest: Ingest,
    private intervalMs: number,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.beat(), this.intervalMs);
    // Prime immediately so the console shows live poles from the start instead
    // of waiting a full heartbeat interval.
    this.beat();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private beat() {
    const now = Date.now();
    for (const pole of this.runtime.poles) {
      const device = this.runtime.deviceFor(pole.id);
      if (!device) continue; // no device, nothing reports
      const st = this.runtime.state.get(pole.id);
      // Only powered poles heartbeat; a dark pole has lost power and goes quiet,
      // which is exactly the signature detection relies on.
      if (st && !st.energized) continue;
      // Skip devices that have already gone silent (e.g. device-die noise) so the
      // fleet does not resurrect them; silence-detection is what flags them dark.
      if (st && st.lastHeartbeatAt != null && now - st.lastHeartbeatAt > this.intervalMs) continue;
      const seq = (this.runtime.deviceSeq.get(device) ?? 0) + 1;
      const ev: TelemetryEvent = {
        device_id: device,
        pole_id: pole.id,
        event: 'heartbeat',
        energized: true,
        ts: new Date(now).toISOString(),
        seq,
        battery_mv: 3480,
        rssi: -70 - Math.round(Math.random() * 30),
        fw: this.runtime.deviceFw.get(device) ?? '1.4.2',
      };
      this.ingest.push(ev, now);
    }
    let powered = 0;
    for (const pole of this.runtime.poles) {
      if (!this.runtime.deviceFor(pole.id)) continue;
      const s = this.runtime.state.get(pole.id);
      if (!s || s.energized) powered++;
    }
    console.log(`[fleet] heartbeats sent for ${powered} powered poles`);
  }
}