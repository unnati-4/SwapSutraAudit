/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SwapSutra — legal pages.
 *
 * Four short pages, each keeping only what a reader needs to know and what
 * Indian law requires us to publish:
 *   /terms          Terms of Use (includes community rules and exchanges)
 *   /privacy        Privacy Policy (DPDP Act, 2023)
 *   /refund-policy  Membership refunds and security deposits
 *   /grievance      Grievance Officer and how complaints are handled (IT Rules, 2021)
 *
 * Every business detail lives in LEGAL_DETAILS. Update it there when the
 * business changes (for example a company name after incorporation, or a
 * dedicated grievance address).
 */

import React from 'react';
import { motion } from 'motion/react';

export const LEGAL_DETAILS = {
  entityName: 'Unnati Goyal, sole proprietor, trading as SwapSutra',
  grievanceOfficer: 'Unnati Goyal',
  grievanceEmail: 'swapsutra@gmail.com',
  supportEmail: 'swapsutra@gmail.com',
  // City and state only: a home address should not be published.
  address: 'Saharanpur, Uttar Pradesh, India',
  city: 'Saharanpur, Uttar Pradesh',
  effectiveDate: '17 September 2026',
  siteUrl: 'https://www.swapsutra.in',
};

const L = LEGAL_DETAILS;

/** The tabs these pages link to. A subset of App's own tab type. */
export type LegalTab = 'about' | 'terms' | 'privacy' | 'refund-policy' | 'grievance';
export type LegalNavTab = LegalTab | 'browse';

type Nav = (tab: LegalNavTab) => void;

const PAGES: { tab: LegalTab; label: string }[] = [
  { tab: 'about', label: 'About' },
  { tab: 'terms', label: 'Terms' },
  { tab: 'privacy', label: 'Privacy' },
  { tab: 'refund-policy', label: 'Refunds & Deposits' },
  { tab: 'grievance', label: 'Grievances' },
];

/* ── shared layout ─────────────────────────────────────────────────────── */

const Shell = ({
  tab, title, summary, children, navigateTo,
}: { tab: LegalTab; title: string; summary: string; children: React.ReactNode; navigateTo: Nav }) => (
  <motion.div
    key={tab}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
    className="max-w-3xl mx-auto py-8 md:py-12"
  >
    <div role="navigation" aria-label="Legal pages" className="mb-8 flex flex-wrap justify-center gap-2">
      {PAGES.map(page => (
        <button
          key={page.tab}
          type="button"
          onClick={() => navigateTo(page.tab)}
          aria-current={page.tab === tab ? 'page' : undefined}
          className={`rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
            page.tab === tab
              ? 'border-brand-gold bg-brand-gold text-white'
              : 'border-brand-border text-[var(--text-secondary)] hover:border-brand-gold hover:text-brand-gold-text'
          }`}
        >
          {page.label}
        </button>
      ))}
    </div>

    <h2 className="text-3xl md:text-4xl font-serif text-[var(--text-primary)] mb-3 text-center tracking-tight">{title}</h2>
    <p className="text-xs uppercase tracking-eyebrow text-brand-gold-text font-bold text-center mb-8">
      Effective {L.effectiveDate}
    </p>

    <div className="classic-card p-6 md:p-12 space-y-8 text-[var(--text-secondary)] leading-relaxed">
      <p className="text-base font-serif italic text-[var(--text-primary)]">{summary}</p>
      {children}
      <div className="pt-8 border-t border-brand-border text-center">
        <button type="button" onClick={() => navigateTo('browse')} className="btn-outline !py-3 !px-8">Back to Library</button>
      </div>
    </div>
  </motion.div>
);

const S = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section>
    <h3 className="text-lg font-serif text-[var(--text-primary)] mb-3 border-b border-brand-border pb-2">{title}</h3>
    <div className="space-y-3 text-sm leading-loose">{children}</div>
  </section>
);

const UL = ({ items }: { items: React.ReactNode[] }) => (
  <ul className="space-y-1.5 list-disc pl-5">
    {items.map((item, i) => <li key={i}>{item}</li>)}
  </ul>
);

const Link = ({ to, navigateTo, children }: { to: LegalNavTab; navigateTo: Nav; children: React.ReactNode }) => (
  <button type="button" onClick={() => navigateTo(to)} className="text-brand-gold-text underline font-bold">{children}</button>
);

