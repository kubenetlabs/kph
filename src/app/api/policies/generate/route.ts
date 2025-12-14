import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Request validation schema
const generatePolicyRequestSchema = z.object({
  description: z
    .string()
    .min(10, "Description must be at least 10 characters")
    .max(2000, "Description must be 2000 characters or less"),
  policyType: z
    .enum(["CILIUM_NETWORK", "CILIUM_CLUSTERWIDE"])
    .default("CILIUM_NETWORK"),
  targetNamespace: z.string().optional(),
  policyName: z.string().optional(),
});

// Response type
interface GeneratedPolicy {
  name: string;
  description: string;
  type: "CILIUM_NETWORK" | "CILIUM_CLUSTERWIDE";
  content: string;
  targetNamespaces: string[];
  parsedRules: ParsedRules;
  generatedFrom: string;
}

interface ParsedRules {
  podSelector: Record<string, string>;
  ingressRules: IngressRule[];
  egressRules: EgressRule[];
}

interface IngressRule {
  fromEndpoints?: Record<string, string>[];
  fromCIDR?: string[];
  toPorts?: PortRule[];
}

interface EgressRule {
  toEndpoints?: Record<string, string>[];
  toCIDR?: string[];
  toFQDNs?: string[];
  toPorts?: PortRule[];
}

interface PortRule {
  port: string;
  protocol: "TCP" | "UDP";
}

// Pattern matching for common policy intents
interface PolicyPattern {
  patterns: RegExp[];
  handler: (description: string, matches: RegExpMatchArray | null) => Partial<ParsedRules>;
}

