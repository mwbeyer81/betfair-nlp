import type { Meta, StoryObj } from "@storybook/react";
import { within, expect, fn } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { PermissionsScreen } from "./PermissionsScreen";
import type { PermissionsMatrix } from "../services/chatApi";

const BASE = "http://localhost:3000";

const ADMIN_ID = "6a5cd47b5b6d9dd065588d14";
const READER_ID = "6a5bddbd4a9def477578d406";
const PLAIN_ID = "6a5bca960a80839f4cad77b4";

// Three rows covering the three cell states: granted, inherited-from-admin,
// and not held.
const MATRIX: PermissionsMatrix = {
  permissions: [
    {
      key: "admin",
      label: "Admin",
      description:
        "Full access to every admin-only screen and endpoint, including the permissions matrix itself. Implies every other permission.",
      implies: ["data-sources:read"],
    },
    {
      key: "data-sources:read",
      label: "Data sources",
      description: "Read the Kaggle CSV vs The Racing API field comparison at /admin/data-sources.",
      implies: [],
    },
  ],
  accounts: [
    {
      id: ADMIN_ID,
      email: "matthewbeyer@hotmail.com",
      phone: null,
      stored: ["admin"],
      effective: ["admin", "data-sources:read"],
      isYou: true,
    },
    {
      id: READER_ID,
      email: "reader@backbet.co.uk",
      phone: null,
      stored: ["data-sources:read"],
      effective: ["data-sources:read"],
      isYou: false,
    },
    {
      id: PLAIN_ID,
      email: "matthew@backbet.co.uk",
      phone: null,
      stored: [],
      effective: [],
      isYou: false,
    },
  ],
};

const okHandler = http.get(`${BASE}/api/admin/permissions`, () =>
  HttpResponse.json({ success: true, data: MATRIX })
);

const meta: Meta<typeof PermissionsScreen> = {
  title: "Components/PermissionsScreen",
  component: PermissionsScreen,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: [okHandler] },
  },
  args: {
    navigate: fn(),
    isAuthenticated: true,
    onLogout: fn(),
    onBack: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const ScreenVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("permissions-screen")).toBeInTheDocument();
    await expect(canvas.findByTestId("permissions-matrix")).resolves.toBeInTheDocument();
  },
};

export const EveryAccountIsARow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("permissions-matrix");
    for (const account of MATRIX.accounts) {
      await expect(canvas.getByTestId(`permissions-row-${account.id}`)).toBeInTheDocument();
    }
  },
};

// The three cell states are the whole point of the matrix: a ticked cell can
// mean "granted" or "admin implies it", and those are different facts.
export const CellsDistinguishGrantedFromInherited: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("permissions-matrix");

    // Admin: stored directly.
    await expect(canvas.getByTestId(`permissions-cell-${ADMIN_ID}-admin`)).toHaveTextContent("●");
    // Data sources: held only because admin implies it.
    await expect(canvas.getByTestId(`permissions-cell-${ADMIN_ID}-data-sources:read`)).toHaveTextContent("○");
    // Reader: granted directly, and no admin.
    await expect(canvas.getByTestId(`permissions-cell-${READER_ID}-data-sources:read`)).toHaveTextContent("●");
    await expect(canvas.getByTestId(`permissions-cell-${READER_ID}-admin`)).toHaveTextContent("·");
    // Ordinary account: nothing at all.
    await expect(canvas.getByTestId(`permissions-cell-${PLAIN_ID}-admin`)).toHaveTextContent("·");
    await expect(canvas.getByTestId(`permissions-cell-${PLAIN_ID}-data-sources:read`)).toHaveTextContent("·");
  },
};

export const YourOwnPermissionsAreCalledOut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const you = await canvas.findByTestId("permissions-you");
    await expect(you).toHaveTextContent("matthewbeyer@hotmail.com");
    await expect(canvas.getByTestId("permissions-you-admin")).toHaveTextContent("Admin");
    // Marked as inherited, not as a separate grant.
    await expect(canvas.getByTestId("permissions-you-data-sources:read")).toHaveTextContent("via admin");
  },
};

export const LegendExplainsEachPermission: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("permissions-legend");
    await expect(canvas.getByTestId("permissions-definition-admin")).toHaveTextContent("Implies every other permission");
    await expect(canvas.getByTestId("permissions-definition-data-sources:read")).toHaveTextContent("Kaggle CSV");
  },
};

// The screen must never offer a way to grant a permission — that would be the
// single most valuable control on the site to anyone who got hold of a session.
export const GrantingIsExplainedAsCliOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const note = await canvas.findByTestId("permissions-grant-note");
    await expect(note).toHaveTextContent("yarn grant:permission");
    await expect(canvas.queryByRole("button", { name: /grant/i })).not.toBeInTheDocument();
  },
};

export const CountsAccounts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("permissions-account-count")).resolves.toHaveTextContent(
      "3 accounts · 2 with at least one permission"
    );
  },
};

export const LoadingState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/admin/permissions`, async () => {
          await new Promise(resolve => setTimeout(resolve, 10000));
          return HttpResponse.json({ success: true, data: MATRIX });
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("permissions-loading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("permissions-matrix")).not.toBeInTheDocument();
  },
};

export const ForbiddenStateForNonAdmin: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/admin/permissions`, () =>
          HttpResponse.json(
            { success: false, error: "Permission required", requiredPermission: "admin" },
            { status: 403 }
          )
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("permissions-forbidden")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("permissions-error")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("permissions-matrix")).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${BASE}/api/admin/permissions`, () =>
          HttpResponse.json({ success: false }, { status: 500 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId("permissions-error")).resolves.toBeInTheDocument();
    await expect(canvas.queryByTestId("permissions-forbidden")).not.toBeInTheDocument();
  },
};
