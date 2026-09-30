"""
SwapSutra pricing engine — the one place a price band is computed.

═══════════════════════════════════════════════════════════════════════════
WHY THIS IS NOT P25 / MEDIAN / P75
═══════════════════════════════════════════════════════════════════════════
The original spec asked for P25 / median / P75, and gave this worked example:

    Atomic Habits observations: 350, 399, 425, 450, 499
    Lower 350 · Reference 425 · Upper 499

Those are MIN / MEDIAN / MAX. P25/P75 on that same data gives 399 / 450 —
a band less than half as wide. The spec contradicted its own example, and
the contradiction matters because the two choices produce different products:
a band of 399-450 leaves a reader almost no room to choose, which makes "the
user picks their own price" decorative.

Worse, percentiles do not survive small samples:

  * There are NINE standard definitions of a sample quantile (Hyndman & Fan
    1996). R defaults to type 7, SAS to type 2. Two libraries disagree on
    P25 of four numbers.
  * Under the Weibull plotting position, order statistic x(i) estimates
    quantile i/(n+1), so a sample can address p=0.25 without extrapolating
    only when n >= 3, and p=0.05 only when n >= 19.
  * At n=2, type-7 P25 is exactly x1 + 0.25*(x2-x1). It has the FORM of a
    percentile and none of the content. Publishing it is worse than
    publishing nothing, because it looks quantitative.
  * Bootstrap does not rescue this: the number of distinct resamples is
    C(2n-1, n) — 10 at n=3, 126 at n=5.
  * Split conformal prediction at 90% coverage needs n >= 9. This is a
    theorem, not a tooling limit. Below it, no distribution-free method can
    promise coverage, so the band MUST come from a prior.

What eBay, Airbnb and Mercari all do instead — three independent
marketplaces, same answer — is pool across similar items. eBay's price
guidance patent (US 11,379,892) builds a price curve for an item with no
history "using historical listing data for other items having a distance
measure below a predetermined threshold". That is a group prior.

So this engine:

  1. Works in LOG space. Book prices are strictly positive and vary
     multiplicatively — a Rs.200 novel and a Rs.2000 textbook do not have
     comparable additive spreads. Log space makes the band multiplicative
     ([c/k, c*k]), which is the right shape for a price, and makes the
     back-transformed centre the geometric centre.

  2. Models the DISCOUNT RATIO ln(price / MRP), not absolute price. Ratios
     pool across price scales; rupees do not. This is what lets a novel and
     a textbook share a prior.

  3. Uses a robust centre appropriate to n, a Hampel filter ONLY where n is
     large enough for it to mean anything, and shrinks toward a group prior
     with weight w = tau2 / (tau2 + sigma2/n).

  4. Publishes INSUFFICIENT_DATA rather than inventing a precise number.

THE THREE FIGURES, KEPT APART
  lower..upper     the ALLOWED LISTING RANGE — what a seller may choose from
  reference        SwapSutra's deterministic valuation for swap/rent/lend.
                   NOT a claim about market value; where there are no
                   observations it is explicitly an MRP-derived estimate.
  deposit_basis    what the security deposit is computed from. It is the
                   reference, never the seller's chosen listing price.

═══════════════════════════════════════════════════════════════════════════
WHAT THIS MODULE DELIBERATELY DOES NOT DO
═══════════════════════════════════════════════════════════════════════════
It does not call an LLM. Gemini's job in this system is to READ web pages
and CLASSIFY what it finds into observations (see extract.py); it never
computes a boundary, and an MRP it extracts cannot anchor a price unless the
quote behind it was checked against a real supplied source page (see
sql/005_mrp_evidence.sql). An LLM doing arithmetic that decides how much money
changes hands is unauditable and irreproducible — run it twice, get two
answers, and no way to explain either to a reader who was refused a price.
Every number below is produced by code you can step through and a test can
pin.
"""

from __future__ import annotations

import hashlib
import math
from decimal import Decimal, ROUND_HALF_UP
from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable, Sequence

