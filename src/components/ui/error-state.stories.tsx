import type { Meta, StoryObj } from "@storybook/nextjs";
import { ErrorState, QueryErrorState } from "./error-state";

const meta: Meta<typeof ErrorState> = {
  title: "UI/ErrorState",
  component: ErrorState,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    title: {
      control: "text",
      description: "Error title",
    },
    message: {
      control: "text",
      description: "Error message details",
    },
    compact: {
      control: "boolean",
      description: "Compact inline display mode",
    },
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ErrorState>;

export const Default: Story = {
  args: {
    title: "Failed to load data",
    message: "Unable to connect to the server. Please check your connection.",
    onRetry: () => alert("Retry clicked!"),
  },
};

export const NetworkError: Story = {
  args: {
    title: "Network Error",
    message: "Failed to fetch clusters. The server may be unavailable.",
    onRetry: () => alert("Retry clicked!"),
  },
};

export const AuthError: Story = {
  args: {
    title: "Authentication Required",
    message: "Your session has expired. Please log in again.",
  },
};

export const NoRetry: Story = {
  args: {
    title: "Permission Denied",
    message: "You don't have access to this resource.",
  },
};

export const Compact: Story = {
  args: {
    title: "Error",
    message: "Failed to load policy details",
    compact: true,
    onRetry: () => alert("Retry clicked!"),
  },
};

export const CompactInline: Story = {
  render: () => (
    <div className="rounded-lg border border-card-border bg-card p-4">
      <h3 className="text-lg font-semibold text-foreground mb-4">Policy Details</h3>
      <ErrorState
        title="Load Failed"
        message="Could not fetch policy configuration"
        compact
        onRetry={() => undefined}
      />
    </div>
  ),
};

export const QueryError: Story = {
  render: () => (
    <QueryErrorState
      error={new Error("Connection timeout after 30s")}
      refetch={() => alert("Refetch called!")}
    />
  ),
};

export const QueryErrorCompact: Story = {
  render: () => (
    <div className="rounded-lg border border-card-border bg-card p-4">
      <h3 className="text-lg font-semibold text-foreground mb-4">Clusters</h3>
      <QueryErrorState
        error={new Error("Failed to fetch cluster list")}
        refetch={() => undefined}
        compact
      />
    </div>
  ),
};
