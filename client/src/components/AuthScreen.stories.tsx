import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn, waitFor } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { AuthScreen } from "./AuthScreen";

const BASE = "http://localhost:3000";

const loginHandlers = [
  http.post(`${BASE}/api/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.email === "matthew@backbet.co.uk" && body.password === "beyer") {
      return HttpResponse.json({ token: "fake.jwt.token" });
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
    return HttpResponse.json({ token: "fake.jwt.token" }, { status: 201 });
  }),
];

const meta: Meta<typeof AuthScreen> = {
  title: "Components/AuthScreen",
  component: AuthScreen,
  parameters: {
    layout: "centered",
    msw: { handlers: [...loginHandlers, ...signupHandlers] },
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
    await userEvent.click(canvas.getByTestId("auth-signup-button"));

    await expect(canvas.findByTestId("auth-error")).resolves.toHaveTextContent("already exists");
    await expect(args.onAuthenticated).not.toHaveBeenCalled();
  },
};
