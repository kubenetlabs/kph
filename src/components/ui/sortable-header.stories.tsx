import type { Meta, StoryObj } from "@storybook/nextjs";
import { SortableHeader } from "./sortable-header";

const meta: Meta<typeof SortableHeader> = {
  title: "UI/SortableHeader",
  component: SortableHeader,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    column: {
      control: "text",
      description: "Column identifier",
    },
    label: {
      control: "text",
      description: "Display label for the column",
    },
  },
};

export default meta;
type Story = StoryObj<typeof SortableHeader>;

export const Default: Story = {
  args: {
    column: "name",
    label: "Name",
    currentSort: { column: null, direction: null },
    onSort: () => undefined,
  },
};

export const ActiveAscending: Story = {
  args: {
    column: "name",
    label: "Name",
    currentSort: { column: "name", direction: "asc" },
    onSort: () => undefined,
  },
};

export const ActiveDescending: Story = {
  args: {
    column: "name",
    label: "Name",
    currentSort: { column: "name", direction: "desc" },
    onSort: () => undefined,
  },
};

export const InactiveColumn: Story = {
  args: {
    column: "status",
    label: "Status",
    currentSort: { column: "name", direction: "asc" },
    onSort: () => undefined,
  },
};

export const HeaderRow: Story = {
  render: () => (
    <div className="rounded-lg border border-card-border bg-card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-card-border">
            <SortableHeader
              column="name"
              label="Name"
              currentSort={{ column: "name", direction: "asc" }}
              onSort={() => undefined}
            />
            <SortableHeader
              column="type"
              label="Type"
              currentSort={{ column: "name", direction: "asc" }}
              onSort={() => undefined}
            />
            <SortableHeader
              column="status"
              label="Status"
              currentSort={{ column: "name", direction: "asc" }}
              onSort={() => undefined}
            />
            <SortableHeader
              column="created"
              label="Created"
              currentSort={{ column: "name", direction: "asc" }}
              onSort={() => undefined}
            />
          </tr>
        </thead>
      </table>
      <p className="p-4 text-sm text-muted">
        Click any header to sort. The &quot;Name&quot; column is currently sorted ascending.
      </p>
    </div>
  ),
};

export const AllStates: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted w-24">Unsorted:</span>
        <SortableHeader
          column="col1"
          label="Column"
          currentSort={{ column: null, direction: null }}
          onSort={() => undefined}
        />
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted w-24">Ascending:</span>
        <SortableHeader
          column="col2"
          label="Column"
          currentSort={{ column: "col2", direction: "asc" }}
          onSort={() => undefined}
        />
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted w-24">Descending:</span>
        <SortableHeader
          column="col3"
          label="Column"
          currentSort={{ column: "col3", direction: "desc" }}
          onSort={() => undefined}
        />
      </div>
    </div>
  ),
};
