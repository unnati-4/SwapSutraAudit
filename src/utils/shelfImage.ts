/**
 * Draws a reader's bookshelf as one picture to share (1080×1350, the
 * portrait size Instagram and WhatsApp show uncropped).
 *
 * Covers are the publisher's covers by ISBN (same-origin /api/books
 * route, so the canvas stays readable); a book with no cover falls back
 * to the reader's own photo through the Drive relay, and failing that to
 * a drawn cover with the title on it. Nothing here can taint the canvas:
 * every image is requested with crossOrigin, and one that refuses simply
 * fails to load and gets the drawn cover instead.
 */
import { shelfCoverUrl } from './bookCover';
import { readableImageUrl } from './share';

export type ShelfImageBook = { title: string; author?: string; isbn?: string; photo?: string };

const W = 1080;
const H = 1350;
const C = {
  page: '#F9F6F0',
  band: '#F2EBE1',
  ink: '#2D2925',
  brown: '#4A3B32',
  soft: '#7C6E65',
  rose: '#8E4A59',
  woodLight: '#B7804F',
  woodMid: '#8B5A32',
  woodDark: '#5A371D',
};
const SERIF = '"Cormorant Garamond", "Playfair Display", Georgia, serif';
const SANS = '"Source Sans 3", "Segoe UI", system-ui, sans-serif';

function loadImage(src: string, timeoutMs = 8000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const t = window.setTimeout(() => { img.src = ''; resolve(null); }, timeoutMs);
    img.onload = () => { window.clearTimeout(t); resolve(img.naturalWidth > 20 ? img : null); };
    img.onerror = () => { window.clearTimeout(t); resolve(null); };
    img.src = src;
  });
}

async function coverFor(book: ShelfImageBook): Promise<HTMLImageElement | null> {
  const fromIsbn = await loadImage(shelfCoverUrl(book.isbn));
  if (fromIsbn) return fromIsbn;
  return loadImage(readableImageUrl(book.photo || ''));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxW) { line = next; continue; }
    if (line) lines.push(line);
    line = w;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

