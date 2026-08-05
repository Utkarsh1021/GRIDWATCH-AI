import 'dotenv/config';

const base = process.env.SIMULATOR_API_URL ?? `http://localhost:${process.env.PORT ?? 3001}`;

async function post(path: string, body: unknown): Promise<Record<string, any>> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, any>;
  if (!res.ok) {
    console.error('request failed', res.status, json);
    process.exit(1);
  }
  return json;
}

async function main() {
  const [cmd, sub] = process.argv.slice(2);
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };

  if (cmd === 'fault') {
    const type = (arg('type') ?? sub ?? 'span') as 'span' | 'dt' | 'feeder';
    const mode = (arg('mode') ?? 'clean') as 'clean' | 'noisy';
    const result = await post('/api/simulator/fault', { type, mode, dtId: arg('dt'), feederId: arg('feeder') });
    console.log('injected:', result.note, `| ${result.messagesEmitted} messages, ${result.messagesDropped} dropped`);
  } else if (cmd === 'noise') {
    const kind = (arg('kind') ?? sub ?? 'device-die') as 'device-die' | 'scheduled-outage' | 'duplicate' | 'out-of-order';
    const result = await post('/api/simulator/noise', { kind, poleId: arg('pole'), targetId: arg('target') });
    console.log('noise:', result.note);
  } else if (cmd === 'repair') {
    const result = await post('/api/simulator/repair', {});
    console.log('repair:', result.note);
  } else {
    console.log(
      `Usage:
  simulate fault [--type span|dt|feeder] [--dt D-0112] [--feeder F-01] [--mode clean|noisy]
  simulate noise [--kind device-die|scheduled-outage|duplicate|out-of-order] [--pole P-0000001]
  simulate repair`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});