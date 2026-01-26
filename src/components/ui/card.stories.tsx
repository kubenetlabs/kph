import type { Meta, StoryObj } from "@storybook/nextjs";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./card";
import Button from "./button";
import Badge from "./badge";

const meta: Meta<typeof Card> = {
  title: "UI/Card",
  component: Card,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    hover: {
      control: "boolean",
      description: "Enables hover effect",
    },
    glow: {
      control: "select",
      options: [undefined, "primary", "accent", "policyhub"],
      description: "Glow effect style",
    },
  },
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  args: {
    children: (
      <>
        <CardHeader>
          <CardTitle>Card Title</CardTitle>
          <CardDescription>Card description goes here</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-foreground">Card content area</p>
        </CardContent>
      </>
    ),
  },
};

export const WithFooter: Story = {
  args: {
    children: (
      <>
        <CardHeader>
          <CardTitle>Create Policy</CardTitle>
          <CardDescription>Define a new network policy</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted">Fill in the policy details below.</p>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button variant="ghost">Cancel</Button>
          <Button>Save</Button>
        </CardFooter>
      </>
    ),
  },
};

export const Hoverable: Story = {
  args: {
    hover: true,
    children: (
      <>
        <CardHeader>
          <CardTitle>Clickable Card</CardTitle>
          <CardDescription>Hover to see the effect</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-foreground">This card has a hover state</p>
        </CardContent>
      </>
    ),
  },
};

export const WithGlow: Story = {
  args: {
    glow: "policyhub",
    children: (
      <>
        <CardHeader>
          <CardTitle>Featured</CardTitle>
          <CardDescription>With glow effect</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-foreground">This card has a cyan glow</p>
        </CardContent>
      </>
    ),
  },
};

export const ClusterCard: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>production-us-east</CardTitle>
            <CardDescription>AWS EKS • us-east-1</CardDescription>
          </div>
          <Badge variant="success">Connected</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted">Nodes</p>
            <p className="text-foreground font-medium">12</p>
          </div>
          <div>
            <p className="text-muted">Policies</p>
            <p className="text-foreground font-medium">8</p>
          </div>
        </div>
      </CardContent>
    </Card>
  ),
};

export const PolicyCard: Story = {
  render: () => (
    <Card hover className="w-80">
      <CardHeader>
        <div className="flex items-start justify-between">
          <CardTitle>allow-frontend-to-api</CardTitle>
          <Badge variant="cilium">Cilium</Badge>
        </div>
        <CardDescription>Allow frontend pods to access API service</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <Badge variant="success">Deployed</Badge>
          <span className="text-xs text-muted">v3 • Updated 2h ago</span>
        </div>
      </CardContent>
    </Card>
  ),
};

export const GlowVariants: Story = {
  render: () => (
    <div className="flex gap-4">
      <Card glow="primary" className="w-48 text-center">
        <CardContent>
          <p className="text-foreground">Primary Glow</p>
        </CardContent>
      </Card>
      <Card glow="accent" className="w-48 text-center">
        <CardContent>
          <p className="text-foreground">Accent Glow</p>
        </CardContent>
      </Card>
      <Card glow="policyhub" className="w-48 text-center">
        <CardContent>
          <p className="text-foreground">PolicyHub Glow</p>
        </CardContent>
      </Card>
    </div>
  ),
};
