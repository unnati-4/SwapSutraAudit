// Vercel Serverless Function — a crawlable page for each listing (18 Oct 2026)
//
// /book/<id> used to return the app's empty shell with the site-wide title,
// so every listing looked like the same blank page to a search engine.
// This serves the same app (same scripts, so readers see nothing different)
// with the book's own title, description, canonical link, a short text
// summary, and Book + breadcrumb structured data.
//
// It never breaks the page: if the book cannot be found or anything fails,
// the plain app shell is served exactly as before.

import type { VercelRequest, VercelResponse } from '@vercel/node';

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const SITE_ORIGIN = 'https://www.swapsutra.in';

export const config = { maxDuration: 20 };

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonLd = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const yes = (v: unknown) => v === true || String(v).toUpperCase() === 'TRUE';

/** What a reader can do with the book, in words. */
export function bookModes(b: any): string[] {
  const m: string[] = [];
  if (yes(b.permanent_exchange) || yes(b.temporary_exchange)) m.push('swap');
  if (yes(b.lend)) m.push('borrow');
  if (yes(b.rent)) m.push('rent');
  if (yes(b.sell)) m.push('buy');
  return m;
}

export function firstImage(b: any): string {
  const raw = String(b.imageUrls || b.imageUrl || '').split('|').flatMap((p) => p.split(',')).map((u) => u.trim()).filter(Boolean)[0] || '';
  const drive = raw.match(/\/d\/([\w-]{20,})|[?&]id=([\w-]{20,})/);
  if (drive) return `https://drive.google.com/thumbnail?id=${drive[1] || drive[2]}&sz=w800`;
  return /^https:\/\//.test(raw) ? raw : `${SITE_ORIGIN}/swapsutra-logo.png`;
}

/** The app shell with this book's head and summary. Pure, so it can be tested. */
export function renderBookPage(shell: string, b: any): string {
  const id = String(b.id);
  const url = `${SITE_ORIGIN}/book/${encodeURIComponent(id)}`;
  const modes = bookModes(b);
  const verbs = modes.length ? modes.join(', ').replace(/, ([^,]*)$/, ' or $1') : 'request';
  const place = [b.area, b.city || b.serviceCity].filter(Boolean)[0] || '';
  const price = Number(b.ownerSellPrice || b.sellPrice) > 0 ? Number(b.ownerSellPrice || b.sellPrice) : 0;
  const title = `${b.title}${b.author ? ' by ' + b.author : ''} — ${verbs.charAt(0).toUpperCase() + verbs.slice(1)} on SwapSutra`;
  const description = `${b.title}${b.author ? ' by ' + b.author : ''}${b.condition ? ' (' + b.condition + ')' : ''}: ${verbs} this book${place ? ' in ' + place : ''} on SwapSutra${price ? ' — ₹' + price : ''}. Swap, lend, rent and buy books with readers near you.`.slice(0, 300);
  const image = firstImage(b);
  const isbn = String(b.isbn || '').replace(/[^0-9Xx]/g, '');
  const book: any = { '@context': 'https://schema.org', '@type': 'Book', name: b.title, url, image };
  if (b.author) book.author = { '@type': 'Person', name: b.author };
  if (isbn) book.isbn = isbn;
  if (b.genre) book.genre = b.genre;
  if (price) book.offers = { '@type': 'Offer', price: String(price), priceCurrency: 'INR', availability: 'https://schema.org/InStock', url, itemCondition: /new/i.test(String(b.condition || '')) ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition' };
  const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'SwapSutra', item: SITE_ORIGIN + '/' },
    { '@type': 'ListItem', position: 2, name: 'Library', item: SITE_ORIGIN + '/' },
    { '@type': 'ListItem', position: 3, name: String(b.title), item: url },
  ] };

  let html = shell;
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}" />`);
  html = html.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(title)}" />`);
  html = html.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(description)}" />`);
  html = html.replace(/<meta property="og:image" content="[^"]*"[^>]*>/, `<meta property="og:image" content="${esc(image)}" />`);
  html = html.replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${esc(title)}" />`);
  html = html.replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${esc(description)}" />`);
  html = html.replace(/<meta name="twitter:image" content="[^"]*"[^>]*>/, `<meta name="twitter:image" content="${esc(image)}" />`);
  html = html.replace('</head>', `<link rel="canonical" href="${url}" />
    <meta property="og:url" content="${url}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    ${jsonLd(book)}
    ${jsonLd(crumbs)}
  </head>`);
  const summary = `<div class="seo-shell" style="max-width:44rem;margin:0 auto;padding:1.5rem 1rem;font-family:system-ui,sans-serif">
      <nav aria-label="Breadcrumb"><a href="/">SwapSutra</a> › <a href="/">Library</a> › <span>${esc(b.title)}</span></nav>
      <main id="main-content">
        <h1>${esc(b.title)}${b.author ? ' by ' + esc(b.author) : ''}</h1>
        <img src="${esc(image)}" alt="${esc('Cover of ' + b.title + (b.author ? ' by ' + b.author : ''))}" width="240" height="320" style="max-width:240px;height:auto" />
        <p>${esc(description)}</p>
        ${b.genre ? `<p>Genre: ${esc(b.genre)}</p>` : ''}
        ${b.sellerName ? `<p>Listed by ${esc(b.sellerName)}.</p>` : ''}
        <p><a href="/">Browse more books near you</a> · <a href="/syllabus">Syllabus shelf</a> · <a href="/plot">Plot shelf</a></p>
      </main>
    </div>`;
  html = html.replace(/<div id="root">[\s\S]*?<\/div>\s*(?=<script|<\/body>)/, `<div id="root">${summary}</div>\n    `);
  return html;
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'swapsutra.in');
  const proto = String(req.headers['x-forwarded-proto'] || 'https');
  const id = String((req.query && (req.query.id as string)) || '').trim();
  let shell = '';
  try { shell = await fetchText(`${proto}://${host}/app.html`); }
  catch { res.setHeader('Location', '/library'); return res.status(302).send(''); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    if (!id || !APPS_SCRIPT_URL) throw new Error('no id');
    const u = new URL(APPS_SCRIPT_URL);
    u.searchParams.set('action', 'getBooks');
    const books = JSON.parse(await fetchText(u.toString()));
    const b = Array.isArray(books) ? books.find((x: any) => String(x?.id) === id) : null;
    if (!b) {
      // A listing that is gone: the app shows the Library; search engines are told to drop it.
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=600');
      return res.status(404).send(shell.replace('</head>', '<meta name="robots" content="noindex" />\n  </head>'));
    }
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(renderBookPage(shell, b));
  } catch (err) {
    console.error('[book-page] serving the plain shell:', err);
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
    return res.status(200).send(shell);
  }
}
