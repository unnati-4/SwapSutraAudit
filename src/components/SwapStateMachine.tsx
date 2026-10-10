import { useCallback, useEffect, useState } from 'react';
import UpiPayBox, { type PayDetails } from './UpiPayBox';
import {apiUrl} from '../config/runtime';
import { depositLine, DEPOSIT_ESTIMATE_EXPLAINER } from '../utils/deposit';

/**
 * THE MASTER SWAPSUTRA TRANSACTION STATE MACHINE — frontend.
 *
 * This component renders exactly what the server's getSwapStage() action
 * returns and nothing it computes on its own. It never decides a stage is
 * unlocked, never decides a stage is complete, and never assumes "I
 * confirmed my side, so we're done" — every button here calls a server
 * action, and the server re-derives the whole stage chain fresh before
 * accepting it. A locked stage is rendered locked and its controls are
 * disabled; the actual rejection, if someone bypasses that, happens on
 * the server (see confirmStage/submitStageEvidence in appsscript.js).
 *
 * Three sections, always in this order, per the spec this was built to:
 *   1. Completed History     — past stages, timestamps, who did what.
 *   2. Current Active Stage  — what's actionable right now, gated by
 *                              exactly what getSwapStage says this viewer
 *                              may do.
 *   3. Future Locked Stages  — visible, greyed, inert.
 *
 * One component serves BOTH permanent (SELL / one-way, permanent SWAP)
 * and temporary (RENT, LEND, temporary SWAP) transactions — the only
 * per-type difference is party count on the security fee (1 payer vs 2),
 * which the server payload already reflects in `securityFee.payers`.
 */

const API_URL = apiUrl('/api/swapsutra');

interface FeePayer {
  payerRole: 'requester' | 'owner';
  payerEmail: string;
  /** What the QR asks for: depositAmount + platformFee. */
  requiredAmount: number;
  /** Refundable part. Older rows (before Oct 2026) report it as the whole amount. */
  depositAmount?: number;
  /** SwapSutra's non-refundable platform fee (₹10 per reader per exchange). */
  platformFee?: number;
  /** On a sale: the book's price, held by SwapSutra until the buyer closes the purchase. */
  saleAmount?: number;
  /** Worked out from an unverified price — shown as an estimate. */
  estimated?: boolean;
  paymentStatus: string;
  adminStatus: string;
  utr: string;
  screenshotUrl: string;
  submittedAt: string;
  approvedAt: string;
  rejectedReason: string;
}

interface StagePartyState {
  uploaded: boolean;
  uploadedAt: string;
  evidenceUrl: string;
  confirmed: boolean;
  confirmedAt: string;
}

interface StageBlock {
  unlocked: boolean;
  requester?: StagePartyState;
  owner?: StagePartyState;
  complete?: boolean;
  completedAt?: string;
  applicable?: boolean;
  startedAt?: string;
  unlockAt?: string;
  timerElapsed?: boolean;
  decided?: boolean;
  type?: string;
  note?: string;
  decidedBy?: string;
  decidedAt?: string;
}

interface StageEvaluation {
  success: boolean;
  restricted?: boolean;
  message?: string;
  swapId: string;
  role: string;
  isAdmin: boolean;
  serviceType: string;
  needsReturn: boolean;
  accepted: boolean;
  disputeOpen: boolean;
  currentStage: string;
  stageStatus: string;
  completed: boolean;
  chatUnlocked: boolean;
  securityFee: { payers: FeePayer[]; required: boolean; allApproved: boolean };
  upi: PayDetails;
  stages: {
    handover: StageBlock;
    logistics: StageBlock;
    receipt: StageBlock;
    possession: StageBlock;
    returnStage: StageBlock;
    finalCondition: StageBlock;
    outcome: StageBlock;
  };
  lockedStages: { stage: string; locked: boolean }[];
  myPendingActions: { type: string; stage: string; label: string; payerRole?: string }[];
  history: { stage: string; party: string; actionType: string; actorEmail: string; note: string; at: string }[];
}

