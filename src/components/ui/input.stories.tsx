import type { Meta, StoryObj } from "@storybook/nextjs";
import Input from "./input";

const meta: Meta<typeof Input> = {
  title: "UI/Input",
  component: Input,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    label: {
      control: "text",
      description: "Label text above the input",
    },
    placeholder: {
      control: "text",
      description: "Placeholder text",
    },
    helperText: {
      control: "text",
      description: "Helper text below the input",
    },
    error: {
      control: "boolean",
      description: "Error state styling",
    },
    disabled: {
      control: "boolean",
      description: "Disabled state",
    },
    type: {
      control: "select",
      options: ["text", "email", "password", "number", "search"],
      description: "Input type",
    },
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: {
    placeholder: "Enter text...",
  },
};

export const WithLabel: Story = {
  args: {
    label: "Email Address",
    placeholder: "you@example.com",
    type: "email",
  },
};

export const WithHelperText: Story = {
  args: {
    label: "Organization Slug",
    placeholder: "acme-corp",
    helperText: "Used in URLs: policyhub.io/org/your-slug",
  },
};

export const ErrorState: Story = {
  args: {
    label: "Email",
    placeholder: "you@example.com",
    error: true,
    helperText: "Please enter a valid email address",
    defaultValue: "invalid-email",
  },
};

export const Disabled: Story = {
  args: {
    label: "Cluster ID",
    defaultValue: "cluster-abc-123",
    disabled: true,
    helperText: "This field cannot be modified",
  },
};

export const Password: Story = {
  args: {
    label: "Password",
    type: "password",
    placeholder: "Enter your password",
  },
};

export const Search: Story = {
  args: {
    type: "search",
    placeholder: "Search policies...",
  },
};

export const FormExample: Story = {
  render: () => (
    <div className="space-y-4">
      <Input
        label="Policy Name"
        placeholder="allow-frontend-to-api"
        helperText="Must be lowercase with hyphens only"
      />
      <Input
        label="Description"
        placeholder="Describe what this policy does"
      />
      <Input
        label="Target Namespace"
        placeholder="default"
        helperText="Leave empty to apply cluster-wide"
      />
    </div>
  ),
};

export const ValidationStates: Story = {
  render: () => (
    <div className="space-y-4">
      <Input
        label="Valid Input"
        defaultValue="valid-slug"
        helperText="This slug is available"
      />
      <Input
        label="Error Input"
        defaultValue="invalid slug!"
        error
        helperText="Slug can only contain lowercase letters, numbers, and hyphens"
      />
    </div>
  ),
};
