import type { Edge, LocatedFault, FaultType, LocalizationScope } from '@gridwatch/domain';

export interface PoleModel {
  id: string;
  lat: number;
  lon: number;
  feeder_id: string;
  dt_id: string;
  seq_on_line: number | null;
  parent_pole_id: string | null;
  pincode: string | null;
  has_device: boolean;
  households: number;
}

export interface TransformerModel {
  id: string;
  feeder_id: string;
  lat: number;
  lon: number;
}

export interface LivenessModel {
  dark: boolean;
  known: boolean;
}

export interface LocalizeInput {
  poles: PoleModel[];
  transformers: TransformerModel[];
  liveness: Map<string, LivenessModel>;
  scheduledOutages: { scope: 'feeder' | 'dt'; target_id: string; start: number; end: number }[];
  now: number;
}

export interface ConfidenceFactors {
  coverage: number;
  cleanliness: number;
  timing: number;
  topology_source: number;
}

export function buildBelievedEdges(
  poles: PoleModel[],
  transformersByDt: Map<string, { lat: number; lon: number }>,
): Edge[] {
  const edges: Edge[] = [];
  const byDt = groupBy(poles, (p) => p.dt_id);

  for (const [dtId, dtPoles] of byDt) {
    const recordedCount = dtPoles.filter((p) => p.parent_pole_id != null).length;
    if (recordedCount > 0) {
      for (const p of dtPoles) {
        if (p.parent_pole_id != null) {
          edges.push({ dt_id: dtId, from: p.parent_pole_id, to: p.id, source: 'recorded' });
        }
      }
    } else {
      const anchor = transformersByDt.get(dtId) ?? { lat: dtPoles[0].lat, lon: dtPoles[0].lon };
      const inferred = inferTree(dtPoles, anchor);
      for (const e of inferred) edges.push({ dt_id: dtId, from: e.from, to: e.to, source: 'inferred' });
    }
  }
  return edges;
}

function inferTree(
  poles: PoleModel[],
  anchor: { lat: number; lon: number },
): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  if (poles.length === 0) return out;

  const maxSpanM = 120;
  const sorted = [...poles].sort(
    (a, b) => distM(a.lat, a.lon, anchor.lat, anchor.lon) - distM(b.lat, b.lon, anchor.lat, anchor.lon),
  );
  const seen: PoleModel[] = [];
  for (const p of sorted) {
    let best: PoleModel | null = null;
    let bestD = maxSpanM;
    for (const q of seen) {
      const d = distM(p.lat, p.lon, q.lat, q.lon);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    if (best) out.push({ from: best.id, to: p.id });
    seen.push(p);
  }
  return out;
}