const Warn = ({ children }: { children: React.ReactNode }) => (
  <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-sm leading-relaxed text-red-800">{children}</div>
);

const Mail = ({ to }: { to: string }) => (
  <a href={`mailto:${to}`} className="text-brand-gold-text underline font-bold break-all">{to}</a>
);

/* ── Terms of Use ──────────────────────────────────────────────────────── */

export const TermsOfUsePage = ({ navigateTo }: { navigateTo: Nav }) => (
  <Shell
    tab="terms"
    title="Terms of Use"
    summary="SwapSutra helps readers find each other and share physical books. By using it you agree to these terms."
    navigateTo={navigateTo}
  >
    <S title="1. Who we are">
      <p>SwapSutra ({L.siteUrl}) is operated by {L.entityName}. These terms apply together with our{' '}
        <Link to="privacy" navigateTo={navigateTo}>Privacy Policy</Link> and{' '}
        <Link to="refund-policy" navigateTo={navigateTo}>Refunds &amp; Deposits</Link> policy.</p>
    </S>

    <S title="2. Your account">
      <UL items={[
        <>You must be <strong>18 or older</strong>.</>,
        'One person, one account. Give accurate details and keep your email secure.',
        <>You sign in with a one-time password (OTP). <strong>Never share your OTP</strong> with anyone. We will never ask for it.</>,
      ]} />
    </S>

    <S title="3. What SwapSutra does">
      <p>SwapSutra is a meeting place for readers. <strong>Every exchange is between the two readers, not with us.</strong> We do not own, inspect, ship or insure books, and we cannot guarantee a book's condition or another reader's conduct.</p>
      <p>We review listings, keep a record of what was agreed and help mediate disputes. Security deposits are the one place we handle money between readers (see <Link to="refund-policy" navigateTo={navigateTo}>Refunds &amp; Deposits</Link>). Separately, SwapSutra charges the small fees set out in section 4.</p>
    </S>

    <S title="4. Membership and fees">
      <p>Joining SwapSutra is <strong>free</strong>, and membership does not expire.</p>
      <UL items={[
        <><strong>Platform fee.</strong> When an exchange (swap, lend, rent or sale) is accepted, <strong>each reader pays SwapSutra ₹10</strong> by UPI before the exchange chat opens. It is separate from any security deposit and from any money readers pay each other.</>,
        <><strong>Listing limit.</strong> Each reader may list up to <strong>20 books</strong> free. A one-time payment of <strong>₹20</strong>, or a valid SwapSutra coupon, removes the limit for that account.</>,
      ]} />
      <p>We give 30 days' notice before any change to these amounts. A change never affects a fee you have already paid.</p>
    </S>

    <S title="5. Listing and exchanging books">
      <UL items={[
        <>List only books <strong>you own</strong>, and only <strong>genuine copies</strong>. Pirated, photocopied or scanned books are not allowed.</>,
        'Describe the condition honestly and use real photos of your copy.',
        'Agree the terms (duration, money, delivery, meeting place) in the app before a book changes hands.',
        'Return borrowed books on time and in the condition you received them. Normal reading wear is fine.',
        'Rent and sale money is paid directly between readers. Courier costs and courier losses are between the sender and the courier.',
      ]} />
    </S>

    <S title="6. Meeting safely">
      <p>Meet in a <strong>public place</strong>, tell someone where you are going, and check the book before you finish the exchange. We do not run background checks. If you are in danger, call <strong>112</strong> first, then tell us.</p>
    </S>

    <S title="7. Not allowed">
      <UL items={[
        'Harassment, threats, abuse, discrimination or unwanted advances.',
        'Impersonation, fake accounts, fake reviews or misleading listings.',
        'Sharing another reader’s contact details or photos without consent.',
        'Unlawful, obscene, hateful or infringing content, spam, scraping, or attempts to break into accounts or systems.',
      ]} />
      <p>We may remove content and restrict, suspend or close accounts that break these rules. Closing an account does not cancel a book or deposit you still owe.</p>
    </S>

    <S title="8. Your content">
      <p>You own what you post. You let us display it to run SwapSutra until you delete it. Copyright complaints go to our <Link to="grievance" navigateTo={navigateTo}>Grievance Officer</Link>.</p>
    </S>

    <S title="9. Disputes and liability">
      <p>Raise a problem in the chat or at <Mail to={L.supportEmail} /> within <strong>14 days</strong>. We review the record and suggest a fair outcome, but we cannot force a reader to return a book or money.</p>
      <p>SwapSutra is provided "as is". We are not liable for other readers' actions. Where we are liable, our total liability is limited to the greater of the membership fees you paid in the last 12 months or ₹5,000, except where Indian law does not allow a limit.</p>
    </S>

    <S title="10. Changes and law">
      <p>We give at least 15 days' notice of important changes. These terms are governed by Indian law, and the courts at {L.city} have jurisdiction, without affecting your rights under the Consumer Protection Act, 2019.</p>
    </S>
  </Shell>
);

