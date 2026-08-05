'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Incident } from '@gridwatch/domain';
import { api, type PoleState, type Stats, type SimResult } from '@/lib/api';

const MapView = dynamic(() => import('./MapView'), { ssr: false, loading: () => <div className="h-full text-sm text-slate-400 flex items-center justify-center">loading map…</div> });

const STATUS_COLOR: Record<string, string> = {
  detected: 'bg-amber-600/80',
  acknowledged: 'bg-sky-600/80',
  crew_assigned: 'bg-indigo-600/80',
  resolved: 'bg-violet-600/80',
  verified: 'bg-green-600/80',
  closed: 'bg-slate-600/80',
  disputed: 'bg-red-600/80',
};

export default function ControlRoom() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [poles, setPoles] = useState<PoleState[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<string>('');

  const refresh = useCallback(async () => {
    try {
      const [incs, ps, st] = await Promise.all([api.incidents(), api.polesState(), api.stats()]);
      setIncidents(incs);
      setPoles(ps);
      setStats(st);
    } catch {
      /* api may be cold-starting */
    }
  }, []);

  useEffect(() => {
    refresh();
    const es = new EventSource('/events');
    const onIncidents = () => refresh();
    es.addEventListener('incidents', onIncidents);
    es.onerror = () => {};
    const poll = setInterval(refresh, 10000);
    return () => {
      es.removeEventListener('incidents', onIncidents);
      es.close();
      clearInterval(poll);
    };
  }, [refresh]);

  const push = (msg: string) => setLog((l) => [msg, ...l].slice(0, 40));

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
      await refresh();
      push(label);
    } catch {
      push(`${label} failed`);
    } finally {
      setBusy('');
    }
  };

  const inject = (kind: 'fault' | 'noise', type: string) =>
    act(`inject ${type}`, async () => {
      const r: SimResult = kind === 'fault' ? await api.fault(type) : await api.noise(type);
      push(`${r.note} (${r.affectedPoles} poles)`);
    });

  const open = useMemo(() => {
    const o = incidents.filter((i) => i.status !== 'closed' && i.status !== 'verified');
    return o.sort((a, b) => b.affected_households * b.confidence - a.affected_households * a.confidence);
  }, [incidents]);
  const closed = useMemo(() => incidents.filter((i) => i.status === 'closed' || i.status === 'verified'), [incidents]);
  const darkCount = useMemo(() => poles.filter((p) => p.known && p.dark).length, [poles]);

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-edge bg-panel">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">GridWatch AI — Fault Console</h1>
          <p className="text-xs text-slate-400">Subdivision SD07 · live/dark liveness → localized fault tickets</p>
        </div>
        <div className="flex gap-6 text-sm">
          <Stat label="Open incidents" value={open.length} tone="amber" />
          <Stat label="Poles dark" value={darkCount} tone="red" />
          <Stat label="Ingest msg/s" value={stats?.ingest.msgsPerSecond ?? 0} tone="slate" />
          <span className="flex items-center gap-1 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> live
          </span>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: incidents + simulator */}
        <div className="w-[420px] shrink-0 flex flex-col overflow-hidden border-r border-edge">
          <SimulatorPanel onInject={inject} onRepair={() => act('repair', async () => { await api.repair(); })} busy={busy} />
          <div className="flex-1 overflow-y-auto">
            <div className="px-3 py-2 text-xs text-slate-400 border-b border-edge">OPEN INCIDENTS</div>
            {open.length === 0 && (
              <div className="text-sm text-slate-500 px-4 py-6">No open faults. Inject one with the simulator →</div>
            )}
            {open.map((inc) => (
              <IncidentCard key={inc.id} inc={inc} onAction={(label, fn) => act(label, fn)} busy={busy} />
            ))}
            {closed.length > 0 && (
              <>
                <div className="px-3 py-2 text-xs text-slate-400 border-t border-edge mt-2">CLOSED / VERIFIED</div>
                {closed.map((inc) => (
                  <IncidentCard key={inc.id} inc={inc} onAction={(label, fn) => act(label, fn)} busy={busy} />
                ))}
              </>
            )}
          </div>
        </div>

        {/* Right: map */}
        <div className="flex-1 relative">
          <MapView poles={poles} incidents={incidents} />
          <div className="absolute bottom-3 left-3 z-[500] text-xs bg-panel/90 border border-edge rounded px-3 py-2 space-y-1">
            <LegendRow color="#22c55e" label="live pole" />
            <LegendRow color="#ef4444" label="dark pole" />
            <LegendRow color="#f59e0b" label="active incident" />
            <LegendRow color="#22c55e" label="verified / closed" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  const c =
    tone === 'amber' ? 'text-amber-400' : tone === 'red' ? 'text-red-400' : 'text-slate-300';
  return (
    <div className="text-center">
      <div className={`text-xl font-semibold leading-none ${c}`}>{value}</div>
      <div className="text-[11px] text-slate-500 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-3 h-3 rounded-full" style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}

