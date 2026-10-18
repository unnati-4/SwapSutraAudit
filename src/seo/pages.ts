/**
 * Search-engine facts for every public page (18 Oct 2026).
 *
 * One source for three things:
 *  - scripts/prerender-seo.ts writes a real HTML page per route at build
 *    time (title, description, canonical, one H1, text, links, JSON-LD),
 *    so a crawler gets content without running the app;
 *  - the app updates the title, description and canonical as the reader
 *    moves between pages (useSeoHead in App.tsx);
 *  - api/sitemap.ts lists the same paths.
 *
 * Keep the text true to what the page shows — Google compares them.
 */

export const SITE_ORIGIN = 'https://www.swapsutra.in';
export const SITE_NAME = 'SwapSutra';

export interface SeoFaq { q: string; a: string }
export interface SeoPage {
  path: string;
  /** Where this page's canonical points (defaults to its own path). */
  canonical?: string;
  title: string;
  description: string;
  h1: string;
  intro: string[];
  /** Name in breadcrumbs and in the site links. */
  label: string;
  /** Included in sitemap.xml. */
  inSitemap: boolean;
  changefreq?: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority?: string;
  faqs?: SeoFaq[];
}

/** Questions answered on the Support page (shown there, and as FAQ schema). */
export const SITE_FAQS: SeoFaq[] = [
  { q: 'What is SwapSutra?',
    a: 'SwapSutra is a community of readers in India. You can swap, lend, rent and buy physical books with readers near you, and bookstores, libraries, authors and publishers list their books here too.' },
  { q: 'Is SwapSutra free to join?',
    a: 'Yes. Joining is free and never expires, and you can list up to 20 books free.' },
  { q: 'How does a book swap work?',
    a: 'Ask for a book you like. If the owner accepts, an exchange room opens where you both pay a refundable deposit, then you hand the books over in person or by courier. The deposit comes back when the exchange is complete; SwapSutra keeps a ₹10 fee.' },
  { q: 'Can I buy or rent a book?',
    a: 'Yes. To buy, you pay SwapSutra the price plus ₹10, and the seller is paid after you have the book. To rent, you pay a refundable deposit plus ₹10, and the rent goes to the owner from the deposit.' },
  { q: 'Is my home address shown to other readers?',
    a: 'No. Your exact location is never shown publicly; it is only used to show you books nearby.' },
  { q: 'Can a bookstore, library, author or publisher join?',
    a: 'Yes. Partners register on the Partners page, list books without a limit and keep their stock up to date from their own dashboard.' },
];

