import { redirect } from "next/navigation";
import { getCurrentUser } from "~/lib/auth";
import AdminSidebar from "~/components/layout/admin-sidebar";

/**
 * Admin Layout
 *
 * This layout wraps all admin pages and enforces SuperAdmin access.
 * Users without SuperAdmin privileges are redirected to the dashboard.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  // Redirect unauthenticated users to sign-in
  if (!user) {
    redirect("/sign-in");
  }

  // Redirect non-SuperAdmins to the main dashboard
  if (!user.isSuperAdmin) {
    redirect("/dashboard");
  }

  return (
    <div className="flex h-screen bg-background">
      <AdminSidebar />
      <main className="flex-1 overflow-auto">
        <div className="container mx-auto max-w-7xl px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
