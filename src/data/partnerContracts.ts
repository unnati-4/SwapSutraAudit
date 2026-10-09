/**
 * SwapSutra partner agreements (9 Oct 2026) — one per partner type.
 *
 * The partner reads the agreement for their type on /partners and signs it
 * by typing their full name; Apps Script records the version, the name and
 * the time (PARTNER_CONTRACT_VERSIONS there must equal `version` here —
 * tests/test_partner_pages.cjs checks it). The same text is published in
 * legal/partner-agreement-<type>.md.
 *
 * Owner's rules written into every agreement: separate registration and
 * documents; 2% commission on every payout (0% for the first year when
 * SwapSutra approves a partner commission-free); payouts monthly; no ₹10
 * platform fee for the partner (a buyer still pays it); promotion free for
 * 6 months, then ₹100 for every 2 months; shipping and delivery are the
 * partner's responsibility; buyer details stay with SwapSutra.
 *
 * Drafted for SwapSutra — have an advocate review it before relying on it.
 */

export type PartnerType = 'bookstore' | 'author' | 'publisher' | 'promoter';

export interface ContractSection { title: string; body: string[] }
export interface PartnerContract { type: PartnerType; version: string; title: string; party: string; sections: ContractSection[] }

const OPERATOR = 'Unnati Goyal, sole proprietor, trading as SwapSutra (Saharanpur, Uttar Pradesh, India; swapsutra@gmail.com)';

export const PARTNER_LABEL: Record<PartnerType, string> = { bookstore: 'Bookstore', author: 'Author', publisher: 'Publisher', promoter: 'Promoter' };

const PARTY: Record<PartnerType, string> = {
  bookstore: 'the bookstore named in the registration, acting through its owner or authorised person ("the Bookstore")',
  author: 'the author named in the registration ("the Author")',
  publisher: 'the publisher or imprint named in the registration, acting through its authorised signatory ("the Publisher")',
  promoter: 'the promoter or agency named in the registration ("the Promoter")',
};
const YOU: Record<PartnerType, string> = { bookstore: 'the Bookstore', author: 'the Author', publisher: 'the Publisher', promoter: 'the Promoter' };

/** What each type does on SwapSutra (clause 1). */
const SCOPE: Record<PartnerType, string[]> = {
  bookstore: [
    'The Bookstore may list books for sale, rent or loan on SwapSutra without the 20-book limit that applies to readers, and must keep the number of copies in stock (inventory) correct for every listing.',
    'The Bookstore may show its banner on the SwapSutra Library page and run ads, as set out in clause 6.',
  ],
  author: [
    'The Author may list and sell copies of their own books, and promote their books, readings and events on SwapSutra.',
    'The Author confirms they hold the right to sell and promote every book they list, and that cover images and text they upload are theirs to use.',
  ],
  publisher: [
    'The Publisher may list and sell books it publishes or distributes, without a listing limit, keeping the number of copies in stock correct for every listing.',
    'The Publisher confirms it holds the publishing or distribution rights for every book it lists, and will list no pirated or unauthorised edition.',
  ],
  promoter: [
    'The Promoter may run ads and banners on SwapSutra for books, authors, bookstores or literary events it is authorised to promote, and may list books it is entitled to sell.',
    'The Promoter confirms it has the written permission of every author, publisher or business it promotes, and will produce that permission if SwapSutra asks.',
  ],
};

