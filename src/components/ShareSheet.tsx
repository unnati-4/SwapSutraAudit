/**
 * The share panel for anything that has a picture — a shelf, a Reading
 * Room post with a photo, a book.
 *
 * Why a panel and not a straight share: phones only let a page open the
 * share sheet right after a tap, and fetching or drawing the image takes
 * longer than that allowance. So the picture is prepared here first (with
 * a preview), and the Share button then hands it to the phone instantly —
 * the image goes as an attachment, the link rides in the text.
 *
 * Desktops mostly can't share files: there the panel offers "Save image"
 * and "Copy link" instead.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { canShareFiles, copyText, downloadFile, fetchImageFile, shareFiles, shareLink } from '../utils/share';

export default function ShareSheet({
  heading,
  title,
  text,
  url,
  images,
  makeImage,
  onClose,
}: {
  heading: string;
  title: string;
  text: string;
  url: string;
  /** Picture URLs to attach (Drive links are relayed so they can be read). */
  images?: string[];
  /** Or a picture drawn on the spot, e.g. the shelf image. */
  makeImage?: () => Promise<File>;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<File[] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      let out: File[] = [];
      try {
        if (makeImage) out = [await makeImage()];
        else if (images?.length) {
          const got = await Promise.all(images.slice(0, 4).map((u, i) => fetchImageFile(u, `swapsutra-${i + 1}`)));
          out = got.filter((f): f is File => !!f);
        }
      } catch { out = []; }
      if (alive) setFiles(out);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const previews = useMemo(() => (files || []).map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p)), [previews]);

  const ready = files !== null;
  const hasFiles = !!files?.length;
  const filesShareable = hasFiles && canShareFiles(files!);

  const doShare = async () => {
    if (busy) return;
    setBusy(true);
    setNote('');
    const r = filesShareable
      ? await shareFiles({ title, text, url, files: files! })
      : await shareLink({ title, text, url });
    setBusy(false);
    if (r === 'shared') { onClose(); return; }
    if (r === 'copied') setNote(hasFiles ? 'Link copied. Save the image to send it along.' : 'Link copied — paste it anywhere.');
    else if (r === 'failed') setNote('Sharing did not work here. Save the image and copy the link instead.');
  };

  const doCopy = async () => {
    setNote((await copyText(`${text}\n${url}`)) ? 'Link copied — paste it anywhere.' : 'Could not copy the link.');
  };

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-label={heading}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-t-3xl bg-[var(--bg-surface)] p-5 shadow-2xl sm:rounded-3xl"
        style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-serif text-xl text-[var(--text-primary)]">{heading}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full border border-brand-border text-[var(--text-secondary)]">✕</button>
        </div>

        <div className="flex min-h-[160px] items-center justify-center rounded-2xl border border-brand-border bg-[var(--bg-surface-inset,#F2EBE1)] p-2">
          {!ready && (
            <p className="flex items-center gap-2 text-xs text-[var(--text-secondary)]" role="status">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-gold/30 border-t-brand-gold" />
              Preparing the picture…
            </p>
          )}
          {ready && hasFiles && (
            <div className={`grid w-full gap-2 ${previews.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {previews.map((p, i) => (
                <img key={p} src={p} alt={`Picture ${i + 1} to share`} className="mx-auto max-h-[46vh] w-auto rounded-xl object-contain" />
              ))}
            </div>
          )}
          {ready && !hasFiles && (
            <p className="px-4 text-center text-xs text-[var(--text-secondary)]">The picture couldn't be loaded — the link will still be shared.</p>
          )}
        </div>

        <p className="mt-3 line-clamp-3 text-xs text-[var(--text-secondary)]">{text}</p>

        <div className="mt-4 grid grid-cols-1 gap-2">
          <button type="button" onClick={doShare} disabled={!ready || busy}
            className="btn-primary !py-3 text-xs uppercase tracking-widest disabled:opacity-60">
            {!ready ? 'Getting it ready…' : filesShareable ? 'Share with picture' : 'Share link'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => files?.forEach(downloadFile)} disabled={!hasFiles}
              className="btn-outline !py-3 text-2xs uppercase tracking-widest disabled:opacity-40">
              Save image
            </button>
            <button type="button" onClick={doCopy}
              className="btn-outline !py-3 text-2xs uppercase tracking-widest">
              Copy link
            </button>
          </div>
        </div>
        {note && <p role="status" className="mt-3 text-center text-xs font-semibold text-[var(--text-primary)]">{note}</p>}
      </div>
    </div>,
    document.body,
  );
}
