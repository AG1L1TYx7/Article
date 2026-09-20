import type { DefaultSession } from "next-auth";

type AppRole = "READER" | "MODERATOR" | "ADMIN";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: AppRole;
      mfaEnabled: boolean;
      emailConfirmed: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role: AppRole;
    sessionVersion: number;
    mfaEnabled: boolean;
    emailConfirmed: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: AppRole;
    sessionVersion?: number;
    mfaEnabled?: boolean;
    emailConfirmed?: boolean;
  }
}
