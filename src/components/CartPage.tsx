import React from 'react';

/**
 * Cart (30 Sep 2026, owner's request: "cart bhi achi si banao fancy si,
 * profile se alag").
 *
 * Its own page at /cart, not a profile tab. Four views over data App
 * already has — nothing new is fetched and no business logic lives here:
 *   • My cart       — books I have asked for (sent swap/rent/buy requests)
 *   • (Requests for my books are the first section of My orders since
 *     9 Oct 2026, with Accept / Decline — no separate tab.)
 *   • Chats         — every swap and book-request conversation
 *   • Wishlist      — books I asked the community to find (was "Wanted")
 *   • My orders     — finished exchanges (9 Oct 2026): once an exchange's
 *                     room closes, the book leaves the cart and is listed
 *                     here with what was paid (book price / deposit / fee)
 *                     and the deposit refund or seller payout.
 * Every action is a callback into the existing App handlers.
 */

export type CartView = 'cart' | 'incoming' | 'chats' | 'wanted' | 'orders';

/** One finished exchange, from getMyOrders. */
export interface CartOrder {
  swapId: string;
  bookId?: string;
  bookTitle: string;
  offeredBook?: string;
  serviceType: string;
  role: 'owner' | 'requester';
  kind: string;
  otherName: string;
  price?: number;
  paid: { total: number; sale: number; deposit: number; fee: number } | null;
  /** amount = what comes back; rent = the rent taken from it (rentals); of = the deposit paid. */
  deposit: { amount: number; status: 'refunded' | 'refund_due' | 'held' | 'forfeited' | 'rent_used'; note?: string; paidAt?: string; rent?: number; fee?: number; of?: number } | null;
  payout: { amount: number; status: 'paid' | 'due'; paidAt?: string; kind?: 'sale' | 'rent' } | null;
  completedAt: string;
  /** sold · received · swapped · rented · lent · in_return */
  category?: string;
  /** A book out with a reader (or coming back) right now. */
  inReturn?: { step: number; stepTitle: string; dueAt: string; daysLeft?: number; overdue?: boolean; onItsWay?: boolean } | null;
  chatId?: string;
  swapPreference?: string;
}

/** My orders, in sections (owner's request, 9 Oct 2026). */
const ORDER_SECTIONS: { id: string; label: string }[] = [
  { id: 'in_return', label: 'In return process' },
  { id: 'received', label: 'Received' },
  { id: 'sold', label: 'Sold' },
  { id: 'swapped', label: 'Swapped' },
  { id: 'rented', label: 'Rented' },
  { id: 'lent', label: 'Lent' },
];

export interface CartSwap {
  id: string;
  bookId?: string;
  requestedBookTitle: string;
  senderEmail: string;
  receiverEmail: string;
  status: string;
  createdAt: string;
  serviceType?: string;
  amount?: number | string;
  securityDeposit?: number | string;
  dueDate?: string;
}
export interface CartChat {
  chatId: string;
  bookId?: string;
  ownerEmail: string;
  requesterEmail: string;
  createdAt: string;
  chatStatus?: string;
  chatType?: string;
  swapId?: string;
}
export interface CartWanted {
  requestId: string;
  title: string;
  author?: string;
  city?: string;
  requestType?: string;
  note?: string;
  status?: string;
  createdAt?: string;
}

export interface CartPageProps {
  view: CartView;
  onViewChange: (v: CartView) => void;
  meEmail: string;
  sent: CartSwap[];
  received: CartSwap[];
  chats: CartChat[];
  wanted: CartWanted[];
  /** Finished exchanges whose room has closed. */
  orders?: CartOrder[];
  busy?: boolean;
  coverFor: (bookId?: string, title?: string) => string;
  bookTitleFor: (bookId?: string) => string;
  hasChatFor: (req: CartSwap) => boolean;
  responsesFor: (requestId: string) => { responseId: string; chatId: string }[];
  onOpenRequestChat: (req: CartSwap) => void;
  onOpenChat: (chat: CartChat) => void;
  onOpenChatById: (chatId: string) => void;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  onCancelWanted: (requestId: string) => void;
  onRequestBook: () => void;
  onBrowse: () => void;
  onListBook: () => void;
}

