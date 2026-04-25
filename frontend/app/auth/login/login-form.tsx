"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase";

type Mode = "signin" | "signup";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PW = 8;

function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

function passwordError(value: string): string | null {
  if (value.length < MIN_PW) {
    return `Password must be at least ${MIN_PW} characters`;
  }
  return null;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect");

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!isValidEmail(email)) {
      setError("Please enter a valid email address");
      return;
    }
    const pwErr = passwordError(password);
    if (pwErr) {
      setError(pwErr);
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo:
              typeof window !== "undefined"
                ? `${window.location.origin}/auth/callback`
                : undefined,
          },
        });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
        // New users land on /profile to set health conditions; the profile
        // row itself is created by the on_auth_user_created DB trigger.
        router.push("/profile");
        router.refresh();
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError("Invalid email or password");
        return;
      }
      router.push(redirectTo ?? "/");
      router.refresh();
    } catch (cause) {
      // Network failure / CORS / unexpected. Surface a friendly message and
      // keep the form alive so the user can retry.
      console.error("auth: unexpected sign-in failure", cause);
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setPending(true);
    try {
      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo:
            typeof window !== "undefined"
              ? `${window.location.origin}/auth/callback`
              : undefined,
        },
      });
      if (oauthError) {
        setError(oauthError.message);
        setPending(false);
      }
      // On success Supabase redirects the browser to Google; no further local
      // navigation needed.
    } catch (cause) {
      console.error("auth: unexpected oauth failure", cause);
      setError("Something went wrong. Please try again.");
      setPending(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        {mode === "signup" ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mt-1 text-sm text-zinc-600">
        {mode === "signup"
          ? "Sign up to personalize your food scores."
          : "Sign in to keep your scores personalized."}
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-8 flex flex-col gap-4"
        aria-describedby={error ? "auth-error" : undefined}
        noValidate
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-700">Email</span>
          <Input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            required
            disabled={pending}
            aria-label="Email"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-700">Password</span>
          <Input
            type="password"
            name="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            required
            minLength={MIN_PW}
            disabled={pending}
            aria-label="Password"
          />
          {mode === "signup" ? (
            <span className="text-xs text-zinc-500">
              At least {MIN_PW} characters.
            </span>
          ) : null}
        </label>

        {error ? (
          <p id="auth-error" role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={pending}>
          {pending
            ? "Working…"
            : mode === "signup"
              ? "Create account"
              : "Sign in"}
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200" />
        <span>or</span>
        <span className="h-px flex-1 bg-zinc-200" />
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={handleGoogle}
        disabled={pending}
        className="w-full"
      >
        Continue with Google
      </Button>

      <p className="mt-6 text-center text-sm text-zinc-600">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setError(null);
              }}
              className="font-medium text-zinc-900 underline-offset-4 hover:underline"
            >
              Sign in
            </button>
          </>
        ) : (
          <>
            New here?{" "}
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError(null);
              }}
              className="font-medium text-zinc-900 underline-offset-4 hover:underline"
            >
              Create an account
            </button>
          </>
        )}
      </p>

      <p className="mt-4 text-center text-xs text-zinc-500">
        <Link href="/" className="hover:text-zinc-700">
          Continue as guest
        </Link>
      </p>
    </>
  );
}
