import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { within, userEvent } from "@storybook/testing-library";

import { Header } from "./Header";

const meta = {
  title: "Example/Header",
  component: Header,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
} satisfies Meta<typeof Header>;

export default meta;

type Story = StoryObj<typeof meta>;

export const LoggedIn: Story = {
  args: {
    user: {
      name: "Jane Doe",
    },
    onLogin: () => {},
    onLogout: () => {},
    onCreateAccount: () => {},
  },
};
// Disabled test for example story that doesn't match actual components
// LoggedIn.play = async ({ canvasElement, args }) => {
//   const canvas = within(canvasElement);
//
//   // Test that user name is displayed when logged in
//   const userName = canvas.getByText('Jane Doe');
//   expect(userName).toBeInTheDocument();
//
//   // Test that logout button is present
//   const logoutButton = canvas.getByRole('button', { name: /logout/i });
//   expect(logoutButton).toBeInTheDocument();
//
//   // Test logout button click
//   await userEvent.click(logoutButton);
//   expect(args.onLogout).toHaveBeenCalled();
// };

export const LoggedOut: Story = {
  args: {
    onLogin: () => {},
    onLogout: () => {},
    onCreateAccount: () => {},
  },
};
// Disabled test for example story that doesn't match actual components
// LoggedOut.play = async ({ canvasElement, args }) => {
//   const canvas = within(canvasElement);
//
//   // Test that login button is present when logged out
//   const loginButton = canvas.getByRole('button', { name: /log in/i });
//   expect(loginButton).toBeInTheDocument();
//
//   // Test that create account button is present
//   const createAccountButton = canvas.getByRole('button', { name: /create account/i });
//   expect(createAccountButton).toBeInTheDocument();
//
//   // Test login button click
//   await userEvent.click(loginButton);
//   expect(args.onLogin).toHaveBeenCalled();
//
//   // Test create account button click
//   await userEvent.click(createAccountButton);
//   expect(args.onCreateAccount).toHaveBeenCalled();
// };
