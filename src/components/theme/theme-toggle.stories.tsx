import type { Meta, StoryObj } from "@storybook/nextjs";
import { ThemeToggle, ThemeSelect } from "./theme-toggle";
import { ThemeProvider } from "./theme-provider";

const meta: Meta<typeof ThemeToggle> = {
  title: "Components/ThemeToggle",
  component: ThemeToggle,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <ThemeProvider defaultTheme="dark">
        <Story />
      </ThemeProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ThemeToggle>;

export const Toggle: Story = {
  render: () => (
    <div className="flex flex-col items-center gap-4">
      <p className="text-muted text-sm">Click to cycle through themes</p>
      <ThemeToggle />
    </div>
  ),
};

export const Select: Story = {
  render: () => (
    <div className="flex flex-col items-center gap-4">
      <p className="text-muted text-sm">Select a theme</p>
      <ThemeSelect />
    </div>
  ),
};

export const InSidebar: Story = {
  render: () => (
    <div className="w-64 rounded-lg border border-card-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">Theme</span>
        <ThemeSelect />
      </div>
    </div>
  ),
};

export const BothVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-8 items-center">
      <div className="text-center">
        <p className="text-muted text-sm mb-2">ThemeToggle (cycles)</p>
        <ThemeToggle />
      </div>
      <div className="text-center">
        <p className="text-muted text-sm mb-2">ThemeSelect (buttons)</p>
        <ThemeSelect />
      </div>
    </div>
  ),
};
