import type { Feeder, Pole, Transformer } from '@gridwatch/domain';

export interface GenPole extends Pole {
  true_parent: string | null;
  households: number;
}

export interface GenNetwork {
  feeders: Feeder[];
  transformers: (Transformer & { recorded: boolean })[];
  poles: GenPole[];
}

interface GenerateOpts {
  substations: number;
  feedersPerSubstation: number;
  dtsPerFeeder: number;
  polesPerDt: [number, number];
  branchRate: number;
  recordedFraction: number;
  noDeviceFraction: number;
  missingPincodeFraction: number;
  seedLat: number;
  seedLon: number;
}

const DEFAULT_OPTS: GenerateOpts = {
  substations: 4,
  feedersPerSubstation: 2,
  dtsPerFeeder: 3,
  polesPerDt: [40, 70],
  branchRate: 0.7,
  recordedFraction: 0.4,
  noDeviceFraction: 0.09,
  missingPincodeFraction: 0.03,
  seedLat: 12.972,
  seedLon: 77.595,
};

let _seq = 0;
function nid(prefix: string, n: number, width = 3): string {
  return `${prefix}-${String(n).padStart(width, '0')}`;
}
export function generateNetwork(opts: Partial<GenerateOpts> = {}): GenNetwork {
  const o = { ...DEFAULT_OPTS, ...opts };
  _seq = 0;
  let poleCounter = 0;
  let deviceCounter = 0;
  const poleIdFmt = (n: number) => `P-${String(n).padStart(7, '0')}`;
  const deviceIdFmt = (n: number) => `KSPDB-SD${String(n).padStart(2, '0')}`;

  const feeders: Feeder[] = [];
  const transformers: (Transformer & { recorded: boolean })[] = [];
  const poles: GenPole[] = [];

  const poleTypes = ['LT-9m-PCC', 'LT-8m-Steel', 'LT-10m-PCC', 'LT-8m-RCC'];
  const wards = ['W-084', 'W-091', 'W-102', 'W-110', 'W-087', 'W-096'];
  const pinBase = 560000;

  let feederN = 0;
  for (let s = 0; s < o.substations; s++) {
    const subLat = o.seedLat + (s % 2 === 0 ? -0.012 : 0.010) + Math.random() * 0.004;
    const subLon = o.seedLon + (s < 2 ? -0.012 : 0.010) + Math.random() * 0.004;
    for (let f = 0; f < o.feedersPerSubstation; f++) {
      feederN++;
      const feederId = nid('F', feederN, 2);
      feeders.push({ id: feederId, substation_id: nid('SS', s + 1, 2), name: `Feeder ${feederId}` });
      for (let d = 0; d < o.dtsPerFeeder; d++) {
        const dtN = transformers.length + 1;
        const dtId = nid('D', dtN, 4);
        const heading = Math.random() * Math.PI * 2;
        const dist = 200 + Math.random() * 1400;
        const dtLat = subLat + (Math.cos(heading) * dist) / 111000;
        const dtLon = subLon + (Math.sin(heading) * dist) / (111000 * Math.cos(subLat * 0.01745));
        const households = 180 + Math.round(Math.random() * 260);
        const recorded = Math.random() < o.recordedFraction;
        transformers.push({
          id: dtId,
          feeder_id: feederId,
          lat: Number(dtLat.toFixed(6)),
          lon: Number(dtLon.toFixed(6)),
          capacity_kva: 100 + Math.round(Math.random() * 3) * 50,
          households_served: households,
          recorded,
        });

        const dtPoles = generateDtPoles({
          dtId,
          feederId,
          dtLat,
          dtLon,
          polesCountRange: o.polesPerDt,
          branchRate: o.branchRate,
          recorded,
          poleIdFmt,
          makePole: (lat, lon, pathLen, parent, noDevice, ward, pincode, hh) => {
            poleCounter++;
            deviceCounter++;
            const hasDevice = !noDevice;
            return {
              id: poleIdFmt(poleCounter),
              lat,
              lon,
              feeder_id: feederId,
              dt_id: dtId,
              seq_on_line: recorded ? pathLen : null,
              parent_pole_id: recorded ? parent : null,
              pole_type: poleTypes[Math.floor(Math.random() * poleTypes.length)],
              ward,
              pincode,
              device_id: hasDevice ? deviceIdFmt(deviceCounter) : null,
              true_parent: parent,
              households: hh,
            };
          },
        });
        poles.push(...dtPoles);
      }
    }
  }

  return { feeders, transformers, poles };
}

