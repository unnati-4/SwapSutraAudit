/**
 * Browser-side photo shrinking, shared by the listing form, swap proofs and
 * the custom mug enquiry (moved out of App.tsx on 30 Sep 2026 so /mugs can
 * reuse it without a second copy).
 */

// --- LISTING PHOTOS ---
//
// The listing form requires at least two photos and used to hard-reject
// any file over 1MB with no way forward. Every current phone camera
// produces 3-8MB images, so the typical reader photographed their book,
// was told "Image IMG_2043.jpg exceeds 1MB limit", and stopped. That was
// the real reason listings were scarce, well before anything about the
// Library's own filters.
//
// Photos are now downscaled and re-encoded in the browser before upload.
// A 1600px long edge is more than the Library ever displays, and JPEG at
// 0.82 keeps a book cover and its spine text perfectly legible while
// landing comfortably under the limit.
export const LISTING_PHOTO_MAX_EDGE = 1600;
// The size a listing photo is shrunk to before it is sent. Comfortably
// under the 600 KB the form asks for, so three photos plus a short video
// still fit in one request.
export const LISTING_PHOTO_TARGET_BYTES = 500 * 1024;
// Tried in order until one lands under the target: a little smaller and a
// little more compressed each time. 1000px still fills a phone screen.
const LISTING_PHOTO_STEPS: [number, number][] = [
  [1600, 0.82],
  [1600, 0.7],
  [1400, 0.62],
  [1200, 0.55],
  [1000, 0.5],
  [800, 0.45],
];

export const loadImageElement = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    // document.createElement, not the global Image constructor: this file
    // also imports an icon called Image, and after minification that name
    // won a scope fight with the browser's own. Every photo failed to shrink
    // (silently — the catch below returned the original), so full-size phone
    // photos went straight at the size limit and listings were refused at
    // the last step with a message the reader had already scrolled past.
    const img = document.createElement('img');
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode-failed')); };
    img.src = url;
  });
/**
 * Downscales a photo and hands back a File, ready to upload as bytes.
 *
 * It produces a file for a direct upload rather than base64, which would
 * cost a third more bytes for nothing.
 *
 * It never throws. Storage accepts a full-size phone photo, so a canvas
 * that cannot cooperate — an unusual codec, an out-of-memory on an old
 * phone — is a reason to upload the original, not a reason to refuse
 * somebody's book. Compression here is a courtesy to the reader's data
 * plan, not a gate.
 */
export const downscaleImageFile = async (file: File): Promise<File> => {
  if (typeof document === 'undefined' || !file.type.startsWith('image/')) return file;

  try {
    const img = await loadImageElement(file);

    const render = async (maxEdge: number, quality: number): Promise<File | null> => {
      const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      // White ground, so a transparent PNG does not flatten to black.
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob) return null;
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    };

    // Already small enough, and re-encoding would only lose detail.
    if (file.size <= LISTING_PHOTO_TARGET_BYTES
      && Math.max(img.naturalWidth, img.naturalHeight) <= LISTING_PHOTO_MAX_EDGE) {
      return file;
    }

    // THE BUG THIS FIXES: one pass at a fixed size and quality was not
    // always enough. A dense photograph — a busy cover, a page of small
    // print, a phone that shoots at high quality — still came out over the
    // limit, and the listing was then refused at the very end with a red
    // line the reader had already scrolled past. Each step below is
    // visibly smaller than the last, so a photo that did not fit at one
    // setting fits at the next, and "add karo" simply works.
    let smallest: File | null = null;
    for (const [maxEdge, quality] of LISTING_PHOTO_STEPS) {
      const candidate = await render(maxEdge, quality);
      if (!candidate) continue;
      if (!smallest || candidate.size < smallest.size) smallest = candidate;
      if (candidate.size <= LISTING_PHOTO_TARGET_BYTES) return candidate;
    }
    // Nothing reached the target (a very unusual image). Send the smallest
    // version produced rather than the original, unless the original was
    // somehow smaller still.
    if (smallest && smallest.size < file.size) return smallest;
    return file;
  } catch {
    return file;
  }
};


/** A File as a data: URL (what the Apps Script upload path accepts). */
export const fileToDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read-failed'));
    reader.readAsDataURL(file);
  });
