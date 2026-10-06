// ===================================================================
// Shrinking a photo before it is uploaded
// ===================================================================
// Why do this at all: a modern phone camera produces a 4-8 MB photo. If
// a Supplier with 200 products uploads all of them on shop 3G, that is
// over a gigabyte of data, and a large part of them will simply fail.
// The file is resized to 1280px and re-encoded as JPEG before it leaves
// the phone, so it arrives at about 150 KB.
//
// No library is used. The browser can do this by itself with a canvas,
// which is built in and free. Image libraries for resizing are usually
// paid or heavy.
//
// WHAT HAPPENS HERE, in plain words: the picture is drawn onto a hidden
// square canvas at a smaller size, and the canvas is then saved as an
// ordinary JPEG file. The original file is never sent.
// ===================================================================

/** Longest edge of the uploaded picture, in pixels. */
const MAX_EDGE = 1280

/** Stop trying to compress below this. Going smaller wastes time and
 *  the quality loss is not worth it. */
const TARGET_BYTES = 200 * 1024

/** We try progressively smaller quality before giving up. 0.8 is usually
 *  enough; below 0.5 a product photo starts looking visibly bad. */
const QUALITY_STEPS = [0.82, 0.72, 0.62, 0.52, 0.45]

import { supabase } from './supabase'

export interface PreparedImage {
  file: File
  width: number
  height: number
  /** True if we shrank it, false if it was already small enough. */
  resized: boolean
}

/**
 * Take a chosen photo and return a small version of it.
 *
 * Returns null if the browser cannot read the picture, which happens
 * with a few formats on older phones. The caller falls back to uploading
 * the original file, so a refused compression never blocks a save.
 */
export async function prepareImage(file: File): Promise<PreparedImage | null> {
  // Not an image, or an unsupported type. Let the storage layer decide.
  if (!file.type.startsWith('image/')) return null

  try {
    const bitmap = await loadImage(file)
    if (!bitmap) return null

    const { naturalWidth: w, naturalHeight: h } = bitmap

    // Already small enough and small enough in bytes: send it untouched.
    // Re-encoding a good photo only makes it worse.
    if (Math.max(w, h) <= MAX_EDGE && file.size <= TARGET_BYTES) {
      closeImage(bitmap)
      return { file, width: w, height: h, resized: false }
    }

    // Scale down so the longest edge becomes MAX_EDGE. Never scale up:
    // making a small picture bigger just wastes data.
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
    const targetW = Math.round(w * scale)
    const targetH = Math.round(h * scale)

    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      closeImage(bitmap)
      return null
    }

    // JPEG has no transparency, so without a white fill a transparent PNG
    // comes out with black corners after conversion.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, targetW, targetH)
    ctx.drawImage(bitmap, 0, 0, targetW, targetH)
    closeImage(bitmap)

    // Try each quality until small enough. toBlob is a promise-based
    // browser function, so this costs nothing extra to use.
    for (const quality of QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, quality)
      if (!blob) break
      if (blob.size <= TARGET_BYTES) {
        return {
          file: new File([blob], renameToJpg(file.name), {
            type: 'image/jpeg',
            lastModified: Date.now(),
          }),
          width: targetW,
          height: targetH,
          resized: true,
        }
      }
      // Keep the last blob in case none of them reach the target. A
      // slightly large picture is better than no picture.
      if (quality === QUALITY_STEPS[QUALITY_STEPS.length - 1]) {
        return {
          file: new File([blob], renameToJpg(file.name), {
            type: 'image/jpeg',
            lastModified: Date.now(),
          }),
          width: targetW,
          height: targetH,
          resized: true,
        }
      }
    }

    return null
  } catch {
    // Any failure here must never block saving a product. Returning null
    // tells the caller to upload the original.
    return null
  }
}

/** Load a File into something drawable. */
function loadImage(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

/** Free the memory a decoded image holds. On a cheap phone, keeping a
 *  dozen full-size photos in memory is enough to crash the tab. */
function closeImage(img: HTMLImageElement): void {
  // Setting the size to 0 is the reliable way to release the decoded
  // bitmap in every browser. close() only exists on ImageBitmap.
  img.src = ''
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
  })
}

/** "photo.png" becomes "photo.jpg". A .png extension on JPEG data
 *  confuses some servers about the content type. */
function renameToJpg(name: string): string {
  const base = name.replace(/\.[^.]*$/, '')
  return `${base || 'photo'}.jpg`
}

/**
 * Build the storage path for a photo.
 *
 * Format: <supplier id>/<random>.jpg
 *
 * The supplier id is the first folder, and the storage rules in
 * migration 010 use that folder to decide who may write the file. The
 * random part means two photos of the same product can never collide,
 * and the original filename is not used -- someone called their photo
 * "../../etc/passwd" and we are not going to store that.
 */
export function buildPhotoPath(supplierId: string, existing?: string | null): string {
  if (existing && existing.startsWith(`${supplierId}/`)) {
    return existing
  }
  // crypto.randomUUID is built into every browser that supports the rest
  // of this app. If it is missing, the Date fallback is still unique
  // enough for one person's photos.
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  return `${supplierId}/${random}.jpg`
}

/** Remove a stored photo. Failures are ignored on purpose: a leftover
 *  empty file costs a few kilobytes, but blocking a product save because
 *  an old photo would not delete would be much worse. */
export async function deletePhoto(path: string): Promise<void> {
  try {
    // A normal import, not `await import()`. The dynamic form was here
    // hoping to keep the database client out of the main bundle, but
    // almost every screen already imports it directly, so the dynamic
    // form split nothing and only made the build warn about it.
    await supabase.storage.from('product-photos').remove([path])
  } catch {
    // Nothing to do. The picture is not what the user came here to do.
  }
}