const policyPatterns: PolicyPattern[] = [
  // Allow ingress from specific app
  {
    patterns: [
      /allow\s+(?:ingress|traffic|connections?)\s+from\s+(?:app[:\s]+)?["']?(\w[\w-]*)["']?/i,
      /(?:accept|permit)\s+(?:ingress|traffic)\s+from\s+(?:app[:\s]+)?["']?(\w[\w-]*)["']?/i,
    ],
    handler: (_, matches) => ({
      ingressRules: [
        {
          fromEndpoints: [{ app: matches?.[1] ?? "unknown" }],
        },
      ],
    }),
  },
  // Allow egress to specific app
  {
    patterns: [
      /allow\s+(?:egress|outbound|outgoing)\s+(?:traffic\s+)?to\s+(?:app[:\s]+)?["']?(\w[\w-]*)["']?/i,
      /(?:can|should)\s+(?:connect|talk|communicate)\s+to\s+(?:app[:\s]+)?["']?(\w[\w-]*)["']?/i,
    ],
    handler: (_, matches) => ({
      egressRules: [
        {
          toEndpoints: [{ app: matches?.[1] ?? "unknown" }],
        },
      ],
    }),
  },
  // Allow specific port
  {
    patterns: [
      /(?:allow|open|permit)\s+(?:port\s+)?(\d+)(?:\s*\/\s*(tcp|udp))?/i,
      /port\s+(\d+)(?:\s*\/\s*(tcp|udp))?\s+(?:should\s+be\s+)?(?:open|allowed)/i,
    ],
    handler: (_, matches) => ({
      ingressRules: [
        {
          toPorts: [
            {
              port: matches?.[1] ?? "80",
              protocol: (matches?.[2]?.toUpperCase() as "TCP" | "UDP") ?? "TCP",
            },
          ],
        },
      ],
    }),
  },
  // Allow HTTP/HTTPS
  {
    patterns: [/allow\s+(?:http|https|web)\s+traffic/i, /(?:http|https|web)\s+traffic\s+(?:should\s+be\s+)?allowed/i],
    handler: () => ({
      ingressRules: [
        {
          toPorts: [
            { port: "80", protocol: "TCP" },
            { port: "443", protocol: "TCP" },
          ],
        },
      ],
    }),
  },
  // Database access patterns
  {
    patterns: [
      /allow\s+(?:access\s+to\s+)?(?:database|db|postgres|mysql|mongodb)/i,
      /(?:database|db|postgres|mysql|mongodb)\s+access/i,
    ],
    handler: (description) => {
      const port = description.toLowerCase().includes("postgres")
        ? "5432"
        : description.toLowerCase().includes("mysql")
          ? "3306"
          : description.toLowerCase().includes("mongodb")
            ? "27017"
            : "5432";
      return {
        egressRules: [
          {
            toEndpoints: [{ app: "database" }],
            toPorts: [{ port, protocol: "TCP" }],
          },
        ],
      };
    },
  },
  // Deny all ingress
  {
    patterns: [/deny\s+all\s+(?:ingress|incoming|inbound)/i, /block\s+all\s+(?:ingress|incoming|inbound)/i],
    handler: () => ({
      ingressRules: [],
    }),
  },
  // Deny all egress
  {
    patterns: [/deny\s+all\s+(?:egress|outgoing|outbound)/i, /block\s+all\s+(?:egress|outgoing|outbound)/i],
    handler: () => ({
      egressRules: [],
    }),
  },
  // Allow DNS
  {
    patterns: [/allow\s+dns/i, /dns\s+(?:should\s+be\s+)?allowed/i, /permit\s+dns\s+(?:queries|lookups)?/i],
    handler: () => ({
      egressRules: [
        {
          toEndpoints: [{ "k8s:io.kubernetes.pod.namespace": "kube-system" }],
          toPorts: [
            { port: "53", protocol: "UDP" },
            { port: "53", protocol: "TCP" },
          ],
        },
      ],
    }),
  },
  // Allow external/internet access
  {
    patterns: [
      /allow\s+(?:external|internet|public)\s+(?:access|traffic)/i,
      /(?:can|should)\s+(?:access|reach)\s+(?:the\s+)?internet/i,
    ],
    handler: () => ({
      egressRules: [
        {
          toCIDR: ["0.0.0.0/0"],
        },
      ],
    }),
  },
  // Allow from specific CIDR
  {
    patterns: [/allow\s+(?:from|ingress\s+from)\s+(?:cidr\s+)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2})/i],
    handler: (_, matches) => ({
      ingressRules: [
        {
          fromCIDR: [matches?.[1] ?? "10.0.0.0/8"],
        },
      ],
    }),
  },
  // Allow to specific FQDN
  {
    patterns: [
      /allow\s+(?:egress|access)\s+to\s+(?:fqdn\s+)?["']?([\w.-]+\.[\w]+)["']?/i,
      /(?:can|should)\s+(?:connect|access)\s+["']?([\w.-]+\.[\w]+)["']?/i,
    ],
    handler: (_, matches) => ({
      egressRules: [
        {
          toFQDNs: [matches?.[1] ?? "example.com"],
        },
      ],
    }),
  },
];

// Extract pod selector from description
function extractPodSelector(description: string): Record<string, string> {
  // Look for app name patterns
  const appPatterns = [
    /(?:for|targeting|select)\s+(?:app[:\s]+)?["']?(\w[\w-]*)["']?\s+pods?/i,
    /pods?\s+(?:with\s+)?(?:app[:\s]+)?["']?(\w[\w-]*)["']?/i,
    /(?:app|application)[:\s]+["']?(\w[\w-]*)["']?/i,
  ];

  for (const pattern of appPatterns) {
    const match = description.match(pattern);
    if (match?.[1]) {
      return { app: match[1] };
    }
  }

  // Look for label patterns
  const labelPattern = /(?:label|selector)[:\s]+["']?(\w+)[:\s=]+["']?(\w[\w-]*)["']?/i;
  const labelMatch = description.match(labelPattern);
  if (labelMatch?.[1] && labelMatch?.[2]) {
    return { [labelMatch[1]]: labelMatch[2] };
  }

  return {};
}

// Extract namespace from description
function extractNamespace(description: string): string | undefined {
  const patterns = [
    /(?:in|for|namespace[:\s]+)["']?(\w[\w-]*)["']?\s+namespace/i,
    /namespace[:\s]+["']?(\w[\w-]*)["']?/i,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

// Generate policy name from description
function generatePolicyName(description: string): string {
  // Extract key terms
  const terms: string[] = [];

  if (/ingress|incoming|inbound/i.test(description)) terms.push("ingress");
  if (/egress|outgoing|outbound/i.test(description)) terms.push("egress");
  if (/deny|block/i.test(description)) terms.push("deny");
  if (/allow|permit/i.test(description)) terms.push("allow");
  if (/database|db/i.test(description)) terms.push("db");
  if (/http|web/i.test(description)) terms.push("http");
  if (/dns/i.test(description)) terms.push("dns");

  // Extract app name if present
  const appMatch = description.match(/(?:app[:\s]+)?["']?(\w[\w-]*)["']?\s+pods?/i);
  if (appMatch?.[1]) {
    terms.unshift(appMatch[1]);
  }

  if (terms.length === 0) {
    terms.push("custom-policy");
  }

  return terms.join("-").toLowerCase().slice(0, 63);
}

// Parse description and generate rules
function parseDescription(description: string): ParsedRules {
  const rules: ParsedRules = {
    podSelector: extractPodSelector(description),
    ingressRules: [],
    egressRules: [],
  };

  // Apply pattern matching
  for (const { patterns, handler } of policyPatterns) {
    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match) {
        const result = handler(description, match);
        if (result.ingressRules) {
          rules.ingressRules.push(...result.ingressRules);
        }
        if (result.egressRules) {
          rules.egressRules.push(...result.egressRules);
        }
        if (result.podSelector) {
          rules.podSelector = { ...rules.podSelector, ...result.podSelector };
        }
        break; // Only apply first matching pattern per category
      }
    }
  }

  return rules;
}

// Generate CiliumNetworkPolicy YAML
function generateCiliumPolicyYAML(
  name: string,
  namespace: string | undefined,
  rules: ParsedRules,
  isClusterwide: boolean
): string {
  const apiVersion = "cilium.io/v2";
  const kind = isClusterwide ? "CiliumClusterwideNetworkPolicy" : "CiliumNetworkPolicy";

  const policy: Record<string, unknown> = {
    apiVersion,
    kind,
    metadata: {
      name,
      ...(namespace && !isClusterwide ? { namespace } : {}),
    },
    spec: {
      endpointSelector: {
        matchLabels: Object.keys(rules.podSelector).length > 0 ? rules.podSelector : {},
      },
    },
  };

  // Add ingress rules if present
  if (rules.ingressRules.length > 0) {
    (policy.spec as Record<string, unknown>).ingress = rules.ingressRules.map((rule) => {
      const ingressRule: Record<string, unknown> = {};

      if (rule.fromEndpoints && rule.fromEndpoints.length > 0) {
        ingressRule.fromEndpoints = rule.fromEndpoints.map((ep) => ({
          matchLabels: ep,
        }));
      }

      if (rule.fromCIDR && rule.fromCIDR.length > 0) {
        ingressRule.fromCIDR = rule.fromCIDR;
      }

      if (rule.toPorts && rule.toPorts.length > 0) {
        ingressRule.toPorts = rule.toPorts.map((p) => ({
          ports: [{ port: p.port, protocol: p.protocol }],
        }));
      }

      return ingressRule;
    });
  }

  // Add egress rules if present
  if (rules.egressRules.length > 0) {
    (policy.spec as Record<string, unknown>).egress = rules.egressRules.map((rule) => {
      const egressRule: Record<string, unknown> = {};

      if (rule.toEndpoints && rule.toEndpoints.length > 0) {
        egressRule.toEndpoints = rule.toEndpoints.map((ep) => ({
          matchLabels: ep,
        }));
      }

      if (rule.toCIDR && rule.toCIDR.length > 0) {
        egressRule.toCIDR = rule.toCIDR;
      }

      if (rule.toFQDNs && rule.toFQDNs.length > 0) {
        egressRule.toFQDNs = rule.toFQDNs.map((fqdn) => ({
          matchName: fqdn,
        }));
      }

      if (rule.toPorts && rule.toPorts.length > 0) {
        egressRule.toPorts = rule.toPorts.map((p) => ({
          ports: [{ port: p.port, protocol: p.protocol }],
        }));
      }

      return egressRule;
    });
  }

  // Convert to YAML format
  return formatAsYAML(policy);
}

// Simple YAML formatter
function formatAsYAML(obj: unknown, indent = 0): string {
  const spaces = "  ".repeat(indent);

  if (obj === null || obj === undefined) {
    return "null";
  }

  if (typeof obj === "string") {
    // Quote strings that need it
    if (obj.includes(":") || obj.includes("#") || obj.includes("'") || obj.includes('"') || obj.match(/^\d/)) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj;
  }

  if (typeof obj === "number" || typeof obj === "boolean") {
    return String(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      return "[]";
    }
    return obj
      .map((item) => {
        const formatted = formatAsYAML(item, indent + 1);
        if (typeof item === "object" && item !== null) {
          const lines = formatted.split("\n");
          return `${spaces}- ${lines[0]}\n${lines.slice(1).map((l) => `${spaces}  ${l}`).join("\n")}`.trimEnd();
        }
        return `${spaces}- ${formatted}`;
      })
      .join("\n");
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) {
      return "{}";
    }
    return entries
      .map(([key, value]) => {
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          const formatted = formatAsYAML(value, indent + 1);
          return `${spaces}${key}:\n${formatted.split("\n").map((l) => `${spaces}  ${l}`).join("\n")}`;
        }
        if (Array.isArray(value)) {
          const formatted = formatAsYAML(value, indent + 1);
          return `${spaces}${key}:\n${formatted}`;
        }
        return `${spaces}${key}: ${formatAsYAML(value, indent)}`;
      })
      .join("\n");
  }

  return String(obj);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request
    const validationResult = generatePolicyRequestSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: validationResult.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    const { description, policyType, targetNamespace, policyName } = validationResult.data;

    // Parse the description to extract rules
    const parsedRules = parseDescription(description);

    // Extract or use provided namespace
    const namespace = targetNamespace ?? extractNamespace(description);

    // Generate or use provided policy name
    const name = policyName ?? generatePolicyName(description);

    // Determine if clusterwide
    const isClusterwide = policyType === "CILIUM_CLUSTERWIDE";

    // Generate the policy YAML
    const content = generateCiliumPolicyYAML(name, namespace, parsedRules, isClusterwide);

    // Build response
    const generatedPolicy: GeneratedPolicy = {
      name,
      description,
      type: policyType,
      content,
      targetNamespaces: namespace ? [namespace] : [],
      parsedRules,
      generatedFrom: description,
    };

    return NextResponse.json(generatedPolicy, { status: 200 });
  } catch (error) {
    console.error("Error generating policy:", error);

    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET endpoint for documentation
export async function GET() {
  return NextResponse.json({
    endpoint: "/api/policies/generate",
    method: "POST",
    description: "Generate a CiliumNetworkPolicy from a natural language description",
    requestBody: {
      description: {
        type: "string",
        required: true,
        description: "Natural language description of the desired network policy",
        examples: [
          "Allow ingress from app frontend on port 80",
          "Deny all egress except DNS",
          "Allow pods with app: api to connect to database on port 5432",
          "Allow HTTP traffic to app: web-server in namespace production",
        ],
      },
      policyType: {
        type: "string",
        required: false,
        default: "CILIUM_NETWORK",
        enum: ["CILIUM_NETWORK", "CILIUM_CLUSTERWIDE"],
        description: "Type of Cilium policy to generate",
      },
      targetNamespace: {
        type: "string",
        required: false,
        description: "Target namespace for the policy (extracted from description if not provided)",
      },
      policyName: {
        type: "string",
        required: false,
        description: "Name for the generated policy (auto-generated if not provided)",
      },
    },
    response: {
      name: "Generated policy name",
      description: "Original description",
      type: "Policy type (CILIUM_NETWORK or CILIUM_CLUSTERWIDE)",
      content: "Generated CiliumNetworkPolicy YAML",
      targetNamespaces: "Array of target namespaces",
      parsedRules: "Parsed rules object with podSelector, ingressRules, and egressRules",
      generatedFrom: "Original description used for generation",
    },
    supportedPatterns: [
      "Allow ingress from specific apps",
      "Allow egress to specific apps",
      "Allow specific ports (TCP/UDP)",
      "Allow HTTP/HTTPS traffic",
      "Database access (PostgreSQL, MySQL, MongoDB)",
      "Deny all ingress/egress",
      "Allow DNS queries",
      "Allow external/internet access",
      "Allow from/to specific CIDR ranges",
      "Allow access to specific FQDNs",
    ],
  });
}

