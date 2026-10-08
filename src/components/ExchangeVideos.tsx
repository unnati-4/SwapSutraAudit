import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../config/runtime';

/**
 * VMS — video evidence for every book that travels (Oct 2026).
 *
 *   sender   QUALITY   the book's condition, before anyone pays
 *            PACKING   packing the book
 *            HANDOVER  handing it over (in person, or to the courier)
 *   receiver RECEIVING opening the parcel / checking the book
 *
 * The recorder runs in the app: it draws the camera onto a canvas with the
 * exchange's code and the date and time burned into every frame, so a
 * video can't be an old one or from another exchange. Where a browser
 * can't record that way, the phone's own camera is used instead (marked as
 * such for the reviewer). Videos travel in 2.5 MB pieces — one request
 * can't carry more than 4.5 MB — and the server passes each piece straight
 * on to Google Drive.
 */

const API_URL = apiUrl('/api/swapsutra');
const MAX_SECONDS = 90;
const MAX_BYTES = 80 * 1024 * 1024;

export type VmsKind = 'QUALITY' | 'PACKING' | 'HANDOVER' | 'RECEIVING';
export type VmsLeg = 'outbound' | 'counter' | 'return' | 'counter_return';

export interface VmsItem {
  side: 'sender' | 'receiver';
  kind: VmsKind;
  label: string;
  byYou: boolean;
  done: boolean;
  videos: { id: string; url: string; at: string; durationSec: number | null; recordedInApp: boolean }[];
}
export interface VmsLegState { leg: VmsLeg; youSend: boolean; youReceive: boolean; items: VmsItem[] }
export interface VmsState { routeMethod: string; legs: VmsLegState[]; stampCode: string; rule: string }

export const VMS_TITLES: Record<VmsKind, string> = {
  QUALITY: 'Book condition', PACKING: 'Packaging', HANDOVER: 'Handover', RECEIVING: 'Receiving / unboxing',
};

const HOW_TO: Record<VmsKind, string> = {
  QUALITY: 'Show the front and back cover, the spine, the corners, then flip through the pages slowly. Point out any marks.',
  PACKING: 'Show the book, then pack it in one continuous shot until the parcel is sealed. Show the sealed parcel (and the address label, if posting).',
  HANDOVER: 'Record the moment the book changes hands — giving it to the other reader at the meeting point, or handing the parcel to the courier with the receipt.',
  RECEIVING: 'Start recording BEFORE you open the parcel. Show it sealed, open it on camera, then show the book from every side.',
};

async function post(body: Record<string, unknown>) {
  const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

export async function fetchExchangeVideos(swapId: string): Promise<VmsState | null> {
  try {
    const d = await post({ action: 'getExchangeVideos', swapId });
    return d?.success ? d as VmsState : null;
  } catch { return null; }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)));
  return btoa(bin);
}

/** Uploads a video in pieces. onProgress gets 0..1. */
export async function uploadExchangeVideo(
  blob: Blob, swapId: string, leg: VmsLeg, kind: VmsKind,
  meta: { durationSec: number; recordedInApp: boolean },
  onProgress: (p: number) => void,
): Promise<{ ok: boolean; message?: string }> {
  const mimeType = (blob.type || 'video/mp4').split(';')[0];
  const start = await post({ action: 'vmsStartUpload', swapId, leg, kind, mimeType, sizeBytes: blob.size });
  if (!start?.success) return { ok: false, message: start?.message || 'Could not start the upload.' };
  const { uploadId, chunkBytes, totalChunks } = start as { uploadId: string; chunkBytes: number; totalChunks: number };
  for (let i = 0; i < totalChunks; i++) {
    const piece = blob.slice(i * chunkBytes, Math.min(blob.size, (i + 1) * chunkBytes));
    const data = toBase64(await piece.arrayBuffer());
    let r: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { r = await post({ action: 'vmsUploadChunk', uploadId, index: i, data }); } catch { r = null; }
      if (r?.success) break;
      if (r?.error === 'OUT_OF_ORDER') break;
      await new Promise(res => setTimeout(res, 1200 * (attempt + 1)));
    }
    if (!r?.success) return { ok: false, message: r?.message || 'The connection dropped during the upload. Please try again.' };
    onProgress((i + 1) / totalChunks);
  }
  const fin = await post({ action: 'vmsFinishUpload', uploadId, ...meta });
  return fin?.success ? { ok: true } : { ok: false, message: fin?.message || 'The video could not be saved.' };
}

