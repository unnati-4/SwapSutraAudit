/**
 * The 21-day return rule, stated before anyone commits (Oct 2026).
 * Shown wherever a reader asks for a book that has to come back:
 * a temporary swap, a rental or a loan. Mirrors RETURN_POLICY_TEXT on
 * the server — keep the two in step.
 */
export default function ReturnRuleNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div role="note" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 space-y-1.5" data-testid="return-rule-notice">
      <p className="text-2xs font-bold uppercase tracking-widest text-red-800">Strict return rule · 21 days</p>
      <p className="text-xs text-red-900 leading-relaxed">
        The book must be on its way back within <strong>21 days</strong> of reaching you — handed over in person,
        or posted with the <strong>courier name and tracking ID</strong> added by day 21.
        {!compact && <> With 7 days left you can ask, once, for <strong>+7 days</strong> — it applies if the owner agrees.</>}
        {' '}If it isn&rsquo;t on its way back by the deadline, your <strong>security deposit is forfeited and paid to the book&rsquo;s owner</strong>.
      </p>
      {!compact && (
        <p className="text-2xs text-red-800/80 leading-relaxed">
          Courier delays after you have posted it are not held against you. You&rsquo;ll get reminders in the app and by email (and WhatsApp, where available) at 7, 3 and 1 days left.
        </p>
      )}
    </div>
  );
}
