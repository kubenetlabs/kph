import type { Meta, StoryObj } from "@storybook/nextjs";
import { useState } from "react";
import { SortableHeader, useSortState, sortData } from "./sortable-header";

const meta: Meta<typeof SortableHeader> = {
  title: "UI/SortableHeader",
  component: SortableHeader,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof SortableHeader>;

export const Default: Story = {
  args: {
    column: "name",
    label: "Name",
    currentSort: { column: null, direction: "asc" },
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

// Interactive table example
const sampleData = [
  { id: "1", name: "production-east", status: "Connected", nodes: 12, region: "us-east-1" },
  { id: "2", name: "staging-west", status: "Connected", nodes: 6, region: "us-west-2" },
  { id: "3", name: "dev-local", status: "Pending", nodes: 3, region: "local" },
  { id: "4", name: "alpha-cluster", status: "Connected", nodes: 8, region: "eu-west-1" },
];

type DataItem = typeof sampleData[number];

function InteractiveTable() {
  const { sortState, handleSort } = useSortState<DataItem>("name");

  const sortedData = sortData(sampleData, sortState, {
    name: (item) => item.name,
    status: (item) => item.status,
    nodes: (item) => item.nodes,
    region: (item) => item.region,
  });

  return (
    <div className="w-full max-w-2xl rounded-lg border border-card-border bg-card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-card-border bg-card-hover">
            <SortableHeader
              column="name"
              label="Cluster Name"
              currentSort={sortState}
              onSort={handleSort}
            />
            <SortableHeader
              column="status"
              label="Status"
              currentSort={sortState}
              onSort={handleSort}
            />
            <SortableHeader
              column="nodes"
              label="Nodes"
              currentSort={sortState}
              onSort={handleSort}
            />
            <SortableHeader
              column="region"
              label="Region"
              currentSort={sortState}
              onSort={handleSort}
            />
          </tr>
        </thead>
        <tbody className="divide-y divide-card-border">
          {sortedData.map((item) => (
            <tr key={item.id} className="hover:bg-card-hover transition-colors">
              <td className="px-4 py-3 text-sm text-foreground font-medium">{item.name}</td>
              <td className="px-4 py-3 text-sm text-foreground">{item.status}</td>
              <td className="px-4 py-3 text-sm text-foreground">{item.nodes}</td>
              <td className="px-4 py-3 text-sm text-muted">{item.region}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const InteractiveTableExample: Story = {
  render: () => <InteractiveTable />,
};

export const HeaderRow: Story = {
  render: () => {
    const [sortState, setSortState] = useState({ column: "name" as string | null, direction: "asc" as const });

    const handleSort = (column: string) => {
      setSortState(prev => {
        if (prev.column === column) {
          if (prev.direction === "asc") return { column, direction: "desc" as const };
          return { column: null, direction: "asc" as const };
        }
        return { column, direction: "asc" as const };
      });
    };

    return (
      <div className="rounded-lg border border-card-border bg-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-card-border">
              <SortableHeader column="name" label="Name" currentSort={sortState} onSort={handleSort} />
              <SortableHeader column="type" label="Type" currentSort={sortState} onSort={handleSort} />
              <SortableHeader column="status" label="Status" currentSort={sortState} onSort={handleSort} />
              <SortableHeader column="created" label="Created" currentSort={sortState} onSort={handleSort} />
            </tr>
          </thead>
        </table>
        <p className="p-4 text-sm text-muted">Click headers to sort. Current: {sortState.column ?? "none"} ({sortState.direction})</p>
      </div>
    );
  },
};
