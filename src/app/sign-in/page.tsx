import { redirect } from "next/navigation";
import { getAuthProviderName } from "~/lib/auth/index";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  const authProvider = getAuthProviderName();

  // In no-auth mode, redirect to dashboard
  if (authProvider === "none") {
    redirect("/dashboard");
  }

  // For Clerk, dynamically import and render SignIn
  if (authProvider === "clerk") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const clerk = require("@clerk/nextjs") as { SignIn: React.ComponentType };
    const { SignIn } = clerk;
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <SignIn />
      </div>
    );
  }

  // OIDC or unknown provider - show a message
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Sign In</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Authentication provider &quot;{authProvider}&quot; is not yet supported.
        </p>
      </div>
    </div>
  );
}
