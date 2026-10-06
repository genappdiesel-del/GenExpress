// ===================================================================
// Scanning a barcode with the phone camera
// ===================================================================
// WHAT THIS DOES: points the phone's back camera at a product and reads
// the barcode printed on it. The Agent is holding the product and
// scanning it instead of typing 13 digits on a small keyboard with one
// hand while holding a box.
//
// WHY IT IS LAZY-LOADED
//
// The scanning library is 12 MB on disk. A Supplier in a warehouse with
// two bars of signal should not download that just to open the products
// screen. So it is only fetched when somebody actually taps "Scan". The
// first download is a second or two on a good connection and a visible
// "loading" note on a slow one, which is a fair trade for everybody else
// never paying it.
//
// WHY NO LIBRARY IS INSTALLED FOR THE SMALL PART
//
// The only thing this needs from the library is to decode a barcode from
// a video stream, and there is no browser API for that. Everything else
// on this page is ordinary React.
//
// THREE THINGS THAT GO WRONG AND ARE HANDLED HERE
//
//  1. No camera, or permission refused. Happens on a desktop computer,
//     in a browser that blocks the camera, or when somebody taps Deny.
//     The bar stays usable: type the number instead.
//
//  2. Two different barcodes on screen. A shelf with several products in
//     view decodes whichever the camera happens to be pointing at, over
//     and over. We keep the first reading and ignore repeats until the
//     user moves the camera, which stops a flapping result.
//
//  3. A barcode that does not match anything in the app. The code itself
//     may be perfectly valid, it just is not one of our products. The
//     user is told that and the number stays in the box so they can act
//     on it.
// ===================================================================

import { useCallback, useEffect, useRef, useState } from 'react'

import { Loading } from '../ui'

export interface BarcodeScannerProps {
  /** Called once per scan, with the digits read from the barcode. */
  onScan: (code: string) => void
  /** Called when the camera is closed. */
  onClose: () => void
  language: 'id' | 'en'
}

/** Barcode formats worth listening for.
 *
 *  Products use EAN-13 and UPC-A. CODE_128 covers the printed labels we
 *  generate ourselves, and QR is included because some Suppliers use QR
 *  codes for their own internal labels.
 *
 *  Restricting the formats is not only tidier -- it makes the camera do
 *  less work, which matters on a cheap phone that is already struggling.
 *
 *  These names come from the library's own list of formats, so a typo
 *  here would be a runtime failure rather than a compile error. The cast
 *  below keeps that risk visible in the comment rather than hidden. */
const FORMAT_NAMES = [
  'EAN_13',
  'EAN_8',
  'UPC_A',
  'UPC_E',
  'CODE_128',
  'CODE_39',
  'ITF',
  'QR_CODE',
] as const