/* ── Privacy Policy ────────────────────────────────────────────────────── */

export const PrivacyPolicyPage = ({ navigateTo }: { navigateTo: Nav }) => (
  <Shell
    tab="privacy"
    title="Privacy Policy"
    summary="We collect only what is needed to connect you with nearby readers. We never sell your data or show your contact details publicly."
    navigateTo={navigateTo}
  >
    <S title="What we collect">
      <UL items={[
        <><strong>Account:</strong> name, email, phone number, area and pincode, and confirmation that you are 18 or older.</>,
        <><strong>Optional profile:</strong> photo, short bio and favourite genres.</>,
        <><strong>Listings and exchanges:</strong> book details and photos, an approximate location, agreed terms, condition photos and handover confirmations.</>,
        <><strong>Messages:</strong> exchange chats and voice notes. Admins can read exchange chats to keep readers safe and settle disputes.</>,
        <><strong>Payments:</strong> payment reference, amount and date. We never see your UPI PIN, card or bank details.</>,
        <><strong>Technical:</strong> IP address and device type, for security.</>,
      ]} />
    </S>

    <S title="How we use it">
      <p>To run your account, show you books nearby, connect matched readers, record exchanges, send notifications, prevent fraud and meet legal duties. <strong>No advertising, no selling, no data brokers.</strong></p>
    </S>

    <S title="Who can see what">
      <UL items={[
        <><strong>Everyone:</strong> your display name, books, general area and reviews.</>,
        <><strong>Members:</strong> your profile details and a book's precise location.</>,
        <><strong>Only a reader you are matched with:</strong> your email and phone number.</>,
      ]} />
    </S>

    <S title="Services we use">
      <p>Google (Sheets, Apps Script, Drive) stores our data, Vercel hosts the website, and Google Gemini powers the Quill assistant, so text you type into Quill is sent to Google. We share data with authorities only when the law requires it.</p>
    </S>

    <S title="How long we keep it">
      <p>While your account is active. After you delete it, within 30 days, except exchange records (3 years), messages (1 year), payment records (8 years, for tax law) and security logs (1 year).</p>
    </S>

    <S title="Cookies">
      <p>Only what is necessary: a session to keep you signed in, and local storage for drafts and preferences. No advertising or third-party trackers.</p>
    </S>

    <S title="Your rights">
      <p>Under the Digital Personal Data Protection Act, 2023 you can ask to see, correct or delete your data, withdraw consent, and nominate someone to act for you. Most details can be changed in your profile. For anything else, write to <Mail to={L.supportEmail} /> from your registered email. If a data breach happens, we will tell you and the Data Protection Board of India.</p>
      <p>Complaints go to our <Link to="grievance" navigateTo={navigateTo}>Grievance Officer</Link>, and then to the Data Protection Board of India.</p>
    </S>
  </Shell>
);

/* ── Refunds & Security Deposits ───────────────────────────────────────── */

