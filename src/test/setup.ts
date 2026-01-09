import "@testing-library/jest-dom/vitest";
import { vi, beforeEach } from "vitest";

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  useParams: () => ({}),
}));

// Mock Clerk authentication
vi.mock("@clerk/nextjs", () => ({
  auth: () => ({ userId: "test-user-id" }),
  currentUser: () => ({
    id: "test-user-id",
    emailAddresses: [{ emailAddress: "test@example.com" }],
  }),
  useUser: () => ({
    user: {
      id: "test-user-id",
      emailAddresses: [{ emailAddress: "test@example.com" }],
    },
    isLoaded: true,
    isSignedIn: true,
  }),
  useAuth: () => ({
    userId: "test-user-id",
    isLoaded: true,
    isSignedIn: true,
  }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  SignInButton: () => null,
  SignOutButton: () => null,
  UserButton: () => null,
}));

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});
