'use client';

import { useEffect, useRef } from 'react';
import type { Incident } from '@gridwatch/domain';
import type { PoleState } from '@/lib/api';

export default function MapView({
  poles,
  incidents,
}: {
  poles: PoleState[];
  incidents: Incident[];
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{ map: L.Map; live: L.LayerGroup; dark: L.LayerGroup; inc: L.LayerGroup } | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('leaflet').then((L) => {
      if (cancelled || !divRef.current) return;
      if (stateRef.current) return;
      const center = poles.length ? [poles[0].lat, poles[0].lon] : [12.97, 77.595];
      const map = L.map(divRef.current, { zoomControl: true }).setView(center as [number, number], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      const live = L.layerGroup().addTo(map);
      const dark = L.layerGroup().addTo(map);
      const inc = L.layerGroup().addTo(map);
      stateRef.current = { map, live, dark, inc };
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    import('leaflet').then((L) => {
      st.live.clearLayers();
      st.dark.clearLayers();
      for (const p of poles) {
        const marker = L.circleMarker([p.lat, p.lon], {
          radius: p.dark ? 3.5 : 2.2,
          color: 'transparent',
          fillColor: p.dark ? '#ef4444' : '#22c55e',
          fillOpacity: p.known ? (p.dark ? 0.95 : 0.55) : 0.12,
        }).bindPopup(`${p.pole_id} · ${p.dt_id} ${p.dark ? '· DARK' : ''}`);
        marker.addTo(p.dark ? st.dark : st.live);
      }
    });
  }, [poles]);

  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    import('leaflet').then((L) => {
      st.inc.clearLayers();
      for (const inc of incidents) {
        if (!inc.coords || inc.scope === 'feeder') continue;
        const col = inc.status === 'closed' || inc.status === 'verified' ? '#22c55e' : '#f59e0b';
        L.circleMarker([inc.coords.lat, inc.coords.lon], {
          radius: 9,
          color: col,
          fillColor: col,
          fillOpacity: 0.3,
          weight: 3,
        })
          .bindPopup(
            `<b>${inc.id}</b><br/>${inc.type}/${inc.scope} conf ${Math.round(inc.confidence * 100)}%<br/>${inc.affected_households} households<br/>PIN ${inc.pincode ?? '?'}<br/><i>${inc.status}</i>`,
          )
          .addTo(st.inc);
      }
    });
  }, [incidents]);

  return <div ref={divRef} className="h-full w-full relative z-0" />;
}