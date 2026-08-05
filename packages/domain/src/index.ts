export type TelemetryEventType = 'heartbeat' | 'power_lost' | 'power_restored' | 'boot';

export interface TelemetryEvent {
  device_id: string;
  pole_id: string;
  event: TelemetryEventType;
  energized: boolean;
  ts: string;
  seq: number;
  battery_mv: number;
  rssi: number;
  fw: string;
}

export interface Feeder {
  id: string;
  substation_id: string;
  name: string;
}

export interface Transformer {
  id: string;
  feeder_id: string;
  lat: number;
  lon: number;
  capacity_kva: number;
  households_served: number;
}

export interface Pole {
  id: string;
  lat: number;
  lon: number;
  feeder_id: string;
  dt_id: string;
  seq_on_line: number | null;
  parent_pole_id: string | null;
  pole_type: string;
  ward: string;
  pincode: string | null;
  device_id: string | null;
}

export type EdgeSource = 'recorded' | 'inferred' | 'learned';

export interface Edge {
  dt_id: string;
  from: string;
  to: string;
  source: EdgeSource;
}

export interface ScheduleEntry {
  id: string;
  scope: 'feeder' | 'dt';
  target_id: string;
  start: string;
  end: string;
  reason: string;
}

export type FaultType = 'span' | 'dt' | 'feeder';

export type LocalizationScope = 'span' | 'dt-area' | 'feeder';

export interface LocatedFault {
  incident_index: number;
  type: FaultType;
  scope: LocalizationScope;
  confidence: number;
  dt_id: string | null;
  feeder_id: string;
  from_pole: string | null;
  to_pole: string | null;
  coords: { lat: number; lon: number } | null;
  pincode: string | null;
  affected_poles: string[];
  affected_households: number;
  boundary: { live?: string; dark: string } | null;
  reason: string;
}

export type IncidentStatus =
  | 'detected'
  | 'acknowledged'
  | 'crew_assigned'
  | 'resolved'
  | 'verified'
  | 'closed'
  | 'disputed';

export type IncidentType = 'span' | 'dt' | 'feeder';

export interface IncidentTimelineEntry {
  at: string;
  status: IncidentStatus;
  note?: string;
}

export interface Incident {
  id: string;
  detected_at: string;
  type: IncidentType;
  scope: LocalizationScope;
  confidence: number;
  dt_id: string | null;
  feeder_id: string;
  from_pole: string | null;
  to_pole: string | null;
  coords: { lat: number; lon: number } | null;
  pincode: string | null;
  affected_pole_ids: string[];
  affected_households: number;
  status: IncidentStatus;
  timeline: IncidentTimelineEntry[];
  ai_brief?: string;
  reason?: string;
}

export interface Liveness {
  pole_id: string;
  dark: boolean;
  known: boolean;
  updated_at: string;
}