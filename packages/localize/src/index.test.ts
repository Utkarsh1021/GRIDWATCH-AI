import { describe, it, expect } from 'vitest';
import { buildBelievedEdges, localize, type PoleModel, type TransformerModel } from './index.js';

const T0 = new Date('2026-08-05T12:00:00Z').getTime();

function pole(id: string, dt: string, parent: string | null, opts: Partial<PoleModel> = {}): PoleModel {
  return {
    id,
    lat: 12.97,
    lon: 77.59,
    feeder_id: 'F-01',
    dt_id: dt,
    seq_on_line: parent ? 1 : 1,
    parent_pole_id: parent,
    pincode: '560001',
    has_device: true,
    households: 10,
    ...opts,
  };
}

const D1: TransformerModel = { id: 'D-1', feeder_id: 'F-01', lat: 12.97, lon: 77.59 };

function liveness(entries: [string, boolean][]): Map<string, { dark: boolean; known: boolean }> {
  const m = new Map<string, { dark: boolean; known: boolean }>();
  for (const [id, dark] of entries) m.set(id, { dark, known: true });
  return m;
}

// Recorded DT with:
//   P1 - P2 - P3 - P4   (main line, P1 root)
//            |
//            P5 - P6    (branch off P2)
function recordedNetwork(): { poles: PoleModel[] } {
  return {
    poles: [
      pole('P1', 'D-1', null),
      pole('P2', 'D-1', 'P1'),
      pole('P3', 'D-1', 'P2'),
      pole('P4', 'D-1', 'P3'),
      pole('P5', 'D-1', 'P2'),
      pole('P6', 'D-1', 'P5'),
    ],
  };
}

describe('buildBelievedEdges', () => {
  it('uses recorded ordering when present', () => {
    const { poles } = recordedNetwork();
    const edges = buildBelievedEdges(poles, new Map());
    expect(edges.every((e) => e.source === 'recorded')).toBe(true);
    expect(edges).toContainEqual({ dt_id: 'D-1', from: 'P2', to: 'P3', source: 'recorded' });
  });

  it('infers a tree when ordering is missing', () => {
    const poles = [
      pole('A1', 'D-9', null),
      pole('A2', 'D-9', null, { lat: 12.9701, lon: 77.5901 }),
      pole('A3', 'D-9', null, { lat: 12.9702, lon: 77.5902 }),
      pole('A4', 'D-9', null, { lat: 12.9703, lon: 77.5903 }),
    ];
    const edges = buildBelievedEdges(
      poles,
      new Map([['D-9', { lat: 12.9699, lon: 77.5899 }]]),
    );
    expect(edges.every((e) => e.source === 'inferred')).toBe(true);
    expect(edges.length).toBe(3);
  });
});

describe('localize - span fault on recorded topology (the headline test)', () => {
  it('finds the expected span P2-P3 with the dark region downstream', () => {
    const { poles } = recordedNetwork();
    const { faults } = localize({
      poles,
      transformers: [D1],
      liveness: liveness([['P1', false], ['P2', false], ['P3', true], ['P4', true]]),
      scheduledOutages: [],
      now: T0,
    });
    expect(faults).toHaveLength(1);
    const f = faults[0];
    expect(f.type).toBe('span');
    expect(f.scope).toBe('span');
    expect(f.from_pole).toBe('P2');
    expect(f.to_pole).toBe('P3');
    expect(f.affected_poles.sort()).toEqual(['P3', 'P4']);
    expect(f.affected_households).toBe(20);
    expect(f.pincode).toBe('560001');
    expect(f.confidence).toBeGreaterThan(0.5);
  });
});

describe('localize - span fault spanning a blind (non-instrumented) pole', () => {
  it('keeps the dark region as ONE ticket across the coverage gap', () => {
    // P1 - P2 - P3 - P4 - P5 - P6 - P7 ; P5 has no device.
    // Fault at P2->P3 darkens P3..P7, but P5 is blind so the sensor grid sees P6 dark
    // with no observable parent. The region must still be one incident.
    const poles = [
      pole('P1', 'D-1', null),
      pole('P2', 'D-1', 'P1'),
      pole('P3', 'D-1', 'P2'),
      pole('P4', 'D-1', 'P3'),
      pole('P5', 'D-1', 'P4', { has_device: false }),
      pole('P6', 'D-1', 'P5'),
      pole('P7', 'D-1', 'P6'),
    ];
    const { faults } = localize({
      poles,
      transformers: [D1],
      liveness: liveness([
        ['P1', false],
        ['P2', false],
        ['P3', true],
        ['P4', true],
        ['P6', true],
        ['P7', true],
      ]),
      scheduledOutages: [],
      now: T0,
    });
    expect(faults).toHaveLength(1);
    expect(faults[0].from_pole).toBe('P2');
    expect(faults[0].to_pole).toBe('P3');
    expect(faults[0].affected_poles.sort()).toEqual(['P3', 'P4', 'P5', 'P6', 'P7']);
    expect(faults[0].affected_households).toBe(50);
    expect(faults[0].confidence).toBeLessThan(1);
  });
});

