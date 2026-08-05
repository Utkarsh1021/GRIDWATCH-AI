import 'dotenv/config';

const apiBase = process.env.LOAD_API_URL ?? `http://localhost:${process.env.PORT ?? 3001}`;
const webBase = process.env.LOAD_WEB_URL ?? 'http://localhost:3000';

interface PoleRow {
  id: string;
  has_device: boolean;
  device_id: string | null;
}

interface Stats {
  ingest: { received: number; applied: number; dropped: number; bufferHighMark: number; msgsPerSecond: number; uptimeSeconds: number };
  openIncidents: number;
  sseClients: number;
}

interface Incident {
  id: string;
  status: string;
}

async function getJson<T>(path: string, baseUrl = apiBase): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const p50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.5)];
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))];

async function fetchDevices(): Promise<{ pole: string; device: string }[]> {
  const poles = await getJson<PoleRow[]>('/api/network/poles');
  return poles.filter((p) => p.has_device && p.device_id).map((p) => ({ pole: p.id, device: p.device_id! }));
}

function heartbeat(device: string, pole: string, seq: number) {
  return {
    device_id: device,
    pole_id: pole,
    event: 'heartbeat',
    energized: true,
    ts: new Date().toISOString(),
    seq,
    battery_mv: 3400 + Math.round(Math.random() * 300),
    rssi: -70 - Math.round(Math.random() * 30),
    fw: '1.4.2',
  };
}

async function resetAll(devices: { pole: string; device: string }[]) {
  const boot = devices.map(({ device, pole }) => ({
    device_id: device,
    pole_id: pole,
    event: 'boot',
    energized: true,
    ts: new Date().toISOString(),
    seq: 0,
    battery_mv: 3480,
    rssi: -80,
    fw: '1.4.2',
  }));
  for (let i = 0; i < boot.length; i += 2000) {
    await postJson<{ accepted: number }>('/ingest', boot.slice(i, i + 2000));
  }
}

async function getStats(): Promise<Stats> {
  return getJson<Stats>('/api/system/stats');
}

async function sustained(seconds: number, rate: number, batchSize: number) {
  const devices = await fetchDevices();
  await resetAll(devices);
  const seq = new Map<string, number>();
  const stats0 = await getStats();
  let di = 0;

  const nextBatch = () => {
    const evs = [];
    for (let i = 0; i < batchSize; i++) {
      const { device, pole } = devices[di++ % devices.length];
      const s = (seq.get(device) ?? 0) + 1;
      seq.set(device, s);
      evs.push(heartbeat(device, pole, s));
    }
    return evs;
  };

  const start = Date.now();
  const until = start + seconds * 1000;
  let sent = 0;
  const intervalMs = 1000 / (rate / batchSize);

  for (;;) {
    const before = Date.now();
    if (before >= until) break;
    const evs = nextBatch();
    const res = await postJson<{ accepted: number }>('/ingest', evs);
    sent += res.accepted;
    const wait = intervalMs - (Date.now() - before);
    if (wait > 0) await sleep(wait);
  }
  const wall = (Date.now() - start) / 1000;
  const stats1 = await getStats();

  const recvDelta = stats1.ingest.received - stats0.ingest.received;
  const appliedDelta = stats1.ingest.applied - stats0.ingest.applied;
  const droppedDelta = stats1.ingest.dropped - stats0.ingest.dropped;
  const rate_ = recvDelta / wall;

  console.log(`\nsustained ingest over ${wall.toFixed(1)}s at target ${rate} msg/s (${seconds}s window)`);
  console.log(`  client sent:        ${sent}`);
  console.log(`  server received:    ${recvDelta}   (${rate_.toFixed(0)} msg/s achieved)`);
  console.log(`  server applied:     ${appliedDelta}`);
  console.log(`  server dropped:     ${droppedDelta}`);
  console.log(`  buffer high-water:  ${stats1.ingest.bufferHighMark}`);
  console.log(`  result:             ${rate_ >= 500 && droppedDelta === 0 ? 'PASS ≥500 msg/s sustained, no loss' : 'CHECK'}`);
}

