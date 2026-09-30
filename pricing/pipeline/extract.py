#!/usr/bin/env python3
"""
Gemini's job in this system, and its hard limits.

═══════════════════════════════════════════════════════════════════════════
WHAT GEMINI DOES AND DOES NOT DO
═══════════════════════════════════════════════════════════════════════════
DOES:   read a publisher page and say "the printed MRP is Rs.399, this is a
        paperback, this is the Indian edition" — reading unstructured text
        and turning it into typed observations. That is a language task and
        an LLM is genuinely the right tool.

DOES NOT: compute a boundary, a median, a shrinkage weight or a deposit.

The reason is not squeamishness about LLMs. It is that these numbers decide
how much money one reader hands another. That demands three properties an
LLM cannot offer:

  * REPRODUCIBILITY — the same inputs must give the same band. A model at
    temperature 0 is still not guaranteed stable across versions, and the
    model WILL be upgraded underneath you.
  * AUDITABILITY — when a reader is refused a price, someone has to be able
    to say exactly which observations produced the boundary and by which
    rule. "The model decided" is not an answer you can give a user, and it
    is not a defence if the number is ever disputed.
  * A PROVABLE FLOOR — a test can pin `median([350,399,425]) == 399`
    forever. No test pins an LLM's arithmetic.

So Gemini's output is EVIDENCE, and it enters the system through the same
validation gate as any other source. Every extraction is checked against
rules the model cannot talk its way past, and anything that fails is stored
excluded with a reason rather than dropped.

═══════════════════════════════════════════════════════════════════════════
THE HALLUCINATION PROBLEM, CONCRETELY
═══════════════════════════════════════════════════════════════════════════
Asked "what does this book cost in India", a model will produce a confident,
plausible, entirely invented number. It is the single largest correctness
risk in this pipeline. Four defences, in order of how much they buy:

  1. NEVER ASK THE MODEL WHAT A BOOK COSTS. Only ever: "here is page text,
     extract prices that appear IN IT." A price the model returns that is
     not a substring of the source text is discarded automatically
     (verify_extraction below). This is the defence that actually works; the
     rest are backstops.
  2. Require a verbatim quote for every price. A model that must produce the
     surrounding sentence cannot invent as freely, and the quote is checked.
  3. Plausibility bounds by category. A Rs.12 textbook or a Rs.90,000 novel
     is rejected regardless of how confident the extraction was.
  4. Cross-source agreement. A single source never moves a band far; that is
     what the shrinkage weight in the engine is for.

MRP EXTRACTIONS ARE HELD TO A HIGHER BAR THAN OTHER PRICES
An extracted price of kind MRP does not simply become the book's MRP. It is
assigned an evidence tier (sql/005_mrp_evidence.sql), and it reaches an
anchoring tier only when its quote was checked against a real supplied source
page. An extraction with no source URL behind it — however plausible, however
confidently returned — lands as USER_PROVISIONAL, which the pricing engine
will not anchor on. So a model-produced number can never become a trusted MRP
by itself. The strongest tier, PHOTO_VERIFIED, requires a human to have read
the printed MRP off the reader's own photograph, and is unreachable from any
automated path.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, asdict
from typing import Any

# Rupees. Deliberately generous — this rejects the absurd, not the merely
# surprising. Narrowing it is how you start silently discarding real prices
# for expensive medical texts.
PLAUSIBLE_INR = {
    "Medical & Nursing":      (300, 15000),
    "Engineering & Technical": (150, 12000),
    "Law":                    (100, 8000),
    "Competitive Exams":      (80, 5000),
    "School & Board Prep":    (40, 3000),
    "Academic":               (100, 12000),
    "__default__":            (30, 5000),
}

EXTRACTION_PROMPT = """\
You are extracting book price information from the text of a web page.

CRITICAL RULES
1. Only report a price that appears LITERALLY in the text below. If the page
   does not state a price, return an empty list. Do not use any knowledge you
   have about this book from anywhere else.
2. For every price, include `quote`: the exact substring of the text the
   price came from, copied character for character.
3. Do not convert currencies. Do not estimate. Do not average.
4. If you are unsure whether a number is a price, leave it out.

Classify each price you find:
  kind: "MRP"         - a printed cover price / list price / M.R.P.
        "NEW_RETAIL"  - a selling price for a new copy
        "USED_RETAIL" - a selling price for a used or second-hand copy
        "EBOOK"       - a Kindle / ebook / digital price
  format: "HARDCOVER" | "TRADE_PAPERBACK" | "MASS_MARKET_PAPERBACK" | "UNKNOWN"
  is_indian_edition: true if the page indicates an Indian, South Asia,
        student or low-price edition; false if not; null if unclear.

Return ONLY a JSON object:
{"prices": [{"price": <number>, "currency": "<code>", "kind": "<kind>",
             "format": "<format>", "is_indian_edition": <bool|null>,
             "quote": "<verbatim substring>"}]}

