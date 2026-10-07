import { useEffect, useRef, useState } from 'react';
import type * as LeafletNS from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Meeting-point pins (Oct 2026).
 *
 * LocationPinPicker — a small OpenStreetMap map. It starts at the reader's
 * current location (if they allow it), they tap or drag the pin to the
 * exact spot, name the place, and send. Leaflet is loaded only when the
 * picker opens, so the rest of the app doesn't carry it.
 *
 * LocationCard — how a shared pin is shown: a map preview and links to
 * open it in Google Maps or OpenStreetMap for directions.
 */

export interface PinValue { lat: number; lng: number; label: string }

const INDIA_CENTER = { lat: 22.97, lng: 78.66 };

export function parseGeoUrl(url: string | undefined | null): PinValue | null {
  const m = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:\?q=(.*))?$/.exec(String(url || '').trim());
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let label = '';
  try { label = m[3] ? decodeURIComponent(m[3]) : ''; } catch { label = ''; }
  return { lat, lng, label };
}

export const googleMapsLink = (p: { lat: number; lng: number }) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

export function LocationCard({ lat, lng, label, compact = false }: { lat: number; lng: number; label?: string; compact?: boolean }) {
  const d = 0.004;
  const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}&layer=mapnik&marker=${lat}%2C${lng}`;
  return (
    <div className="overflow-hidden rounded-2xl border border-brand-border bg-[var(--bg-surface)]" data-testid="location-card">
      <iframe
        title={label ? `Map: ${label}` : 'Shared location'}
        src={embed}
        loading="lazy"
        className={`block w-full ${compact ? 'h-32' : 'h-44'} border-0`}
        referrerPolicy="no-referrer"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <p className="text-xs font-semibold text-[var(--text-primary)] min-w-0 truncate">📍 {label || 'Pinned location'}</p>
        <div className="flex gap-3 text-2xs font-bold uppercase tracking-widest">
          <a href={googleMapsLink({ lat, lng })} target="_blank" rel="noopener noreferrer" className="text-brand-gold-text underline">Google Maps</a>
          <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`} target="_blank" rel="noopener noreferrer" className="text-[var(--text-secondary)] underline">OSM</a>
        </div>
      </div>
    </div>
  );
}

export function LocationPinPicker({
  onSubmit, onCancel, submitLabel = 'Share this location', busy = false, initial,
}: {
  onSubmit: (value: PinValue) => void;
  onCancel: () => void;
  submitLabel?: string;
  busy?: boolean;
  initial?: { lat: number; lng: number } | null;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const markerRef = useRef<LeafletNS.Marker | null>(null);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(initial || null);
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState('Loading the map…');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import('leaflet');
      if (cancelled || !mapEl.current) return;
      const start = initial || INDIA_CENTER;
      const map = L.map(mapEl.current, { zoomControl: true }).setView([start.lat, start.lng], initial ? 16 : 5);
      mapRef.current = map;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      // A plain circle marker needs no image files (Leaflet's default icon
      // images don't survive bundling without extra setup).
      const icon = L.divIcon({
        className: '',
        html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#8B4A57;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>',
        iconSize: [22, 22], iconAnchor: [11, 22],
      });
      const place = (lat: number, lng: number) => {
        setPin({ lat, lng });
        if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
        else {
          markerRef.current = L.marker([lat, lng], { draggable: true, icon }).addTo(map);
          markerRef.current.on('dragend', () => {
            const p = markerRef.current!.getLatLng();
            setPin({ lat: p.lat, lng: p.lng });
          });
        }
      };
      if (initial) place(initial.lat, initial.lng);
      map.on('click', (e: LeafletNS.LeafletMouseEvent) => place(e.latlng.lat, e.latlng.lng));
      setStatus(initial ? 'Drag the pin to adjust.' : 'Tap the map to drop a pin, or use your current location.');
      if (!initial && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (cancelled) return;
            map.setView([pos.coords.latitude, pos.coords.longitude], 16);
            place(pos.coords.latitude, pos.coords.longitude);
            setStatus('That is where you are now. Drag the pin to the meeting spot.');
          },
          () => { /* permission refused: they can still tap the map */ },
          { enableHighAccuracy: true, timeout: 8000 }
        );
      }
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null; }
    };
    // initial is only read once, when the map is created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3" data-testid="location-pin-picker">
      <div ref={mapEl} className="h-64 w-full rounded-2xl border border-brand-border overflow-hidden" style={{ zIndex: 0 }} />
      <p className="text-2xs text-[var(--text-secondary)]" role="status">{status}</p>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={80}
        placeholder="Name the place — e.g. Café Coffee Day, Sanjay Place, Gate 2"
        className="input-classic !py-2 text-xs w-full bg-[var(--bg-surface)]"
      />
      <p className="text-2xs text-[var(--text-secondary)] italic">Pick somewhere public. Phone numbers can't be added here.</p>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 px-4 py-2 rounded-lg border border-brand-border/60 text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Cancel</button>
        <button
          type="button"
          disabled={!pin || busy}
          onClick={() => pin && onSubmit({ lat: pin.lat, lng: pin.lng, label: label.trim() })}
          className="flex-1 px-4 py-2 rounded-lg bg-brand-brown text-white text-2xs font-bold uppercase tracking-widest disabled:opacity-50"
        >
          {busy ? 'Sending…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