# ── Tunables ─────────────────────────────────────────────────────────────
# Every one of these is a policy decision, not a fact. They live together so
# a change is a one-line diff with a visible blast radius.

HAMPEL_K = 3.0            # NISTIR 8526 screens at 3*MAD, not Tukey's 1.5
MAD_SCALE = 1.4826        # makes MAD consistent with sigma under normality
MIN_N_FOR_OUTLIER_FILTER = 5
MIN_N_FOR_PERCENTILES = 10
MIN_LOG_SCALE = 0.10      # the MAD==0 floor. See _robust_scale.
BAND_Z = 1.28             # ~80% predictive interval. Wide enough to choose in.
MIN_BAND_RATIO = 1.15     # a band is never tighter than +/-15%
MAX_BAND_RATIO = 2.50     # nor wider than 2.5x either way
ROUND_TO = 5              # rupees


class Method(str, Enum):
    EDITION_OBSERVATIONS = "EDITION_OBSERVATIONS"
    TITLE_OBSERVATIONS = "TITLE_OBSERVATIONS"
    PUBLISHER_PRIOR = "PUBLISHER_PRIOR"
    CATEGORY_PRIOR = "CATEGORY_PRIOR"
    MRP_DERIVED = "MRP_DERIVED"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"


class PriceKind(str, Enum):
    MRP = "MRP"
    NEW_RETAIL = "NEW_RETAIL"
    USED_RETAIL = "USED_RETAIL"
    EBOOK = "EBOOK"
    SWAPSUTRA_TXN = "SWAPSUTRA_TXN"


@dataclass(frozen=True)
class Observation:
    """One price someone actually saw, with enough provenance to audit it."""
    price: float
    kind: PriceKind
    source: str
    obs_id: int | None = None
    condition: str | None = None
    confidence: float = 0.5


@dataclass(frozen=True)
class Prior:
    """
    The group prior, on ln(price / MRP).

    mu:     prior mean discount ratio in log space
    tau2:   between-book variance — how much books in this group differ
    sigma2: within-book variance — how much observations of ONE book differ
    """
    mu_log_ratio: float
    tau2: float
    sigma2: float
    scope: str = "global"
    n_observations: int = 0


@dataclass
class Band:
    lower: float | None
    reference: float | None
    upper: float | None
    deposit_basis: float | None
    method: Method
    confidence: float
    sample_size: int
    shrinkage_weight: float | None = None
    discount_ratio: float | None = None
    notes: list[str] = field(default_factory=list)
    inputs_digest: str | None = None

    @property
    def is_publishable(self) -> bool:
        return self.method is not Method.INSUFFICIENT_DATA and self.reference is not None


# ═════════════════════════════════════════════════════ robust statistics

def _median(xs: Sequence[float]) -> float:
    s = sorted(xs)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2.0


def _robust_scale(xs: Sequence[float]) -> float:
    """
    A scale estimate that does not collapse to zero.

    MAD == 0 is not a corner case in book pricing — three sources all
    reporting Rs.399 is completely normal, and it is the majority case for
    MRP observations, which are supposed to agree. An unguarded Hampel
    filter then gives every non-identical point an infinite modified
    Z-score and deletes every genuine observation that differs at all.

    The floor is relative (a fixed value in log space is a fixed
    PERCENTAGE in price space), so it means the same thing for a Rs.150
    novel and a Rs.4000 textbook.
    """
    if len(xs) < 2:
        return MIN_LOG_SCALE
    med = _median(xs)
    mad = _median([abs(x - med) for x in xs])
    return max(MAD_SCALE * mad, MIN_LOG_SCALE)


def _trimmed_mean(xs: Sequence[float], proportion: float = 0.2) -> float:
    """20% trimmed mean: ~efficient under mild contamination, 20% breakdown."""
    s = sorted(xs)
    k = int(len(s) * proportion)
    core = s[k:len(s) - k] if len(s) - 2 * k >= 1 else s
    return sum(core) / len(core)


