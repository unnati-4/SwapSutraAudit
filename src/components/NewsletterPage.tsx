/**
 * /newsletter — every letter SwapSutra has sent, readable by anyone.
 *
 * There is no sign-up box any more: joining SwapSutra subscribes you, and
 * this page is where you read past letters or switch them off. The
 * unsubscribe link in each email lands here with ?unsubscribe=<token>; we
 * ask for one tap before acting, so an email scanner opening the link
 * cannot unsubscribe anyone by accident.
 */
import { useEffect, useRef, useState } from 'react';

type Edition = {
  newsletterId: string;
  editionLabel: string;
  subject: string;
  headerTitle: string;
  preheader?: string;
  sentAt: string;
};

const niceDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
};

export default function NewsletterPage({
  apiUrl,
  signedIn,
  unsubscribeToken,
  onSignIn,
}: {
  apiUrl: string;
  signedIn: boolean;
  unsubscribeToken?: string;
  onSignIn: () => void;
}) {
  const [editions, setEditions] = useState<Edition[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState<{ edition: Edition; html: string } | null>(null);
  const [opening, setOpening] = useState('');
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [unsubState, setUnsubState] = useState<'ask' | 'working' | 'done' | 'error'>('ask');
  const [unsubMessage, setUnsubMessage] = useState('');
  const frameRef = useRef<HTMLIFrameElement>(null);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  const loadArchive = async () => {
    setLoadError('');
    try {
      const data = await post({ action: 'getNewsletterArchive' });
      if (data?.success) setEditions(Array.isArray(data.editions) ? data.editions : []);
      else setLoadError(data?.message || 'Could not load the letters.');
    } catch {
      setLoadError('Connection problem. Please try again.');
    }
  };

  useEffect(() => { loadArchive(); }, []);

  useEffect(() => {
    if (!signedIn) { setSubscribed(null); return; }
    post({ action: 'getMyNewsletterSubscription' })
      .then((d) => { if (d?.success) setSubscribed(!!d.subscribed); })
      .catch(() => {});
  }, [signedIn]);

  const toggle = async () => {
    if (subscribed === null || saving) return;
    setSaving(true);
    try {
      const d = await post({ action: 'setMyNewsletterSubscription', subscribed: !subscribed });
      if (d?.success) setSubscribed(!!d.subscribed);
    } catch { /* keep the old state */ }
    setSaving(false);
  };

  const confirmUnsubscribe = async () => {
    setUnsubState('working');
    try {
      const d = await post({ action: 'unsubscribeNewsletter', token: unsubscribeToken });
      setUnsubState(d?.success ? 'done' : 'error');
      setUnsubMessage(d?.message || '');
      if (d?.success) setSubscribed(false);
    } catch {
      setUnsubState('error');
      setUnsubMessage('Connection problem. Please try again.');
    }
  };

  const openEdition = async (e: Edition) => {
    setOpening(e.newsletterId);
    try {
      const d = await post({ action: 'getNewsletterEdition', newsletterId: e.newsletterId });
      if (d?.success && d.html) {
        // Links open outside the frame; nothing in the letter can run script.
        const html = String(d.html).replace(/<head([^>]*)>/i, '<head$1><base target="_blank"><meta name="viewport" content="width=device-width, initial-scale=1">');
        setOpen({ edition: { ...e, ...d.edition }, html });
        window.scrollTo({ top: 0 });
      }
    } catch { /* stay on the list */ }
    setOpening('');
  };

  const fitFrame = () => {
    const f = frameRef.current;
    try {
      const h = f?.contentDocument?.documentElement?.scrollHeight;
      if (f && h) f.style.height = `${h + 8}px`;
    } catch { /* cross-origin: keep the default height */ }
  };

  if (open) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <button type="button" onClick={() => setOpen(null)}
          className="text-xs font-bold uppercase tracking-widest text-brand-gold-text">
          ← All letters
        </button>
        <div>
          <p className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">
            {[open.edition.editionLabel, niceDate(open.edition.sentAt)].filter(Boolean).join(' · ')}
          </p>
          <h1 className="mt-1 font-serif text-2xl sm:text-3xl text-[var(--text-primary)]">{open.edition.headerTitle || open.edition.subject}</h1>
        </div>
        <iframe
          ref={frameRef}
          title={open.edition.headerTitle || open.edition.subject}
          srcDoc={open.html}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          onLoad={fitFrame}
          className="block w-full rounded-2xl border border-brand-border bg-white"
          style={{ height: '80vh' }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="text-center">
        <p className="text-2xs font-bold uppercase tracking-eyebrow text-brand-gold-text">Newsletter</p>
        <h1 className="mt-2 font-serif text-3xl sm:text-4xl text-[var(--text-primary)]">The SwapSutra Letter</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">Every member gets it by email. All past letters are here.</p>
      </header>

      {unsubscribeToken && unsubState !== 'done' && (
        <div className="rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-5 text-center space-y-3">
          <p className="font-serif text-lg text-[var(--text-primary)]">Stop getting the newsletter?</p>
          {unsubState === 'error' && <p className="text-sm text-red-700">{unsubMessage}</p>}
          <button type="button" onClick={confirmUnsubscribe} disabled={unsubState === 'working'}
            className="rounded-full bg-brand-brown px-6 py-2.5 text-xs font-bold uppercase tracking-widest text-brand-offwhite disabled:opacity-50">
            {unsubState === 'working' ? 'Unsubscribing…' : 'Yes, unsubscribe'}
          </button>
        </div>
      )}
      {unsubState === 'done' && (
        <p role="status" className="rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-4 text-center text-sm text-[var(--text-primary)]">
          {unsubMessage || 'You are unsubscribed.'}
        </p>
      )}

      {signedIn ? (
        subscribed !== null && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-brand-border bg-[var(--bg-surface)] px-4 py-3">
            <p className="text-sm text-[var(--text-primary)]">
              {subscribed ? '✓ You get these letters by email' : 'You have unsubscribed'}
            </p>
            <button type="button" onClick={toggle} disabled={saving}
              className="shrink-0 rounded-full border border-brand-border px-4 py-2 text-2xs font-bold uppercase tracking-widest text-brand-gold-text disabled:opacity-50">
              {saving ? '…' : subscribed ? 'Unsubscribe' : 'Subscribe again'}
            </button>
          </div>
        )
      ) : (
        <p className="text-center text-xs text-[var(--text-secondary)]">
          <button type="button" onClick={onSignIn} className="font-bold text-brand-gold-text underline">Join SwapSutra</button> to get the next letter in your inbox.
        </p>
      )}

      {loadError && (
        <div className="text-center space-y-2">
          <p className="text-sm text-red-700">{loadError}</p>
          <button type="button" onClick={loadArchive} className="text-xs font-bold uppercase tracking-widest text-brand-gold-text">Try again</button>
        </div>
      )}
      {!editions && !loadError && <p className="text-center text-sm text-[var(--text-secondary)]">Loading letters…</p>}
      {editions && editions.length === 0 && (
        <p className="rounded-2xl border border-dashed border-brand-border p-8 text-center text-sm text-[var(--text-secondary)]">
          The first letter is on its way.
        </p>
      )}

      {editions && editions.length > 0 && (
        <ul className="space-y-3">
          {editions.map((e) => (
            <li key={e.newsletterId}>
              <button type="button" onClick={() => openEdition(e)} disabled={!!opening}
                className="w-full rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-4 text-left transition hover:border-brand-gold disabled:opacity-60">
                <p className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">
                  {[e.editionLabel, niceDate(e.sentAt)].filter(Boolean).join(' · ')}
                </p>
                <p className="mt-1 font-serif text-lg leading-snug text-[var(--text-primary)]">{e.headerTitle || e.subject}</p>
                {e.preheader && <p className="mt-1 line-clamp-2 text-sm text-[var(--text-secondary)]">{e.preheader}</p>}
                <p className="mt-2 text-2xs font-bold uppercase tracking-widest text-brand-gold-text">
                  {opening === e.newsletterId ? 'Opening…' : 'Read letter →'}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
