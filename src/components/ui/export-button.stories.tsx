import type { Meta, StoryObj } from "@storybook/nextjs";
import { ExportButton } from "./export-button";

const sampleData = [
  { id: "1", name: "production-east", status: "Connected", nodes: 12 },
  { id: "2", name: "staging-west", status: "Connected", nodes: 6 },
  { id: "3", name: "dev-local", status: "Pending", nodes: 3 },
];

const columns = [
  { key: "name" as const, header: "Cluster Name" },
  { key: "status" as const, header: "Status" },
  { key: "nodes" as const, header: "Node Count" },
];

const meta: Meta<typeof ExportButton> = {
  title: "UI/ExportButton",
  component: ExportButton,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    label: {
      control: "text",
      description: "Button label text",
    },
    filename: {
      control: "text",
      description: "Base filename for export (without extension)",
    },
    variant: {
      control: "select",
      options: ["primary", "secondary", "ghost"],
      description: "Button style variant",
    },
    disabled: {
      control: "boolean",
      description: "Disabled state",
    },
  },
};

export default meta;
type Story = StoryObj<typeof ExportButton>;

export const Default: Story = {
  args: {
    data: sampleData,
    columns: columns,
    filename: "clusters",
  },
};

export const CustomLabel: Story = {
  args: {
    data: sampleData,
    columns: columns,
    filename: "clusters",
    label: "Download Report",
  },
};

export const PrimaryVariant: Story = {
  args: {
    data: sampleData,
    columns: columns,
    filename: "clusters",
    variant: "primary",
  },
};

export const GhostVariant: Story = {
  args: {
    data: sampleData,
    columns: columns,
    filename: "clusters",
    variant: "ghost",
  },
};

export const Disabled: Story = {
  args: {
    data: sampleData,
    columns: columns,
    filename: "clusters",
    disabled: true,
  },
};

export const EmptyData: Story = {
  args: {
    data: [],
    columns: columns,
    filename: "clusters",
  },
};

export const InHeader: Story = {
  render: () => (
    <div className="flex items-center justify-between w-96 rounded-lg border border-card-border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Clusters</h2>
        <p className="text-sm text-muted">3 clusters</p>
      </div>
      <ExportButton
        data={sampleData}
        columns={columns}
        filename="clusters"
      />
    </div>
  ),
};
