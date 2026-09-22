import { after } from "next/server";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { VerifyEmailNudge } from "@/components/VerifyEmailNudge";
import { publishDueArticles } from "@/lib/scheduledPublishing";
import { runRetention } from "@/lib/retention";

/** The reader-facing shell: masthead above, footer below. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  // Housekeeping that rides on ordinary traffic, once the response is out
  // the door: scheduled stories go live (throttled to once a minute) and
  // data past its retention period is removed (once an hour). See
  // lib/scheduledPublishing.ts and lib/retention.ts.
  after(() => publishDueArticles().catch(() => {}));
  after(() => runRetention().catch(() => {}));

  return (
    <>
      <SiteHeader />
      {/* Asks a signed-in reader to confirm their address; never blocks. */}
      <VerifyEmailNudge />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </>
  );
}
