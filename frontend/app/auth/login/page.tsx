import { Suspense } from "react";

import { LoginForm } from "./login-form";

export const metadata = {
  title: "Sign in — Clean.",
};

export default function LoginPage() {
  return (
    <div className="mx-auto w-full max-w-sm px-6 py-16">
      <Suspense fallback={<div className="text-sm text-zinc-500">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
