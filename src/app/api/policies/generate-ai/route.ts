import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getLLMProvider } from "~/lib/llm";
import { POLICY_GENERATION_SYSTEM_PROMPT } from "~/lib/llm/prompts/policy-generation";

// Force dynamic rendering - evaluate env vars at runtime, not build time
export const dynamic = "force-dynamic";

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

    // Get LLM provider
    const provider = getLLMProvider();
    if (!provider) {
      return NextResponse.json(
        {
          error: "AI policy generation is not configured",
          message:
            "Set KPH_LLM_PROVIDER and KPH_LLM_API_KEY environment variables, " +
            "or set ANTHROPIC_API_KEY for backward compatibility.",
          docs: "https://github.com/kubenetlabs/kph/docs/byom-llm-setup.md",
        },
        { status: 501 }
      );
    }

    // Build the user prompt
    const userPrompt = `Generate a ${policyType} policy for the following requirement:

"${prompt}"

${targetNamespace ? `Target namespace: ${targetNamespace}` : ""}

Remember:
- Output ONLY valid YAML starting with "apiVersion:"
- Include comments explaining the policy
- Follow security best practices
- Use descriptive metadata names`;

    // Call LLM provider
    const response = await provider.generate({
      systemPrompt: POLICY_GENERATION_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 2048,
    });

    // Extract the generated YAML
    let generatedYaml = response.content.trim();

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
        targetNamespaces: extractedNamespace
          ? [extractedNamespace]
          : targetNamespace
            ? [targetNamespace]
            : [],
        generatedFrom: prompt,
        generatedModel: response.model,
        generatedProvider: response.provider,
      },
      usage: response.usage,
    });
  } catch (error) {
    console.error("Error generating policy with LLM:", error);

    // Handle provider-specific errors
    if (error instanceof Error) {
      // Check for common API errors
      const message = error.message.toLowerCase();
      if (message.includes("api key") || message.includes("authentication") || message.includes("unauthorized")) {
        return NextResponse.json(
          {
            error: "LLM authentication failed",
            message: "Check your API key configuration",
          },
          { status: 401 }
        );
      }
      if (message.includes("rate limit") || message.includes("too many requests")) {
        return NextResponse.json(
          {
            error: "LLM rate limit exceeded",
            message: "Please try again in a moment",
          },
          { status: 429 }
        );
      }
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
