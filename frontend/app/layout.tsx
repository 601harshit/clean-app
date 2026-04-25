import type { Metadata } from "next";
import Link from "next/link";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clean. — Know what you eat.",
  description:
    "Personalized food health scores based on your conditions, with healthier alternatives.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white text-zinc-900">
        <header className="border-b border-zinc-200">
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link
              href="/"
              className="text-lg font-semibold tracking-tight text-zinc-900"
            >
              Clean.
            </Link>
            <div className="flex items-center gap-6 text-sm text-zinc-600">
              <Link href="/search" className="hover:text-zinc-900">
                Search
              </Link>
              <Link href="/history" className="hover:text-zinc-900">
                History
              </Link>
              <Link
                href="/profile"
                className="rounded-full border border-zinc-200 px-3 py-1 text-zinc-900 hover:bg-zinc-50"
              >
                Profile
              </Link>
            </div>
          </nav>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
