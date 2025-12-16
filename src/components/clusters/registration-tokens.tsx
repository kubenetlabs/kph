"use client";

import { useState } from "react";
import { trpc } from "~/lib/trpc";
import Button from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Badge from "~/components/ui/badge";
import Modal from "~/components/ui/modal";
import Input from "~/components/ui/input";

interface CreateTokenModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTokenCreated: (token: string) => void;
}

function CreateTokenModal({ isOpen, onClose, onTokenCreated }: CreateTokenModalProps) {
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number | undefined>(30);

  const createToken = trpc.cluster.createRegistrationToken.useMutation({
    onSuccess: (data: { token: string }) => {
      onTokenCreated(data.token);
      setName("");
      setExpiresInDays(30);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createToken.mutate({ name, expiresInDays });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Registration Token"
      description="Create a token that allows operators to self-register new clusters."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="tokenName" className="block text-sm font-medium text-foreground mb-1">
            Token Name
          </label>
          <Input
            id="tokenName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Production clusters"
            required
          />
          <p className="mt-1 text-xs text-muted">
            A descriptive name to identify this token
          </p>
        </div>

        <div>
          <label htmlFor="expiresIn" className="block text-sm font-medium text-foreground mb-1">
            Expires In (days)
          </label>
          <Input
            id="expiresIn"
            type="number"
            value={expiresInDays ?? ""}
            onChange={(e) => setExpiresInDays(e.target.value ? Number(e.target.value) : undefined)}
            placeholder="Leave empty for no expiration"
            min={1}
            max={365}
          />
          <p className="mt-1 text-xs text-muted">
            Leave empty for a token that never expires
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={createToken.isPending}>
            Create Token
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface TokenCreatedModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
}

function TokenCreatedModal({ isOpen, onClose, token }: TokenCreatedModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Token Created"
      size="lg"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
          <div className="flex items-start gap-3">
            <svg className="h-5 w-5 flex-shrink-0 text-warning mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-warning">Save Your Registration Token</p>
              <p className="mt-1 text-xs text-muted">
                This token will only be shown once. Copy it now and store it securely.
              </p>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Registration Token
          </label>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-card px-3 py-2 text-xs font-mono text-foreground break-all border border-border">
              {token}
            </code>
            <Button variant="secondary" size="sm" onClick={handleCopy}>
              {copied ? (
                <>
                  <svg className="mr-1.5 h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="text-sm font-medium text-foreground mb-2">How to use this token</h4>
          <ol className="space-y-2 text-sm text-muted list-decimal list-inside">
            <li>Install the Policy Hub operator in your cluster</li>
            <li>Configure the operator with this registration token</li>
            <li>The operator will automatically register and create the cluster</li>
            <li>A cluster-specific token will be generated for ongoing communication</li>
          </ol>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function RegistrationTokens() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [tokenToRevoke, setTokenToRevoke] = useState<string | null>(null);

  const { data: tokens, refetch } = trpc.cluster.listRegistrationTokens.useQuery();
  const revokeToken = trpc.cluster.revokeRegistrationToken.useMutation({
    onSuccess: () => {
      void refetch();
      setTokenToRevoke(null);
    },
  });

  const handleTokenCreated = (token: string) => {
    setIsCreateModalOpen(false);
    setCreatedToken(token);
    void refetch();
  };

  const formatDate = (date: Date | null) => {
    if (!date) return "Never";
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  interface TokenStatusInput {
    revokedAt: Date | null;
    expiresAt: Date | null;
  }

  const getTokenStatus = (token: TokenStatusInput) => {
    if (token.revokedAt) {
      return { variant: "danger" as const, label: "Revoked" };
    }
    if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
      return { variant: "warning" as const, label: "Expired" };
    }
    return { variant: "success" as const, label: "Active" };
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Registration Tokens</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Tokens for operator self-registration. One token can register multiple clusters.
            </p>
          </div>
          <Button onClick={() => setIsCreateModalOpen(true)}>
            <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Token
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {tokens && tokens.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-card-border">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Token Prefix
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Created
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Expires
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Last Used
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {tokens.map((token) => {
                  const status = getTokenStatus(token);
                  return (
                    <tr key={token.id} className="hover:bg-card-hover transition-colors">
                      <td className="px-4 py-4">
                        <span className="font-medium text-foreground">{token.name}</span>
                      </td>
                      <td className="px-4 py-4">
                        <code className="text-sm text-muted">{token.prefix}...</code>
                      </td>
                      <td className="px-4 py-4">
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </td>
                      <td className="px-4 py-4 text-sm text-muted">
                        {formatDate(token.createdAt)}
                      </td>
                      <td className="px-4 py-4 text-sm text-muted">
                        {formatDate(token.expiresAt)}
                      </td>
                      <td className="px-4 py-4 text-sm text-muted">
                        {token.lastUsedAt ? formatDate(token.lastUsedAt) : "Never"}
                      </td>
                      <td className="px-4 py-4 text-right">
                        {!token.revokedAt && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setTokenToRevoke(token.id)}
                          >
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="py-12 text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-card-hover p-3 text-muted">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-medium text-foreground">No registration tokens</h3>
              <p className="mt-2 text-sm text-muted">
                Create a registration token to allow operators to self-register clusters.
              </p>
              <Button className="mt-6" onClick={() => setIsCreateModalOpen(true)}>
                <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Your First Token
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Token Modal */}
      <CreateTokenModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onTokenCreated={handleTokenCreated}
      />

      {/* Token Created Modal */}
      {createdToken && (
        <TokenCreatedModal
          isOpen={!!createdToken}
          onClose={() => setCreatedToken(null)}
          token={createdToken}
        />
      )}

      {/* Revoke Confirmation Modal */}
      <Modal
        isOpen={!!tokenToRevoke}
        onClose={() => setTokenToRevoke(null)}
        title="Revoke Token"
        description="Are you sure you want to revoke this registration token? Clusters already registered will continue to work, but this token cannot be used to register new clusters."
      >
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="secondary" onClick={() => setTokenToRevoke(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            isLoading={revokeToken.isPending}
            onClick={() => tokenToRevoke && revokeToken.mutate({ tokenId: tokenToRevoke })}
          >
            Revoke Token
          </Button>
        </div>
      </Modal>
    </>
  );
}
