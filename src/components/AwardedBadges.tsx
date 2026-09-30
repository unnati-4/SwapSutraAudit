/**
 * Badges a person awarded — "Doctor of the Month", "Patient", whatever the
 * last meetup decided — as distinct from the ones the system computes from
 * swap counts.
 *
 * They look different on purpose. A computed badge says "this happened";
 * an awarded one says "the community noticed you", and that is the one a
 * reader will want to show off. They come from the admin-managed
 * ReaderBadges sheet via awardedBadgesFor() in appsscript.js, with expired
 * ones already filtered out server-side.
 */

import React from 'react';

export interface AwardedBadge {
  label: string;
  note?: string;
  awardedAt?: string;
}

export const AwardedBadges = ({
  badges,
  align = 'center',
}: {
  badges?: AwardedBadge[] | null;
  align?: 'center' | 'start';
}) => {
  const list = (Array.isArray(badges) ? badges : []).filter((b) => b && String(b.label || '').trim());
  if (!list.length) return null;

  return (
    <div className={`flex flex-wrap gap-2 ${align === 'center' ? 'justify-center' : 'justify-start'}`}>
      {list.map((b, i) => (
        <span
          key={`${b.label}:${i}`}
          title={b.note || b.label}
          className="inline-flex items-center gap-1.5 rounded-full border border-brand-gold/45 bg-gradient-to-r from-brand-gold/20 to-brand-gold/5 px-3.5 py-1.5 text-2xs font-bold uppercase tracking-wider text-brand-gold-text shadow-sm"
        >
          <span aria-hidden="true">🏅</span>
          {b.label}
        </span>
      ))}
    </div>
  );
};

export default AwardedBadges;