function pickMime(): string {
  const options = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const m of options) { try { if ((window as any).MediaRecorder?.isTypeSupported?.(m)) return m; } catch { /* keep looking */ } }
  return '';
}

/** Full-screen recorder. Calls onDone with the recorded (or chosen) video. */
export function VideoRecorder({
  kind, stampCode, onDone, onCancel,
}: {
  kind: VmsKind;
  stampCode: string;
  onDone: (blob: Blob, meta: { durationSec: number; recordedInApp: boolean }) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number>(0);
  const startedAtRef = useRef<number>(0);
  const [phase, setPhase] = useState<'starting' | 'ready' | 'recording' | 'review' | 'fallback'>('starting');
  const [elapsed, setElapsed] = useState(0);
  const [preview, setPreview] = useState<{ blob: Blob; url: string; durationSec: number; recordedInApp: boolean } | null>(null);
  const [error, setError] = useState('');

  const stopAll = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const canRecord = !!navigator.mediaDevices?.getUserMedia && typeof (window as any).MediaRecorder !== 'undefined'
        && typeof (HTMLCanvasElement.prototype as any).captureStream === 'function' && !!pickMime();
      if (!canRecord) { setPhase('fallback'); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current!;
        v.srcObject = stream;
        v.muted = true;
        await v.play();
        const c = canvasRef.current!;
        const long = 720;
        const w = v.videoWidth || 1280, h = v.videoHeight || 720;
        const scale = Math.min(1, long / Math.max(w, h));
        c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        const ctx = c.getContext('2d')!;
        const draw = () => {
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const stamp = `SwapSutra · ${stampCode} · ${new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
          const fs = Math.max(12, Math.round(c.width / 42));
          ctx.font = `600 ${fs}px system-ui, sans-serif`;
          const pad = Math.round(fs * 0.5);
          const tw = ctx.measureText(stamp).width;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(pad, c.height - fs - pad * 3, tw + pad * 2, fs + pad * 2);
          ctx.fillStyle = '#fff';
          ctx.fillText(stamp, pad * 2, c.height - pad * 2 - Math.round(fs * 0.15));
          rafRef.current = requestAnimationFrame(draw);
        };
        draw();
        setPhase('ready');
      } catch {
        if (!cancelled) setPhase('fallback');
      }
    })();
    return () => { cancelled = true; stopAll(); };
  }, [stampCode, stopAll]);

  const start = () => {
    const c = canvasRef.current!;
    const out = (c as any).captureStream(30) as MediaStream;
    streamRef.current?.getAudioTracks().forEach(t => out.addTrack(t));
    const mime = pickMime();
    const rec = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: 1_200_000, audioBitsPerSecond: 64_000 });
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const durationSec = Math.round((Date.now() - startedAtRef.current) / 1000);
      const blob = new Blob(chunksRef.current, { type: mime.split(';')[0] });
      stopAll();
      setPreview({ blob, url: URL.createObjectURL(blob), durationSec, recordedInApp: true });
      setPhase('review');
    };
    recRef.current = rec;
    startedAtRef.current = Date.now();
    rec.start(1000);
    setPhase('recording');
    const tick = setInterval(() => {
      const s = Math.round((Date.now() - startedAtRef.current) / 1000);
      setElapsed(s);
      if (s >= MAX_SECONDS && rec.state === 'recording') rec.stop();
      if (rec.state !== 'recording') clearInterval(tick);
    }, 250);
  };

  const pickFile = (f: File | undefined) => {
    setError('');
    if (!f) return;
    if (!f.type.startsWith('video/')) { setError('Please choose a video.'); return; }
    if (f.size > MAX_BYTES) { setError('That video is over 80 MB. Record a shorter one (about a minute).'); return; }
    const url = URL.createObjectURL(f);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => setPreview({ blob: f, url, durationSec: Math.round(probe.duration || 0), recordedInApp: false });
    probe.onerror = () => setPreview({ blob: f, url, durationSec: 0, recordedInApp: false });
    probe.src = url;
    setPhase('review');
  };

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-3" role="dialog" aria-modal="true" aria-label="Record a video">
      <div className="w-full max-w-lg rounded-3xl bg-[var(--bg-surface)] p-4 space-y-3 max-h-[95vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-2xs font-bold uppercase tracking-widest text-brand-gold-text">{VMS_TITLES[kind]} video</p>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed mt-1">{HOW_TO[kind]}</p>
          </div>
          <button type="button" onClick={() => { recRef.current?.state === 'recording' && recRef.current.stop(); stopAll(); onCancel(); }}
            aria-label="Close" className="text-xl leading-none text-[var(--text-secondary)]">×</button>
        </div>

        {/* Live camera: the canvas is what gets recorded (camera + stamp). */}
        <video ref={videoRef} playsInline className="hidden" />
        {(phase === 'starting' || phase === 'ready' || phase === 'recording') && (
          <div className="relative overflow-hidden rounded-2xl bg-black">
            <canvas ref={canvasRef} className="block w-full h-auto" />
            {phase === 'starting' && <p className="absolute inset-0 flex items-center justify-center text-xs text-white">Opening the camera…</p>}
            {phase === 'recording' && (
              <span className="absolute top-2 left-2 rounded-full bg-red-600 px-2 py-0.5 text-2xs font-bold text-white tabular-nums">
                ● REC {elapsed}s / {MAX_SECONDS}s
              </span>
            )}
          </div>
        )}

        {phase === 'ready' && (
          <button type="button" onClick={start} className="w-full rounded-xl bg-red-600 py-3 text-xs font-bold uppercase tracking-widest text-white">Start recording</button>
        )}
        {phase === 'recording' && (
          <button type="button" onClick={() => recRef.current?.stop()} className="w-full rounded-xl bg-brand-brown py-3 text-xs font-bold uppercase tracking-widest text-white">Stop</button>
        )}

        {phase === 'fallback' && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              This browser can't record inside SwapSutra, so your phone's camera will open instead. Record a fresh video now — not one from your gallery.
            </p>
            <label className="block w-full cursor-pointer rounded-xl bg-red-600 py-3 text-center text-xs font-bold uppercase tracking-widest text-white">
              Open camera
              <input type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => pickFile(e.currentTarget.files?.[0])} />
            </label>
          </div>
        )}

        {phase === 'review' && preview && (
          <div className="space-y-2">
            <video src={preview.url} controls playsInline className="w-full rounded-2xl bg-black" />
            <p className="text-2xs text-[var(--text-secondary)]">{preview.durationSec ? `${preview.durationSec}s · ` : ''}{(preview.blob.size / 1048576).toFixed(1)} MB</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); onCancel(); }}
                className="flex-1 rounded-xl border border-brand-border py-3 text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Discard</button>
              <button type="button" onClick={() => onDone(preview.blob, { durationSec: preview.durationSec, recordedInApp: preview.recordedInApp })}
                className="flex-1 rounded-xl bg-brand-brown py-3 text-2xs font-bold uppercase tracking-widest text-white">Use this video</button>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
      </div>
    </div>
  );
}

/** The checklist for one leg: which videos exist, and buttons to record your own. */
export function ExchangeVideosPanel({
  swapId, leg, state, onChanged, disabled,
}: { swapId: string; leg: VmsLeg; state: VmsState | null; onChanged: () => void; disabled?: boolean }) {
  const [recording, setRecording] = useState<VmsKind | null>(null);
  const [progress, setProgress] = useState<{ kind: VmsKind; p: number } | null>(null);
  const [msg, setMsg] = useState('');
  const legState = state?.legs.find(l => l.leg === leg);
  if (!state || !legState) return null;

  const onRecorded = async (kind: VmsKind, blob: Blob, meta: { durationSec: number; recordedInApp: boolean }) => {
    setRecording(null);
    setMsg('');
    setProgress({ kind, p: 0 });
    const r = await uploadExchangeVideo(blob, swapId, leg, kind, meta, (p) => setProgress({ kind, p }));
    setProgress(null);
    setMsg(r.ok ? 'Video saved.' : (r.message || 'The video could not be saved.'));
    if (r.ok) onChanged();
  };

  return (
    <section className="p-4 rounded-2xl border border-brand-border/60 bg-[var(--bg-page)] space-y-3" aria-label="Exchange videos" data-testid="exchange-videos">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Videos for this book</p>
        <span className="text-2xs text-[var(--text-secondary)] font-mono">{state.stampCode}</span>
      </div>
      <ul className="space-y-2">
        {legState.items.map(it => (
          <li key={it.side + it.kind} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--bg-surface)] px-3 py-2">
            <span className="text-xs text-[var(--text-primary)] min-w-0">
              <span className={it.done ? 'text-emerald-700' : 'text-amber-700'}>{it.done ? '✓' : '○'}</span>{' '}
              {it.label.charAt(0).toUpperCase() + it.label.slice(1)}
              <span className="text-[var(--text-secondary)]"> · {it.byYou ? 'you' : it.side === 'sender' ? 'the sender' : 'the receiver'}</span>
            </span>
            <span className="flex items-center gap-2">
              {it.videos.map((v, i) => (
                <a key={v.id} href={v.url} target="_blank" rel="noopener noreferrer" className="text-2xs font-bold uppercase tracking-widest text-brand-gold-text underline">
                  Watch{it.videos.length > 1 ? ` ${i + 1}` : ''}
                </a>
              ))}
              {it.byYou && !disabled && (
                progress?.kind === it.kind ? (
                  <span className="text-2xs text-[var(--text-secondary)] tabular-nums" role="status">Uploading {Math.round(progress.p * 100)}%</span>
                ) : (
                  <button type="button" onClick={() => setRecording(it.kind)} disabled={!!progress}
                    className="rounded-lg bg-brand-brown px-3 py-1.5 text-2xs font-bold uppercase tracking-widest text-white disabled:opacity-50">
                    {it.done ? 'Re-record' : 'Record'}
                  </button>
                )
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-2xs text-[var(--text-secondary)] italic leading-relaxed">
        Every video is stamped with this exchange&rsquo;s code and the time. If anything is disputed, SwapSutra decides the security deposit from these videos.
      </p>
      {msg && <p className="text-xs text-[var(--text-secondary)]" role="status">{msg}</p>}
      {recording && (
        <VideoRecorder
          kind={recording}
          stampCode={state.stampCode}
          onCancel={() => setRecording(null)}
          onDone={(blob, meta) => onRecorded(recording, blob, meta)}
        />
      )}
    </section>
  );
}

/** Which of YOUR videos are still missing on a leg, for disabling buttons. */
export function missingForMe(state: VmsState | null, leg: VmsLeg, side: 'sender' | 'receiver'): VmsKind[] {
  const l = state?.legs.find(x => x.leg === leg);
  if (!l) return [];
  return l.items.filter(i => i.side === side && i.byYou && !i.done).map(i => i.kind);
}