export const SEO_PAGES: SeoPage[] = [
  { path: '/', label: 'Library', inSitemap: true, changefreq: 'daily', priority: '1.0',
    title: 'SwapSutra — Swap, Lend, Rent & Buy Second-Hand Books Near You',
    description: 'Swap, lend, rent and buy physical books with readers near you in India. Free to join — list up to 20 books, find second-hand novels and exam books nearby.',
    h1: 'Swap, lend, rent and buy books with readers near you',
    intro: [
      'SwapSutra is a reader-first library spread across homes in India. Every book on the shelf belongs to a reader, a bookstore or a library near you.',
      'Browse the Library, ask for a book, and pick it up in person or have it sent by courier. Joining is free.',
    ] },
  { path: '/library', canonical: '/', label: 'Library', inSitemap: false,
    title: 'Library — Second-Hand Books Near You | SwapSutra',
    description: 'Browse books listed by readers, bookstores and libraries near you. Swap, borrow, rent or buy them on SwapSutra.',
    h1: 'The SwapSutra Library',
    intro: ['Every book here belongs to a reader, a bookstore or a library near you. Filter by genre, condition or distance, and ask for the one you want.'] },
  { path: '/syllabus', label: 'Syllabus shelf', inSitemap: true, changefreq: 'daily', priority: '0.9',
    title: 'Second-Hand Exam & Textbooks Near You — Syllabus Shelf | SwapSutra',
    description: 'Second-hand textbooks and exam preparation books (JEE, NEET, UPSC, school and college) from readers near you. Swap, rent or buy them on SwapSutra.',
    h1: 'Syllabus shelf: textbooks and exam books near you',
    intro: ['Textbooks and exam-preparation books from students and readers near you — pass on the ones you have finished and find the ones you need.'] },
  { path: '/plot', label: 'Plot shelf', inSitemap: true, changefreq: 'daily', priority: '0.9',
    title: 'Used Novels & Story Books Near You — Plot Shelf | SwapSutra',
    description: 'Novels, fiction and story books from readers near you. Swap, borrow, rent or buy second-hand books on SwapSutra.',
    h1: 'Plot shelf: novels and stories near you',
    intro: ['Fiction, classics and stories from readers in your neighbourhood. Swap one you have read for one you have not.'] },
  { path: '/partners', label: 'Partners', inSitemap: true, changefreq: 'weekly', priority: '0.8',
    title: 'Sell Books on SwapSutra — Bookstores, Libraries, Authors & Publishers',
    description: 'Bookstores, libraries, authors and publishers: list books on SwapSutra without a limit, reach readers near you or across India, and track orders and payouts.',
    h1: 'SwapSutra for bookstores, libraries, authors and publishers',
    intro: [
      'Register as a partner to list your books without a limit, keep your stock up to date, and reach readers near you or all over India.',
      'Already a partner? Sign in on this page with your email to open your dashboard.',
    ] },
  { path: '/book-requests', label: 'Book requests', inSitemap: true, changefreq: 'daily', priority: '0.6',
    title: 'Ask for a Book — Book Requests | SwapSutra',
    description: 'Can\'t find a book? Ask for it on SwapSutra and readers nearby will see your request.',
    h1: 'Book requests',
    intro: ['Looking for a book nobody has listed yet? Ask for it here, and readers nearby who have it can answer.'] },
  { path: '/reading-room', label: 'Reading Room', inSitemap: true, changefreq: 'daily', priority: '0.6',
    title: 'Reading Room — What Readers Are Reading | SwapSutra',
    description: 'Book recommendations, shout-outs and current reads from the SwapSutra community of readers in India.',
    h1: 'The Reading Room',
    intro: ['Recommendations, shout-outs and what people are reading right now, from readers across SwapSutra.'] },
  { path: '/community', canonical: '/reading-room', label: 'Reading Room', inSitemap: false,
    title: 'Reading Room — What Readers Are Reading | SwapSutra',
    description: 'Book recommendations, shout-outs and current reads from the SwapSutra community of readers in India.',
    h1: 'The Reading Room',
    intro: ['Recommendations, shout-outs and what people are reading right now, from readers across SwapSutra.'] },
  { path: '/events', label: 'Events', inSitemap: true, changefreq: 'weekly', priority: '0.7',
    title: 'Book Club Meetups & Reader Events | SwapSutra',
    description: 'Reader circles, book club meetups and community events from SwapSutra. Come sit with fellow readers.',
    h1: 'Come sit with fellow readers',
    intro: ['Reader circles and meetups where people bring a book, talk about it and leave with a new one.'] },
  { path: '/readers-cafe', label: 'Readers\' Café', inSitemap: true, changefreq: 'daily', priority: '0.5',
    title: 'Readers\' Café — Chat With Readers | SwapSutra',
    description: 'Talk books with other readers on SwapSutra, and keep every exchange conversation in one place.',
    h1: 'Readers\' Café',
    intro: ['Conversations between readers — about books, and about the exchanges you are part of.'] },
  { path: '/mugs', label: 'Mugs', inSitemap: true, changefreq: 'weekly', priority: '0.5',
    title: 'Book Lover Coffee Mugs | SwapSutra',
    description: 'Coffee mugs for readers, from SwapSutra — including custom mugs made to order.',
    h1: 'Mugs for people who take their coffee personally',
    intro: ['Mugs for readers, and custom mugs made to order.'] },
  { path: '/campus-ambassador', label: 'Campus Ambassador', inSitemap: true, changefreq: 'monthly', priority: '0.5',
    title: 'Campus Ambassador Program | SwapSutra',
    description: 'Become a SwapSutra Campus Ambassador: bring book swapping to your college and build a reading community on campus.',
    h1: 'Become a SwapSutra Campus Ambassador',
    intro: ['Bring book swapping to your campus. Ambassadors start reader circles, help classmates pass on their books, and grow the community at their college.'] },
  { path: '/rituals', label: 'How it works', inSitemap: true, changefreq: 'monthly', priority: '0.4',
    title: 'How SwapSutra Works — The Ritual of Swapping',
    description: 'How swapping, lending, renting and buying books works on SwapSutra: deposits, fees, durations and community rules.',
    h1: 'The ritual of swapping',
    intro: ['Joining is free and never expires. This page sets out how exchanges work, what a deposit is for, and the rules every reader agrees to.'] },
  { path: '/support', label: 'Help', inSitemap: true, changefreq: 'monthly', priority: '0.4',
    title: 'Help & Support | SwapSutra',
    description: 'Answers to common questions about swapping, renting and buying books on SwapSutra, and how to reach the team.',
    h1: 'Need help?',
    intro: ['Answers to the questions readers ask most, and ways to reach the SwapSutra team by email, WhatsApp or the message form.'],
    faqs: SITE_FAQS },
  { path: '/terms', label: 'Terms of Use', inSitemap: true, changefreq: 'yearly', priority: '0.2',
    title: 'Terms of Use | SwapSutra', description: 'The terms that apply when you use SwapSutra to swap, lend, rent, buy or sell books.',
    h1: 'Terms of Use', intro: ['The rules for using SwapSutra, including exchanges, deposits, fees and community guidelines.'] },
  { path: '/privacy', label: 'Privacy Policy', inSitemap: true, changefreq: 'yearly', priority: '0.2',
    title: 'Privacy Policy | SwapSutra', description: 'What personal data SwapSutra collects, why, how long it is kept and how to ask for it to be deleted.',
    h1: 'Privacy Policy', intro: ['What SwapSutra collects, why it is needed, who sees it and how long it is kept.'] },
  { path: '/refund-policy', label: 'Refund Policy', inSitemap: true, changefreq: 'yearly', priority: '0.2',
    title: 'Refund & Security Deposit Policy | SwapSutra', description: 'How refundable deposits, fees and refunds work on SwapSutra.',
    h1: 'Refund and Security Deposit Policy', intro: ['How deposits are held and returned, which fees are kept, and when a refund is made.'] },
  { path: '/grievance', label: 'Grievance Officer', inSitemap: true, changefreq: 'yearly', priority: '0.2',
    title: 'Grievance Redressal | SwapSutra', description: 'How to raise a complaint with SwapSutra\'s Grievance Officer, and the timelines for a reply.',
    h1: 'Grievance redressal', intro: ['How to raise a complaint about content or an exchange, and how quickly SwapSutra replies.'] },
];

const byPath: Record<string, SeoPage> = Object.fromEntries(SEO_PAGES.map((p) => [p.path, p]));

/** The SEO facts for a URL path (trailing slash ignored), or null for a private page. */
export function seoForPath(path: string): SeoPage | null {
  const clean = (path || '/').replace(/\/+$/, '') || '/';
  return byPath[clean] || null;
}

export function canonicalUrl(page: SeoPage): string {
  const p = page.canonical || page.path;
  return SITE_ORIGIN + (p === '/' ? '/' : p);
}
