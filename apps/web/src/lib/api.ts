import type { Incident } from '@gridwatch/domain';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  incidents: () => http<Incident[]>('/api/incidents'),
  polesState: () => http<PoleState[]>('/api/poles/state'),
  transformers: () => http<Transformer[]>('/api/network/transformers'),
  stats: () => http<Stats>('/api/system/stats'),
  acknowledge: (id: string) => http<Incident>(`/api/incidents/${id}/acknowledge`, { method: 'POST', body: '{}' }),
  assign: (id: string, crew: string) => http<Incident>(`/api/incidents/${id}/assign`, { method: 'POST', body: JSON.stringify({ crew }) }),
  resolve: (id: string) => http<Incident>(`/api/incidents/${id}/resolve`, { method: 'POST', body: '{"by":"operator"}' }),
  fault: (type: string) => http<SimResult>('/api/simulator/fault', { method: 'POST', body: JSON.stringify({ type }) }),
  noise: (kind: string) => http<SimResult>('/api/simulator/noise', { method: 'POST', body: JSON.stringify({ kind }) }),
  repair: () => http<SimResult>('/api/simulator/repair', { method: 'POST', body: '{}' }),
};

export interface PoleState {
  pole_id: string;
  lat: number;
  lon: number;
  dt_id: string;
  feeder_id: string;
  dark: boolean;
  known: boolean;
}

export interface Transformer {
  id: string;
  feeder_id: string;
  lat: number;
  lon: number;
}

export interface Stats {
  ingest: { received: number; applied: number; dropped: number; msgsPerSecond: number; uptimeSeconds: number };
  openIncidents: number;
  sseClients: number;
}

export interface SimResult {
  kind: string;
  note: string;
  affectedPoles: number;
  messagesEmitted: number;
  messagesDropped: number;
}