const norm = (e?: string) => String(e || '').trim().toLowerCase();
const nameOf = (email?: string) => {
  const local = String(email || 'reader').split('@')[0].replace(/[._-]+/g, ' ').trim();
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'A reader';
};
const status = (s?: string) => String(s || 'Pending').trim().toLowerCase();
const when = (d?: string) => {
  const t = d ? new Date(d) : null;
  return t && !isNaN(t.getTime()) ? t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
};
const inr = (v?: number | string) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '';
};
/** What the reader is doing with the book, in their words. */
const kindOf = (t?: string, mine = true) => {
  switch (String(t || 'SWAP').toUpperCase()) {
    case 'RENT': return mine ? 'Rent' : 'Wants to rent';
    case 'SELL': return mine ? 'Buy' : 'Wants to buy';
    case 'LEND': return mine ? 'Borrow' : 'Wants to borrow';
    default: return mine ? 'Swap' : 'Wants to swap';
  }
};

function Cover({ src, title }: { src: string; title: string }) {
  const [failed, setFailed] = React.useState(false);
  const initials = title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'SS';
  return (
    <div className="cart-cover" aria-hidden="true">
      {src && !failed
        ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
        : <span className="cart-cover__plate"><span>{initials}</span></span>}
    </div>
  );
}

/** Requested → Accepted → Chat, as a small track. */
function Steps({ s, chat }: { s: string; chat: boolean }) {
  if (s === 'declined' || s === 'cancelled' || s === 'rejected') {
    return <p className="cart-steps cart-steps--closed">Not available this time</p>;
  }
  const at = s === 'pending' ? 1 : chat ? 3 : 2;
  return (
    <ol className="cart-steps" aria-label={`Step ${at} of 3`}>
      {['Requested', 'Accepted', 'Chatting'].map((label, i) => (
        <li key={label} className={i < at ? 'is-done' : ''} aria-current={i === at - 1 ? 'step' : undefined}>{label}</li>
      ))}
    </ol>
  );
}

function Empty({ title, body, action, onAction }: { title: string; body: string; action: string; onAction: () => void }) {
  return (
    <div className="cart-empty">
      <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
        <path d="M14 22h36l-3 28a4 4 0 0 1-4 4H21a4 4 0 0 1-4-4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M24 22v-4a8 8 0 0 1 16 0v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M26 34h12M26 41h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      </svg>
      <h3>{title}</h3>
      <p>{body}</p>
      <button type="button" className="cart-btn cart-btn--solid" onClick={onAction}>{action}</button>
    </div>
  );
}

// A request whose room has closed — finished (it is an order now) or closed
// before any exchange (cancelled, or not paid within 48 hours).
const CLOSED = ['cancelled', 'expired', 'completed'];

