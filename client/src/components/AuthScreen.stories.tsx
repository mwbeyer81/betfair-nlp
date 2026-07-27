import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { AuthScreen } from "./AuthScreen";

const BASE = "http://localhost:3000";

const loginHandlers = [
  http.post(`${BASE}/api/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.email === "matthew@backbet.co.uk" && body.password === "beyer") {
      return HttpResponse.json({ token: "fake.jwt.token", emailVerified: true });
    }
    return HttpResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }),
];

const signupHandlers = [
  http.post(`${BASE}/api/auth/signup`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.email === "taken@backbet.co.uk") {
      return HttpResponse.json({ error: "An account with that email already exists" }, { status: 409 });
    }
    return HttpResponse.json({ token: "fake.jwt.token", emailVerified: false }, { status: 201 });
  }),
];

const smsHandlers = [
  http.post(`${BASE}/api/auth/sms/send`, async ({ request }) => {
    const body = (await request.json()) as { phone: string };
    if (body.phone === "+10000000000") {
      return HttpResponse.json({ error: "Failed to send verification code" }, { status: 502 });
    }
    return HttpResponse.json({ success: true });
  }),
  http.post(`${BASE}/api/auth/sms/verify`, async ({ request }) => {
    const body = (await request.json()) as { phone: string; code: string };
    if (body.code === "000000") {
      return HttpResponse.json({ token: "fake.jwt.token", emailVerified: false });
    }
    return HttpResponse.json({ error: "Invalid or expired verification code" }, { status: 401 });
  }),
];

const meta: Meta<typeof AuthScreen> = {
  title: "Components/AuthScreen",
  component: AuthScreen,
  parameters: {
    layout: "centered",
    msw: { handlers: [...loginHandlers, ...signupHandlers, ...smsHandlers] },
  },
  tags: ["autodocs"],
  args: {
    onAuthenticated: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const RendersAtIphone12: Story = {
  parameters: { viewport: { defaultViewport: "iphone12" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("auth-email-input")).toBeInTheDocument();
    await expect(canvas.getByTestId("auth-password-input")).toBeInTheDocument();
    await expect(canvas.getByTestId("auth-login-button")).toBeInTheDocument();
  },
};

export const RendersAtLaptop: Story = {
  parameters: { viewport: { defaultViewport: "laptop" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("auth-email-input")).toBeInTheDocument();
    await expect(canvas.getByTestId("auth-password-input")).toBeInTheDocument();
    await expect(canvas.getByTestId("auth-login-button")).toBeInTheDocument();
  },
};

export const LoginFormByDefault: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("auth-email-input")).toBeInTheDocument();
    await expect(canvas.getByTestId("auth-password-input")).toBeInTheDocument();
    await expect(canvas.getByTestId("auth-login-button")).toBeInTheDocument();
    await expect(canvas.getByText("Log in to continue")).toBeInTheDocument();
  },
};

export const ToggleToSignupMode: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("auth-mode-toggle"));

    await expect(canvas.getByTestId("auth-signup-button")).toBeInTheDocument();
    await expect(canvas.getByText("Create your account")).toBeInTheDocument();
    await expect(canvas.queryByTestId("auth-login-button")).not.toBeInTheDocument();

    // Toggling back returns to the login form
    await userEvent.click(canvas.getByTestId("auth-mode-toggle"));
    await expect(canvas.getByTestId("auth-login-button")).toBeInTheDocument();
  },
};

// Each story below asserts on onAuthenticated call counts. meta.args's fn()
// is a single shared instance whose calls accumulate across every story in
// this file (the test runner doesn't reload between stories), so each of
// these gets its own fresh mock via a story-level args override.
export const LoginSucceeds: Story = {
  args: { onAuthenticated: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId("auth-email-input"), "matthew@backbet.co.uk");
    await userEvent.type(canvas.getByTestId("auth-password-input"), "beyer");
    await userEvent.click(canvas.getByTestId("auth-login-button"));

    await waitFor(() => expect(args.onAuthenticated).toHaveBeenCalledTimes(1));
  },
};

export const LoginFailsShowsError: Story = {
  args: { onAuthenticated: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId("auth-email-input"), "matthew@backbet.co.uk");
    await userEvent.type(canvas.getByTestId("auth-password-input"), "wrong-password");
    await userEvent.click(canvas.getByTestId("auth-login-button"));

    await expect(canvas.findByTestId("auth-error")).resolves.toHaveTextContent("Invalid email or password");
    await expect(args.onAuthenticated).not.toHaveBeenCalled();
  },
};

export const SignupSucceeds: Story = {
  args: { onAuthenticated: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("auth-mode-toggle"));
    await userEvent.type(canvas.getByTestId("auth-email-input"), "new.user@backbet.co.uk");
    await userEvent.type(canvas.getByTestId("auth-password-input"), "correct-horse-battery");
    await userEvent.type(canvas.getByTestId("auth-confirm-password-input"), "correct-horse-battery");
    await userEvent.click(canvas.getByTestId("auth-signup-button"));

    await waitFor(() => expect(args.onAuthenticated).toHaveBeenCalledTimes(1));
  },
};

export const SignupFailsForTakenEmail: Story = {
  args: { onAuthenticated: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("auth-mode-toggle"));
    await userEvent.type(canvas.getByTestId("auth-email-input"), "taken@backbet.co.uk");
    await userEvent.type(canvas.getByTestId("auth-password-input"), "correct-horse-battery");
    await userEvent.type(canvas.getByTestId("auth-confirm-password-input"), "correct-horse-battery");
    await userEvent.click(canvas.getByTestId("auth-signup-button"));

    await expect(canvas.findByTestId("auth-error")).resolves.toHaveTextContent("already exists");
    await expect(args.onAuthenticated).not.toHaveBeenCalled();
  },
};

export const ConfirmPasswordFieldOnlyInSignupMode: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("auth-confirm-password-input")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("auth-mode-toggle"));
    await expect(canvas.getByTestId("auth-confirm-password-input")).toBeInTheDocument();
  },
};

export const MismatchedConfirmPasswordShowsErrorAndDisablesSubmit: Story = {
  args: { onAuthenticated: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("auth-mode-toggle"));
    await userEvent.type(canvas.getByTestId("auth-email-input"), "new.user@backbet.co.uk");
    await userEvent.type(canvas.getByTestId("auth-password-input"), "correct-horse-battery");
    await userEvent.type(canvas.getByTestId("auth-confirm-password-input"), "not-the-same");

    await expect(canvas.getByTestId("auth-confirm-password-error")).toHaveTextContent("don't match");
    // Disabled (not just visually) — a real click can't reach it, which is
    // exactly the guarantee this test cares about, so don't attempt one.
    await expect(canvas.getByTestId("auth-signup-button")).toBeDisabled();
    await expect(args.onAuthenticated).not.toHaveBeenCalled();
  },
};

export const MatchingConfirmPasswordClearsErrorAndEnablesSubmit: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("auth-mode-toggle"));
    await userEvent.type(canvas.getByTestId("auth-email-input"), "new.user@backbet.co.uk");
    await userEvent.type(canvas.getByTestId("auth-password-input"), "correct-horse-battery");
    await userEvent.type(canvas.getByTestId("auth-confirm-password-input"), "correct-horse-battery");

    await expect(canvas.queryByTestId("auth-confirm-password-error")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("auth-signup-button")).toBeEnabled();
  },
};

export const GoogleButtonHiddenWhenNotConfigured: Story = {
  // config.googleClientId is blank in every test/build environment here
  // (no Google Cloud project created yet) — confirms the button simply
  // doesn't render rather than rendering broken/empty.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("auth-google-button-container")).not.toBeInTheDocument();
  },
};

export const SignInWithPhoneLink: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("auth-use-phone")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("auth-use-phone"));

    await expect(canvas.getByTestId("auth-phone-input")).toBeInTheDocument();
    await expect(canvas.getByTestId("auth-phone-send-code")).toBeDisabled();
  },
};

export const PhoneSendCodeRequiresE164Format: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("auth-use-phone"));

    await userEvent.type(canvas.getByTestId("auth-phone-input"), "07911123456");
    await expect(canvas.getByTestId("auth-phone-send-code")).toBeDisabled();

    await userEvent.clear(canvas.getByTestId("auth-phone-input"));
    await userEvent.type(canvas.getByTestId("auth-phone-input"), "+447911123456");
    await expect(canvas.getByTestId("auth-phone-send-code")).toBeEnabled();
  },
};

export const PhoneSignInFullFlowSucceeds: Story = {
  args: { onAuthenticated: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("auth-use-phone"));
    await userEvent.type(canvas.getByTestId("auth-phone-input"), "+447911123456");
    await userEvent.click(canvas.getByTestId("auth-phone-send-code"));

    await expect(canvas.findByTestId("auth-sms-code-input")).resolves.toBeInTheDocument();
    await expect(canvas.getByTestId("auth-phone-verify-code")).toBeDisabled();

    await userEvent.type(canvas.getByTestId("auth-sms-code-input"), "000000");
    await userEvent.click(canvas.getByTestId("auth-phone-verify-code"));

    await waitFor(() => expect(args.onAuthenticated).toHaveBeenCalledTimes(1));
  },
};

export const PhoneSignInWrongCodeShowsError: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("auth-use-phone"));
    await userEvent.type(canvas.getByTestId("auth-phone-input"), "+447911123456");
    await userEvent.click(canvas.getByTestId("auth-phone-send-code"));

    await canvas.findByTestId("auth-sms-code-input");
    await userEvent.type(canvas.getByTestId("auth-sms-code-input"), "123456");
    await userEvent.click(canvas.getByTestId("auth-phone-verify-code"));

    await expect(canvas.findByTestId("auth-error")).resolves.toHaveTextContent("Invalid or expired");
  },
};

export const PhoneBackToLoginResetsState: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("auth-use-phone"));
    await userEvent.type(canvas.getByTestId("auth-phone-input"), "+447911123456");

    await userEvent.click(canvas.getByTestId("auth-back-to-login"));
    await expect(canvas.getByTestId("auth-email-input")).toBeInTheDocument();

    // Going back to phone mode should start fresh, not resume the old number.
    await userEvent.click(canvas.getByTestId("auth-use-phone"));
    await expect((canvas.getByTestId("auth-phone-input") as HTMLInputElement).value).toBe("");
  },
};