def _robust_centre(xs: Sequence[float]) -> tuple[float, str]:
    """
    Centre chosen by sample size, because the right estimator changes with n.

    Below n~5 there is no robustness to buy: at n=2 the median IS the mean,
    and a 20% trimmed mean at n=3 either trims nothing or degenerates to the
    median. Above it, trimming starts to pay.
    """
    n = len(xs)
    if n == 1:
        return xs[0], "single observation"
    if n <= 4:
        return _median(xs), "median (n<=4: no robustness available)"
    if n <= 7:
        return _median(xs), "median"
    return _trimmed_mean(xs, 0.2), "20% trimmed mean"


def hampel_filter(xs: Sequence[float], k: float = HAMPEL_K) -> tuple[list[int], list[int]]:
    """
    Returns (kept_indices, rejected_indices).

    Only applied at n >= MIN_N_FOR_OUTLIER_FILTER. Below that you cannot
    distinguish an outlier from a small sample, and discarding one of four
    genuine observations costs far more than keeping one bad one — the
    shrinkage step is what protects against a bad point at small n.
    """
    n = len(xs)
    if n < MIN_N_FOR_OUTLIER_FILTER:
        return list(range(n)), []
    med = _median(xs)
    scale = _robust_scale(xs)
    kept, rejected = [], []
    for i, x in enumerate(xs):
        (kept if abs(x - med) <= k * scale else rejected).append(i)
    # Never let the filter empty the sample.
    if not kept:
        return list(range(n)), []
    return kept, rejected


# ═════════════════════════════════════════════════════════════ the engine

