/**
 * Kubernetes Client Service
 *
 * Provides functionality to connect to and interact with Kubernetes clusters
 * using service account tokens.
 */

export interface KubernetesConnectionResult {
  success: boolean;
  kubernetesVersion?: string;
  nodeCount?: number;
  namespaceCount?: number;
  error?: string;
}

interface K8sVersionInfo {
  major: string;
  minor: string;
  gitVersion: string;
  platform: string;
}

interface K8sListResponse<T> {
  items: T[];
}

interface K8sNode {
  metadata: { name: string };
}

interface K8sNamespace {
  metadata: { name: string };
}

/**
 * Create headers for Kubernetes API requests.
 */
function createK8sHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

/**
 * Create a fetch agent options object with CA certificate handling.
 * Note: In Node.js 18+, we use the native fetch with custom HTTPS agent.
 */
function createFetchOptions(
  token: string,
  caCert?: string
): RequestInit {
  const options: RequestInit = {
    headers: createK8sHeaders(token),
  };

  // Handle self-signed certificates in development
  // In production with proper CA, this won't be needed
  if (caCert) {
    // For server-side requests with custom CA, we would need to use
    // a custom HTTPS agent. For now, we'll handle this in the API route.
    // @ts-expect-error - Node.js specific option for self-signed certs
    options.rejectUnauthorized = false;
  }

  return options;
}

/**
 * Test connectivity to a Kubernetes cluster.
 *
 * @param endpoint - The Kubernetes API server URL (e.g., https://kubernetes.default.svc)
 * @param token - Service account token for authentication
 * @param caCert - Optional CA certificate (base64 encoded)
 * @returns Connection result with cluster info or error
 */
export async function testKubernetesConnection(
  endpoint: string,
  token: string,
  caCert?: string
): Promise<KubernetesConnectionResult> {
  // Normalize endpoint URL
  const baseUrl = endpoint.replace(/\/$/, "");

  try {
    // First, check the /version endpoint (doesn't require special permissions)
    const versionResponse = await fetch(`${baseUrl}/version`, {
      ...createFetchOptions(token, caCert),
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!versionResponse.ok) {
      if (versionResponse.status === 401) {
        return {
          success: false,
          error: "Authentication failed. Please check your service account token.",
        };
      }
      if (versionResponse.status === 403) {
        return {
          success: false,
          error: "Authorization failed. The token may not have sufficient permissions.",
        };
      }
      return {
        success: false,
        error: `Failed to connect: HTTP ${versionResponse.status} ${versionResponse.statusText}`,
      };
    }

    const versionInfo = (await versionResponse.json()) as K8sVersionInfo;
    const kubernetesVersion = versionInfo.gitVersion;

    // Try to count nodes (may fail if token lacks permissions)
    let nodeCount: number | undefined;
    try {
      const nodesResponse = await fetch(`${baseUrl}/api/v1/nodes`, {
        ...createFetchOptions(token, caCert),
        signal: AbortSignal.timeout(10000),
      });

      if (nodesResponse.ok) {
        const nodeList = (await nodesResponse.json()) as K8sListResponse<K8sNode>;
        nodeCount = nodeList.items.length;
      }
    } catch {
      // Node counting is optional, don't fail the connection test
    }

    // Try to count namespaces
    let namespaceCount: number | undefined;
    try {
      const namespacesResponse = await fetch(`${baseUrl}/api/v1/namespaces`, {
        ...createFetchOptions(token, caCert),
        signal: AbortSignal.timeout(10000),
      });

      if (namespacesResponse.ok) {
        const namespaceList = (await namespacesResponse.json()) as K8sListResponse<K8sNamespace>;
        namespaceCount = namespaceList.items.length;
      }
    } catch {
      // Namespace counting is optional, don't fail the connection test
    }

    return {
      success: true,
      kubernetesVersion,
      nodeCount,
      namespaceCount,
    };
  } catch (error) {
    // Handle specific error types
    if (error instanceof TypeError && error.message.includes("fetch")) {
      return {
        success: false,
        error: "Network error. Unable to reach the Kubernetes API server. Please check the endpoint URL.",
      };
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        success: false,
        error: "Connection timed out. The Kubernetes API server did not respond in time.",
      };
    }

    // Handle certificate errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (
      errorMessage.includes("certificate") ||
      errorMessage.includes("SSL") ||
      errorMessage.includes("TLS")
    ) {
      return {
        success: false,
        error: "Certificate verification failed. Please check the CA certificate.",
      };
    }

    return {
      success: false,
      error: `Connection failed: ${errorMessage}`,
    };
  }
}

/**
 * Get cluster info summary for display.
 */
export async function getClusterInfo(
  endpoint: string,
  token: string,
  caCert?: string
): Promise<{
  version?: string;
  nodes?: number;
  namespaces?: number;
  platform?: string;
}> {
  const baseUrl = endpoint.replace(/\/$/, "");

  try {
    const versionResponse = await fetch(`${baseUrl}/version`, {
      ...createFetchOptions(token, caCert),
      signal: AbortSignal.timeout(10000),
    });

    if (!versionResponse.ok) {
      return {};
    }

    const versionInfo = (await versionResponse.json()) as K8sVersionInfo;

    return {
      version: versionInfo.gitVersion,
      platform: versionInfo.platform,
    };
  } catch {
    return {};
  }
}
