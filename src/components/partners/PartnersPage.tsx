import React, { useCallback, useEffect, useState } from 'react';
import { PARTNER_LABEL, type PartnerType } from '../../data/partnerContracts';
import PartnerRegister from './PartnerRegister';
import PartnerDashboard from './PartnerDashboard';
import { partnerPost, type PartnerDash } from './partnerApi';

/**
 * /partners (9 Oct 2026, owner's request) — bookstores, authors, publishers
 * and promoters register here, separately from readers, and run their
 * business from the dashboard once approved.
 */

export default function PartnersPage({ signedInEmail, onSession, onOpenOrders, onListBook }: {
  signedInEmail: string;
  onSession: (s: { sessionToken: string; email: string; role?: string }) => void;
  onOpenOrders: () => void;
  onListBook: () => void;
}) {
  const [dash, setDash] = useState<PartnerDash | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [startType, setStartType] = useState<PartnerType | undefined>(undefined);
  const [editing, setEditing] = useState(false);

  const reload = useCallback(async () => {
    if (!signedInEmail) { setDash(null); return; }
    setLoading(true); setError('');
    try {
      const d = await partnerPost('getMyPartner');
      if (d?.success) setDash(d); else setError(d?.message || 'Could not load your partner account.');
    } catch { setError('Could not reach SwapSutra. Check your connection.'); }
    setLoading(false);
  }, [signedInEmail]);
  useEffect(() => { reload(); }, [reload]);

  const p = dash?.partner || null;
  return (
    <div className="pp-page" data-testid="partners-page">
      {(!p || p.status !== 'APPROVED') && <PartnersIntro onPick={(t) => { setStartType(t); document.getElementById('pp-start')?.scrollIntoView({ behavior: 'smooth' }); }} />}
      <div id="pp-start" className="pp-start">
        {!signedInEmail ? <VerifyEmail onSession={onSession} />
          : loading && !dash ? <p className="pp-hint">Loading your partner account…</p>
          : error ? <p className="pp-error" role="alert">{error} <button type="button" className="pp-link" onClick={reload}>Try again</button></p>
          : !p ? <PartnerRegister initialType={startType} onDone={() => { reload(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
          : p.status === 'APPROVED' ? <PartnerDashboard dash={dash!} reload={reload} onOpenOrders={onOpenOrders} onListBook={onListBook} />
          : (p.status === 'CHANGES_REQUESTED' && editing) ? <PartnerRegister existing={p} onDone={() => { setEditing(false); reload(); }} />
          : <ApplicationStatus dash={dash!} onEdit={() => setEditing(true)} />}
      </div>
    </div>
  );
}

function PartnersIntro({ onPick }: { onPick: (t: PartnerType) => void }) {
  return (
    <section className="pp-hero ss-bleed">
      <div className="pp-hero__inner">
        <p className="pp-eyebrow">SwapSutra partners</p>
        <h1 className="pp-h1">Bring your bookstore, your books or your launches to SwapSutra's readers.</h1>
        <p className="pp-lead">For bookstores, authors, publishers and promoters. A separate account, verified by SwapSutra.</p>
        <ul className="pp-perks">
          <li><b>No listing limit</b> — list every title, with how many copies you have.</li>
          <li><b>No ₹10 platform fee</b> for you on your own books (buyers pay it as usual). SwapSutra keeps <b>2%</b> of your payouts — <b>0% for the first year</b> if SwapSutra approves you commission-free.</li>
          <li><b>Paid monthly</b> to your UPI, with every order and the commission shown in your dashboard.</li>
          <li><b>Your banner on the Library page</b> (with the SwapSutra logo) and <b>ads between the books</b> — free for 6 months, then ₹100 for every 2 months. Your choice.</li>
          <li>You ship and deliver your orders; SwapSutra keeps buyers' details private and gives you only the shipping address.</li>
        </ul>
        <div className="pp-hero__types">
          {(Object.keys(PARTNER_LABEL) as PartnerType[]).map((t) => (
            <button key={t} type="button" className="pp-hero__type" onClick={() => onPick(t)}>Register as {PARTNER_LABEL[t].toLowerCase()}</button>
          ))}
        </div>
      </div>
    </section>
  );
}

function VerifyEmail({ onSession }: { onSession: (s: { sessionToken: string; email: string; role?: string }) => void }) {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setMsg('Enter a valid email.'); return; }
    setBusy(true); setMsg('');
    try {
      const d = await partnerPost('sendOTP', { email: email.trim().toLowerCase(), purpose: 'partner' });
      if (d?.success) { setSent(true); setMsg('We sent a code to ' + email.trim() + '. It works for a short time.'); }
      else setMsg(d?.message || 'Could not send the code.');
    } catch { setMsg('Could not reach SwapSutra.'); }
    setBusy(false);
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const d = await partnerPost('verifyOTP', { email: email.trim().toLowerCase(), otp: otp.trim() });
      if (d?.success && d.sessionToken) onSession({ sessionToken: d.sessionToken, email: email.trim().toLowerCase(), role: d.role });
      else setMsg(d?.message || 'That code did not work.');
    } catch { setMsg('Could not reach SwapSutra.'); }
    setBusy(false);
  };
  return (
    <section className="pp-card pp-verify" data-testid="partner-verify">
      <h2 className="pp-h2">Start with your business email</h2>
      <p className="pp-hint">Use the email you want for your partner account — it can be different from any reader account. Already a partner? Use the same email to open your dashboard.</p>
      {!sent ? (
        <form onSubmit={send} className="pp-inline">
          <input className="input-classic pp-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="store@example.com" aria-label="Email" />
          <button type="submit" className="btn-primary pp-btn" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="pp-inline">
          <input className="input-classic pp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="6-digit code" aria-label="Code" />
          <button type="submit" className="btn-primary pp-btn" disabled={busy || otp.length < 6}>{busy ? 'Checking…' : 'Verify'}</button>
          <button type="button" className="pp-link" onClick={() => { setSent(false); setOtp(''); }}>Use another email</button>
        </form>
      )}
      {msg && <p className="pp-hint" role="status">{msg}</p>}
    </section>
  );
}

function ApplicationStatus({ dash, onEdit }: { dash: PartnerDash; onEdit: () => void }) {
  const p = dash.partner!;
  const label: Record<string, string> = { PENDING: 'Under review', CHANGES_REQUESTED: 'Changes needed', REJECTED: 'Not approved', SUSPENDED: 'Paused' };
  return (
    <section className="pp-card" data-testid="partner-status">
      <p className="pp-eyebrow">{p.typeLabel} application</p>
      <h2 className="pp-h2">{p.name} — {label[p.status] || p.status}</h2>
      <ol className="pp-steps">{(dash.nextSteps || []).map((s) => <li key={s.key} className={s.urgent ? 'is-urgent' : ''}>{s.text}</li>)}</ol>
      {p.status === 'CHANGES_REQUESTED' && <button type="button" className="btn-primary pp-btn" onClick={onEdit}>Update my application</button>}
      <p className="pp-hint">Sent on {p.submittedAt ? new Date(p.submittedAt).toLocaleDateString('en-IN') : '—'} · agreement signed by {p.contractSignedName}. Questions: swapsutra@gmail.com</p>
    </section>
  );
}
