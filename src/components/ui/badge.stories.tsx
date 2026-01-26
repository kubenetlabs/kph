import type { Meta, StoryObj } from "@storybook/nextjs";
import Badge from "./badge";

const meta: Meta<typeof Badge> = {
  title: "UI/Badge",
  component: Badge,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "success",
        "warning",
        "danger",
        "muted",
        "accent",
        "policyhub",
        "cilium",
        "tetragon",
        "gateway",
      ],
      description: "Visual style variant",
    },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: {
    children: "Default",
    variant: "default",
  },
};

export const Success: Story = {
  args: {
    children: "Connected",
    variant: "success",
  },
};

export const Warning: Story = {
  args: {
    children: "Pending",
    variant: "warning",
  },
};

export const Danger: Story = {
  args: {
    children: "Failed",
    variant: "danger",
  },
};

export const Muted: Story = {
  args: {
    children: "Draft",
    variant: "muted",
  },
};

export const Accent: Story = {
  args: {
    children: "New",
    variant: "accent",
  },
};

export const StatusBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="success">Connected</Badge>
      <Badge variant="warning">Pending</Badge>
      <Badge variant="danger">Failed</Badge>
      <Badge variant="muted">Draft</Badge>
    </div>
  ),
};

export const PolicyTypeBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="cilium">Cilium Network</Badge>
      <Badge variant="tetragon">Tetragon</Badge>
      <Badge variant="gateway">Gateway API</Badge>
      <Badge variant="policyhub">Policy Hub</Badge>
    </div>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="danger">Danger</Badge>
      <Badge variant="muted">Muted</Badge>
      <Badge variant="accent">Accent</Badge>
      <Badge variant="policyhub">PolicyHub</Badge>
      <Badge variant="cilium">Cilium</Badge>
      <Badge variant="tetragon">Tetragon</Badge>
      <Badge variant="gateway">Gateway</Badge>
    </div>
  ),
};
