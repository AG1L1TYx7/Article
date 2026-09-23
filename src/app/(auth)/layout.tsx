import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

/**
 * Sign-in pages get a quiet shell: the wordmark to get back home, one
 * centred card, and nothing else competing for attention.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex h-16 items-center justify-center">
        <Link href="/">
          <Wordmark height={28} />
        </Link>
      </header>
      <div className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:pt-12">
        {children}
      </div>
    </div>
  );
}
