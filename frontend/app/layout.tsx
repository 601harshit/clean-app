import type { Metadata } from "next";
import Link from "next/link";
import { Geist } from "next/font/google";
import "./globals.css";

import { createClient } from "@/lib/supabase-server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clean. — Know what you eat.",
  description:
    "Personalized food health scores based on your conditions, with healthier alternatives.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
              {user ? (
                <form
                  action="/auth/sign-out"
                  method="post"
                  className="flex items-center gap-3"
                >
                  <span
                    data-testid="nav-user-email"
                    className="hidden max-w-[12rem] truncate text-zinc-500 sm:inline"
                    title={user.email ?? undefined}
                  >
                    {user.email}
                  </span>
                  <button
                    type="submit"
                    className="rounded-full border border-zinc-200 px-3 py-1 text-zinc-700 hover:bg-zinc-50"
                  >
                    Sign out
                  </button>
                </form>
              ) : (
                <Link
                  href="/auth/login"
                  className="rounded-full border border-zinc-900 bg-zinc-900 px-3 py-1 text-white hover:bg-zinc-800"
                >
                  Sign in
                </Link>
              )}
            </div>
          </nav>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
