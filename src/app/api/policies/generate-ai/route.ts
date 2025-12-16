import { type NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// Request validation schema
const generatePolicyRequestSchema = z.object({
  prompt: z
    .string()
    .min(10, "Description must be at least 10 characters")
    .max(2000, "Description must be 2000 characters or less"),
  policyType: z
    .enum([
      "CILIUM_NETWORK",
      "CILIUM_CLUSTERWIDE",
      "TETRAGON",
      "GATEWAY_HTTPROUTE",
      "GATEWAY_GRPCROUTE",
      "GATEWAY_TCPROUTE",
    ])
    .default("CILIUM_NETWORK"),
  targetNamespace: z.string().optional(),
});

const SYSTEM_PROMPT = `You are an expert Kubernetes network policy engineer specializing in Cilium, Tetragon, and Gateway API policies. Your task is to generate valid, production-ready Kubernetes policy YAML based on natural language descriptions.

Guidelines:
1. Generate ONLY valid YAML - no explanations before or after the YAML
2. Use proper Kubernetes API versions and kinds
3. Include helpful comments in the YAML explaining key sections
4. Follow security best practices (principle of least privilege)
5. Use descriptive names for policies based on their purpose

Policy Types:
- CILIUM_NETWORK: CiliumNetworkPolicy (apiVersion: cilium.io/v2) - namespace-scoped network policies
- CILIUM_CLUSTERWIDE: CiliumClusterwideNetworkPolicy (apiVersion: cilium.io/v2) - cluster-wide network policies
- TETRAGON: TracingPolicy (apiVersion: cilium.io/v1alpha1) - runtime security and observability
- GATEWAY_HTTPROUTE: HTTPRoute (apiVersion: gateway.networking.k8s.io/v1) - HTTP routing rules
- GATEWAY_GRPCROUTE: GRPCRoute (apiVersion: gateway.networking.k8s.io/v1alpha2) - gRPC routing rules
- GATEWAY_TCPROUTE: TCPRoute (apiVersion: gateway.networking.k8s.io/v1alpha2) - TCP routing rules

For Cilium Network Policies, remember:
- endpointSelector selects the pods the policy applies TO
- ingress rules define what can connect TO the selected pods
- egress rules define what the selected pods can connect TO
- Use matchLabels for selecting pods by labels
- Use fromEndpoints/toEndpoints for pod-to-pod rules
- Use fromCIDR/toCIDR for IP-based rules
- Use toPorts for port restrictions
- Use toFQDNs for DNS-based egress rules

For Tetragon Tracing Policies:
- Use kprobes for kernel-level tracing
- Use tracepoints for predefined kernel events
- Define selectors to filter which processes/pods to monitor
- Common syscalls: sys_execve, sys_open, sys_connect, sys_write

Respond with ONLY the YAML content, starting with "apiVersion:" and nothing else.`;

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();

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

    const { prompt, policyType, targetNamespace } = validationResult.data;

    // Check for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error: "ANTHROPIC_API_KEY is not configured",
          message: "Please add your Anthropic API key to the .env file",
        },
        { status: 500 }
      );
    }

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey,
    });

    // Build the user prompt
    const userPrompt = `Generate a ${policyType} policy for the following requirement:

"${prompt}"

${targetNamespace ? `Target namespace: ${targetNamespace}` : ""}

Remember:
- Output ONLY valid YAML starting with "apiVersion:"
- Include comments explaining the policy
- Follow security best practices
- Use descriptive metadata names`;

    // Call Claude API
    const message = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
      system: SYSTEM_PROMPT,
    });

    // Extract the generated YAML
    const content = message.content[0];
    if (!content || content.type !== "text") {
      return NextResponse.json(
        { error: "Unexpected response format from Claude" },
        { status: 500 }
      );
    }

    let generatedYaml = (content as { type: "text"; text: string }).text.trim();

    // Clean up the response - remove markdown code blocks if present
    if (generatedYaml.startsWith("```yaml")) {
      generatedYaml = generatedYaml.slice(7);
    } else if (generatedYaml.startsWith("```")) {
      generatedYaml = generatedYaml.slice(3);
    }
    if (generatedYaml.endsWith("```")) {
      generatedYaml = generatedYaml.slice(0, -3);
    }
    generatedYaml = generatedYaml.trim();

    // Extract policy name from YAML
    const nameMatch = generatedYaml.match(/name:\s*["']?([a-z0-9-]+)["']?/);
    const policyName = nameMatch?.[1] ?? "generated-policy";

    // Extract namespace from YAML if present
    const namespaceMatch = generatedYaml.match(/namespace:\s*["']?([a-z0-9-]+)["']?/);
    const extractedNamespace = namespaceMatch?.[1];

    return NextResponse.json({
      success: true,
      policy: {
        name: policyName,
        description: prompt,
        type: policyType,
        content: generatedYaml,
        targetNamespaces: extractedNamespace ? [extractedNamespace] : targetNamespace ? [targetNamespace] : [],
        generatedFrom: prompt,
        generatedModel: "claude-3-haiku-20240307",
      },
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    });
  } catch (error) {
    console.error("Error generating policy with Claude:", error);

    if (error instanceof Anthropic.APIError) {
      const statusCode = typeof error.status === "number" ? error.status : 500;
      return NextResponse.json(
        {
          error: "Claude API error",
          message: error.message,
          status: statusCode,
        },
        { status: statusCode }
      );
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
