import Link from "next/link";
import { SITE_NAME } from "@/lib/siteUrl";

/**
 * Sign-in pages get a quiet shell: the wordmark to get back home, one
 * centred card, and nothing else competing for attention.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex h-16 items-center justify-center">
        <Link href="/" className="headline text-2xl font-semibold tracking-[-0.02em]">
          {SITE_NAME}
        </Link>
      </header>
      <div className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:pt-12">
        {children}
      </div>
    </div>
  );
}