describe('localize - simultaneous faults', () => {
  it('returns two tickets for two separate dark regions, not one', () => {
    const { poles } = recordedNetwork();
    const { faults } = localize({
      poles,
      transformers: [D1],
      liveness: liveness([
        ['P1', false],
        ['P2', false],
        ['P3', true],
        ['P4', true],
        ['P5', true],
        ['P6', true],
      ]),
      scheduledOutages: [],
      now: T0,
    });
    expect(faults).toHaveLength(2);
    const tops = faults.map((f) => f.to_pole).sort();
    expect(tops).toEqual(['P3', 'P5']);
  });
});

describe('localize - DT fault', () => {
  it('returns a dt-area ticket when every pole under a transformer is dark (other DTs live)', () => {
    const { poles } = recordedNetwork();
    // Add a second, live DT on the same feeder so this is NOT interpreted as a feeder fault
    const secondDtPoles = [pole('S1', 'D-2', null), pole('S2', 'D-2', 'S1')];
    const { faults } = localize({
      poles: [...poles, ...secondDtPoles],
      transformers: [D1, { id: 'D-2', feeder_id: 'F-01', lat: 12.98, lon: 77.6 }],
      liveness: liveness([
        ['P1', true], ['P2', true], ['P3', true], ['P4', true], ['P5', true], ['P6', true],
        ['S1', false], ['S2', false],
      ]),
      scheduledOutages: [],
      now: T0,
    });
    expect(faults).toHaveLength(1);
    expect(faults[0].scope).toBe('dt-area');
    expect(faults[0].type).toBe('dt');
    expect(faults[0].from_pole).toBeNull();
  });
});

describe('localize - dead sensor (must not cry wolf)', () => {
  it('does NOT ticket a single dark pole whose children are live', () => {
    const { poles } = recordedNetwork();
    const { faults, suspects } = localize({
      poles,
      transformers: [D1],
      // P2 dark, but its children P3/P4/P5 are live => physically impossible as a line fault
      liveness: liveness([
        ['P1', false],
        ['P2', true],
        ['P3', false],
        ['P4', false],
        ['P5', false],
        ['P6', false],
      ]),
      scheduledOutages: [],
      now: T0,
    });
    expect(faults).toHaveLength(0);
    expect(suspects).toContain('P2');
  });
});

describe('localize - scheduled outage (must not cry wolf)', () => {
  it('suppresses a fault that falls inside a scheduled feeder outage', () => {
    const { poles } = recordedNetwork();
    const { faults } = localize({
      poles,
      transformers: [D1],
      liveness: liveness([['P1', false], ['P2', false], ['P3', true], ['P4', true]]),
      scheduledOutages: [
        { scope: 'feeder', target_id: 'F-01', start: T0 - 1000, end: T0 + 1000 },
      ],
      now: T0,
    });
    expect(faults).toHaveLength(0);
  });

  it('does NOT suppress a fault when the outage window has elapsed (overrun = real)', () => {
    const { poles } = recordedNetwork();
    const { faults } = localize({
      poles,
      transformers: [D1],
      liveness: liveness([['P1', false], ['P2', false], ['P3', true], ['P4', true]]),
      scheduledOutages: [{ scope: 'feeder', target_id: 'F-01', start: T0 - 2000, end: T0 - 1000 }],
      now: T0,
    });
    expect(faults).toHaveLength(1);
  });
});

describe('localize - missing topology via geometric inference', () => {
  it('localizes a fault to the right span on an inferred line', () => {
    // Poles on a straight line, no recorded ordering. The centroid is the middle,
    // so the closest-closer-parent rule reconstructs the line.
    const dt = 'D-7';
    const poles = [
      pole('Q1', dt, null, { lat: 12.9700, lon: 77.5900 }),
      pole('Q2', dt, null, { lat: 12.97005, lon: 77.5901 }),
      pole('Q3', dt, null, { lat: 12.9701, lon: 77.5902 }),
      pole('Q4', dt, null, { lat: 12.97015, lon: 77.5903 }),
      pole('Q5', dt, null, { lat: 12.9702, lon: 77.5904 }),
      pole('Q6', dt, null, { lat: 12.97025, lon: 77.5905 }),
    ];
    const tf: TransformerModel = { id: dt, feeder_id: 'F-01', lat: 12.9699, lon: 77.5899 };
    const { faults } = localize({
      poles,
      transformers: [tf],
      liveness: liveness([
        ['Q1', false], ['Q2', false], ['Q3', true], ['Q4', true], ['Q5', true], ['Q6', true],
      ]),
      scheduledOutages: [],
      now: T0,
    });
    expect(faults).toHaveLength(1);
    expect(faults[0].scope).toBe('span');
    expect(faults[0].from_pole).toBe('Q2');
    expect(faults[0].to_pole).toBe('Q3');
    expect(faults[0].confidence).toBeLessThan(1);
  });
});

describe('localize - unknowns and confidence', () => {
  it('never emits a fault above confidence 1 and span confidence is well-formed', () => {
    const { poles } = recordedNetwork();
    const { faults } = localize({
      poles,
      transformers: [D1],
      liveness: liveness([['P1', false], ['P2', false], ['P3', true], ['P4', true]]),
      scheduledOutages: [],
      now: T0,
    });
    for (const f of faults) {
      expect(f.confidence).toBeGreaterThan(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    }
  });
});