export default function CartPage(props: CartPageProps) {
  const orders = props.orders || [];
  // 9 Oct 2026: "Requests" is no longer its own tab — requests for my books
  // are the first section of My orders. Old links to the Requests view land
  // there, filtered to requests.
  const [orderFilter, setOrderFilter] = React.useState<string>(props.view === 'incoming' ? 'requests' : 'all');
  const view: CartView = props.view === 'incoming' ? 'orders' : props.view;
  const ordered = new Set(orders.map((o) => String(o.swapId)));
  const open = (r: CartSwap) => !ordered.has(String(r.id)) && !CLOSED.includes(status(r.status));
  // The cart and the requests list only show exchanges that are still open.
  const p = { ...props, sent: props.sent.filter(open), received: props.received.filter(open) };
  const pendingIn = p.received.filter((r) => status(r.status) === 'pending').length;
  const openChats = p.chats.filter((c) => c.chatStatus !== 'Archived');
  const openWanted = p.wanted.filter((w) => !['cancelled', 'fulfilled', 'closed'].includes(status(w.status || 'open')));
  const inCart = p.sent.filter((r) => !['declined', 'cancelled', 'rejected'].includes(status(r.status))).length;

  const tabs: { id: CartView; label: string; count: number; alert?: boolean }[] = [
    { id: 'cart', label: 'My cart', count: p.sent.length },
    { id: 'chats', label: 'Chats', count: openChats.length },
    { id: 'wanted', label: 'Wishlist', count: openWanted.length },
    { id: 'orders', label: 'My orders', count: orders.length + p.received.length, alert: pendingIn > 0 },
  ];
  const goRequests = () => { setOrderFilter('requests'); p.onViewChange('orders'); };

  return (
    <div className="cart" data-testid="cart-page">
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="cart-hero">
        <div className="cart-hero__text">
          <p className="cart-hero__eyebrow">Your cart</p>
          <h1 className="cart-hero__title">
            {inCart ? <>{inCart} {inCart === 1 ? 'book is' : 'books are'} on {inCart === 1 ? 'its' : 'their'} way to you.</> : <>Your next read starts here.</>}
          </h1>
          <p className="cart-hero__sub">Books you’ve asked for, books others want from you, and every conversation about them.</p>
        </div>
        <div className="cart-stats">
          {[
            { id: 'cart' as const, n: inCart, label: 'In your cart' },
            { id: 'incoming' as const, n: pendingIn, label: 'Waiting on you', hot: pendingIn > 0 },
            { id: 'chats' as const, n: openChats.length, label: 'Open chats' },
          ].map((t) => (
            <button key={t.id} type="button" className={`cart-stat ${t.hot ? 'is-hot' : ''}`} onClick={() => (t.id === 'incoming' ? goRequests() : p.onViewChange(t.id))}>
              <span className="cart-stat__n">{t.n}</span>
              <span className="cart-stat__label">{t.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Tabs ─────────────────────────────────────────── */}
      <div className="cart-tabs" role="tablist" aria-label="Cart sections">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={view === t.id} className="cart-tab" onClick={() => { if (t.id === 'orders') setOrderFilter('all'); p.onViewChange(t.id); }}>
            {t.label}
            <span className={`cart-tab__count ${t.alert ? 'is-alert' : ''} ${t.count ? '' : 'is-zero'}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* ── My cart ──────────────────────────────────────── */}
      {view === 'cart' && (
        p.sent.length ? (
          <div className="cart-list">
            {p.sent.map((r) => {
              const s = status(r.status);
              const chat = s === 'accepted' && p.hasChatFor(r);
              return (
                <article key={r.id} className="cart-item" data-testid="cart-item">
                  <Cover src={p.coverFor(r.bookId, r.requestedBookTitle)} title={r.requestedBookTitle} />
                  <div className="cart-item__body">
                    <p className="cart-item__kind">
                      <span className="cart-chip">{kindOf(r.serviceType)}</span>
                      <span>from {nameOf(r.receiverEmail)}</span>
                    </p>
                    <h3 className="cart-item__title">{r.requestedBookTitle}</h3>
                    {(inr(r.amount) || inr(r.securityDeposit)) && (
                      <p className="cart-item__price">
                        {inr(r.amount)}{inr(r.securityDeposit) ? `${inr(r.amount) ? ' + ' : ''}${inr(r.securityDeposit)} refundable deposit` : ''}
                      </p>
                    )}
                    <Steps s={s} chat={chat} />
                    <div className="cart-item__foot">
                      <span className="cart-item__date">Asked {when(r.createdAt)}</span>
                      {s === 'accepted' ? (
                        <button type="button" className="cart-btn cart-btn--solid" onClick={() => p.onOpenRequestChat(r)}>Open chat</button>
                      ) : s === 'pending' ? (
                        <span className="cart-item__wait">Waiting for {nameOf(r.receiverEmail)}</span>
                      ) : (
                        <button type="button" className="cart-btn" onClick={p.onBrowse}>Find another copy</button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty title="Your cart is empty" body="Find a book you’d love to read next and ask its reader to swap, lend, rent or sell it." action="Browse books" onAction={p.onBrowse} />
        )
      )}

      {/* ── Chats ────────────────────────────────────────── */}
      {view === 'chats' && (
        openChats.length ? (
          <ul className="cart-chats">
            {openChats.map((c) => {
              const other = [c.ownerEmail, c.requesterEmail].find((e) => norm(e) !== norm(p.meEmail)) || '';
              const isRequest = c.chatType === 'BookRequest' || String(c.swapId || '').startsWith('SS_REQ_BOOK_');
              const book = p.bookTitleFor(c.bookId);
              return (
                <li key={c.chatId}>
                  <button type="button" className="cart-chat" onClick={() => p.onOpenChat(c)} data-testid="cart-chat">
                    <span className="cart-chat__avatar" aria-hidden="true">{nameOf(other).charAt(0)}</span>
                    <span className="cart-chat__text">
                      <span className="cart-chat__name">{nameOf(other)}</span>
                      <span className="cart-chat__about">{isRequest ? 'Book request' : book || 'Swap'} · since {when(c.createdAt)}</span>
                    </span>
                    <span className="cart-chat__go" aria-hidden="true">›</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty title="No conversations yet" body="A chat opens here as soon as a request is accepted — yours or someone else’s." action="Browse books" onAction={p.onBrowse} />
        )
      )}

      {/* ── Wanted ───────────────────────────────────────── */}
      {view === 'wanted' && (
        <>
          <div className="cart-wanted-bar">
            <p><b>My wishlist</b> — books you want. Readers near you see it and can offer theirs.</p>
            <button type="button" className="cart-btn cart-btn--solid" onClick={p.onRequestBook}>Add a book</button>
          </div>
          {p.wanted.length ? (
            <div className="cart-list">
              {p.wanted.map((w) => {
                const s = status(w.status || 'open');
                const closed = ['cancelled', 'fulfilled', 'closed'].includes(s);
                const replies = p.responsesFor(w.requestId);
                return (
                  <article key={w.requestId} className={`cart-item ${closed ? 'is-closed' : ''}`} data-testid="cart-wanted">
                    <Cover src="" title={w.title} />
                    <div className="cart-item__body">
                      <p className="cart-item__kind">
                        <span className="cart-chip">{w.requestType && w.requestType !== 'Any' ? w.requestType : 'Any way'}</span>
                        <span>{w.city || 'Any area'}</span>
                      </p>
                      <h3 className="cart-item__title">{w.title}</h3>
                      {w.author && <p className="cart-item__author">{w.author}</p>}
                      <div className="cart-item__foot">
                        <span className={`cart-status is-${s}`}>{w.status || 'Open'}</span>
                        <span className="cart-item__decide">
                          {replies.map((r, i) => (
                            <button key={r.responseId} type="button" className="cart-btn cart-btn--solid" onClick={() => p.onOpenChatById(r.chatId)}>
                              {replies.length > 1 ? `Offer ${i + 1}` : 'Open chat'}
                            </button>
                          ))}
                          {!closed && <button type="button" className="cart-btn cart-btn--ghost" onClick={() => p.onCancelWanted(w.requestId)}>Cancel</button>}
                        </span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty title="Your wishlist is empty" body="Add a book you want, and readers near you will see it. You can also ask in Community → Book requests." action="Add to wishlist" onAction={p.onRequestBook} />
          )}
        </>
      )}

      {/* ── My orders ────────────────────────────────────── */}
      {view === 'orders' && (
        orders.length || p.received.length ? (
          <>
            <div className="cart-order-filters" role="group" aria-label="Show orders">
              {[{ id: 'all', label: 'All', n: orders.length + p.received.length }, { id: 'requests', label: 'Requests', n: p.received.length }]
                .concat(ORDER_SECTIONS.map((sec) => ({ ...sec, n: orders.filter((o) => (o.category || 'received') === sec.id).length })))
                .filter((x) => x.n > 0 || x.id === orderFilter)
                .map((f) => (
                  <button key={f.id} type="button" className={`cart-order-filter ${orderFilter === f.id ? 'is-on' : ''}`} aria-pressed={orderFilter === f.id} onClick={() => setOrderFilter(f.id)}>
                    {f.label} <span>{f.n}</span>
                  </button>
                ))}
            </div>
            {/* Requests for my books: accept or decline here. */}
            {(orderFilter === 'all' || orderFilter === 'requests') && (p.received.length ? (
              <section className="cart-order-section" aria-label="Requests" data-testid="orders-requests">
                <h2 className="cart-order-section__title">Requests {pendingIn > 0 ? <span className="is-alert">{pendingIn} waiting on you</span> : <span>{p.received.length}</span>}</h2>
                <div className="cart-list">
                  {p.received.map((r) => {
                    const s = status(r.status);
                    return (
                      <article key={r.id} className={`cart-item ${s === 'pending' ? 'is-waiting' : ''}`} data-testid="cart-incoming">
                        <Cover src={p.coverFor(r.bookId, r.requestedBookTitle)} title={r.requestedBookTitle} />
                        <div className="cart-item__body">
                          <p className="cart-item__kind">
                            <span className="cart-chip">{kindOf(r.serviceType, false)}</span>
                            <span>{nameOf(r.senderEmail)}</span>
                          </p>
                          <h3 className="cart-item__title">{r.requestedBookTitle}</h3>
                          {inr(r.amount) && <p className="cart-item__price">{inr(r.amount)}</p>}
                          <div className="cart-item__foot">
                            <span className="cart-item__date">{when(r.createdAt)}</span>
                            {s === 'pending' ? (
                              <span className="cart-item__decide">
                                <button type="button" className="cart-btn cart-btn--ghost" disabled={p.busy} onClick={() => p.onDecline(r.id)}>Decline</button>
                                <button type="button" className="cart-btn cart-btn--solid" disabled={p.busy} onClick={() => p.onAccept(r.id)}>Accept</button>
                              </span>
                            ) : s === 'accepted' ? (
                              <button type="button" className="cart-btn cart-btn--solid" onClick={() => p.onOpenRequestChat(r)}>Open chat</button>
                            ) : (
                              <span className={`cart-status is-${s}`}>{r.status}</span>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : orderFilter === 'requests' ? (
              <p className="cart-order__line">No one has asked for your books right now. The more books on your shelf, the sooner a request arrives.</p>
            ) : null)}
            {ORDER_SECTIONS.filter((sec) => orderFilter === 'all' || orderFilter === sec.id).map((sec) => {
              const list = orders.filter((o) => (o.category || 'received') === sec.id);
              if (!list.length) return null;
              return (
                <section key={sec.id} className="cart-order-section" aria-label={sec.label} data-testid={'orders-' + sec.id}>
                  <h2 className="cart-order-section__title">{sec.label} <span>{list.length}</span></h2>
                  <div className="cart-list">
                    {list.map((o) => (
                      <React.Fragment key={o.swapId}>
                        <OrderCard o={o} cover={p.coverFor(o.bookId, o.bookTitle)} onOpenChat={o.chatId ? () => p.onOpenChatById(o.chatId!) : undefined} />
                      </React.Fragment>
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        ) : (
          <Empty title="No orders yet" body="Requests for your books, and books you buy, sell, swap, rent or lend, appear here — sorted by kind, with what was paid." action="Browse books" onAction={p.onBrowse} />
        )
      )}
    </div>
  );
}

/** One order: the book, who with, what was paid, and where the money / book stands. */
function OrderCard({ o, cover, onOpenChat }: { o: CartOrder; cover: string; onOpenChat?: () => void }) {
  const paidParts = o.paid ? [
    o.paid.sale > 0 ? `${inr(o.paid.sale)} book` : '',
    o.paid.deposit > 0 ? `${inr(o.paid.deposit)} deposit` : '',
    o.paid.fee > 0 ? `${inr(o.paid.fee)} fee` : '',
  ].filter(Boolean) : [];
  const dep = o.deposit;
  const r = o.inReturn;
  return (
    <article className="cart-item" data-testid="cart-order">
      <Cover src={cover} title={o.bookTitle} />
      <div className="cart-item__body">
        <p className="cart-item__kind">
          <span className="cart-chip">{o.kind}</span>
          <span>{o.role === 'owner' ? (o.serviceType === 'SWAP' ? 'with' : 'to') : (o.serviceType === 'SWAP' ? 'with' : 'from')} {o.otherName}</span>
        </p>
        <h3 className="cart-item__title">{o.bookTitle}</h3>
        {o.offeredBook && <p className="cart-item__author">⇄ {o.offeredBook}{o.swapPreference ? ` · ${o.swapPreference.toLowerCase()} swap` : ''}</p>}
        {o.paid ? (
          <p className="cart-item__price">
            You paid {inr(o.paid.total) || '₹0'}{paidParts.length > 1 ? <span className="cart-order__parts"> ({paidParts.join(' + ')})</span> : null}
          </p>
        ) : !o.payout ? <p className="cart-order__line">Nothing paid through SwapSutra</p> : null}
        {o.payout && (
          <p className="cart-order__line">{o.payout.status === 'paid' ? `✓ ${inr(o.payout.amount)} paid to you` : `${inr(o.payout.amount)} on its way to you`} {o.payout.kind === 'rent' ? '(rent, from the renter’s deposit)' : '(book price minus the fee)'}</p>
        )}
        {dep && (
          <p className={`cart-order__line ${dep.status === 'forfeited' ? 'is-bad' : ''}`}>
            {!dep.rent && dep.fee ? (dep.status === 'held' ? `Of your ${inr(dep.of)} deposit, ${inr(dep.fee)} is SwapSutra's fee · ` : `${inr(dep.fee)} platform fee taken from your ${inr(dep.of)} deposit · `) : ''}
            {dep.rent ? (dep.status === 'held' ? `Of your ${inr(dep.of)} deposit, ${inr(dep.rent)} rent goes to the owner · ` : `${inr(dep.rent)} rent paid to the owner from your ${inr(dep.of)} deposit · `) : ''}
            {dep.status === 'refunded' ? `✓ ${inr(dep.amount)} ${dep.rent || dep.fee ? 'refunded to you' : 'deposit refunded'}`
              : dep.status === 'refund_due' ? `${inr(dep.amount)} ${dep.rent || dep.fee ? 'coming back to you' : 'deposit refund on its way'}`
              : dep.status === 'rent_used' ? 'nothing left to refund'
              : dep.status === 'forfeited' ? `${inr(dep.amount)} deposit — ${dep.note || 'forfeited'}`
              : dep.rent ? `${inr(Math.max(0, (dep.of || 0) - dep.rent))} comes back when the book is returned`
              : dep.fee ? `${inr(Math.max(0, (dep.of || 0) - dep.fee))} comes back when the exchange is complete`
              : `${inr(dep.amount)} deposit held until the book is back`}
          </p>
        )}
        {r && (
          <p className={`cart-order__line ${r.overdue ? 'is-bad' : ''}`}>
            {r.onItsWay ? 'On its way back' : r.overdue ? 'Return overdue' : 'With the reader'}
            {r.dueAt ? ` · due ${when(r.dueAt)}` : ''}{!r.overdue && typeof r.daysLeft === 'number' && r.daysLeft > 0 ? ` (${r.daysLeft} days left)` : ''} · Step {r.step}: {r.stepTitle}
          </p>
        )}
        <div className="cart-item__foot">
          <span className="cart-item__date">{r ? 'In progress' : `Completed ${when(o.completedAt)}`}</span>
          {r && onOpenChat
            ? <button type="button" className="cart-btn cart-btn--solid" onClick={onOpenChat}>Open chat</button>
            : <span className="cart-status is-completed">Done</span>}
        </div>
      </div>
    </article>
  );
}
