# Feature Spec: Authentication

## Goal
Let users sign up / sign in so their health profile persists and scores are personalized.

## User Stories
- As a guest, I can use food search and scanning without an account; I see a generic score.
- As a new user, I can sign up with email + password or Google.
- As a returning user, I can sign in and immediately see personalized scores.
- As a signed-in user, I can sign out.

## Scope
- Email/password auth via Supabase Auth
- Google OAuth via Supabase Auth
- Session persistence via cookie (`@supabase/ssr`)
- Profile row auto-created on first sign-in (Supabase trigger)

## Out of Scope
- Forgot password (deferred — Supabase handles the email, add UI later)
- Apple Sign-In (Phase 2 mobile)

## Acceptance Criteria
- [ ] `/auth/login` page renders email + password form and Google button
- [ ] Successful email sign-up redirects to `/profile` (to set health conditions)
- [ ] Successful Google sign-in redirects to `/` (profile pre-filled with Google name)
- [ ] Invalid credentials show inline error: "Invalid email or password"
- [ ] Auth session survives page refresh (cookie-based via `@supabase/ssr`)
- [ ] Sign-out clears session and redirects to `/`
- [ ] `/profile` and `/history` redirect unauthenticated users to `/auth/login`
- [ ] A `profiles` row is created automatically on first sign-in (DB trigger or backend middleware)

## Implementation Notes
- Use `@supabase/ssr` with Next.js middleware to protect routes server-side
- Supabase trigger to auto-create `profiles` row:
  ```sql
  create or replace function public.handle_new_user()
  returns trigger as $$
  begin
    insert into public.profiles (id) values (new.id);
    return new;
  end;
  $$ language plpgsql security definer;

  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
  ```
- OAuth callback URL: `/auth/callback` — exchanges code for session via `supabase.auth.exchangeCodeForSession`

## Files to Create/Modify
- `frontend/app/auth/login/page.tsx` — login form
- `frontend/app/auth/callback/page.tsx` — OAuth callback handler
- `frontend/middleware.ts` — protect `/profile` and `/history`
- `frontend/lib/supabase.ts` — browser Supabase client
- `frontend/lib/supabase-server.ts` — server Supabase client
- Supabase: run trigger SQL in dashboard
