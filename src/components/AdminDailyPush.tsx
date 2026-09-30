import React, { useEffect, useState } from 'react';
import { apiUrl } from '../config/runtime';

/**
 * Admin → Dashboard → "Daily book updates" (27 Sep).
 * Who is reached, what today's four pushes say, sends/taps per slot for
 * the last days, pause, change the hours, and "send me a test".
 */
const API = apiUrl('/api/swapsutra');
const SLOT_LABEL: Record<string, string> = { morning: 'Morning', afternoon: 'Lunch', evening: 'Evening', night: 'Night' };

async function call(action: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
  return res.json();
}

export function AdminDailyPush() {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [hours, setHours] = useState('');
  // Setup check (28 Sep): pop-ups were silently dead for everyone because
  // the notifications function crashed on Vercel. This shows, in yes/no
  // form, every piece a pop-up needs — and whether this device is in.
  const [setup, setSetup] = useState<any>(null);
  const loadSetup = async () => {
    const out: any = {};
    try { out.server = await fetch(apiUrl('/api/notifications/status')).then((r) => (r.ok ? r.json() : { crashed: r.status })); }
    catch { out.server = { crashed: 'offline' }; }
    try {
      out.permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration('/') : undefined;
      out.subscribed = Boolean(reg && (await reg.pushManager.getSubscription()));
    } catch { out.subscribed = false; }
    setSetup(out);
  };
  useEffect(() => { loadSetup(); }, []);

  const load = async () => {
    try {
      const r = await call('getDailyPushAdmin');
      if (r?.success) { setD(r); setHours((r.slots || []).join(', ')); } else setNote(r?.message || 'Could not load (deploy the new Apps Script version).');
    } catch { setNote('Could not load.'); }
  };
  useEffect(() => { load(); }, []);

  const act = async (label: string, action: string, extra: Record<string, unknown> = {}) => {
    setBusy(label); setNote('');
    try {
      const r = await call(action, extra);
      if (action === 'sendDailyPushTest') setNote(r?.summary?.skipped ? `Not sent: ${r.summary.skipped}` : `Sent to your devices (${r?.summary?.sent ?? 0}).`);
      else if (r?.success) { setD(r); setHours((r.slots || []).join(', ')); }
    } catch { setNote('Failed.'); }
    setBusy('');
  };

  const days = d?.stats ? Object.keys(d.stats).sort().reverse().slice(0, 7) : [];
  return (
    <div className="mt-8 rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-5 shadow-sm" data-testid="admin-daily-push">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-2xs font-bold uppercase tracking-widest text-[var(--text-primary)]">Daily book updates (push)</p>
        {d && (
          <p className="text-2xs text-[var(--text-secondary)]">
            {d.paused ? 'Paused' : `On · ${d.slots.join(', ')} IST`}{d.relayReady ? '' : ' · relay not configured'}
          </p>
        )}
      </div>
      {!d ? (
        <p className="mt-3 text-xs text-[var(--text-secondary)]">{note || 'Loading…'}</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            {[
              { label: 'Members reached', value: d.readers },
              { label: 'Visitors reached', value: d.visitors },
              { label: 'Devices', value: d.devicesReached },
            ].map((m) => (
              <div key={m.label} className="rounded-xl bg-[var(--bg-page)] p-3">
                <p className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{m.label}</p>
                <p className="mt-1 font-serif text-2xl text-[var(--text-primary)] tabular-nums">{m.value}</p>
              </div>
            ))}
          </div>

          {setup && (
            <div className="mt-4 rounded-xl bg-[var(--bg-page)] p-3 text-xs" data-testid="push-setup-check">
              <p className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Pop-up setup check</p>
              <ul className="mt-1 space-y-0.5">
                {[
                  ['Notifications server is running', setup.server && !setup.server.crashed, setup.server?.crashed ? `error ${setup.server.crashed} — redeploy the website` : ''],
                  ['VAPID keys on Vercel', setup.server?.vapidKeys, setup.server?.vapidKeyProblem || ''],
                  ['PUSH_RELAY_SECRET on Vercel', setup.server?.relaySecret, 'add it (16+ characters)'],
                  ['PUSH_RELAY_URL + secret in Apps Script', d.relayReady, 'Script Properties → PUSH_RELAY_URL = https://swapsutra.in/api/notifications/relay'],
                  ['GEMINI_API_KEY on Vercel (optional)', setup.server?.geminiKey, 'built-in lines are used'],
                  ['This browser allowed notifications', setup.permission === 'granted', `permission: ${setup.permission}`],
                  ['This device is registered', setup.subscribed, 'reload the site once after the fixes above'],
                ].map(([label, ok, hint]: any) => (
                  <li key={label}>{ok ? '✅' : '❌'} {label}{!ok && hint ? <span className="text-[var(--text-secondary)]"> — {hint}</span> : null}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 rounded-xl bg-[var(--bg-page)] p-3 text-xs">
            <p>
              <strong>Festival:</strong>{' '}
              {d.festival ? `${d.festival.emoji} ${d.festival.name} (${d.festival.phase === 'soon' ? `in ${d.festival.daysAway} days` : d.festival.phase})` : 'none today'}
              {' · '}<strong>Copy:</strong> {d.copySource === 'gemini' ? 'written by Gemini' : 'built-in lines'}
              {!d.aiEnabled && ' (Gemini switched off)'}
            </p>
            {(d.upcomingFestivals || []).length > 0 && (
              <p className="mt-1 text-[var(--text-secondary)]">
                Coming up: {d.upcomingFestivals.slice(0, 6).map((f: any) => `${f.name} (${f.inDays === 0 ? 'today' : `${f.inDays}d`})`).join(', ')}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={!!busy} onClick={() => act('ai', 'setDailyPushSettings', { ai: d.aiEnabled ? 'off' : 'on' })}
                className="min-h-[36px] rounded-full border border-brand-border px-3 text-2xs font-bold uppercase tracking-widest">
                {d.aiEnabled ? 'Use built-in lines' : 'Use Gemini'}
              </button>
              <button type="button" disabled={!!busy || !d.aiEnabled} onClick={() => act('regen', 'getDailyPushAdmin', { refreshCopy: true })}
                className="min-h-[36px] rounded-full border border-brand-border px-3 text-2xs font-bold uppercase tracking-widest">
                {busy === 'regen' ? 'Writing…' : 'Rewrite today with Gemini'}
              </button>
            </div>
          </div>

          <p className="mt-5 text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Today's pushes (what you would get / what a visitor gets)</p>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            {(d.preview || []).map((p: any) => (
              <div key={p.hour} className="rounded-xl bg-[var(--bg-page)] p-3 text-xs">
                <p className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{p.hour}:00 · {SLOT_LABEL[p.slot] || p.slot}</p>
                <p className="mt-1 font-semibold text-[var(--text-primary)]">{p.member.title}</p>
                <p className="text-[var(--text-secondary)]">{p.member.message}</p>
                <p className="mt-1 text-2xs text-[var(--text-secondary)]">Visitor: {p.visitor.title}</p>
                <button type="button" className="mt-2 text-2xs font-bold uppercase tracking-widest text-brand-gold-text disabled:opacity-50"
                  disabled={!!busy} onClick={() => act('test-' + p.slot, 'sendDailyPushTest', { slot: p.slot })}>
                  {busy === 'test-' + p.slot ? 'Sending…' : 'Send me this now'}
                </button>
              </div>
            ))}
          </div>

          {days.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead><tr className="text-left text-2xs uppercase tracking-widest text-[var(--text-secondary)]">
                  <th className="py-1 pr-3">Day</th>{['morning', 'afternoon', 'evening', 'night'].map((s) => <th key={s} className="py-1 pr-3">{SLOT_LABEL[s]} sent / taps</th>)}
                </tr></thead>
                <tbody>
                  {days.map((day) => (
                    <tr key={day} className="border-t border-brand-border/50">
                      <td className="py-1 pr-3">{day}</td>
                      {['morning', 'afternoon', 'evening', 'night'].map((s) => {
                        const x = d.stats[day]?.[s];
                        return <td key={s} className="py-1 pr-3">{x ? `${x.sent || 0} / ${x.opens || 0}` : '—'}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button type="button" disabled={!!busy} onClick={() => act('pause', 'setDailyPushSettings', { paused: !d.paused })}
              className="min-h-[40px] rounded-full border border-brand-border px-4 text-2xs font-bold uppercase tracking-widest">
              {d.paused ? 'Resume' : 'Pause'}
            </button>
            <label className="flex items-center gap-2 text-xs">
              Hours (IST, max 4, 8–22)
              <input value={hours} onChange={(e) => setHours(e.target.value)} className="w-32 rounded-lg border border-brand-border bg-[var(--bg-page)] px-2 py-1" />
            </label>
            <button type="button" disabled={!!busy} onClick={() => act('hours', 'setDailyPushSettings', { slots: hours })}
              className="min-h-[40px] rounded-full border border-brand-border px-4 text-2xs font-bold uppercase tracking-widest">Save hours</button>
            {note && <span className="text-xs text-[var(--text-secondary)]">{note}</span>}
          </div>
        </>
      )}
    </div>
  );
}
