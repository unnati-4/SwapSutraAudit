import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { shelfCoverCandidates, shelfCoverUrl } from '../utils/bookCover';

/** Uploaded photo first; reference cover and placeholder only on failure. */
export default function ListingImage({ src, isbn, ...props }: ImgHTMLAttributes<HTMLImageElement> & { isbn?: unknown }) {
  const candidates = shelfCoverCandidates(isbn, src);
  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [src, isbn]);
  const current = candidates[Math.min(step, candidates.length - 1)];
  return <>
    <img {...props} src={current} onError={() => setStep(n => Math.min(n + 1, candidates.length - 1))} />
    {current === shelfCoverUrl(isbn) && <span className="pointer-events-none absolute bottom-1 left-1 right-1 z-[3] rounded bg-[#F2EBE1]/95 px-1 py-1 text-center text-[10px] leading-tight text-[#4A3B32]">Reference cover · edition may vary</span>}
  </>;
}