def _round_inr(x: float) -> int:
    """
    Rounded to Rs.5. A band reading 347-501 looks computed; 345-500 looks
    decided.

    ROUND_HALF_UP, not Python's built-in round(). This is not pedantry: the
    conformance suite caught the plpgsql runtime engine returning Rs.205
    where this returned Rs.200 for the same book. Python's round() uses
    banker's rounding (202.5 -> 200) and Postgres rounds halves away from
    zero (202.5 -> 205), so the reference and runtime implementations
    silently disagreed by Rs.5 on every band whose boundary landed exactly
    on a half.

    Half-away-from-zero is also the right convention for money, so the
    reference implementation moves to match the runtime one rather than the
    other way round.

    There is a second, deeper divergence underneath the rounding mode, and
    the 1e-6 quantize below is what fixes it. Postgres does the ladder
    arithmetic in NUMERIC, where 450 * 0.45 is exactly 202.50. Python does
    it in binary float, where the same expression is 202.49999999999997,
    because 0.45 has no exact binary representation. Rounding that to the
    nearest Rs.5 gives 200 in Python and 205 in Postgres — a real Rs.5
    disagreement produced entirely by representation, not by any difference
    in method. Snapping to six decimal places first absorbs the
    representation error without touching any genuine value.
    """
    exact = Decimal(str(x)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    q = (exact / Decimal(ROUND_TO)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return max(ROUND_TO, int(q) * ROUND_TO)


def _usable(observations: Iterable[Observation], condition: str | None) -> list[Observation]:
    """
    Filters observations down to the ones that may inform a PRINT band.

    The exclusions are not fussiness:
      * EBOOK — Google Books saleInfo returns Play Books ebook prices. An
        ebook price is not evidence about a physical paperback, and mixing
        them is the single most likely way this system produces a wrong
        number while looking healthy.
      * A USED_RETAIL observation of a different condition grade is
        evidence about a different thing.
    """
    out = []
    for o in observations:
        if o.kind is PriceKind.EBOOK:
            continue
        if o.price <= 0:
            continue
        if o.kind is PriceKind.USED_RETAIL and condition and o.condition and o.condition != condition:
            continue
        out.append(o)
    return out


def compute_band(
    *,
    observations: Sequence[Observation],
    mrp: float | None,
    prior: Prior | None,
    condition: str,
    condition_ladder: dict[str, tuple[float, float, float]],
    is_unofficial: bool = False,
) -> Band:
    """
    The whole decision, in one function.

    condition_ladder maps a condition grade to (lower_pct, ref_pct, upper_pct)
    of MRP — the deterministic SELL ladder, which needs no market data and so
    works from the very first listing, before any observation corpus exists.
    """
    # An unauthorised copy is declarable and not priceable. This is checked
    # first and unconditionally: no path below can produce a number for one.
    if is_unofficial:
        return Band(None, None, None, None, Method.INSUFFICIENT_DATA, 0.0, 0,
                    notes=["Unofficial copies are not priced. Swap and lend only."])

    usable = _usable(observations, condition)
    n = len(usable)

    # ── Tier A: nothing at all ──────────────────────────────────────────
    if n == 0 and mrp is None:
        return Band(None, None, None, None, Method.INSUFFICIENT_DATA, 0.0, 0,
                    notes=["No MRP and no usable price observations."])

    # ── Tier B: MRP only. The condition ladder alone. ───────────────────
    # This is the common case on day one and it is a perfectly good answer:
    # the ladder is a published policy, not a guess, and MRP is a legally
    # printed number rather than a scraped one.
    if n == 0:
        lo_pct, ref_pct, up_pct = condition_ladder[condition]
        return Band(
            lower=_round_inr(mrp * lo_pct),
            reference=_round_inr(mrp * ref_pct),
            upper=_round_inr(mrp * up_pct),
            deposit_basis=_round_inr(mrp * ref_pct),
            method=Method.MRP_DERIVED,
            confidence=0.55,
            sample_size=0,
            discount_ratio=ref_pct,
            notes=[f"MRP Rs.{mrp:.0f} and the published condition ladder. No market observations yet."],
        )

    # ── Tier C: observations exist ──────────────────────────────────────
    #
    # STRUCTURE, and the reason for it: the first version of this function
    # computed the band directly from the observation spread, and produced
    # an IDENTICAL band for an as-new copy and a fair one. Condition is the
    # single largest driver of second-hand price, so that was simply wrong —
    # and it only showed up by running the thing on a real example.
    #
    # The corrected shape separates two different questions:
    #
    #   1. What is this edition's NEW price level? (the anchor)
    #      MRP answers it; new-retail observations refine it.
    #   2. What is a copy in THIS condition worth? (the band)
    #      The published condition ladder answers it, applied to the anchor.
    #
    # Direct evidence about used copies at the matching grade is better than
    # either, so where it exists it pulls the reference toward itself.
    #
    # Doing it this way also fixes a second problem: deriving band WIDTH from
    # the observation spread gave a 2.2x band (Rs.270-600 on a Rs.599 book),
    # which is not a boundary, it is a shrug. The ladder gives a width that
    # is a policy decision rather than an artefact of how many sources
    # happened to disagree that week.

    anchor_obs = [o for o in usable if o.kind in (PriceKind.MRP, PriceKind.NEW_RETAIL)]
    direct_obs = [o for o in usable
                  if o.kind in (PriceKind.USED_RETAIL, PriceKind.SWAPSUTRA_TXN)]

    notes: list[str] = []
    rejected_prices: list[float] = []

    # ── 1. The anchor: this edition's new-copy price level ──────────────
    anchor = float(mrp) if mrp else None
    if anchor_obs:
        logs = [math.log(o.price) for o in anchor_obs]
        kept_idx, rej_idx = hampel_filter(logs)
        rejected_prices = [anchor_obs[i].price for i in rej_idx]
        kept_logs = [logs[i] for i in kept_idx]
        centre_log, centre_rule = _robust_centre(kept_logs)
        market_anchor = math.exp(centre_log)
        notes.append(
            f"New-price anchor: {centre_rule} of {len(kept_logs)} observation(s) "
            f"= Rs.{market_anchor:.0f}."
        )
        if rejected_prices:
            notes.append(
                f"{len(rejected_prices)} rejected by the Hampel filter at {HAMPEL_K}x MAD: "
                + ", ".join(f"Rs.{p:.0f}" for p in rejected_prices)
            )
        elif len(anchor_obs) < MIN_N_FOR_OUTLIER_FILTER:
            notes.append(
                f"No outlier filtering at n={len(anchor_obs)}: below "
                f"n={MIN_N_FOR_OUTLIER_FILTER} an outlier cannot be told apart "
                "from a small sample."
            )
        # MRP is a printed, legally-required number. A scraped or extracted
        # market price is not, so where both exist the MRP anchors and the
        # observations adjust it rather than replacing it.
        anchor = (0.5 * market_anchor + 0.5 * mrp) if mrp else market_anchor

    if anchor is None:
        return Band(None, None, None, None, Method.INSUFFICIENT_DATA, 0.0, 0,
                    notes=["Only used-price observations and no anchor to scale them against."])

    # ── 2. The band: the published ladder, applied to the anchor ────────
    lo_pct, ref_pct, up_pct = condition_ladder[condition]
    lower = anchor * lo_pct
    reference = anchor * ref_pct
    upper = anchor * up_pct
    notes.append(
        f"Band from the published {condition} ladder "
        f"({lo_pct:.0%}-{up_pct:.0%} of Rs.{anchor:.0f})."
    )

    # ── 3. Direct used-copy evidence pulls the reference ────────────────
    shrink_w: float | None = None
    n_direct = len(direct_obs)
    if n_direct:
        d_logs = [math.log(o.price) for o in direct_obs]
        d_kept, d_rej = hampel_filter(d_logs)
        d_logs = [d_logs[i] for i in d_kept]
        rejected_prices += [direct_obs[i].price for i in d_rej]
        d_centre, d_rule = _robust_centre(d_logs)

        if prior is not None:
            shrink_w = prior.tau2 / (prior.tau2 + prior.sigma2 / len(d_logs))
        else:
            # Without a fitted prior, let the data earn weight by count alone.
            shrink_w = len(d_logs) / (len(d_logs) + 4.0)

        reference = math.exp(shrink_w * d_centre + (1 - shrink_w) * math.log(reference))
        notes.append(
            f"Reference pulled toward {len(d_logs)} direct used-copy observation(s) "
            f"({d_rule}) with weight {shrink_w:.2f}."
        )
        # The ladder still bounds it: a handful of unusually cheap or dear
        # listings must not move the band itself, only the point inside it.
        reference = min(max(reference, lower), upper)

    # ── 4. The MRP cap: a SwapSutra platform policy ─────────────────────
    # SwapSutra caps used-book pricing at the printed MRP. This is a platform
    # policy, not a statement of law — a second-hand copy listed above the
    # price of a new one is a bad outcome for the reader on the other side of
    # the trade, so the platform does not allow it.
    if mrp:
        upper = min(upper, float(mrp))
        reference = min(reference, upper)
        lower = min(lower, reference)

    n_total = len(anchor_obs) + n_direct
    method = (Method.EDITION_OBSERVATIONS if n_total >= 3 else Method.MRP_DERIVED)

    ids = [str(o.obs_id) for o in usable if o.obs_id is not None]
    digest = hashlib.sha256(",".join(sorted(ids)).encode()).hexdigest()[:16] if ids else None

    return Band(
        lower=_round_inr(lower),
        reference=_round_inr(reference),
        upper=_round_inr(upper),
        deposit_basis=_round_inr(reference),
        method=method,
        confidence=_confidence(n_total, shrink_w, mrp is not None, len(rejected_prices)),
        sample_size=n_total,
        shrinkage_weight=shrink_w,
        discount_ratio=(reference / mrp) if mrp else None,
        notes=notes,
        inputs_digest=digest,
    )


def _confidence(n: int, shrink_w: float | None, has_mrp: bool, n_rejected: int) -> float:
    """
    A number a human can act on, not a probability.

    Rises with sample size and with how much weight the data earned, and is
    capped below 1.0 because a price band for a second-hand book in India is
    never actually certain.
    """
    c = 0.35
    c += min(n, 12) * 0.035          # up to +0.42 by n=12
    if has_mrp:
        c += 0.12                     # a printed MRP is a strong anchor
    if shrink_w is not None:
        c += shrink_w * 0.10
    if n_rejected:
        c -= 0.05                     # the sample disagreed with itself
    if n < MIN_N_FOR_PERCENTILES:
        c -= 0.05                     # honest about small-sample estimates
    return round(min(max(c, 0.0), 0.95), 3)


def sell_band_from_mrp(
    mrp: float, condition: str, condition_ladder: dict[str, tuple[float, float, float]]
) -> tuple[int, int, int]:
    """
    The SELL band: a published fraction of MRP by condition grade.

    Deterministic and auditable, and it needs no market data — which is why
    SELL pricing works on day one while the observation corpus is still
    empty. This is the piece that answers "75-80% of MRP for As New,
    decreasing with condition" directly.
    """
    lo, ref, up = condition_ladder[condition]
    return _round_inr(mrp * lo), _round_inr(mrp * ref), _round_inr(mrp * up)


# The deposit rate is now tiered by the book's condition instead of a flat
# 60% for every book — mirrored 1:1 with appsscript.js's
# CONDITION_DEPOSIT_RATES/depositRateForCondition and
# pricing/sql/003_runtime.sql's deposit_rate_for_condition(), so a live
# Supabase deploy, this reference engine, and the Apps Script runtime path
# all agree. Applies uniformly to SWAP/RENT/LEND/SELL — nothing here is
# service-type specific.
#
# Bucket mapping (against this file's own book_condition grades):
#   AS_NEW                  -> 60%  (New / Like New)
#   VERY_GOOD, GOOD, FAIR   -> 55%  (Mid)
#   POOR                    -> 50%  (Poor / Damaged)
CONDITION_DEPOSIT_RATES: dict[str, float] = {
    "AS_NEW": 0.60,
    "VERY_GOOD": 0.55,
    "GOOD": 0.55,
    "FAIR": 0.55,
    "POOR": 0.50,
}

DEFAULT_DEPOSIT_RATE = 0.60  # kept as the historical/fallback rate


def deposit_rate_for_condition(condition: str | None, default: float = DEFAULT_DEPOSIT_RATE) -> float:
    """The tiered deposit rate for a condition grade. Unrecognised/None
    conditions fail toward `default` (the old flat rate), the same
    "smallest error available" rule normalizeConditionGrade documents in
    appsscript.js for its own unrecognised-condition fallback (GOOD)."""
    if condition is None:
        return default
    return CONDITION_DEPOSIT_RATES.get(condition, default)


def deposit_from_band(band: Band, rate: float | None = None, condition: str | None = None) -> int | None:
    """
    The security deposit — a condition-tiered percentage (60/55/50%) of the
    band's REFERENCE price, never of the reader's chosen price. The reason
    is an incentive, not a technicality: the deposit is paid by the OTHER
    reader. An owner free to move it has every reason to pick the top of the
    band and none not to, so "the user chooses" would collapse to "every
    owner chooses the maximum" for swap and lend. Pinning the deposit to the
    reference removes the incentive instead of capping it.

    The reader's own chosen price still governs what they SELL at, where the
    market corrects them: price too high and nobody buys.

    `rate`, if given explicitly, overrides the condition-derived rate — kept
    only for a caller that already computed its own rate (or a test that
    wants the old flat-60% behaviour). Ordinary callers should pass
    `condition` instead and let this function look up the tier.
    """
    if band.deposit_basis is None:
        return None
    effective_rate = rate if rate is not None else deposit_rate_for_condition(condition)
    return _round_inr(band.deposit_basis * effective_rate)
