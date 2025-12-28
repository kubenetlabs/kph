"use client";

import { useState } from "react";
import Link from "next/link";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import Input from "~/components/ui/input";
import Select from "~/components/ui/select";
import Modal from "~/components/ui/modal";
import { trpc } from "~/lib/trpc";

// Icons
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

function PackageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  );
}

const tierOptions = [
  { value: "COMMUNITY", label: "Community (Free)" },
  { value: "ENTERPRISE", label: "Enterprise" },
];

const categoryOptions = [
  { value: "COMPLIANCE", label: "Compliance" },
  { value: "WORKLOAD", label: "Workload" },
  { value: "SECURITY", label: "Security" },
];

const policyTypeOptions = [
  { value: "CILIUM_NETWORK", label: "CiliumNetworkPolicy" },
  { value: "CILIUM_CLUSTERWIDE", label: "CiliumClusterwideNetworkPolicy" },
];

export default function MarketplaceAdminPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPack, setEditingPack] = useState<string | null>(null);
  const [selectedPack, setSelectedPack] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.marketplace.getMyPacks.useQuery();

  const createPackMutation = trpc.marketplace.createPack.useMutation({
    onSuccess: () => {
      void utils.marketplace.getMyPacks.invalidate();
      setShowCreateModal(false);
    },
  });

  const updatePackMutation = trpc.marketplace.updatePack.useMutation({
    onSuccess: () => {
      void utils.marketplace.getMyPacks.invalidate();
      setEditingPack(null);
    },
  });

  const deletePackMutation = trpc.marketplace.deletePack.useMutation({
    onSuccess: () => {
      void utils.marketplace.getMyPacks.invalidate();
      setSelectedPack(null);
    },
  });

  const currentPack = selectedPack ? data?.packs.find((p) => p.id === selectedPack) : null;

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/marketplace">
              <Button variant="ghost" size="sm">
                <ArrowLeftIcon className="w-4 h-4 mr-2" />
                Back to Marketplace
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-foreground">My Policy Packs</h1>
              <p className="text-muted mt-1">
                Create and manage your own policy packs
              </p>
            </div>
          </div>
          <Button onClick={() => setShowCreateModal(true)}>
            <PlusIcon className="w-4 h-4 mr-2" />
            Create Pack
          </Button>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Pack List */}
          <div className="col-span-4">
            <Card>
              <CardHeader>
                <CardTitle>Your Packs</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-4 space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="h-16 bg-card-hover rounded animate-pulse" />
                    ))}
                  </div>
                ) : data?.packs.length === 0 ? (
                  <div className="p-8 text-center">
                    <PackageIcon className="h-12 w-12 text-muted mx-auto mb-3" />
                    <p className="text-muted">No packs created yet</p>
                    <Button variant="secondary" size="sm" className="mt-3" onClick={() => setShowCreateModal(true)}>
                      Create your first pack
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y divide-card-border">
                    {data?.packs.map((pack) => (
                      <button
                        key={pack.id}
                        onClick={() => setSelectedPack(pack.id)}
                        className={`w-full p-4 text-left hover:bg-card-hover transition-colors ${
                          selectedPack === pack.id ? "bg-card-hover border-l-2 border-primary" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-foreground">{pack.name}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant={pack.tier === "ENTERPRISE" ? "accent" : "muted"}>
                                {pack.tier}
                              </Badge>
                              <Badge variant={pack.isPublished ? "success" : "default"}>
                                {pack.isPublished ? "Published" : "Draft"}
                              </Badge>
                            </div>
                          </div>
                          <span className="text-sm text-muted">{pack.policies.length} policies</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Pack Details */}
          <div className="col-span-8">
            {selectedPack && currentPack ? (
              <PackDetails
                pack={currentPack}
                onEdit={() => setEditingPack(currentPack.id)}
                onDelete={() => {
                  if (confirm("Are you sure you want to delete this pack?")) {
                    deletePackMutation.mutate({ packId: currentPack.id });
                  }
                }}
                onTogglePublish={() => {
                  updatePackMutation.mutate({
                    packId: currentPack.id,
                    isPublished: !currentPack.isPublished,
                  });
                }}
              />
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <PackageIcon className="h-16 w-16 text-muted mb-4" />
                  <p className="text-lg font-medium text-foreground">Select a pack to view details</p>
                  <p className="text-muted">Or create a new pack to get started</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Create Pack Modal */}
      <CreatePackModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={(data) => createPackMutation.mutate(data)}
        isLoading={createPackMutation.isPending}
      />

      {/* Edit Pack Modal */}
      {editingPack && currentPack && (
        <EditPackModal
          isOpen={true}
          pack={currentPack}
          onClose={() => setEditingPack(null)}
          onSubmit={(data) => updatePackMutation.mutate({ packId: editingPack, ...data })}
          isLoading={updatePackMutation.isPending}
        />
      )}
    </AppShell>
  );
}

interface PackData {
  id: string;
  slug: string;
  name: string;
  description: string;
  tier: string;
  category: string;
  version: string;
  isPublished: boolean;
  policies: Array<{
    id: string;
    name: string;
    description: string;
    policyType: string;
    yamlContent: string;
    controlIds: unknown;
    order: number;
  }>;
  installCount: number;
}

interface PackDetailsProps {
  pack: PackData;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePublish: () => void;
}

function PackDetails({ pack, onEdit, onDelete, onTogglePublish }: PackDetailsProps) {
  const [showAddPolicy, setShowAddPolicy] = useState(false);
  const [showImportPolicy, setShowImportPolicy] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const addPolicyMutation = trpc.marketplace.addPolicyToPack.useMutation({
    onSuccess: () => {
      void utils.marketplace.getMyPacks.invalidate();
      setShowAddPolicy(false);
    },
  });

  const updatePolicyMutation = trpc.marketplace.updatePackPolicy.useMutation({
    onSuccess: () => {
      void utils.marketplace.getMyPacks.invalidate();
      setEditingPolicy(null);
    },
  });

  const removePolicyMutation = trpc.marketplace.removePackPolicy.useMutation({
    onSuccess: () => {
      void utils.marketplace.getMyPacks.invalidate();
    },
  });

  const importPolicyMutation = trpc.marketplace.importPolicyToPack.useMutation({
    onSuccess: () => {
      void utils.marketplace.getMyPacks.invalidate();
      setShowImportPolicy(false);
    },
  });

  const currentEditPolicy = editingPolicy ? pack.policies.find((p) => p.id === editingPolicy) : null;

  return (
    <div className="space-y-4">
      {/* Pack Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{pack.name}</CardTitle>
              <p className="text-sm text-muted mt-1">{pack.slug} &bull; v{pack.version}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onTogglePublish}>
                {pack.isPublished ? (
                  <>
                    <EyeOffIcon className="w-4 h-4 mr-2" />
                    Unpublish
                  </>
                ) : (
                  <>
                    <EyeIcon className="w-4 h-4 mr-2" />
                    Publish
                  </>
                )}
              </Button>
              <Button variant="ghost" size="sm" onClick={onEdit}>
                <EditIcon className="w-4 h-4 mr-2" />
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={onDelete} disabled={pack.installCount > 0}>
                <TrashIcon className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted">{pack.description}</p>
          <div className="flex items-center gap-2 mt-3">
            <Badge variant={pack.tier === "ENTERPRISE" ? "accent" : "muted"}>
              {pack.tier}
            </Badge>
            <Badge variant="default">{pack.category}</Badge>
            <Badge variant={pack.isPublished ? "success" : "default"}>
              {pack.isPublished ? "Published" : "Draft"}
            </Badge>
            {pack.installCount > 0 && (
              <Badge variant="muted">{pack.installCount} installations</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Policies */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Policies ({pack.policies.length})</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowImportPolicy(true)}>
                Import Existing
              </Button>
              <Button size="sm" onClick={() => setShowAddPolicy(true)}>
                <PlusIcon className="w-4 h-4 mr-2" />
                Add Policy
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {pack.policies.length === 0 ? (
            <div className="p-8 text-center">
              <ShieldIcon className="h-12 w-12 text-muted mx-auto mb-3" />
              <p className="text-muted">No policies in this pack yet</p>
              <div className="flex items-center justify-center gap-2 mt-3">
                <Button variant="secondary" size="sm" onClick={() => setShowImportPolicy(true)}>
                  Import Existing
                </Button>
                <Button size="sm" onClick={() => setShowAddPolicy(true)}>
                  Create New
                </Button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-card-border">
              {pack.policies.map((policy, index) => (
                <div key={policy.id} className="p-4 hover:bg-card-hover">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-muted text-sm">#{index + 1}</span>
                        <p className="font-medium text-foreground">{policy.name}</p>
                        <Badge variant="default">{policy.policyType}</Badge>
                      </div>
                      <p className="text-sm text-muted mt-1">{policy.description}</p>
                      {Array.isArray(policy.controlIds) && (policy.controlIds as string[]).length > 0 && (
                        <div className="flex items-center gap-1 mt-2">
                          <span className="text-xs text-muted">Controls:</span>
                          {(policy.controlIds as string[]).slice(0, 3).map((id: string) => (
                            <Badge key={id} variant="muted">{id}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingPolicy(policy.id)}
                      >
                        <EditIcon className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm("Remove this policy from the pack?")) {
                            removePolicyMutation.mutate({ policyId: policy.id });
                          }
                        }}
                      >
                        <TrashIcon className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Policy Modal */}
      <AddPolicyModal
        isOpen={showAddPolicy}
        onClose={() => setShowAddPolicy(false)}
        onSubmit={(data) => addPolicyMutation.mutate({ packId: pack.id, ...data })}
        isLoading={addPolicyMutation.isPending}
      />

      {/* Import Policy Modal */}
      <ImportPolicyModal
        isOpen={showImportPolicy}
        packId={pack.id}
        onClose={() => setShowImportPolicy(false)}
        onImport={(policyId) => importPolicyMutation.mutate({ packId: pack.id, policyId })}
        isLoading={importPolicyMutation.isPending}
      />

      {/* Edit Policy Modal */}
      {currentEditPolicy && (
        <EditPolicyModal
          isOpen={true}
          policy={currentEditPolicy}
          onClose={() => setEditingPolicy(null)}
          onSubmit={(data) => updatePolicyMutation.mutate({ policyId: currentEditPolicy.id, ...data })}
          isLoading={updatePolicyMutation.isPending}
        />
      )}
    </div>
  );
}

// Create Pack Modal
interface CreatePackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    slug: string;
    description: string;
    tier: "COMMUNITY" | "ENTERPRISE";
    category: "COMPLIANCE" | "WORKLOAD" | "SECURITY";
    version: string;
  }) => void;
  isLoading: boolean;
}

function CreatePackModal({ isOpen, onClose, onSubmit, isLoading }: CreatePackModalProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [tier, setTier] = useState<"COMMUNITY" | "ENTERPRISE">("COMMUNITY");
  const [category, setCategory] = useState<"COMPLIANCE" | "WORKLOAD" | "SECURITY">("WORKLOAD");
  const [version, setVersion] = useState("1.0.0");

  const handleSubmit = () => {
    onSubmit({ name, slug, description, tier, category, version });
  };

  const generateSlug = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Policy Pack">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Pack Name</label>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slug || slug === generateSlug(name.slice(0, -1))) {
                setSlug(generateSlug(e.target.value));
              }
            }}
            placeholder="My Policy Pack"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Slug</label>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="my-policy-pack"
          />
          <p className="text-xs text-muted mt-1">URL-friendly identifier (lowercase, hyphens only)</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Description</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A brief description of what this pack does"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Tier</label>
            <Select
              options={tierOptions}
              value={tier}
              onChange={(e) => setTier(e.target.value as "COMMUNITY" | "ENTERPRISE")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Category</label>
            <Select
              options={categoryOptions}
              value={category}
              onChange={(e) => setCategory(e.target.value as "COMPLIANCE" | "WORKLOAD" | "SECURITY")}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Version</label>
          <Input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.0.0"
          />
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isLoading || !name || !slug || !description}>
            {isLoading ? "Creating..." : "Create Pack"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Edit Pack Modal
interface EditPackModalProps {
  isOpen: boolean;
  pack: PackData;
  onClose: () => void;
  onSubmit: (data: {
    name?: string;
    description?: string;
    tier?: "COMMUNITY" | "ENTERPRISE";
    category?: "COMPLIANCE" | "WORKLOAD" | "SECURITY";
    version?: string;
  }) => void;
  isLoading: boolean;
}

function EditPackModal({ isOpen, pack, onClose, onSubmit, isLoading }: EditPackModalProps) {
  const [name, setName] = useState(pack.name);
  const [description, setDescription] = useState(pack.description);
  const [tier, setTier] = useState(pack.tier as "COMMUNITY" | "ENTERPRISE");
  const [category, setCategory] = useState(pack.category as "COMPLIANCE" | "WORKLOAD" | "SECURITY");
  const [version, setVersion] = useState(pack.version);

  const handleSubmit = () => {
    onSubmit({ name, description, tier, category, version });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Policy Pack">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Pack Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Description</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Tier</label>
            <Select
              options={tierOptions}
              value={tier}
              onChange={(e) => setTier(e.target.value as "COMMUNITY" | "ENTERPRISE")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Category</label>
            <Select
              options={categoryOptions}
              value={category}
              onChange={(e) => setCategory(e.target.value as "COMPLIANCE" | "WORKLOAD" | "SECURITY")}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Version</label>
          <Input value={version} onChange={(e) => setVersion(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Add Policy Modal
interface AddPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    description: string;
    policyType: "CILIUM_NETWORK" | "CILIUM_CLUSTERWIDE";
    yamlContent: string;
    controlIds: string[];
  }) => void;
  isLoading: boolean;
}

function AddPolicyModal({ isOpen, onClose, onSubmit, isLoading }: AddPolicyModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [policyType, setPolicyType] = useState<"CILIUM_NETWORK" | "CILIUM_CLUSTERWIDE">("CILIUM_NETWORK");
  const [yamlContent, setYamlContent] = useState("");
  const [controlIds, setControlIds] = useState("");

  const handleSubmit = () => {
    const ids = controlIds.split(",").map((s) => s.trim()).filter(Boolean);
    onSubmit({ name, description, policyType, yamlContent, controlIds: ids });
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setPolicyType("CILIUM_NETWORK");
    setYamlContent("");
    setControlIds("");
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        resetForm();
        onClose();
      }}
      title="Add Policy to Pack"
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Policy Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="allow-frontend-to-backend"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Description</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Allow traffic from frontend pods to backend service"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Policy Type</label>
          <Select
            options={policyTypeOptions}
            value={policyType}
            onChange={(e) => setPolicyType(e.target.value as "CILIUM_NETWORK" | "CILIUM_CLUSTERWIDE")}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">YAML Content</label>
          <textarea
            value={yamlContent}
            onChange={(e) => setYamlContent(e.target.value)}
            className="w-full h-48 px-3 py-2 bg-background border border-card-border rounded-md text-foreground font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder={`apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-frontend-to-backend
spec:
  endpointSelector:
    matchLabels:
      app: backend
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend`}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Control IDs (optional)</label>
          <Input
            value={controlIds}
            onChange={(e) => setControlIds(e.target.value)}
            placeholder="CC6.1.1, CC6.1.2"
          />
          <p className="text-xs text-muted mt-1">Comma-separated compliance control IDs</p>
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isLoading || !name || !description || !yamlContent}>
            {isLoading ? "Adding..." : "Add Policy"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Edit Policy Modal
interface PolicyData {
  id: string;
  name: string;
  description: string;
  policyType: string;
  yamlContent: string;
  controlIds: unknown;
}

interface EditPolicyModalProps {
  isOpen: boolean;
  policy: PolicyData;
  onClose: () => void;
  onSubmit: (data: {
    name?: string;
    description?: string;
    policyType?: "CILIUM_NETWORK" | "CILIUM_CLUSTERWIDE";
    yamlContent?: string;
    controlIds?: string[];
  }) => void;
  isLoading: boolean;
}

function EditPolicyModal({ isOpen, policy, onClose, onSubmit, isLoading }: EditPolicyModalProps) {
  const [name, setName] = useState(policy.name);
  const [description, setDescription] = useState(policy.description);
  const [policyType, setPolicyType] = useState(policy.policyType as "CILIUM_NETWORK" | "CILIUM_CLUSTERWIDE");
  const [yamlContent, setYamlContent] = useState(policy.yamlContent);
  const [controlIds, setControlIds] = useState(
    Array.isArray(policy.controlIds) ? (policy.controlIds as string[]).join(", ") : ""
  );

  const handleSubmit = () => {
    const ids = controlIds.split(",").map((s) => s.trim()).filter(Boolean);
    onSubmit({ name, description, policyType, yamlContent, controlIds: ids });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Policy">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Policy Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Description</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Policy Type</label>
          <Select
            options={policyTypeOptions}
            value={policyType}
            onChange={(e) => setPolicyType(e.target.value as "CILIUM_NETWORK" | "CILIUM_CLUSTERWIDE")}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">YAML Content</label>
          <textarea
            value={yamlContent}
            onChange={(e) => setYamlContent(e.target.value)}
            className="w-full h-48 px-3 py-2 bg-background border border-card-border rounded-md text-foreground font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Control IDs</label>
          <Input
            value={controlIds}
            onChange={(e) => setControlIds(e.target.value)}
            placeholder="CC6.1.1, CC6.1.2"
          />
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Import Policy Modal
interface ImportPolicyModalProps {
  isOpen: boolean;
  packId: string;
  onClose: () => void;
  onImport: (policyId: string) => void;
  isLoading: boolean;
}

function ImportPolicyModal({ isOpen, onClose, onImport, isLoading }: ImportPolicyModalProps) {
  const [search, setSearch] = useState("");
  const [selectedPolicy, setSelectedPolicy] = useState<string | null>(null);

  const { data, isLoading: policiesLoading } = trpc.marketplace.listOrgPolicies.useQuery(
    { search: search || undefined },
    { enabled: isOpen }
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Import Existing Policy">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Search Policies</label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name..."
          />
        </div>

        <div className="border border-card-border rounded-md max-h-64 overflow-y-auto">
          {policiesLoading ? (
            <div className="p-4 text-center text-muted">Loading policies...</div>
          ) : data?.policies.length === 0 ? (
            <div className="p-4 text-center text-muted">No policies found</div>
          ) : (
            <div className="divide-y divide-card-border">
              {data?.policies.map((policy) => (
                <button
                  key={policy.id}
                  onClick={() => setSelectedPolicy(policy.id)}
                  className={`w-full p-3 text-left hover:bg-card-hover transition-colors ${
                    selectedPolicy === policy.id ? "bg-card-hover border-l-2 border-primary" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground">{policy.name}</p>
                      <p className="text-sm text-muted">{policy.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="default">{policy.type}</Badge>
                      {policy.cluster && (
                        <Badge variant="muted">{policy.cluster.name}</Badge>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => selectedPolicy && onImport(selectedPolicy)}
            disabled={isLoading || !selectedPolicy}
          >
            {isLoading ? "Importing..." : "Import Policy"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
