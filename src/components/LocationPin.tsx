import { useEffect, useState } from 'react';
import { apiUrl } from '../config/runtime';

/**
 * Meeting-point pins — with Google (Oct 2026, owner's request).
 *
 * LocationPinPicker — find the meeting place with Google: search it by name
 * (Google's geocoder, through the server), use your current location, or
 * paste a Google Maps link (Share → Copy link; short maps.app.goo.gl links
 * work too). The chosen spot is previewed on a Google map before sending.
 *
 * LocationCard — how a shared pin is shown: a Google map, and buttons to
 * open it or get directions in Google Maps.
 *
 * No API key is needed: the map is Google's embeddable map, and place
 * search runs on the server (Apps Script's built-in Maps service).
 */

export interface PinValue { lat: number; lng: number; label: string }
interface Place { label: string; address: string; lat: number; lng: number }

const API_URL = apiUrl('/api/swapsutra');

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
export const googleDirectionsLink = (p: { lat: number; lng: number }) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
/** Google's embeddable map of a point — no key needed. */
export const googleEmbedUrl = (p: { lat: number; lng: number }, zoom = 16) => `https://maps.google.com/maps?q=${p.lat},${p.lng}&z=${zoom}&output=embed`;

export function LocationCard({ lat, lng, label, compact = false }: { lat: number; lng: number; label?: string; compact?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-brand-border bg-[var(--bg-surface)]" data-testid="location-card">
      <iframe
        title={label ? `Map: ${label}` : 'Shared location'}
        src={googleEmbedUrl({ lat, lng })}
        loading="lazy"
        className={`block w-full ${compact ? 'h-32' : 'h-44'} border-0`}
        referrerPolicy="no-referrer-when-downgrade"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <p className="text-xs font-semibold text-[var(--text-primary)] min-w-0 truncate">📍 {label || 'Pinned location'}</p>
        <div className="flex gap-3 text-2xs font-bold uppercase tracking-widest">
          <a href={googleMapsLink({ lat, lng })} target="_blank" rel="noopener noreferrer" className="text-brand-gold-text underline">Open in Google Maps</a>
          <a href={googleDirectionsLink({ lat, lng })} target="_blank" rel="noopener noreferrer" className="text-[var(--text-secondary)] underline">Directions</a>
        </div>
      </div>
    </div>
  );
}

async function post(body: Record<string, unknown>) {
  const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
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
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(initial || null);
  const [label, setLabel] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [link, setLink] = useState('');
  const [working, setWorking] = useState<'' | 'search' | 'here' | 'link'>('');
  const [note, setNote] = useState('Search the meeting place, use where you are, or paste a Google Maps link.');

  useEffect(() => { if (initial) setPin(initial); }, [initial]);

  const choose = (p: Place) => {
    setPin({ lat: p.lat, lng: p.lng });
    setLabel(p.label || p.address.split(',')[0] || '');
    setResults(null);
    setNote(p.address ? `📍 ${p.address}` : 'Place set. Check it on the map below.');
  };

  const search = async () => {
    if (query.trim().length < 3) { setNote('Type at least 3 letters — add the area or city for a better match.'); return; }
    setWorking('search');
    try {
      const d = await post({ action: 'geocodePlace', query: query.trim() });
      if (d?.success) {
        setResults(d.places || []);
        setNote((d.places || []).length ? 'Pick the right place:' : (d.message || 'No place found. Add the area or city.'));
      } else setNote(d?.message || 'Place search is not available right now.');
    } catch { setNote('Could not reach SwapSutra. Check your connection.'); }
    finally { setWorking(''); }
  };

  const useHere = () => {
    if (!navigator.geolocation) { setNote('This browser cannot share your location. Search the place instead.'); return; }
    setWorking('here');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const here = { lat: Math.round(pos.coords.latitude * 1e5) / 1e5, lng: Math.round(pos.coords.longitude * 1e5) / 1e5 };
      setPin(here);
      setNote('That is where you are now.');
      try {
        const d = await post({ action: 'reversePlace', ...here });
        if (d?.success && d.place?.address) { setNote(`📍 ${d.place.address}`); if (!label) setLabel(d.place.label || ''); }
      } catch { /* the pin is enough */ }
      setWorking('');
    }, () => { setWorking(''); setNote('Location permission was refused. Search the place or paste a Google Maps link.'); },
    { enableHighAccuracy: true, timeout: 10000 });
  };

  const fromLink = async () => {
    if (!link.trim()) return;
    setWorking('link');
    try {
      const d = await post({ action: 'resolveMapsLink', url: link.trim() });
      if (d?.success && d.place) { choose(d.place); setLink(''); }
      else setNote(d?.message || 'That link could not be read.');
    } catch { setNote('Could not reach SwapSutra. Check your connection.'); }
    finally { setWorking(''); }
  };

  const field = 'input-classic !py-2 text-xs w-full bg-[var(--bg-surface)]';
  const small = 'shrink-0 px-3 py-2 rounded-lg border border-brand-border text-2xs font-bold uppercase tracking-widest text-[var(--text-primary)] disabled:opacity-50';

  return (
    <div className="space-y-3" data-testid="location-pin-picker">
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={120}
          placeholder="Search a place — e.g. Hazratganj Metro, Lucknow" className={field} aria-label="Search a place on Google Maps" />
        <button type="submit" disabled={working === 'search'} className={small}>{working === 'search' ? '…' : 'Search'}</button>
      </form>
      {results && results.length > 0 && (
        <ul className="space-y-1" data-testid="place-results">
          {results.map((p, i) => (
            <li key={i}>
              <button type="button" onClick={() => choose(p)} className="w-full text-left rounded-lg border border-brand-border/60 px-3 py-2 hover:border-brand-gold">
                <span className="block text-xs font-semibold text-[var(--text-primary)]">{p.label || p.address.split(',')[0]}</span>
                <span className="block text-2xs text-[var(--text-secondary)] truncate">{p.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={useHere} disabled={working === 'here'} className={small}>{working === 'here' ? 'Finding you…' : '📍 Use my current location'}</button>
        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || 'meeting point near me')}`} target="_blank" rel="noopener noreferrer" className={small}>Open Google Maps</a>
      </div>
      <div className="flex gap-2">
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="…or paste a Google Maps link" className={field} aria-label="Paste a Google Maps link" />
        <button type="button" onClick={fromLink} disabled={!link.trim() || working === 'link'} className={small}>{working === 'link' ? '…' : 'Use link'}</button>
      </div>
      <p className="text-2xs text-[var(--text-secondary)]" role="status">{note}</p>

      {pin ? (
        <iframe title="Meeting point on Google Maps" src={googleEmbedUrl(pin, 17)} className="block h-56 w-full rounded-2xl border border-brand-border" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
      ) : (
        <div className="flex h-28 items-center justify-center rounded-2xl border border-dashed border-brand-border text-2xs text-[var(--text-secondary)]">The place will show here on Google Maps.</div>
      )}

      <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80}
        placeholder="Name the place — e.g. Café Coffee Day, Gate 2" className={field} />
      <p className="text-2xs text-[var(--text-secondary)] italic">Pick somewhere public. Phone numbers can't be added here.</p>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 px-4 py-2 rounded-lg border border-brand-border/60 text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Cancel</button>
        <button type="button" disabled={!pin || busy} onClick={() => pin && onSubmit({ lat: pin.lat, lng: pin.lng, label: label.trim() })}
          className="flex-1 px-4 py-2 rounded-lg bg-brand-brown text-white text-2xs font-bold uppercase tracking-widest disabled:opacity-50">
          {busy ? 'Sending…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
