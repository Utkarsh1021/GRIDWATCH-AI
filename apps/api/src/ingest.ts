import type { DB } from '@gridwatch/db';
import { telemetry_events } from '@gridwatch/db';
import type { TelemetryEvent } from '@gridwatch/domain';
import { Runtime } from './runtime.js';

interface Pending {
  event: TelemetryEvent;
  recvAt: number;
  appliedRef?: TelemetryEvent;
}

export class Ingest {
  private buffer: Pending[] = [];
  private timer: NodeJS.Timeout | null = null;
  private stats = { received: 0, applied: 0, dropped: 0, bufferHighMark: 0 };
  private startedAt = Date.now();

  constructor(
    private db: DB,
    private runtime: Runtime,
    private batchSize = 500,
    private batchMs = 250,
  ) {}

  push(event: TelemetryEvent, recvAt = Date.now()) {
    this.stats.received++;
    const result = this.runtime.apply(event, recvAt);
    if (!result.applied) {
      this.stats.dropped++;
      return;
    }
    this.stats.applied++;
    this.buffer.push({ event, recvAt });
    if (this.buffer.length > this.stats.bufferHighMark) this.stats.bufferHighMark = this.buffer.length;
    if (this.buffer.length >= this.batchSize) this.flush();
    else this.schedule();
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.batchMs);
  }

  private flush() {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    this.db
      .insert(telemetry_events)
      .values(
        batch.map((b) => ({
          device_id: b.event.device_id,
          pole_id: b.event.pole_id,
          event: b.event.event,
          energized: b.event.energized,
          seq: b.event.seq,
          fw: b.event.fw,
          recv_at: new Date(b.recvAt),
          event_ts: new Date(b.event.ts),
        })),
      )
      .catch((e) => {
        console.error('[ingest] batch write failed', e);
        this.buffer.unshift(...batch);
      });
  }

  getStats() {
    const up = (Date.now() - this.startedAt) / 1000;
    return {
      received: this.stats.received,
      applied: this.stats.applied,
      dropped: this.stats.dropped,
      bufferHighMark: this.stats.bufferHighMark,
      msgsPerSecond: up > 0 ? Math.round(this.stats.received / up) : 0,
      uptimeSeconds: Math.round(up),
    };
  }

  async drainNow() {
    this.flush();
  }
}