const STAGE_LABELS: Record<string, string> = {
  ACCEPTANCE: 'Request Acceptance',
  SECURITY_FEE: 'Payment',
  HANDOVER: 'Handover',
  LOGISTICS: 'Meeting / Courier Logistics',
  RECEIPT: 'Receipt Confirmation',
  POSSESSION: 'Possession Period',
  RETURN: 'Return',
  FINAL_CONDITION: 'Final Condition Verification',
  OUTCOME: 'Security Fee Outcome',
  COMPLETED: 'Completed',
  DISPUTED: 'Disputed'
};

async function post(action: string, payload: Record<string, unknown>) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  return res.json();
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fmtDate(v?: string) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function SwapStateMachine({ swapId, isAdmin }: { swapId: string; isAdmin?: boolean }) {
  const [data, setData] = useState<StageEvaluation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string>('');
  const [utrInput, setUtrInput] = useState('');
  const [outcomeReason, setOutcomeReason] = useState('');
  const [deductionAmount, setDeductionAmount] = useState('');

  const refresh = useCallback(async () => {
    if (!swapId) return;
    try {
      const res = await post('getSwapStage', { swapId });
      if (res.success) {
        setData(res);
        setError('');
      } else {
        setError(res.message || 'Could not load exchange status.');
      }
    } catch {
      setError('Could not reach SwapSutra. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [swapId]);

  useEffect(() => { refresh(); }, [refresh]);

  const runAction = async (action: string, payload: Record<string, unknown>, busyKey: string) => {
    setBusy(busyKey);
    try {
      const res = await post(action, { swapId, ...payload });
      if (!res.success) {
        window.alert(res.message || 'That action could not be completed.');
      }
      await refresh();
    } catch {
      window.alert('Network error. Please try again.');
    } finally {
      setBusy('');
    }
  };

  const handlePaySubmit = async () => {
    if (!utrInput.trim()) { window.alert('Enter the UTR / transaction reference.'); return; }
    const input = document.getElementById(`ssm-fee-file-${swapId}`) as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) { window.alert('Attach a payment screenshot.'); return; }
    const fileData = await fileToDataUrl(file);
    await runAction('submitSecurityFeePayment', { utr: utrInput.trim(), fileData, fileName: file.name }, 'pay');
    setUtrInput('');
  };

  const handleStageUpload = async (stage: string) => {
    const input = document.getElementById(`ssm-stage-file-${stage}`) as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) { window.alert('Choose a photo first.'); return; }
    const fileData = await fileToDataUrl(file);
    await runAction('submitStageEvidence', { stage, fileData, fileName: file.name }, 'upload_' + stage);
  };

  const handleStageConfirm = async (stage: string) => {
    await runAction('confirmStage', { stage }, 'confirm_' + stage);
  };

  const handleAdminApprove = async (payerRole: string, decision: 'APPROVE' | 'REJECT') => {
    let reason = '';
    if (decision === 'REJECT') {
      reason = window.prompt('Reason for rejecting this payment?') || '';
      if (!reason) return;
    }
    await runAction('adminApproveSecurityFeePayment', { payerRole, decision, reason }, 'admin_fee_' + payerRole);
  };

  const handleAdminOutcome = async (outcome: 'FULL_RELEASE' | 'PARTIAL_DEDUCTION' | 'FULL_DEDUCTION') => {
    const payload: Record<string, unknown> = { outcome, reason: outcomeReason };
    if (outcome === 'PARTIAL_DEDUCTION') {
      const amt = Number(deductionAmount);
      if (!isFinite(amt) || amt <= 0) { window.alert('Enter a valid deduction amount.'); return; }
      payload.deductionAmount = amt;
    }
    if (!window.confirm(`Record outcome: ${outcome.replace('_', ' ')}? This marks the exchange Completed.`)) return;
    await runAction('adminSetSecurityFeeOutcome', payload, 'outcome');
  };

  if (loading) {
    return <div className="p-6 text-center text-xs text-[var(--text-secondary)] italic">Loading exchange status…</div>;
  }
  if (error || !data) {
    return <div className="p-6 text-center text-xs text-red-500">{error || 'Unable to load.'}</div>;
  }
  if (data.restricted) {
    return <div className="p-6 text-center text-xs text-[var(--text-secondary)]">{data.message}</div>;
  }

  const confirmBlock = (label: string, stage: string, block: StageBlock, requireUpload = true) => {
    const myState = data.role === 'requester' ? block.requester : block.owner;
    const otherState = data.role === 'requester' ? block.owner : block.requester;
    const isMine = !!myState;
    return (
      <div key={stage} className="rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-widest">{label}</p>
          {block.complete && <span className="text-2xs font-bold text-green-600 uppercase">Both confirmed</span>}
        </div>
        <div className="grid grid-cols-2 gap-3 text-2xs">
          <div className="space-y-1">
            <p className="font-bold text-[var(--text-secondary)] uppercase tracking-widest">You{data.role ? ` (${data.role})` : ''}</p>
            <p>{myState?.uploaded ? '✓ Uploaded' : requireUpload ? '— No upload yet' : '—'}</p>
            <p>{myState?.confirmed ? `✓ Confirmed ${fmtDate(myState.confirmedAt)}` : '— Not confirmed'}</p>
          </div>
          <div className="space-y-1">
            <p className="font-bold text-[var(--text-secondary)] uppercase tracking-widest">Other party</p>
            <p>{otherState?.uploaded ? '✓ Uploaded' : requireUpload ? '— No upload yet' : '—'}</p>
            <p>{otherState?.confirmed ? `✓ Confirmed ${fmtDate(otherState.confirmedAt)}` : '— Not confirmed'}</p>
          </div>
        </div>
        {block.unlocked && isMine && !myState?.confirmed && (
          <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center pt-2 border-t border-brand-border/40">
            {!myState?.uploaded && (
              <>
                <input id={`ssm-stage-file-${stage}`} type="file" accept="image/jpeg,image/png,image/webp" className="text-2xs" />
                <button
                  onClick={() => handleStageUpload(stage)}
                  disabled={busy === 'upload_' + stage}
                  className="px-3 py-2 rounded-lg bg-brand-gold text-[var(--text-primary)] text-2xs font-bold uppercase tracking-widest disabled:opacity-50"
                >
                  {busy === 'upload_' + stage ? 'Uploading…' : 'Upload evidence'}
                </button>
              </>
            )}
            {myState?.uploaded && !myState?.confirmed && (
              <button
                onClick={() => handleStageConfirm(stage)}
                disabled={busy === 'confirm_' + stage}
                className="px-3 py-2 rounded-lg bg-brand-brown text-brand-offwhite text-2xs font-bold uppercase tracking-widest disabled:opacity-50"
              >
                {busy === 'confirm_' + stage ? 'Confirming…' : 'Confirm ' + label.toLowerCase()}
              </button>
            )}
          </div>
        )}
        {!block.unlocked && <p className="text-2xs text-[var(--text-secondary)] italic">Locked — an earlier stage is still incomplete.</p>}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {data.disputeOpen && (
        <div className="rounded-2xl border border-red-400 bg-red-50 p-4 text-center">
          <p className="text-xs font-bold text-red-600 uppercase tracking-widest">A dispute is open</p>
          <p className="text-2xs text-red-500 mt-1">All progress on this exchange is paused until SwapSutra resolves it.</p>
        </div>
      )}

      {/* ── 1. Completed History ─────────────────────────────────────── */}
      <div>
        <h4 className="font-serif text-lg text-[var(--text-primary)] mb-3">Completed History</h4>
        {data.history.length === 0 ? (
          <p className="text-2xs text-[var(--text-secondary)] italic">Nothing recorded yet.</p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {data.history.slice().reverse().map((e, i) => (
              <div key={i} className="flex items-center justify-between text-2xs border-b border-brand-border/30 pb-2">
                <span className="text-[var(--text-primary)]">
                  <b>{STAGE_LABELS[e.stage] || e.stage}</b> — {e.party} {e.actionType.replace('_', ' ')}
                </span>
                <span className="text-[var(--text-secondary)] tabular-nums">{fmtDate(e.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 2. Current Active Stage ──────────────────────────────────── */}
      <div>
        <h4 className="font-serif text-lg text-[var(--text-primary)] mb-3">
          Current Stage: <span className="text-brand-gold-text">{STAGE_LABELS[data.currentStage] || data.currentStage}</span>
        </h4>

        {data.currentStage === 'SECURITY_FEE' && (
          <div className="space-y-4">
            {data.securityFee.payers.map(p => (
              <div key={p.payerRole} className="rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-primary)]">
                    {p.payerRole === data.role ? 'You' : p.payerRole} — ₹{p.requiredAmount}
                  </p>
                  <span className={`text-2xs font-bold uppercase ${p.adminStatus === 'ADMIN_APPROVED' ? 'text-green-600' : p.adminStatus === 'ADMIN_REJECTED' ? 'text-red-500' : 'text-amber-600'}`}>
                    {p.adminStatus.replace('_', ' ')}
                  </span>
                </div>
                {/* What the amount is made of. The fee is SwapSutra's; only the
                    deposit is ever refunded. */}
                {(p.saleAmount ?? 0) > 0 && (
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    ₹{p.saleAmount} book price + ₹{p.platformFee ?? 0} platform fee. SwapSutra holds the price and pays the seller only after you have the book and close the purchase.
                  </p>
                )}
                {!((p.saleAmount ?? 0) > 0) && (() => {
                  const fee = p.platformFee ?? 0;
                  const deposit = p.depositAmount ?? (p.requiredAmount - fee);
                  if (fee <= 0) {
                    return p.estimated ? <p className="text-xs text-[var(--text-secondary)]">{depositLine(deposit, true)}</p> : null;
                  }
                  return (
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      {deposit > 0
                        ? <>{p.estimated ? depositLine(deposit, true) : `₹${deposit} refundable deposit`} + ₹{fee} platform fee</>
                        : <>₹{fee} platform fee</>}
                    </p>
                  );
                })()}
                {p.estimated && (
                  <p className="text-xs italic text-[var(--text-secondary)] leading-relaxed">{DEPOSIT_ESTIMATE_EXPLAINER}</p>
                )}

                {p.payerRole === data.role && p.adminStatus !== 'ADMIN_APPROVED' && p.adminStatus !== 'ADMIN_PENDING' && (
                  <div className="space-y-3 pt-2 border-t border-brand-border/40">
                    <div className="flex flex-col items-center gap-3 bg-[var(--bg-page)] p-4 rounded-xl">
                      <UpiPayBox upi={data.upi} amount={p.requiredAmount} note="SwapSutra Exchange Payment" size={160} />
                    </div>
                    <input
                      type="text"
                      placeholder="UTR / transaction reference"
                      value={utrInput}
                      onChange={(e) => setUtrInput(e.target.value)}
                      className="input-classic bg-[var(--input-bg)] w-full"
                    />
                    <input id={`ssm-fee-file-${swapId}`} type="file" accept="image/jpeg,image/png,image/webp" className="text-2xs" />
                    <button
                      onClick={handlePaySubmit}
                      disabled={busy === 'pay'}
                      className="w-full px-3 py-2 rounded-lg bg-brand-gold text-[var(--text-primary)] text-2xs font-bold uppercase tracking-widest disabled:opacity-50"
                    >
                      {busy === 'pay' ? 'Submitting…' : 'Submit payment'}
                    </button>
                  </div>
                )}
                {p.payerRole === data.role && p.adminStatus === 'ADMIN_PENDING' && (
                  <p className="text-2xs text-amber-600 italic">Submitted — awaiting SwapSutra's approval.</p>
                )}
                {p.payerRole === data.role && p.adminStatus === 'ADMIN_REJECTED' && (
                  <p className="text-2xs text-red-500 italic">Rejected{p.rejectedReason ? `: ${p.rejectedReason}` : ''}. Please resubmit above.</p>
                )}

                {data.isAdmin && p.adminStatus === 'ADMIN_PENDING' && (
                  <div className="space-y-2 pt-2 border-t border-brand-border/40">
                    <p className="text-2xs text-[var(--text-secondary)]">UTR: {p.utr} {p.screenshotUrl && <a href={p.screenshotUrl} target="_blank" rel="noreferrer" className="underline">view screenshot</a>}</p>
                    <div className="flex gap-2">
                      <button onClick={() => handleAdminApprove(p.payerRole, 'APPROVE')} disabled={busy === 'admin_fee_' + p.payerRole} className="flex-1 px-3 py-2 rounded-lg bg-green-600 text-white text-2xs font-bold uppercase tracking-widest disabled:opacity-50">Approve</button>
                      <button onClick={() => handleAdminApprove(p.payerRole, 'REJECT')} disabled={busy === 'admin_fee_' + p.payerRole} className="flex-1 px-3 py-2 rounded-lg bg-red-500 text-white text-2xs font-bold uppercase tracking-widest disabled:opacity-50">Reject</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {data.currentStage === 'HANDOVER' && confirmBlock('Handover', 'HANDOVER', data.stages.handover)}
        {data.currentStage === 'LOGISTICS' && confirmBlock('Meeting / Courier Logistics', 'LOGISTICS', data.stages.logistics)}
        {data.currentStage === 'RECEIPT' && confirmBlock('Receipt Confirmation', 'RECEIPT', data.stages.receipt)}

        {data.currentStage === 'POSSESSION' && (
          <div className="rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-4 space-y-2 text-xs">
            <p>The book has been handed over and received. The 21-day return window is running.</p>
            {data.stages.possession.startedAt && <p className="text-2xs text-[var(--text-secondary)]">Started: {fmtDate(data.stages.possession.startedAt)}</p>}
            {data.stages.returnStage.unlockAt && <p className="text-2xs text-[var(--text-secondary)]">Return stage unlocks: {fmtDate(data.stages.returnStage.unlockAt)}</p>}
          </div>
        )}

        {data.currentStage === 'RETURN' && confirmBlock('Return', 'RETURN', data.stages.returnStage)}
        {data.currentStage === 'FINAL_CONDITION' && confirmBlock('Final Condition Verification', 'FINAL_CONDITION', data.stages.finalCondition)}

        {data.currentStage === 'OUTCOME' && (
          <div className="rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-4 space-y-3">
            {data.isAdmin ? (
              <>
                <p className="text-2xs text-[var(--text-secondary)]">Both parties have confirmed final condition. Record the security-fee outcome.</p>
                <textarea placeholder="Reason / notes" value={outcomeReason} onChange={(e) => setOutcomeReason(e.target.value)} className="input-classic bg-[var(--input-bg)] w-full" rows={2} />
                <input type="number" placeholder="Deduction amount (only for partial deduction)" value={deductionAmount} onChange={(e) => setDeductionAmount(e.target.value)} className="input-classic bg-[var(--input-bg)] w-full" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button onClick={() => handleAdminOutcome('FULL_RELEASE')} disabled={busy === 'outcome'} className="px-3 py-2 rounded-lg bg-green-600 text-white text-2xs font-bold uppercase tracking-widest disabled:opacity-50">Full release</button>
                  <button onClick={() => handleAdminOutcome('PARTIAL_DEDUCTION')} disabled={busy === 'outcome'} className="px-3 py-2 rounded-lg bg-amber-500 text-white text-2xs font-bold uppercase tracking-widest disabled:opacity-50">Partial deduction</button>
                  <button onClick={() => handleAdminOutcome('FULL_DEDUCTION')} disabled={busy === 'outcome'} className="px-3 py-2 rounded-lg bg-red-500 text-white text-2xs font-bold uppercase tracking-widest disabled:opacity-50">Full deduction</button>
                </div>
              </>
            ) : (
              <p className="text-2xs text-[var(--text-secondary)] italic">Both parties confirmed. SwapSutra is finalising the security-fee outcome.</p>
            )}
          </div>
        )}

        {data.currentStage === 'COMPLETED' && (
          <div className="rounded-2xl border border-green-400 bg-green-50 p-4 text-center">
            <p className="text-xs font-bold text-green-700 uppercase tracking-widest">Exchange Completed</p>
            {data.stages.outcome.type && <p className="text-2xs text-green-700 mt-1">Outcome: {data.stages.outcome.type.replace('_', ' ')}</p>}
          </div>
        )}
      </div>

      {/* ── 3. Future Locked Stages ──────────────────────────────────── */}
      {data.lockedStages.length > 0 && (
        <div>
          <h4 className="font-serif text-lg text-[var(--text-secondary)] mb-3 opacity-70">Upcoming (Locked)</h4>
          <div className="space-y-2 opacity-50">
            {data.lockedStages.map(s => (
              <div key={s.stage} className="rounded-xl border border-dashed border-brand-border px-4 py-3 text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)] flex items-center justify-between">
                <span>{STAGE_LABELS[s.stage] || s.stage}</span>
                <span>🔒 Locked</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
