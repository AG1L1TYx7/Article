import { Suspense } from "react";
import { googleEnabled } from "@/lib/auth/config";
import { RegisterForm } from "./RegisterForm";

/**
 * Server component, for the same reason /login is one: whether Google
 * sign-in is configured is decided by server-only environment variables,
 * and the flag is handed down rather than published to the browser.
 */
export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm googleEnabled={googleEnabled} />
    </Suspense>
  );
}