const DRAWN_COVERS = ['#4A3B32', '#8E4A59', '#5A6B5D', '#3F4A63', '#7A5230'];

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, book: ShelfImageBook,
  x: number, y: number, w: number, h: number, i: number) {
  ctx.save();
  ctx.shadowColor = 'rgba(45, 30, 20, 0.38)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetX = 8;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = DRAWN_COVERS[i % DRAWN_COVERS.length];
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, w, h, 6);
  ctx.clip();
  if (img) {
    // object-fit: cover
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x + 12, y + 14, w - 24, 2);
    ctx.fillRect(x + 12, y + h - 16, w - 24, 2);
    ctx.fillStyle = '#F9F6F0';
    ctx.textAlign = 'center';
    const titleSize = Math.round(w / 7.5);
    ctx.font = `700 ${titleSize}px ${SERIF}`;
    const lines = wrap(ctx, book.title || 'Untitled', w - 28, 4);
    const top = y + h * 0.3;
    lines.forEach((l, k) => ctx.fillText(l, x + w / 2, top + k * titleSize * 1.12));
    if (book.author) {
      ctx.font = `500 ${Math.round(w / 13)}px ${SANS}`;
      ctx.globalAlpha = 0.8;
      const a = wrap(ctx, book.author, w - 28, 1)[0] || '';
      ctx.fillText(a, x + w / 2, y + h - 34);
      ctx.globalAlpha = 1;
    }
  }
  // spine hinge + sheen, like the shelf on the site
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.40)');
  g.addColorStop(0.06, 'rgba(0,0,0,0.08)');
  g.addColorStop(0.08, 'rgba(255,255,255,0.16)');
  g.addColorStop(0.13, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawPlank(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  const top = 16;
  const front = 12;
  const g1 = ctx.createLinearGradient(0, y, 0, y + top);
  g1.addColorStop(0, C.woodDark);
  g1.addColorStop(0.45, C.woodMid);
  g1.addColorStop(1, C.woodLight);
  ctx.fillStyle = g1;
  ctx.fillRect(x, y, w, top);
  ctx.save();
  ctx.shadowColor = 'rgba(90, 55, 29, 0.45)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 8;
  const g2 = ctx.createLinearGradient(0, y + top, 0, y + top + front);
  g2.addColorStop(0, C.woodMid);
  g2.addColorStop(1, C.woodDark);
  ctx.fillStyle = g2;
  ctx.fillRect(x, y + top, w, front);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(x, y + top, w, 2);
}

export async function buildShelfImage(opts: {
  name: string;
  books: ShelfImageBook[];
  link: string;
}): Promise<File> {
  try {
    await Promise.all([
      (document as any).fonts?.load?.(`700 72px ${SERIF}`),
      (document as any).fonts?.load?.(`600 28px ${SANS}`),
    ]);
  } catch { /* system fonts are fine */ }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // page
  ctx.fillStyle = C.page;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.band;
  ctx.fillRect(0, 0, W, 250);

  // header
  const first = (opts.name || '').trim().split(/\s+/)[0] || '';
  ctx.textAlign = 'center';
  ctx.fillStyle = C.rose;
  ctx.font = `700 22px ${SANS}`;
  if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '6px';
  ctx.fillText('SWAPSUTRA', W / 2, 78);
  if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '0px';
  ctx.fillStyle = C.brown;
  ctx.font = `700 76px ${SERIF}`;
  ctx.fillText(first ? `${first}'s Bookshelf` : 'My Bookshelf', W / 2, 162);
  ctx.fillStyle = C.soft;
  ctx.font = `500 28px ${SANS}`;
  const total = opts.books.length;
  ctx.fillText(`${total} book${total === 1 ? '' : 's'} on the shelf`, W / 2, 210);

  // shelf grid
  const cols = total <= 6 ? 3 : 4;
  const maxBooks = cols * 3;
  const shown = opts.books.slice(0, maxBooks);
  const rows = Math.max(1, Math.ceil(shown.length / cols));
  const areaTop = 285;
  const areaBottom = H - 150;
  const rowH = (areaBottom - areaTop) / Math.max(rows, 2);
  const coverH = Math.min(330, rowH - 62);
  const coverW = Math.round(coverH * 2 / 3);
  const colW = (W - 120) / cols;
  const covers = await Promise.all(shown.map(coverFor));
  const gridTop = areaTop + ((areaBottom - areaTop) - rowH * rows) / 2;

  for (let r = 0; r < rows; r++) {
    const plankY = gridTop + rowH * (r + 1) - 40;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= shown.length) break;
      const x = 60 + colW * c + (colW - coverW) / 2;
      drawCover(ctx, covers[i], shown[i], x, plankY - coverH, coverW, coverH, i);
    }
    drawPlank(ctx, 40, plankY, W - 80);
  }

  // footer
  ctx.textAlign = 'center';
  if (total > shown.length) {
    ctx.fillStyle = C.rose;
    ctx.font = `700 26px ${SANS}`;
    ctx.fillText(`+${total - shown.length} more on SwapSutra`, W / 2, H - 108);
  }
  ctx.fillStyle = C.brown;
  ctx.font = `700 34px ${SERIF}`;
  ctx.fillText('Swap, lend & discover books near you', W / 2, H - 62);
  ctx.fillStyle = C.soft;
  ctx.font = `600 24px ${SANS}`;
  const host = (() => { try { return new URL(opts.link).host.replace(/^www\./, ''); } catch { return 'swapsutra.in'; } })();
  ctx.fillText(host, W / 2, H - 26);

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the shelf.'))), 'image/jpeg', 0.9));
  const slug = (first || 'my').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return new File([blob], `${slug}-bookshelf-swapsutra.jpg`, { type: 'image/jpeg' });
}
