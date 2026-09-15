import type { IntegrationProvider } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { ActorContext } from "@/lib/context";
import { scope } from "@/lib/tenant";
import { findIntegration } from "./registry";

/**
 * E-mail transport adapter contract.
 *
 * The CRM composes, stores and links e-mails itself; actually putting a message
 * on the wire is delegated to a transport. No transport is implemented yet, so
 * `resolveEmailTransport` returns a reason instead of a fake success — callers
 * surface that reason to the user.
 */
export type OutgoingEmail = {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text?: string;
};

export type EmailTransport = {
  provider: IntegrationProvider;
  send(message: OutgoingEmail): Promise<{ providerMessageId: string }>;
};

export type TransportResolution =
  | { ok: true; transport: EmailTransport; connectionId: string; fromAddress: string }
  | { ok: false; reason: string };

/** Adapters register here once implemented; the map is intentionally empty. */
const TRANSPORT_FACTORIES: Partial<
  Record<IntegrationProvider, (config: Record<string, unknown>, secret: string) => EmailTransport>
> = {};

export async function resolveEmailTransport(ctx: ActorContext): Promise<TransportResolution> {
  const connection = await prisma.integrationConnection.findFirst({
    where: {
      ...scope(ctx),
      status: "CONNECTED",
      provider: { in: ["SMTP", "GOOGLE", "MICROSOFT"] },
      OR: [{ userId: ctx.userId }, { userId: null }],
    },
    orderBy: { userId: "desc" },
  });

  if (!connection) {
    return {
      ok: false,
      reason:
        "Es ist kein E-Mail-Postausgang verbunden. Ein Administrator kann unter Einstellungen → Integrationen einen Anbieter verbinden.",
    };
  }

  const factory = TRANSPORT_FACTORIES[connection.provider];
  if (!factory) {
    const descriptor = findIntegration(connection.provider);
    return {
      ok: false,
      reason: `Für ${descriptor?.name ?? connection.provider} ist noch kein Versand-Adapter implementiert.`,
    };
  }

  const config = (connection.config as Record<string, unknown> | null) ?? {};
  const fromAddress = typeof config.fromAddress === "string" ? config.fromAddress : ctx.email;
  const { decryptSecret } = await import("@/lib/crypto");
  const secret = connection.secretCipher ? decryptSecret(connection.secretCipher) : "";

  return { ok: true, transport: factory(config, secret), connectionId: connection.id, fromAddress };
}

/** True when this organization can actually send mail today. */
export async function emailSendingAvailable(ctx: ActorContext): Promise<boolean> {
  const resolution = await resolveEmailTransport(ctx);
  return resolution.ok;
}
