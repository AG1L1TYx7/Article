import { Suspense } from "react";
import { googleEnabled } from "@/lib/auth/config";
import { LoginForm } from "./LoginForm";

/**
 * A server component purely so it can read whether Google sign-in is
 * configured. `googleEnabled` is derived from GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET, which are server-only and must stay that way — so
 * the flag is resolved here and handed to the client form as a prop,
 * rather than exposing another NEXT_PUBLIC_ variable that could drift out
 * of step with the one the auth config actually uses.
 *
 * The Suspense boundary is required by useSearchParams() inside the form.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm googleEnabled={googleEnabled} />
    </Suspense>
  );
}
