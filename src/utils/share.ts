/**
 * Share a SwapSutra link — with its picture when there is one.
 *
 * On phones this opens the system share sheet (WhatsApp, Instagram,
 * Messages…). Where that isn't available (most desktops) the link — with
 * a line of text — is copied so it can be pasted anywhere.
 *
 * Images (owner's request, 23 Sep): anything shared that has a picture —
 * a shelf, a Reading Room post with a photo, a book — sends the picture as
 * an attachment too. Browsers only allow that when the image bytes are
 * readable, so photos on Google Drive go through our own relay
 * (/api/books?action=image), and the share itself has to happen straight
 * from a tap; see ShareSheet, which prepares the files first.
 */
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export const siteUrl = (path: string) =>
  (typeof window !== 'undefined' ? window.location.origin : 'https://swapsutra.in') + path;

export async function copyText(payload: string): Promise<boolean> {
  const nav: any = typeof navigator !== 'undefined' ? navigator : null;
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(payload);
      return true;
    }
  } catch { /* fall back below */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = payload;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export async function shareLink(opts: { title: string; text: string; url: string }): Promise<ShareResult> {
  const nav: any = typeof navigator !== 'undefined' ? navigator : null;
  if (nav?.share) {
    try {
      await nav.share({ title: opts.title, text: opts.text, url: opts.url });
      return 'shared';
    } catch (err: any) {
      if (err?.name === 'AbortError') return 'cancelled';
      // fall through to copying
    }
  }
  return (await copyText(`${opts.text}\n${opts.url}`)) ? 'copied' : 'failed';
}

// ── Images ──────────────────────────────────────────────────────────────

const driveId = (url: string): string | null => {
  const m = url.match(/drive\.google\.com\/(?:file\/d\/|thumbnail\?(?:[^#]*&)?id=|open\?(?:[^#]*&)?id=|uc\?(?:[^#]*&)?id=)([A-Za-z0-9_-]{10,})/)
    || url.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return m && /drive\.google\.com/.test(url) ? m[1] : null;
};

/** A URL the browser is allowed to read the bytes of. */
export function readableImageUrl(url: string): string {
  const u = String(url || '').trim();
  if (!u) return '';
  const id = driveId(u);
  if (id) return `/api/books?action=image&id=${id}`;
  return u;
}

const extFor = (type: string) => (/png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : /gif/.test(type) ? 'gif' : 'jpg');

/** Fetches an image as a File ready to attach, or null if it can't be read. */
export async function fetchImageFile(url: string, baseName: string): Promise<File | null> {
  const src = readableImageUrl(url);
  if (!src) return null;
  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(src, { signal: ctrl.signal, mode: 'cors', credentials: 'omit' });
    window.clearTimeout(t);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') || blob.size < 500) return null;
    return new File([blob], `${baseName}.${extFor(blob.type)}`, { type: blob.type });
  } catch {
    return null;
  }
}

export const canShareFiles = (files: File[]): boolean => {
  const nav: any = typeof navigator !== 'undefined' ? navigator : null;
  if (!files.length || !nav?.share || !nav?.canShare) return false;
  try { return !!nav.canShare({ files }); } catch { return false; }
};

/**
 * Shares files with the text. The link goes inside the text, because most
 * apps (WhatsApp among them) drop the separate `url` field when a file is
 * attached. Must be called straight from a tap.
 */
export async function shareFiles(opts: { title: string; text: string; url: string; files: File[] }): Promise<ShareResult> {
  const nav: any = navigator;
  try {
    await nav.share({ files: opts.files, title: opts.title, text: `${opts.text}\n${opts.url}` });
    return 'shared';
  } catch (err: any) {
    if (err?.name === 'AbortError') return 'cancelled';
    return 'failed';
  }
}

export function downloadFile(file: File) {
  const href = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = href;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 4000);
}