export function localize(input: LocalizeInput): { faults: LocatedFault[]; suspects: string[] } {
  const { poles, transformers, liveness, scheduledOutages, now } = input;
  const byDt = groupBy(poles, (p) => p.dt_id);
  const byFeeder = groupBy(poles, (p) => p.feeder_id);
  const tfById = new Map(transformers.map((t) => [t.id, t]));
  const edges = buildBelievedEdges(poles, tfById);
  const faults: LocatedFault[] = [];
  const suspects: string[] = [];

  const isDark = (id: string) => {
    const s = liveness.get(id);
    return !!s && s.known && s.dark;
  };
  const isLive = (id: string) => {
    const s = liveness.get(id);
    return !!s && s.known && !s.dark;
  };

  // ---- Feeder faults: every DT under the feeder fully dark, feeder had a live history.
  const feederDarkSet = new Set<string>();
  for (const [feederId, fp] of byFeeder) {
    const dtIds = new Set(fp.map((p) => p.dt_id));
    let allFullyDark = dtIds.size > 0;
    for (const dtId of dtIds) {
      if (!dtFullyDark(byDt.get(dtId) ?? [], isDark)) {
        allFullyDark = false;
        break;
      }
    }
    if (allFullyDark) feederDarkSet.add(feederId);
  }

  // ---- Per-DT analysis
  for (const [dtId, dtPoles] of byDt) {
    const feederId = dtPoles[0].feeder_id;
    if (feederDarkSet.has(feederId)) {
      continue; // handled as feeder fault
    }

    // Build full adjacency (all poles including non-instrumented / "blind" ones)
    // for boundary naming and physical affected-set expansion.
    const children = new Map<string, string[]>();
    const dtEdgeFrom = new Map<string, string | null>(); // pole -> parent (null if root)
    const hasDevice = new Map(dtPoles.map((p) => [p.id, p.has_device]));
    for (const e of edges) {
      if (e.dt_id !== dtId) continue;
      if (!children.has(e.from)) children.set(e.from, []);
      children.get(e.from)!.push(e.to);
      dtEdgeFrom.set(e.to, e.from);
    }

    // Nearest device-bearing ancestor. Blind (non-instrumented) poles carry no
    // liveness, so one physical dark region spanning a blind pole would otherwise
    // be split into two components. Contracting them keeps the region whole.
    const nearestDeviceParent = (id: string): string | null => {
      let cur = dtEdgeFrom.get(id) ?? null;
      while (cur && !hasDevice.get(cur)) cur = dtEdgeFrom.get(cur) ?? null;
      return cur;
    };

    const dChildren = new Map<string, string[]>();
    for (const p of dtPoles) {
      if (!p.has_device) continue;
      const dParent = nearestDeviceParent(p.id);
      if (dParent) {
        if (!dChildren.has(dParent)) dChildren.set(dParent, []);
        dChildren.get(dParent)!.push(p.id);
      }
    }

    const deviceDark = (id: string): boolean => (hasDevice.get(id) ?? false) && isDark(id);

    // A top is a dark, instrumented pole whose nearest instrumented ancestor is
    // not dark (live) or absent (fault just downstream of the DT).
    const tops: string[] = [];
    for (const p of dtPoles) {
      if (!deviceDark(p.id)) continue;
      const dParent = nearestDeviceParent(p.id);
      if (dParent == null || !deviceDark(dParent)) tops.push(p.id);
    }

    if (tops.length === 0) continue;

    const dtIsFullyDark = dtFullyDark(dtPoles, isDark);
    const tf = tfById.get(dtId);

    for (const top of tops) {
      const comp = collectComponent(top, dChildren, deviceDark);

      // Dead-sensor check: a single dark instrumented pole with live instrumented
      // children is physically impossible as a line fault => dead sensor, not outage.
      const dKids = dChildren.get(top) ?? [];
      const hasLiveDeviceChild = dKids.some((k) => !isDark(k));
      if (comp.size === 1 && hasLiveDeviceChild) {
        suspects.push(top);
        continue;
      }

      // Physical affected set: the dark-plus-blind region downstream of the
      // boundary, stopping at any live instrumented pole.
      const affectedPoles = expandAffected(top, children, hasDevice, isDark);
      const scope: LocalizationScope =
        dtEdgeFrom.get(top) == null || dtIsFullyDark ? 'dt-area' : 'span';
      const type: FaultType = scope === 'dt-area' ? 'dt' : 'span';

      const from = dtEdgeFrom.get(top) ?? null;
      const to = top;

      // Coordinates: midpoint of the fault span, or the DT for dt-area
      let coords: { lat: number; lon: number } | null = null;
      if (scope === 'span' && from) {
        const a = poles.find((p) => p.id === from)!;
        const b = poles.find((p) => p.id === to)!;
        coords = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
      } else if (tf) {
        coords = { lat: tf.lat, lon: tf.lon };
      }

      const pincode = pickPincode(poles, affectedPoles);

      const affected_households = sumHe(affectedPoles, poles);

      const reasons: string[] = [];
      if (scope === 'span') reasons.push('live/dark boundary mid-line');
      else reasons.push('all poles under transformer dark');

      const conf = computeConfidence({
        coverage: coverageRatio(affectedPoles, poles),
        cleanliness: comp.size === 1 && !hasLiveDeviceChild ? 0.7 : 1,
        timing: 1, // refined by caller with burst info if needed
        topology_source: scope === 'span' ? (edgeSourceOf(dtEdgeFrom, top, edges, dtId) === 'recorded' ? 1 : 0.72) : 0.5,
      });

      // Scheduled outage suppression
      if (isSuppressed(feederId, dtId, affectedPoles, scheduledOutages, now)) continue;

      faults.push({
        incident_index: faults.length,
        type,
        scope,
        confidence: round(conf),
        dt_id: dtId,
        feeder_id: feederId,
        from_pole: from,
        to_pole: to,
        coords,
        pincode,
        affected_poles: affectedPoles,
        affected_households,
        boundary: { live: from ?? undefined, dark: to },
        reason: reasons.join('; '),
      });
    }
  }

  // ---- Feeder faults
  for (const feederId of feederDarkSet) {
    const fp = byFeeder.get(feederId) ?? [];
    const dtIds = new Set(fp.map((p) => p.dt_id));
    const tf = transformers.find((t) => t.feeder_id === feederId);
    const coords = tf ? { lat: tf.lat, lon: tf.lon } : { lat: fp[0]?.lat ?? 0, lon: fp[0]?.lon ?? 0 };
    const pincode = pickPincode(poles, fp.map((p) => p.id));
    if (isSuppressed(feederId, feederId, fp.map((p) => p.id), scheduledOutages, now)) continue;
    faults.push({
      incident_index: faults.length,
      type: 'feeder',
      scope: 'feeder',
      confidence: round(computeConfidence({ coverage: 1, cleanliness: 0.9, timing: 1, topology_source: 1 })),
      dt_id: dtIds.size === 1 ? [...dtIds][0] ?? null : null,
      feeder_id: feederId,
      from_pole: null,
      to_pole: null,
      coords,
      pincode,
      affected_poles: fp.map((p) => p.id),
      affected_households: sumHe(fp.map((p) => p.id), poles),
      boundary: null,
      reason: 'all distribution transformers under feeder dark',
    });
  }

  return { faults, suspects };
}