async function burst(total: number) {
  const devices = await fetchDevices();
  await resetAll(devices);
  const stats0 = await getStats();
  const evs = [];
  let seq = 0;
  for (let i = 0; i < total; i++) {
    const { device, pole } = devices[i % devices.length];
    seq += 1;
    evs.push(heartbeat(device, pole, seq));
  }
  const start = Date.now();
  let accepted = 0;
  for (let i = 0; i < evs.length; i += 2000) {
    const chunk = evs.slice(i, i + 2000);
    const res = await postJson<{ accepted: number }>('/ingest', chunk);
    accepted += res.accepted;
  }
  const wall = (Date.now() - start) / 1000;
  const stats1 = await getStats();
  const droppedDelta = stats1.ingest.dropped - stats0.ingest.dropped;
  const appliedDelta = stats1.ingest.applied - stats0.ingest.applied;

  console.log(`\nburst ingest: ${total} messages (chunked at 2,000/request)`);
  console.log(`  request round-trip: ${(wall * 1000).toFixed(0)} ms (target 10,000 ms)`);
  console.log(`  accepted:           ${accepted}`);
  console.log(`  server applied:     ${appliedDelta}`);
  console.log(`  server dropped:     ${droppedDelta}`);
  console.log(`  result:             ${wall < 10 && droppedDelta === 0 ? 'PASS 5,000 / 10s, no loss' : 'CHECK'}`);
}

async function consoleLatency(iterations: number) {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await getJson<Incident[]>('/api/incidents', webBase);
    times.push(performance.now() - t0);
  }
  console.log(`\nconsole incident list via web origin (${iterations} iters)`);
  console.log(`  p50:  ${p50(times).toFixed(0)} ms`);
  console.log(`  p95:  ${p95(times).toFixed(0)} ms`);
  console.log(`  max:  ${Math.max(...times).toFixed(0)} ms`);
  console.log(`  result: ${p95(times) < 2000 ? 'PASS < 2 s' : 'CHECK'}`);
}

async function pollUntil(
  fn: () => Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`);
    await sleep(1000);
  }
}

async function loop(iterations: number) {
  const detect: number[] = [];
  const verify: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const before = (await getJson<Incident[]>('/api/incidents')).length;
    const t0 = Date.now();
    let injected = false;
    for (let attempt = 0; attempt < 5 && !injected; attempt++) {
      const res = await postJson<{ messagesEmitted: number; note: string }>('/api/simulator/fault', { type: 'span', mode: 'clean' });
      injected = res.messagesEmitted > 0;
      if (!injected) console.log(`  fault pick produced no telemetry (${res.note}); retrying`);
    }
    if (!injected) throw new Error('could not inject a usable span fault');
    let incId = '';
    await pollUntil(
      async () => {
        const list = await getJson<Incident[]>('/api/incidents');
        if (list.length > before) {
          incId = list.find((x) => x.status !== 'closed')?.id ?? list[0].id;
          return true;
        }
        return false;
      },
      90_000,
      'fault to be localized',
    );
    detect.push(Date.now() - t0);

    const t1 = Date.now();
    await postJson('/api/simulator/repair', {});
    await pollUntil(
      async () => {
        const list = await getJson<Incident[]>('/api/incidents');
        const inc = list.find((x) => x.id === incId);
        return !!inc && (inc.status === 'closed' || inc.status === 'verified');
      },
      90_000,
      'repair to be auto-verified',
    );
    verify.push(Date.now() - t1);
    console.log(`  iter ${i + 1}: fault→ticket ${(detect[i] / 1000).toFixed(1)}s, repair→verified ${(verify[i] / 1000).toFixed(1)}s`);
  }
  console.log(`\nfault → localized ticket visible (target < 120 s p95)`);
  console.log(`  p95: ${(p95(detect) / 1000).toFixed(1)} s  max: ${(Math.max(...detect) / 1000).toFixed(1)} s`);
  console.log(`restoration → auto-verified (target < 120 s p95)`);
  console.log(`  p95: ${(p95(verify) / 1000).toFixed(1)} s  max: ${(Math.max(...verify) / 1000).toFixed(1)} s`);
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const num = (name: string, dflt: number) => Number(arg(name) ?? dflt);

const cmd = process.argv[2];
switch (cmd) {
  case 'sustained':
    sustained(num('seconds', 30), num('rate', 1000), num('batch', 1000)).then(() => process.exit(0)).catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;
  case 'burst':
    burst(num('msgs', 5000)).then(() => process.exit(0)).catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;
  case 'console':
    consoleLatency(num('iters', 20)).then(() => process.exit(0)).catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;
  case 'loop':
    loop(num('iters', 1)).then(() => process.exit(0)).catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;
  default:
    console.log(`Usage:
  load sustained [--seconds 30] [--rate 1000] [--batch 1000]
  load burst [--msgs 5000]
  load console [--iters 20]
  load loop [--iters 1]
env: LOAD_API_URL, LOAD_WEB_URL`);
    process.exit(0);
}