export function BarcodeScanner({ onScan, onClose, language }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Held in a ref, not state: the camera controls must survive re-renders
  // without being torn down and rebuilt, or the camera light stays on.
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const t = useCallback(
    (id: string, en: string) => (language === 'id' ? id : en),
    [language],
  )

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
  }, [])

  // Start the camera once, on mount.
  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        // Dynamic import. This is the 12 MB, and it is only fetched now.
        const { BrowserMultiFormatReader, BarcodeFormat } = await import(
          '@zxing/browser'
        )
        // DecodeHintType lives in the library underneath, and the browser
        // package does not re-export it, so it is imported directly. It is
        // an enum whose numeric value is what the reader matches against,
        // hence the numeric-keyed map below.
        const { DecodeHintType } = await import('@zxing/library')

        if (cancelled) return

        // Restrict to the formats we care about. Without this the reader
        // tries every format in existence on every frame, which is slow on
        // an old phone and picks up QR codes off random posters.
        const hints = new Map<number, unknown>()
        for (const name of FORMAT_NAMES) {
          const format = BarcodeFormat[name]
          if (format !== undefined) {
            hints.set(format, [DecodeHintType.POSSIBLE_FORMATS, [format]])
          }
        }

        const reader = new BrowserMultiFormatReader(hints)

        const controls = await reader.decodeFromVideoDevice(
          undefined, // the default back camera
          // The ref is empty on the very first render, and the library's
          // signature says `undefined` rather than `null`. Passing it
          // straight through would be a type error, and worse, would hand
          // the library nothing to attach the camera to.
          videoRef.current ?? undefined,
          (result) => {
            if (!result) return

            const code = result.getText()
            if (!code) return

            const now = Date.now()
            const previous = lastCodeRef.current

            // Ignore the same code read twice within a second and a half.
            // Without this the camera keeps re-reading the same label and
            // the result flashes over and over.
            if (previous && previous.code === code && now - previous.at < 1500) {
              return
            }

            lastCodeRef.current = { code, at: now }
            onScan(code)
          },
        )

        if (cancelled) {
          controls.stop()
          return
        }

        controlsRef.current = controls
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        setLoading(false)
        setError(describeCameraError(err, language))
      }
    }

    void start()

    // Always stop the camera when leaving. Leaving it running is the
    // difference between a green light that goes off and one that stays
    // on with nobody watching.
    return () => {
      cancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [onScan, language])

  function handleClose() {
    stopCamera()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-slate-950"
      role="dialog"
      aria-modal="true"
      aria-label={t('Pindai barcode', 'Scan barcode')}
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <h2 className="text-base font-bold">
          {t('Pindai barcode', 'Scan barcode')}
        </h2>
        <button
          type="button"
          onClick={handleClose}
          className="min-h-11 rounded-lg bg-white/15 px-3 text-sm font-medium"
        >
          {t('Tutup', 'Close')}
        </button>
      </header>

      <div className="relative flex-1 bg-black">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          // Muted and playsInline are required or the browser shows the
          // video with sound and refuses to play on iPhone.
          muted
          playsInline
        />

        {/* A frame over the middle of the picture. Purely to help someone
            aim the camera; the library reads the whole frame anyway. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="h-40 w-[70%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="text-white">
              <Loading label={t('Menyiapkan kamera...', 'Starting camera...')} />
            </div>
          </div>
        )}
      </div>

      {error ? (
        <div className="bg-white p-4">
          <p className="text-sm font-semibold text-danger-700">
            {t('Kamera tidak bisa dipakai', 'The camera cannot be used')}
          </p>
          <p className="mt-1 text-sm text-slate-600">{error}</p>
          <button
            type="button"
            onClick={handleClose}
            className="btn-secondary mt-3 w-full"
          >
            {t('Tutup dan ketik manual', 'Close and type it instead')}
          </button>
        </div>
      ) : (
        <p className="bg-white px-4 py-3 text-center text-sm text-slate-600">
          {t(
            'Arahkan kamera ke barcode pada produk.',
            'Point the camera at the barcode on the product.',
          )}
        </p>
      )}
    </div>
  )
}

/**
 * Turn a camera failure into a sentence with something to do about it.
 *
 * The raw errors are unhelpful and varied: "NotAllowedError",
 * "NotFoundError", "OverconstrainedError". Each one means the same
 * practical thing here -- there is no usable camera right now -- so the
 * person gets one explanation and one action.
 */
function describeCameraError(error: unknown, language: 'id' | 'en'): string {
  const raw =
    typeof error === 'string' ? error : ((error as Error)?.message ?? '')

  const denied = /notallowed|permission/i.test(raw)
  const missing = /notfound|no camera|devicesfound|overconstrained/i.test(raw)
  const insecure = /secure context|https/i.test(raw)

  if (language === 'id') {
    if (denied) {
      return 'Izin kamera ditolak. Untuk mengizinkan, buka pengaturan situs di browser lalu pilih Izinkan untuk Kamera. Anda juga bisa mengetik kode barcode secara manual.'
    }
    if (insecure) {
      return 'Kamera hanya bisa dipakai pada alamat yang aman (https). Anda bisa mengetik kode barcode secara manual.'
    }
    if (missing) {
      return 'Tidak ada kamera yang bisa dipakai di perangkat ini. Silakan ketik kode barcode secara manual.'
    }
    return 'Kamera gagal dibuka. Silakan ketik kode barcode secara manual.'
  }

  if (denied) {
    return 'Camera permission was refused. To allow it, open the site settings in your browser and choose Allow for Camera. You can also type the barcode by hand.'
  }
  if (insecure) {
    return 'The camera only works on a secure (https) address. You can type the barcode by hand instead.'
  }
  if (missing) {
    return 'No usable camera was found on this device. Please type the barcode by hand.'
  }
  return 'The camera could not be opened. Please type the barcode by hand instead.'
}