interface dtParams {
  dtId: string;
  feederId: string;
  dtLat: number;
  dtLon: number;
  polesCountRange: [number, number];
  branchRate: number;
  recorded: boolean;
  poleIdFmt: (n: number) => string;
  makePole: (
    lat: number,
    lon: number,
    pathLen: number,
    parent: string | null,
    noDevice: boolean,
    ward: string,
    pincode: string | null,
    households: number,
  ) => GenPole;
}

function generateDtPoles(p: dtParams): GenPole[] {
  const out: GenPole[] = [];
  const [min, max] = p.polesCountRange;
  const nMain = min + Math.round(Math.random() * (max - min));
  const dtHh = 180 + Math.round(Math.random() * 260);
  const mainHeading = Math.random() * Math.PI * 2;
  const ward = `W-${String(84 + Math.floor(Math.random() * 20)).padStart(3, '0')}`;
  const pincode = Math.random() < 0.03 ? null : String(560000 + Math.floor(Math.random() * 200));

  const spacing = () => 35 + Math.random() * 15;
  const jitter = 0.00002;

  const meterToLat = 1 / 111000;
  const meterToLon = 1 / (111000 * Math.cos(p.dtLat * 0.01745));

  const baseHhShare = dtHh / (max * 1.5);
  const hhFor = (share: number) => Math.max(1, Math.round(share * (0.5 + Math.random())));

  let prev: string | null = null;
  let prevLat = p.dtLat;
  let prevLon = p.dtLon;
  // main line
  for (let i = 0; i < nMain; i++) {
    const la = prevLat + Math.cos(mainHeading) * spacing() * meterToLat + (Math.random() - 0.5) * jitter;
    const lo = prevLon + Math.sin(mainHeading) * spacing() * meterToLon + (Math.random() - 0.5) * jitter;
    const noDevice = Math.random() < 0.09;
    const pole = p.makePole(
      Number(la.toFixed(6)),
      Number(lo.toFixed(6)),
      i + 1,
      prev,
      noDevice,
      ward,
      pincode,
      hhFor(baseHhShare),
    );
    out.push(pole);
    prev = pole.id;
    prevLat = la;
    prevLon = lo;
  }

  // branches
  const nBranches = Math.random() < p.branchRate ? 1 + Math.floor(Math.random() * 3) : 0;
  const anchorIdx = (idx: number) => out[idx];
  for (let b = 0; b < nBranches; b++) {
    const startIdx = Math.floor(Math.random() * (nMain - 1));
    const anchor = anchorIdx(startIdx);
    if (!anchor) continue;
    const branchLen = 4 + Math.floor(Math.random() * 16);
    const branchHeading = mainHeading + (Math.PI / 2.5) * (Math.random() < 0.5 ? 1 : -1);
    let bLat = anchor.lat;
    let bLon = anchor.lon;
    let bPrev: string | null = anchor.id;
    for (let i = 0; i < branchLen; i++) {
      bLat += Math.cos(branchHeading) * spacing() * meterToLat;
      bLon += Math.sin(branchHeading) * spacing() * meterToLon;
      const noDevice = Math.random() < 0.09;
      const pathLen = startIdx + 2 + i;
      const pole = p.makePole(
        Number(bLat.toFixed(6)),
        Number(bLon.toFixed(6)),
        pathLen,
        bPrev,
        noDevice,
        ward,
        pincode,
        hhFor(baseHhShare * 0.6),
      );
      out.push(pole);
      bPrev = pole.id;
    }
  }

  return out;
}