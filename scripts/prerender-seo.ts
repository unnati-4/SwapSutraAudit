/**
 * Writes a crawlable HTML page for every public route (18 Oct 2026).
 *
 *   npx tsx scripts/prerender-seo.ts      (runs after `vite build`)
 *
 * SwapSutra is a single-page app: without this, every URL served the same
 * empty <div id="root"> with the same title, so a search engine saw one
 * blank page many times over. For each page in src/seo/pages.ts this
 * writes dist/<path>/index.html with its own title, description,
 * canonical link, one H1, real text, links to the other public pages,
 * and JSON-LD (breadcrumbs, FAQ, the organisation). The app's scripts are
 * unchanged, so a visitor gets the full app as before — React replaces
 * this content as soon as it starts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SEO_PAGES, SITE_NAME, SITE_ORIGIN, canonicalUrl, type SeoPage } from '../src/seo/pages';

const dist = path.join(process.cwd(), 'dist');
const template = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonLd = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;

const linkPages = SEO_PAGES.filter((p) => p.inSitemap);

function structuredData(page: SeoPage): string {
  const out: string[] = [];
  const url = canonicalUrl(page);
  if (page.path === '/') {
    out.push(jsonLd({
      '@context': 'https://schema.org', '@type': 'Organization', name: SITE_NAME, url: SITE_ORIGIN + '/',
      logo: SITE_ORIGIN + '/swapsutra-logo.png', email: 'swapsutra@gmail.com',
      founder: { '@type': 'Person', name: 'Unnati Goyal' },
      address: { '@type': 'PostalAddress', addressLocality: 'Saharanpur', addressRegion: 'Uttar Pradesh', addressCountry: 'IN' },
    }));
    out.push(jsonLd({ '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: SITE_ORIGIN + '/', inLanguage: 'en-IN' }));
  } else {
    out.push(jsonLd({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE_NAME, item: SITE_ORIGIN + '/' },
        { '@type': 'ListItem', position: 2, name: page.label, item: url },
      ],
    }));
  }
  if (page.faqs?.length) {
    out.push(jsonLd({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: page.faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    }));
  }
  return out.join('\n    ');
}

function body(page: SeoPage): string {
  const crumbs = page.path === '/' ? '' :
    `<nav aria-label="Breadcrumb" class="seo-crumbs"><a href="/">${SITE_NAME}</a> › <span>${esc(page.label)}</span></nav>`;
  const faqs = page.faqs?.length
    ? `<section><h2>Questions readers ask</h2>${page.faqs.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}</section>` : '';
  const links = linkPages.map((p) => `<li><a href="${p.path}">${esc(p.label)}</a></li>`).join('');
  return `<div class="seo-shell">
      <header><a href="/" class="seo-brand"><img src="/swapsutra-logo.png" alt="SwapSutra logo" width="40" height="40" /> ${SITE_NAME}</a></header>
      <main id="main-content">
        ${crumbs}
        <h1>${esc(page.h1)}</h1>
        ${page.intro.map((p) => `<p>${esc(p)}</p>`).join('\n        ')}
        ${faqs}
      </main>
      <footer><nav aria-label="SwapSutra pages"><ul>${links}</ul></nav></footer>
    </div>`;
}

function render(page: SeoPage): string {
  const url = canonicalUrl(page);
  let html = template;
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(page.title)}</title>`);
  html = html.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(page.description)}" />`);
  html = html.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(page.title)}" />`);
  html = html.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(page.description)}" />`);
  html = html.replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${esc(page.title)}" />`);
  html = html.replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${esc(page.description)}" />`);
  html = html.replace(/(<meta property="og:image" content=")\/swapsutra-logo\.png/, `$1${SITE_ORIGIN}/swapsutra-logo.png`);
  html = html.replace(/(<meta name="twitter:image" content=")\/swapsutra-logo\.png/, `$1${SITE_ORIGIN}/swapsutra-logo.png`);
  const head = `<link rel="canonical" href="${url}" />
    <meta property="og:url" content="${url}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <style>.seo-shell{max-width:44rem;margin:0 auto;padding:1.5rem 1rem;font-family:'Source Sans 3',system-ui,sans-serif;color:#2d2925;line-height:1.6}.seo-shell h1{font-family:'Cormorant Garamond',Georgia,serif;font-size:2rem;line-height:1.2}.seo-shell a{color:#7a2e3a}.seo-shell footer ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:.5rem 1rem}.seo-brand{display:inline-flex;align-items:center;gap:.5rem;font-weight:700;text-decoration:none}</style>
    ${structuredData(page)}
  </head>`;
  html = html.replace('</head>', head);
  html = html.replace(/<div id="root"><\/div>/, `<div id="root">${body(page)}</div>`);
  return html;
}

let n = 0;
for (const page of SEO_PAGES) {
  const file = page.path === '/' ? path.join(dist, 'index.html') : path.join(dist, page.path.slice(1), 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, render(page));
  n++;
}
// The untouched shell for every other URL (the catch-all rewrite and /book/… pages).
fs.writeFileSync(path.join(dist, 'app.html'), template);
console.log(`prerender-seo: ${n} pages written`);
