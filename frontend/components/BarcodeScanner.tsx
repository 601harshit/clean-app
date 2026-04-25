"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser"
import { Camera, CameraOff } from "lucide-react"

import { Button } from "@/components/ui/button"

export type BarcodeScannerProps = {
  /**
   * Called once when a barcode has been successfully decoded.
   * The scanner stops itself before invoking this callback so the
   * camera stream is released and the parent can navigate away.
   */
  onDecode: (barcode: string) => void
  /**
   * Optional: auto-start the scanner on mount. Defaults to false so
   * the user has to click "Start scanning" — this keeps the camera
   * permission prompt tied to a user gesture (better UX + Safari
   * autoplay policy).
   */
  autoStart?: boolean
  className?: string
}

type Status = "idle" | "starting" | "scanning" | "denied" | "error"

/**
 * Browser-only barcode scanner backed by `@zxing/browser`'s
 * `BrowserMultiFormatReader`. Renders a video preview and a single
 * action button. On a successful decode, calls `onDecode(barcode)`
 * once and tears down the underlying media stream.
 *
 * Cleanup: the reader's `IScannerControls.stop()` is invoked on
 * unmount, on any restart, and after the first decode — so the
 * camera light goes off promptly.
 *
 * Permission denied: surfaces a clear inline message instead of a
 * console error. The user can retry via the "Try again" button.
 */
export function BarcodeScanner({
  onDecode,
  autoStart = false,
  className,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const decodedRef = useRef(false)
  const [status, setStatus] = useState<Status>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const stop = useCallback(() => {
    if (controlsRef.current) {
      try {
        controlsRef.current.stop()
      } catch {
        // best-effort cleanup; nothing actionable if stop throws
      }
      controlsRef.current = null
    }
  }, [])

  const start = useCallback(async () => {
    if (!videoRef.current) return
    // If something is already running, stop it before starting again.
    stop()
    decodedRef.current = false
    setErrorMessage(null)
    setStatus("starting")
    const reader = new BrowserMultiFormatReader()
    try {
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result, err, ctrl) => {
          if (decodedRef.current) return
          if (result) {
            decodedRef.current = true
            // Stop the live controls passed in the callback as well as
            // the cached ref — either may be the active one depending
            // on the @zxing/browser version.
            try {
              ctrl?.stop()
            } catch {
              // ignore
            }
            stop()
            setStatus("idle")
            onDecode(result.getText())
          }
          // err is expected on every frame that doesn't contain a code;
          // intentionally swallowed.
        },
      )
      controlsRef.current = controls
      setStatus("scanning")
    } catch (err) {
      const name = (err as { name?: string } | null)?.name
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setStatus("denied")
        setErrorMessage(
          "Camera permission was denied. Please enable camera access in your browser settings to scan a barcode.",
        )
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setStatus("error")
        setErrorMessage("No camera was found on this device.")
      } else {
        setStatus("error")
        setErrorMessage(
          (err as Error)?.message ||
            "Could not start the camera. Please try again.",
        )
      }
    }
  }, [onDecode, stop])

  // Auto-start once on mount if requested. Defer to a microtask so the
  // setState calls inside `start()` happen after the effect commits —
  // otherwise React's eslint rule (correctly) flags cascading renders.
  useEffect(() => {
    let cancelled = false
    if (autoStart) {
      queueMicrotask(() => {
        if (!cancelled) void start()
      })
    }
    return () => {
      cancelled = true
      stop()
    }
  }, [autoStart, start, stop])

  const isDenied = status === "denied"
  const isError = status === "error"
  const isScanning = status === "scanning" || status === "starting"

  return (
    <div className={`flex flex-col gap-4 ${className ?? ""}`}>
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-900">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          // muted + playsInline are required for inline preview on iOS.
          muted
          playsInline
          aria-label="Barcode scanner camera preview"
          data-testid="barcode-scanner-video"
        />
        {!isScanning && !isDenied && !isError ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-300">
            Camera preview will appear here
          </div>
        ) : null}
        {isScanning ? (
          <div
            className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-emerald-400/80 shadow-[0_0_12px_rgba(52,211,153,0.8)]"
            aria-hidden="true"
          />
        ) : null}
      </div>

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          data-testid="barcode-scanner-error"
        >
          {errorMessage}
        </div>
      ) : null}

      <div className="flex justify-center">
        {isScanning ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              stop()
              setStatus("idle")
            }}
          >
            <CameraOff aria-hidden="true" />
            <span>Stop scanning</span>
          </Button>
        ) : (
          <Button type="button" onClick={() => void start()}>
            <Camera aria-hidden="true" />
            <span>
              {isDenied || isError ? "Try again" : "Start scanning"}
            </span>
          </Button>
        )}
      </div>
    </div>
  )
}

export default BarcodeScanner
