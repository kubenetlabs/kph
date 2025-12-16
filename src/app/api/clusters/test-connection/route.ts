import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { testKubernetesConnection } from "~/lib/kubernetes-client";

const testConnectionSchema = z.object({
  endpoint: z.string().url(),
  token: z.string().min(1),
  caCert: z.string().optional(),
});

/**
 * POST /api/clusters/test-connection
 * Test connectivity to a Kubernetes cluster.
 * This endpoint proxies the connection test to avoid CORS issues from browser.
 */
export async function POST(request: NextRequest) {
  // TODO: Add proper authentication when NextAuth is configured
  // For now, this endpoint is accessible to authenticated users via the UI

  try {
    const body: unknown = await request.json();

    // Validate request body
    const validationResult = testConnectionSchema.safeParse(body);
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

    const { endpoint, token, caCert } = validationResult.data;

    // Test the connection
    const result = await testKubernetesConnection(endpoint, token, caCert);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error testing connection:", error);

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
