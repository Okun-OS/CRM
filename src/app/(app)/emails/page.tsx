import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { emailSendingAvailable } from "@/server/integrations/email";
import { EmailsView } from "./emails-view";

export const metadata: Metadata = { title: "E-Mails" };
export const dynamic = "force-dynamic";

export default async function EmailsPage() {
  const actor = await getActor();
  if (!actor) return null;
  const canSend = await emailSendingAvailable(actor);

  return (
    <div className="space-y-5">
      <PageHeader
        title="E-Mails"
        description="Kommunikation, die dem CRM bekannt ist – verknüpft mit Kontakten, Unternehmen und Deals."
        actions={
          <Link href="/templates">
            <Button variant="secondary" icon={<FileText className="h-4 w-4" />}>
              Vorlagen
            </Button>
          </Link>
        }
      />
      <EmailsView transportConnected={canSend} canCompose={can(actor, "emails.send")} />
    </div>
  );
}
