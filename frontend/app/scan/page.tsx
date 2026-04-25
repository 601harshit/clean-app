"use client"

import { useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"

import { BarcodeScanner } from "@/components/BarcodeScanner"

/**
 * /scan — wraps <BarcodeScanner /> and routes to /food/[barcode]
 * when a code is decoded. The detail page (T1.3) handles the
 * "barcode not found" empty state, so we trust whatever string
 * the decoder emits.
 */
export default function ScanPage() {
  const router = useRouter()

  const handleDecode = useCallback(
    (barcode: string) => {
      const trimmed = barcode.trim()
      if (!trimmed) return
      router.push(`/food/${encodeURIComponent(trimmed)}`)
    },
    [router],
  )

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-6 pt-12 pb-24">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
          Scan a barcode
        </h1>
        <p className="text-sm text-zinc-600">
          Point your camera at a product&rsquo;s barcode. We&rsquo;ll take you
          straight to its health score.
        </p>
      </header>

      <BarcodeScanner onDecode={handleDecode} />

      <p className="text-center text-xs text-zinc-500">
        Prefer to type it in?{" "}
        <Link href="/" className="underline hover:text-zinc-900">
          Search by name instead
        </Link>
        .
      </p>
    </div>
  )
}
