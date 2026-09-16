import type { Metadata } from "next";
import Link from "next/link";
import { readInvitation } from "@/server/services/users";
import { AcceptInvitationForm } from "./accept-form";

export const metadata: Metadata = { title: "Einladung annehmen" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let invitation: Awaited<ReturnType<typeof readInvitation>> | null = null;
  try {
    invitation = await readInvitation(token);
  } catch {
    invitation = null;
  }

  if (!invitation) {
    return (
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-ink-900">Einladung ungültig</h2>
        <p className="mt-2 text-sm text-ink-500">
          Diese Einladung ist abgelaufen, wurde zurückgezogen oder bereits verwendet. Bitte fordere eine neue
          Einladung an.
        </p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">
          Zur Anmeldung
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight text-ink-900">Einladung annehmen</h2>
      <p className="mt-1.5 text-sm text-ink-500">
        Du wurdest zu <span className="font-medium text-ink-800">{invitation.organizationName}</span> eingeladen.
      </p>
      <div className="mt-8">
        <AcceptInvitationForm token={token} email={invitation.email} />
      </div>
    </div>
  );
}