export const RefundPolicyPage = ({ navigateTo }: { navigateTo: Nav }) => (
  <Shell
    tab="refund-policy"
    title="Refunds & Deposits"
    summary="Fees are what you pay SwapSutra. A security deposit protects a lent book. They are refunded differently."
    navigateTo={navigateTo}
  >
    <S title="SwapSutra's fees">
      <p>Joining is free. SwapSutra charges two things, both paid by UPI and checked by hand, usually within a day.</p>
      <p><strong>₹10 platform fee per reader, per exchange.</strong> Refunded in full if the exchange is cancelled before both payments are verified and the chat opens, or if you were charged twice. Once the chat has opened, it is not refundable.</p>
      <p><strong>₹20 to list more than 20 books</strong> (one time). Refunded in full if we could not verify it, you were charged twice, or you ask within <strong>48 hours</strong> without having listed a 21st book.</p>
      <p><strong>No refund</strong> after an account is suspended for breaking the <Link to="terms" navigateTo={navigateTo}>Terms</Link>.</p>
      <p>To ask, email <Mail to={L.supportEmail} /> with the subject "Refund request" and your payment reference (UTR). We decide within 7 working days, and approved refunds reach your original payment method within 7–10 working days.</p>
    </S>

    <S title="Security deposits">
      <p>For a swap, a rental or a loan, the reader receiving a book pays a refundable deposit of 65% of its printed MRP. A purchase has no deposit. A borrowed book must be on its way back within <strong>21 days</strong> of reaching the borrower (handed over, or posted with the courier name and tracking ID). Both readers may agree to extend by +7 or +14 days, 14 at most. If it isn't on its way back by the deadline, the deposit is forfeited and paid to the book's owner.</p>
      <UL items={[
        <><strong>Returned in full within 48 hours</strong> after both readers confirm the book is back in good condition, or if the exchange is cancelled before handover.</>,
        <><strong>Partly or fully kept</strong> only if the book is not returned, is damaged beyond normal reading wear, or is returned very late. The reason must be given in the exchange chat.</>,
      ]} />
      <p>If a deposit has not come back, raise it in the chat first, then with us within 14 days.</p>
      <Warn>
        <strong>Please note:</strong> deposits are currently collected and released manually by SwapSutra, not held in a regulated escrow account. We will update this page when escrow is in place. If you would rather not pay a deposit on these terms, please avoid temporary exchanges.
      </Warn>
    </S>

    <S title="Money between readers">
      <p>Rent, sale money and courier charges are paid directly between readers, and SwapSutra cannot refund them. Nothing here limits your rights under the Consumer Protection Act, 2019.</p>
    </S>
  </Shell>
);

/* ── Grievance Redressal ───────────────────────────────────────────────── */

