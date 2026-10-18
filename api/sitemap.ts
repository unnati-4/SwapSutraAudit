// Vercel Serverless Function — SwapSutra sitemap
//
// Generated from the live Library rather than kept as a static file, so a
// book listed this morning is discoverable today.
//
// Served at /api/sitemap and, since 18 Oct 2026, at /sitemap.xml too (a
// vercel.json rewrite). robots.txt allows this one path under /api/ — it
// used to block the whole of /api/, sitemap included.
//
// The public pages come from src/seo/pages.ts, the same list the build
// uses to write a real HTML page per route; book pages are rendered by
// api/book-page.ts. Every URL uses the one canonical host, www.swapsutra.in (Vercel sends swapsutra.in there).

import type { VercelRequest, VercelResponse } from '@vercel/node';

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
// The one canonical host. Kept in step with SITE_ORIGIN in src/seo/pages.ts
// (tests/test_seo.cjs checks) — a function here may import packages only.
const SITE_URL = 'https://www.swapsutra.in';

export const config = { maxDuration: 30 };

/** Public pages worth indexing — the inSitemap pages of src/seo/pages.ts (tests/test_seo.cjs checks they match). */
const STATIC_ROUTES: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/syllabus', changefreq: 'daily', priority: '0.9' },
  { path: '/plot', changefreq: 'daily', priority: '0.9' },
  { path: '/partners', changefreq: 'weekly', priority: '0.8' },
  { path: '/book-requests', changefreq: 'daily', priority: '0.6' },
  { path: '/reading-room', changefreq: 'daily', priority: '0.6' },
  { path: '/events', changefreq: 'weekly', priority: '0.7' },
  { path: '/readers-cafe', changefreq: 'daily', priority: '0.5' },
  { path: '/mugs', changefreq: 'weekly', priority: '0.5' },
  { path: '/campus-ambassador', changefreq: 'monthly', priority: '0.5' },
  { path: '/rituals', changefreq: 'monthly', priority: '0.4' },
  { path: '/support', changefreq: 'monthly', priority: '0.4' },
  { path: '/terms', changefreq: 'yearly', priority: '0.2' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.2' },
  { path: '/refund-policy', changefreq: 'yearly', priority: '0.2' },
  { path: '/grievance', changefreq: 'yearly', priority: '0.2' },
];

function xmlEscape(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoDate(value: unknown): string {
  const d = new Date(String(value || ''));
  return isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const entries: string[] = STATIC_ROUTES.map(r =>
    `  <url>\n    <loc>${xmlEscape(SITE_URL + r.path)}</loc>\n` +
    `    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority}</priority>\n  </url>`
  );

  // The Library, best-effort. A sitemap of the static pages is far better
  // than a 500, so a backend hiccup degrades rather than fails.
  if (APPS_SCRIPT_URL) {
    try {
      const url = new URL(APPS_SCRIPT_URL);
      url.searchParams.set('action', 'getBooks');
      const response = await fetch(url.toString());
      const text = await response.text();
      const books = JSON.parse(text);
      if (Array.isArray(books)) {
        for (const book of books) {
          const id = String(book?.id || '').trim();
          if (!id) continue;
          entries.push(
            `  <url>\n    <loc>${xmlEscape(SITE_URL + '/book/' + encodeURIComponent(id))}</loc>\n` +
            `    <lastmod>${isoDate(book.updatedAt || book.listedAt || book.createdAt)}</lastmod>\n` +
            `    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`
          );
        }
      }
    } catch (err) {
      console.error('[sitemap] Library fetch failed, serving static routes only:', err);
    }
  }

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.join('\n') +
    '\n</urlset>\n';

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  // One hour at the edge: fresh enough that a new listing is found the
  // same day, cheap enough that a crawler cannot hammer Apps Script.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(xml);
}