function sections(type: PartnerType): ContractSection[] {
  const you = YOU[type];
  return [
    { title: '1. What this agreement covers', body: [
      `This agreement is between ${OPERATOR} ("SwapSutra") and ${PARTY[type]}. It applies from the moment ${you} signs it on swapsutra.in, and takes effect when SwapSutra approves the registration.`,
      ...SCOPE[type],
      `${you} uses a partner account that is separate from any reader account, and is also bound by SwapSutra's Terms of Use, Privacy Policy, Community Guidelines and Refund & Security Deposit Policy. Where they differ, this agreement applies to ${you}'s partner activity.`,
    ] },
    { title: '2. Registration, documents and verification', body: [
      `${you} gives true and complete details: the name the business or work is registered in, the owner's or signatory's PAN, a masked Aadhaar (only the last 4 digits visible), ${type === 'bookstore' || type === 'publisher' ? 'a business proof (GST certificate, shop & establishment registration, Udyam or trade licence), ' : ''}contact details and${type === 'bookstore' || type === 'publisher' ? ' the business location' : ' location (optional)'}.`,
      'SwapSutra keeps these documents in private storage, uses them only to verify the partner, to pay them and to meet legal requirements, and does not show them to readers. Only the last 4 digits of the Aadhaar number are kept as text.',
      `${you} must tell SwapSutra within 7 days if any of these details change. SwapSutra may ask for fresh documents at any time and may pause the account until they are given.`,
    ] },
    { title: '3. Selling, orders and stock', body: [
      `Buyers pay SwapSutra through the site. SwapSutra holds the money until the buyer has received the book and closed the purchase (or 7 days after receipt with no problem reported), as set out in the Refund & Security Deposit Policy.`,
      `${you} keeps every listing accurate — title, edition, condition, price and the number of copies in stock — and marks a book out of stock as soon as it is no longer available. An order ${you} cannot fulfil must be cancelled in the exchange room straight away; repeated cancellations may lead to suspension.`,
      'Every order runs in its exchange room: the condition video, packaging video, courier name and tracking ID, and the steps the room asks for must be completed within the times it shows.',
    ] },
    { title: '4. Shipping and delivery are the partner\'s responsibility', body: [
      `${you} is responsible for packing, shipping and delivering every order — choosing the courier, paying the shipping cost unless the listing says otherwise, entering the courier name and tracking ID, and making sure the book reaches the buyer in the condition shown.`,
      `Loss or damage in transit, delays and courier disputes are between ${you} and the courier. If a book does not arrive, or arrives damaged or different from the listing, SwapSutra may refund the buyer from the money it holds for that order, and ${you} is not paid for it.`,
      `SwapSutra gives ${you} only what is needed to post an order — the recipient's name, delivery address, pincode and phone number. ${you} may use these only to deliver that order and must not keep, share or use them for marketing or any other purpose.`,
    ] },
    { title: '5. Fees, commission and monthly payouts', body: [
      `${you} pays no ₹10 platform fee on any exchange. Buyers still pay SwapSutra's ₹10 platform fee on each purchase.`,
      `SwapSutra keeps a commission of 2% of every payout to ${you} (the sale price of each book sold, and the rent of each book rented). The commission is deducted before payment.`,
      `If SwapSutra approves ${you} "commission-free", no commission is charged on payouts for the first 12 months from the date of approval; from the 13th month the 2% commission applies.`,
      `Payouts are made monthly: the money for orders closed in a calendar month is paid after that month ends, usually within the first 10 days of the next month, to the UPI ID ${you} saves in the partner dashboard. The dashboard shows every order, the commission kept and what was paid.`,
      `${you} is responsible for its own taxes (including GST where it applies) on its sales. SwapSutra may change the commission rate or the fees with at least 30 days' notice by email; ${you} may end this agreement before the change applies.`,
    ] },
    { title: '6. Banner and ads (promotion)', body: [
      `${you} chooses whether to show a banner on the SwapSutra Library page and whether to run ads, and can change this at any time in the dashboard. Every banner and ad is checked by SwapSutra before it shows and is always labelled "Sponsored" with the SwapSutra logo.`,
      'Promotion is free for the first 6 months from approval. After that it costs ₹100 for every 2 months, paid in advance by UPI to SwapSutra and verified by SwapSutra. If it is not paid, the banner and ads stop showing until it is; nothing else about the account changes.',
      `${you} confirms that every banner and ad is true, is its own to publish (images, logos, text), and does not mislead readers. SwapSutra may refuse, pause or remove any banner or ad, with a reason.`,
    ] },
    { title: '7. Conduct', body: [
      `${you} lists only genuine, legally sold copies — no pirated, counterfeit or unauthorised editions — and describes each book honestly.`,
      `${you} does not contact buyers outside SwapSutra to take a sale off the site, does not ask buyers for their personal details, and treats readers courteously.`,
      'SwapSutra may suspend or end a partner account for a breach of this agreement or of the Community Guidelines, after telling the partner why (or at once for fraud, piracy or a risk to readers).',
    ] },
    { title: '8. Ending the agreement', body: [
      `Either side may end this agreement with 15 days' notice by email. ${you} must complete or cancel open orders; SwapSutra pays what is due for completed orders with the next monthly payout, less any commission and any refund owed to buyers.`,
      'Unpaid promotion fees are not refundable once the promotion period has started.',
    ] },
    { title: '9. Liability, privacy and law', body: [
      `SwapSutra provides the platform. It is not the seller of ${you}'s books and is not liable for the books, their delivery, or ${you}'s dealings with couriers. Each side's liability to the other is limited to the commission and fees SwapSutra received from ${you} in the 3 months before the claim, except for fraud.`,
      'Personal data is handled under the Privacy Policy and the Digital Personal Data Protection Act, 2023.',
      'This agreement is governed by the laws of India. Disputes are first raised with SwapSutra\'s grievance officer (swapsutra@gmail.com); if not resolved in 30 days, the courts at Saharanpur, Uttar Pradesh have jurisdiction.',
    ] },
    { title: '10. Signature', body: [
      `By typing ${type === 'bookstore' || type === 'publisher' ? 'the owner\'s or authorised person\'s' : 'their'} full name and submitting the registration, ${you} signs this agreement electronically (Information Technology Act, 2000). SwapSutra records the name, the date and time and this agreement's version, and ${you} can see them in the partner dashboard.`,
    ] },
  ];
}

const VERSION_DATE = '2026-10-09';
export const PARTNER_CONTRACTS: Record<PartnerType, PartnerContract> = (['bookstore', 'author', 'publisher', 'promoter'] as PartnerType[])
  .reduce((acc, type) => {
    acc[type] = {
      type,
      version: `${type}-${VERSION_DATE}`,
      title: `SwapSutra ${PARTNER_LABEL[type]} Partner Agreement`,
      party: PARTY[type],
      // "the Bookstore" opens many sentences: capitalise it there.
      sections: sections(type).map((sec) => ({ ...sec, body: sec.body.map((p) => p.replace(/(^|[.;:] )the (Bookstore|Author|Publisher|Promoter)/g, '$1The $2')) })),
    };
    return acc;
  }, {} as Record<PartnerType, PartnerContract>);

/** The agreement as Markdown (what legal/partner-agreement-<type>.md holds). */
export function contractMarkdown(c: PartnerContract): string {
  return [
    `# ${c.title}`,
    '',
    `**Version:** ${c.version}`,
    '',
    '> Drafted for SwapSutra. Have an advocate review it before relying on it.',
    '',
    ...c.sections.flatMap((s) => [`## ${s.title}`, '', ...s.body.flatMap((p) => [p, '']),]),
  ].join('\n');
}