export const GrievancePage = ({ navigateTo }: { navigateTo: Nav }) => (
  <Shell
    tab="grievance"
    title="Grievances & Contact"
    summary="If something has gone wrong, tell us. Every complaint is acknowledged within 24 hours and resolved within 15 days."
    navigateTo={navigateTo}
  >
    <S title="Grievance Officer">
      <div className="p-5 bg-[var(--bg-page-alt)] border border-brand-border rounded-2xl space-y-1">
        <p className="font-serif text-lg text-[var(--text-primary)]">{L.grievanceOfficer}</p>
        <p className="text-sm">Email: <Mail to={L.grievanceEmail} /></p>
        <p className="text-sm">Location: {L.address}</p>
        <p className="text-xs opacity-70 pt-2">
          Appointed under Rule 3(2) of the IT (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021
          and the Digital Personal Data Protection Act, 2023.
        </p>
      </div>
    </S>

    <S title="How to complain">
      <p>Email us with your registered email, what happened, where (listing, chat or profile), when, and any screenshots. You can complain about unlawful or infringing content, fake listings, harassment, privacy or data requests, safety incidents, billing, or deposits.</p>
      <p>Content showing someone in an intimate situation without consent is removed within <strong>24 hours</strong>. Use the subject "URGENT".</p>
      <Warn>In an emergency, call <strong>112</strong> first. For cybercrime, call <strong>1930</strong> or visit cybercrime.gov.in.</Warn>
    </S>

    <S title="If you are not satisfied">
      <UL items={[
        'Data protection: the Data Protection Board of India.',
        <>Consumer matters: a Consumer Commission, or the National Consumer Helpline on <strong>1915</strong>.</>,
        'Content decisions: a Grievance Appellate Committee at gac.gov.in, within 30 days.',
      ]} />
      <p>See also our <Link to="terms" navigateTo={navigateTo}>Terms of Use</Link>.</p>
    </S>
  </Shell>
);


/* ── About ─────────────────────────────────────────────────────────────── */

/**
 * Who runs SwapSutra and what it is for.
 *
 * It sits with the legal pages on purpose: the same person and the same
 * address stand behind both, and a reader deciding whether to hand a book to
 * a stranger deserves to find all of that in one place. It is also, since the
 * Home page was retired, the only page that explains the idea in full.
 */
const AboutPage = ({ navigateTo }: { navigateTo: Nav }) => (
  <Shell
    tab="about"
    navigateTo={navigateTo}
    title="About SwapSutra"
    summary="SwapSutra is a place to lend, swap, rent and sell books with readers near you — so a book you have finished can be read again instead of sitting on a shelf."
  >
    <S title="The idea">
      <p>Most of us own books we will not read again, and want books we do not own. SwapSutra puts those two facts next to each other. You list what is on your shelf, you see what is on shelves near you, and you arrange the exchange between yourselves.</p>
      <p>Nothing is shipped by us and nothing is warehoused. Readers meet, or post to each other, and the book keeps travelling.</p>
    </S>

    <S title="How it works">
      <UL items={[
        <><strong>Find a book near you.</strong> Browse what readers in your area have put up.</>,
        <><strong>Ask the owner.</strong> Borrow it, swap it, rent it or buy it — whatever that reader has offered.</>,
        <><strong>Put your own books up.</strong> Add books from your shelf so other readers can find you too.</>,
      ]} />
      <p>Your contact details are never shown publicly. Readers talk through SwapSutra until they choose to share more.</p>
    </S>

    <S title="What it costs">
      <p>Joining is free and stays free. When an exchange is accepted, each reader pays a <strong>₹10 platform fee</strong> — that is what keeps the site running. You can list up to 20 books free; listing more costs <strong>₹20, once</strong>.</p>
      <p>Money for a rented or sold book passes directly between the two readers. The one exception is a refundable security deposit on a temporary exchange — see our <Link to="refund-policy" navigateTo={navigateTo}>Refunds &amp; Deposits</Link> page for exactly how that is handled.</p>
    </S>

    <S title="Who runs it">
      <p>SwapSutra is operated by {L.entityName}, based in {L.city}.</p>
      <p>Questions, problems or ideas: <a href={`mailto:${L.supportEmail}`} className="font-bold text-brand-gold-text underline">{L.supportEmail}</a>. Complaints have their own route, set out on our <Link to="grievance" navigateTo={navigateTo}>Grievances</Link> page.</p>
    </S>

    <S title="The rules">
      <p>Using SwapSutra means agreeing to our <Link to="terms" navigateTo={navigateTo}>Terms of Use</Link>, and our <Link to="privacy" navigateTo={navigateTo}>Privacy Policy</Link> explains what we collect and why. Both are short, and worth the two minutes.</p>
    </S>

    {/* The footer is gone (22 Sep), so its contact line and social links
        live here — last on the page, after The rules. */}
    <S title="Contact & follow us">
      <p>
        Write to us at{' '}
        <a href={`mailto:${L.supportEmail}`} className="font-bold text-brand-gold-text underline">{L.supportEmail}</a>
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        {[
          ['Instagram', 'https://www.instagram.com/swapsutra/'],
          ['YouTube', 'https://www.youtube.com/channel/UCizJU_foEKhFBoXgTn0lsIg'],
          ['LinkedIn', 'https://www.linkedin.com/company/swapsutra/'],
          ['Facebook', 'https://www.facebook.com/profile.php?id=61589256513995'],
        ].map(([label, url]) => (
          <a key={label} href={url} target="_blank" rel="noopener noreferrer"
            className="rounded-full border border-brand-border px-4 py-2 text-sm font-semibold text-[var(--text-primary)] no-underline hover:border-brand-gold hover:text-brand-gold-text">
            {label}
          </a>
        ))}
      </div>
    </S>
  </Shell>
);

/** Renders the legal page for a tab. */
export const LegalPage = ({ tab, navigateTo }: { tab: LegalTab; navigateTo: Nav }) => {
  switch (tab) {
    case 'about': return <AboutPage navigateTo={navigateTo} />;
    case 'terms': return <TermsOfUsePage navigateTo={navigateTo} />;
    case 'refund-policy': return <RefundPolicyPage navigateTo={navigateTo} />;
    case 'grievance': return <GrievancePage navigateTo={navigateTo} />;
    default: return <PrivacyPolicyPage navigateTo={navigateTo} />;
  }
};

export default LegalPage;
