/**
 * LoginForm RTL tests — covers happy + sad + edge per global CLAUDE.md.
 *
 * The Supabase browser client is mocked: we only own the form behavior, and
 * we test that the form calls the right Supabase method with the right args
 * and reacts to its result (success → router.push, error → inline message).
 *
 * The real session flow is exercised end-to-end in e2e/auth.spec.ts against
 * the local Supabase instance (no mocks for things we own).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LoginForm } from "@/app/auth/login/login-form";

const pushMock = jest.fn();
const refreshMock = jest.fn();
const searchParamsGet = jest.fn<string | null, [string]>();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => ({ get: (key: string) => searchParamsGet(key) }),
}));

const signInWithPassword = jest.fn();
const signUp = jest.fn();
const signInWithOAuth = jest.fn();

jest.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
      signUp: (...args: unknown[]) => signUp(...args),
      signInWithOAuth: (...args: unknown[]) => signInWithOAuth(...args),
    },
  }),
}));

beforeEach(() => {
  pushMock.mockReset();
  refreshMock.mockReset();
  searchParamsGet.mockReset().mockReturnValue(null);
  signInWithPassword.mockReset();
  signUp.mockReset();
  signInWithOAuth.mockReset();
});

describe("LoginForm — render", () => {
  it("renders the email + password form and Google button (acceptance #1)", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
  });

  it("toggles to sign-up mode and back", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: /create an account/i }));
    expect(
      screen.getByRole("button", { name: /create account/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /sign in$/i }));
    expect(screen.getByRole("button", { name: /sign in$/i })).toBeInTheDocument();
  });
});

describe("LoginForm — sign in (happy path)", () => {
  it("calls signInWithPassword and redirects to / on success (acceptance #5 default)", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "correcthorse");
    await user.click(screen.getByRole("button", { name: /sign in$/i }));

    await waitFor(() => {
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "correcthorse",
      });
      expect(pushMock).toHaveBeenCalledWith("/");
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("respects the ?redirect= query param", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    searchParamsGet.mockImplementation((key) =>
      key === "redirect" ? "/profile" : null,
    );
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "correcthorse");
    await user.click(screen.getByRole("button", { name: /sign in$/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/profile"));
  });
});

describe("LoginForm — sign in (sad paths)", () => {
  it("shows 'Invalid email or password' on bad credentials (acceptance #4)", async () => {
    signInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrongpass1");
    await user.click(screen.getByRole("button", { name: /sign in$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /invalid email or password/i,
      );
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a friendly message on network failure", async () => {
    signInWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    // Silence the deliberate console.error from the catch block.
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "validpass1");
    await user.click(screen.getByRole("button", { name: /sign in$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /something went wrong/i,
      );
    });
    expect(pushMock).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("LoginForm — client-side validation (edge cases)", () => {
  it("rejects an obviously-invalid email format before hitting Supabase", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "not-an-email");
    await user.type(screen.getByLabelText(/password/i), "validpass1");
    // Bypass the browser's own email validation — we own the message.
    fireEvent.submit(screen.getByLabelText(/email/i).closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /please enter a valid email/i,
    );
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects a too-short password before hitting Supabase", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "short");
    fireEvent.submit(screen.getByLabelText(/email/i).closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /at least 8 characters/i,
    );
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("LoginForm — sign up (happy path)", () => {
  it("calls signUp with an emailRedirectTo and redirects to /profile (acceptance #2)", async () => {
    signUp.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: /create an account/i }));
    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.type(screen.getByLabelText(/password/i), "correcthorse");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(signUp).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "new@example.com",
          password: "correcthorse",
          options: expect.objectContaining({
            emailRedirectTo: expect.stringMatching(/\/auth\/callback$/),
          }),
        }),
      );
      expect(pushMock).toHaveBeenCalledWith("/profile");
    });
  });

  it("surfaces signUp errors inline (e.g. weak/duplicate)", async () => {
    signUp.mockResolvedValue({
      error: { message: "User already registered" },
    });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: /create an account/i }));
    await user.type(screen.getByLabelText(/email/i), "dup@example.com");
    await user.type(screen.getByLabelText(/password/i), "correcthorse");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /user already registered/i,
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("LoginForm — Google OAuth", () => {
  it("calls signInWithOAuth with provider 'google' and a callback redirectTo", async () => {
    signInWithOAuth.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(signInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "google",
          options: expect.objectContaining({
            redirectTo: expect.stringMatching(/\/auth\/callback$/),
          }),
        }),
      );
    });
  });

  it("surfaces OAuth errors inline", async () => {
    signInWithOAuth.mockResolvedValue({
      error: { message: "Provider not enabled" },
    });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: /continue with google/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /provider not enabled/i,
    );
  });
});
