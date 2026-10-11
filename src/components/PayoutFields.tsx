/**
 * PayoutFields (11 Oct 2026, owner's request) — where SwapSutra pays someone:
 * a UPI ID with the name on it, and/or a bank account (holder, number,
 * IFSC, bank). At least one is needed; the server checks the same rules
 * (validatePayoutDetails_ in appsscript.js).
 */
export interface PayoutDetails {
  upiId: string;
  payeeName: string;
  accountName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
}

export const EMPTY_PAYOUT: PayoutDetails = { upiId: '', payeeName: '', accountName: '', accountNumber: '', ifsc: '', bankName: '' };

/** Fills the fields from a saved account (getPayoutAccount / dashboard). */
export function payoutFromAccount(acct: any, fallbackName = ''): PayoutDetails {
  return {
    upiId: acct?.upiId || '',
    payeeName: acct?.payeeName || fallbackName,
    accountName: acct?.bank?.accountName || '',
    accountNumber: acct?.bank?.accountNumber || '',
    ifsc: acct?.bank?.ifsc || '',
    bankName: acct?.bank?.bankName || '',
  };
}

/** Same checks as the server, so the reader hears about a mistake at once. */
export function payoutErrors(v: PayoutDetails): Partial<Record<keyof PayoutDetails, string>> {
  const e: Partial<Record<keyof PayoutDetails, string>> = {};
  const wantsBank = !!(v.accountName.trim() || v.accountNumber.trim() || v.ifsc.trim() || v.bankName.trim());
  if (!v.upiId.trim() && !wantsBank) e.upiId = 'Add a UPI ID or a bank account, so SwapSutra can pay you.';
  if (v.upiId.trim() && !/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,63}$/.test(v.upiId.trim())) e.upiId = 'Enter a UPI ID like name@okbank.';
  if (v.upiId.trim() && !v.payeeName.trim()) e.payeeName = 'Enter the name on the UPI account.';
  if (wantsBank) {
    if (!v.accountName.trim()) e.accountName = "Enter the account holder's name.";
    if (!/^\d{9,18}$/.test(v.accountNumber.replace(/\s+/g, ''))) e.accountNumber = 'Enter the account number (9–18 digits).';
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.ifsc.trim().toUpperCase())) e.ifsc = 'Enter the IFSC code, like SBIN0001234.';
  }
  return e;
}

export default function PayoutFields({ value, onChange, inputClassName, errors, labelClassName }: {
  value: PayoutDetails;
  onChange: (v: PayoutDetails) => void;
  inputClassName: string;
  labelClassName?: string;
  errors?: Partial<Record<string, string>>;
}) {
  const set = (k: keyof PayoutDetails) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const err = (k: string) => errors?.[k] ? <span className="block text-2xs text-red-700 mt-1" role="alert">{errors[k]}</span> : null;
  const lab = labelClassName || 'block text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-1';
  return (
    <div className="space-y-3" data-testid="payout-fields">
      <div>
        <label className={lab}>UPI ID</label>
        <input value={value.upiId} onChange={set('upiId')} placeholder="name@okaxis" autoComplete="off" className={inputClassName} name="payoutUpiId" />
        {err('upiId')}
      </div>
      <div>
        <label className={lab}>Name on the UPI account</label>
        <input value={value.payeeName} onChange={set('payeeName')} placeholder="As your bank shows it" className={inputClassName} name="payoutPayeeName" />
        {err('payeeName')}
      </div>
      <p className="text-2xs text-[var(--text-secondary)]">…or / and a bank account</p>
      <div>
        <label className={lab}>Account holder's name</label>
        <input value={value.accountName} onChange={set('accountName')} className={inputClassName} name="payoutAccountName" />
        {err('accountName')}
      </div>
      <div>
        <label className={lab}>Account number</label>
        <input value={value.accountNumber} onChange={set('accountNumber')} inputMode="numeric" autoComplete="off" className={inputClassName} name="payoutAccountNumber" />
        {err('accountNumber')}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lab}>IFSC</label>
          <input value={value.ifsc} onChange={(e) => onChange({ ...value, ifsc: e.target.value.toUpperCase() })} placeholder="SBIN0001234" autoComplete="off" className={inputClassName} name="payoutIfsc" />
          {err('ifsc')}
        </div>
        <div>
          <label className={lab}>Bank (optional)</label>
          <input value={value.bankName} onChange={set('bankName')} className={inputClassName} name="payoutBankName" />
        </div>
      </div>
    </div>
  );
}
