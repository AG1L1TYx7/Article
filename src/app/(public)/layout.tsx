import { after } from "next/server";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { publishDueArticles } from "@/lib/scheduledPublishing";

/** The reader-facing shell: masthead above, footer below. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  // Scheduled stories go live on the first public request after their
  // time, once the response is out the door. Throttled to once a minute
  // inside; see lib/scheduledPublishing.ts.
  after(() => publishDueArticles().catch(() => {}));

  return (
    <>
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </>
  );
}