PAGE TEXT:
---
{page_text}
---
"""


@dataclass
class Extraction:
    price: float
    currency: str
    kind: str
    format: str
    quote: str
    is_indian_edition: bool | None = None
    accepted: bool = True
    rejected_reason: str | None = None


def _digits(s: str) -> str:
    return re.sub(r"[^0-9]", "", s)


def verify_extraction(item: dict[str, Any], page_text: str, category: str | None) -> Extraction:
    """
    Checks one extracted price against the source text and against sanity.

    This is the gate the model cannot argue with. It runs on every item
    regardless of how confident the extraction claimed to be, because a
    hallucinated price and a real one look identical in the output.
    """
    def reject(reason: str) -> Extraction:
        return Extraction(
            price=float(item.get("price") or 0), currency=str(item.get("currency") or ""),
            kind=str(item.get("kind") or "UNKNOWN"), format=str(item.get("format") or "UNKNOWN"),
            quote=str(item.get("quote") or ""), is_indian_edition=item.get("is_indian_edition"),
            accepted=False, rejected_reason=reason,
        )

    try:
        price = float(item.get("price"))
    except (TypeError, ValueError):
        return reject("price is not a number")

    if price <= 0:
        return reject("price is not positive")

    currency = str(item.get("currency") or "").upper()
    if currency not in ("INR", "RS", "₹", "RS."):
        return reject(f"currency {currency!r} is not INR — no conversion is ever performed")

    quote = str(item.get("quote") or "")
    if not quote:
        return reject("no verbatim quote supplied")

    # THE defence. A price the model returned that is not in the page it was
    # given did not come from that page.
    if quote not in page_text:
        return reject("quote is not a substring of the source text (hallucinated)")

    if _digits(str(int(price))) not in _digits(quote):
        return reject("the price does not appear within its own quote")

    lo, hi = PLAUSIBLE_INR.get(category or "", PLAUSIBLE_INR["__default__"])
    if not (lo <= price <= hi):
        return reject(f"Rs.{price:.0f} is outside the plausible range for {category or 'this category'} "
                      f"(Rs.{lo}-Rs.{hi})")

    kind = str(item.get("kind") or "").upper()
    if kind not in ("MRP", "NEW_RETAIL", "USED_RETAIL", "EBOOK"):
        return reject(f"unknown price kind {kind!r}")

    fmt = str(item.get("format") or "UNKNOWN").upper()
    if fmt not in ("HARDCOVER", "TRADE_PAPERBACK", "MASS_MARKET_PAPERBACK", "UNKNOWN"):
        fmt = "UNKNOWN"

    # An ebook price is stored, but never against a print format — the schema
    # enforces this too, and it is stated in both places because a violation
    # here is silent and expensive.
    if kind == "EBOOK":
        fmt = "UNKNOWN"

    return Extraction(price=price, currency="INR", kind=kind, format=fmt,
                      quote=quote, is_indian_edition=item.get("is_indian_edition"))


def verify_response(raw: str, page_text: str, category: str | None) -> list[Extraction]:
    """Parses and verifies a whole model response. Never raises."""
    try:
        payload = json.loads(raw[raw.index("{"):raw.rindex("}") + 1])
    except (ValueError, json.JSONDecodeError):
        return []
    items = payload.get("prices")
    if not isinstance(items, list):
        return []
    return [verify_extraction(i, page_text, category) for i in items if isinstance(i, dict)]


def to_observation_rows(extractions: list[Extraction], isbn13: str,
                        source: str, source_url: str) -> list[dict]:
    """
    Shapes verified extractions into book_prices rows.

    Rejected items are included with excluded=TRUE and their reason, not
    dropped. A filter you cannot inspect is a filter you cannot debug, and
    a sudden spike in one rejection reason is the earliest warning that a
    source has changed its page layout.
    """
    rows = []
    for e in extractions:
        rows.append({
            "isbn13": isbn13,
            "format": e.format,
            "kind": e.kind,
            "price": e.price,
            "currency": "INR",
            "source": source,
            "source_url": source_url,
            "source_ref": e.quote[:200],
            "excluded": not e.accepted,
            "excluded_reason": e.rejected_reason,
            # A verified extraction is still only one source's word. It never
            # outranks a printed MRP, and the engine's shrinkage is what stops
            # it moving a band on its own.
            "confidence": 0.60 if e.accepted else 0.0,
        })
    return rows


if __name__ == "__main__":
    # A worked demonstration of the gate, including the case that matters.
    page = ("Atomic Habits by James Clear. Paperback. "
            "M.R.P.: ₹399.00. Kindle edition ₹199.00. "
            "Publisher: Manjul Publishing, Indian edition.")
    model_said = json.dumps({"prices": [
        {"price": 399, "currency": "INR", "kind": "MRP", "format": "TRADE_PAPERBACK",
         "is_indian_edition": True, "quote": "M.R.P.: ₹399.00"},
        {"price": 199, "currency": "INR", "kind": "EBOOK", "format": "TRADE_PAPERBACK",
         "is_indian_edition": True, "quote": "Kindle edition ₹199.00"},
        # The failure mode this whole module exists for: a plausible number
        # the model produced from its own memory rather than from the page.
        {"price": 450, "currency": "INR", "kind": "NEW_RETAIL", "format": "TRADE_PAPERBACK",
         "is_indian_edition": True, "quote": "Price: ₹450.00"},
        {"price": 12, "currency": "INR", "kind": "NEW_RETAIL", "format": "TRADE_PAPERBACK",
         "is_indian_edition": True, "quote": "M.R.P.: ₹399.00"},
    ]})
    for e in verify_response(model_said, page, "Self Help"):
        mark = "ACCEPT" if e.accepted else "REJECT"
        print(f"  {mark}  Rs.{e.price:>6.0f}  {e.kind:<12} {e.format:<22} {e.rejected_reason or ''}")