function computeConfidence(f: ConfidenceFactors): number {
  return f.coverage * f.cleanliness * f.timing * f.topology_source;
}

function edgeSourceOf(
  parentOf: Map<string, string | null>,
  top: string,
  edges: Edge[],
  dtId: string,
): Edge['source'] {
  const parent = parentOf.get(top);
  if (!parent) return 'recorded';
  const e = edges.find((x) => x.dt_id === dtId && x.to === top);
  return e ? e.source : 'recorded';
}

function isSuppressed(
  feederId: string,
  dtId: string,
  affectedPoles: string[],
  outages: { scope: 'feeder' | 'dt'; target_id: string; start: number; end: number }[],
  now: number,
): boolean {
  for (const o of outages) {
    if (now < o.start || now > o.end) continue;
    if (o.scope === 'feeder' && o.target_id === feederId) return true;
    if (o.scope === 'dt' && o.target_id === dtId) return true;
  }
  return false;
}

function dtFullyDark(dtPoles: PoleModel[], isDark: (id: string) => boolean): boolean {
  const known = dtPoles.filter((p) => p.has_device);
  if (known.length === 0) return false;
  return known.every((p) => isDark(p.id));
}

function collectComponent(
  start: string,
  children: Map<string, string[]>,
  isDark: (id: string) => boolean,
): Set<string> {
  const out = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const n = stack.pop()!;
    if (out.has(n)) continue;
    out.add(n);
    for (const k of children.get(n) ?? []) if (isDark(k)) stack.push(k);
  }
  return out;
}

function expandAffected(
  start: string,
  children: Map<string, string[]>,
  hasDevice: Map<string, boolean>,
  isDark: (id: string) => boolean,
): string[] {
  const out: string[] = [];
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.includes(id)) continue;
    if (hasDevice.get(id) && !isDark(id)) continue; // live instrumented node: boundary
    out.push(id);
    for (const k of children.get(id) ?? []) stack.push(k);
  }
  return out;
}

function coverageRatio(comp: string[], poles: PoleModel[]): number {
  const idSet = new Set<string>(comp);
  let total = 0;
  let dev = 0;
  for (const p of poles) {
    if (idSet.has(p.id)) {
      total++;
      if (p.has_device) dev++;
    }
  }
  return total === 0 ? 0 : dev / total;
}

function pickPincode(poles: PoleModel[], comp: Iterable<string>): string | null {
  const set = new Set<string>(comp);
  let fallback: string | null = null;
  for (const p of poles) {
    if (!set.has(p.id)) continue;
    if (p.pincode) return p.pincode;
    fallback = p.pincode ?? fallback;
  }
  return fallback ?? null;
}

function sumHe(ids: string[], poles: PoleModel[]): number {
  const set = new Set<string>(ids);
  let total = 0;
  for (const p of poles) if (set.has(p.id)) total += p.households;
  return total;
}

function groupBy<T>(arr: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}