function SimulatorPanel({
  onInject,
  onRepair,
  busy,
}: {
  onInject: (kind: 'fault' | 'noise', type: string) => void;
  onRepair: () => void;
  busy: string;
}) {
  return (
    <div className="border-b border-edge p-3 space-y-2">
      <div className="text-xs text-slate-400 uppercase tracking-wide">Simulator</div>
      <div className="flex flex-wrap gap-1.5">
        <SimBtn label="Span fault" on={() => onInject('fault', 'span')} busy={busy} />
        <SimBtn label="DT fault" on={() => onInject('fault', 'dt')} busy={busy} />
        <SimBtn label="Feeder fault" on={() => onInject('fault', 'feeder')} busy={busy} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <SimBtn label="Device dies" on={() => onInject('noise', 'device-die')} busy={busy} tone="neutral" />
        <SimBtn label="Scheduled outage" on={() => onInject('noise', 'scheduled-outage')} busy={busy} tone="neutral" />
        <SimBtn label="Dup msg" on={() => onInject('noise', 'duplicate')} busy={busy} tone="neutral" />
        <SimBtn label="Out-of-order" on={() => onInject('noise', 'out-of-order')} busy={busy} tone="neutral" />
      </div>
      <div className="flex items-center gap-2">
        <SimBtn label="Repair → auto-verify" on={onRepair} busy={busy} tone="green" />
      </div>
    </div>
  );
}

function SimBtn({
  label,
  on,
  busy,
  tone = 'current',
}: {
  label: string;
  on: () => void;
  busy: string;
  tone?: string;
}) {
  const cls =
    tone === 'green'
      ? 'bg-green-600 hover:bg-green-500'
      : tone === 'neutral'
        ? 'bg-slate-700 hover:bg-slate-600'
        : 'bg-amber-600 hover:bg-amber-500';
  return (
    <button
      onClick={on}
      className={`text-xs px-2.5 py-1.5 rounded text-white ${cls} transition disabled:opacity-50`}
    >
      {label}
    </button>
  );
}

function IncidentCard({
  inc,
  onAction,
  busy,
}: {
  inc: Incident;
  onAction: (label: string, fn: () => Promise<void>) => void;
  busy: string;
}) {
  const isClosed = inc.status === 'closed' || inc.status === 'verified';
  return (
    <div className={`px-4 py-3 border-b border-edge/60 ${isClosed ? 'opacity-70' : 'bg-panel/40'}`}>
      <div className="flex items-center justify-between">
        <div className="font-mono text-sm">{inc.id}</div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-1.5 py-0.5 rounded text-white ${STATUS_COLOR[inc.status] ?? 'bg-slate-700'}`}>
            {inc.status}
          </span>
          <span className="text-[11px] text-slate-400">{inc.type} · {inc.scope}</span>
        </div>
      </div>
      <div className="mt-1.5 text-sm">
        {inc.scope === 'span' ? (
          <span className="text-slate-200">Failure span: <span className="font-mono text-amber-300">{inc.from_pole}</span> → <span className="font-mono text-red-300">{inc.to_pole}</span></span>
        ) : inc.scope === 'feeder' ? (
          <span className="text-slate-200">Feeder fault · feeder <span className="font-mono text-amber-300">{inc.feeder_id}</span></span>
        ) : (
          <span className="text-slate-200">DT area fault · <span className="font-mono text-amber-300">{inc.dt_id}</span></span>
        )}
      </div>
      <div className="mt-1 text-xs text-slate-400 space-x-3">
        <span>{inc.affected_households} households</span>
        <span>{inc.affected_pole_ids.length} poles</span>
        <span>PIN {inc.pincode ?? '?'}</span>
        {inc.coords && <span className="font-mono">{inc.coords.lat.toFixed(5)},{inc.coords.lon.toFixed(5)}</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded bg-slate-700 overflow-hidden">
          <div className="h-full bg-slate-300" style={{ width: `${Math.round(inc.confidence * 100)}%` }} />
        </div>
        <span className="text-[11px] text-slate-400" title={inc.reason}>
          {Math.round(inc.confidence * 100)}% conf
        </span>
      </div>
      {inc.ai_brief && (
        <div className="mt-2 text-xs text-slate-300 border border-edge rounded p-2 whitespace-pre-line">
          <span className="text-[10px] text-emerald-400 font-semibold uppercase">AI brief</span>
          <div className="mt-1">{inc.ai_brief}</div>
        </div>
      )}
      {!isClosed && (
        <div className="mt-2 flex gap-2">
          {inc.status === 'detected' && (
            <ActionBtn label="Acknowledge" busy={busy} onClick={() => onAction('ack', () => api.acknowledge(inc.id).then(() => undefined))} />
          )}
          {inc.status === 'acknowledged' && (
            <ActionBtn label="Assign crew" busy={busy} onClick={() => onAction('assign', () => api.assign(inc.id, 'Crew-2').then(() => undefined))} />
          )}
          {(inc.status === 'crew_assigned' || inc.status === 'resolved') && (
            <ActionBtn label="Mark resolved" busy={busy} onClick={() => onAction('resolve', () => api.resolve(inc.id).then(() => undefined))} tone="violet" />
          )}
          {inc.status === 'disputed' && (
            <span className="text-xs text-red-400">Marked fixed but poles still dark — not closed</span>
          )}
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  label,
  onClick,
  busy,
  tone = 'default',
}: {
  label: string;
  onClick: () => void;
  busy: string;
  tone?: string;
}) {
  const cls = tone === 'violet' ? 'bg-violet-600 hover:bg-violet-500' : 'bg-sky-600 hover:bg-sky-500';
  return (
    <button onClick={onClick} className={`text-xs px-2 py-1 rounded text-white ${cls} transition disabled:opacity-50`} disabled={!!busy}>
      {label}
    </button>
  );
}