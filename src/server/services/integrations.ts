import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";
import { ValidationError } from "@/lib/api/errors";
import { INTEGRATIONS, findIntegration } from "@/server/integrations/registry";
import { parseSmtpConfig, verifySmtp } from "@/server/integrations/smtp";

/**
 * Verwaltung der Integrationsverbindungen einer Organisation.
 *
 * Geheimnisse gehen nur in eine Richtung: Sie werden verschlüsselt abgelegt
 * (AES-256-GCM) und von keiner Abfrage je zurückgegeben — auch nicht an
 * Administratoren. Wer das Passwort ändern will, gibt ein neues ein.
 */
export const smtpConnectionSchema = z.object({
  host: z.string().trim().min(1, "Bitte den SMTP-Host angeben.").max(200),
  port: z.coerce.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  user: z.string().trim().min(1, "Bitte den Benutzernamen angeben.").max(200),
  password: z.string().min(1, "Bitte das Passwort angeben.").max(400),
  fromAddress: z.string().trim().email("Bitte eine gültige Absenderadresse angeben.").max(254),
  fromName: z.string().trim().max(80).optional(),
});

export async function listConnections(ctx: ActorContext) {
  assertPermission(ctx, "settings.manage");
  const connections = await prisma.integrationConnection.findMany({
    where: scope(ctx),
    select: {
      id: true,
      provider: true,
      status: true,
      displayName: true,
      config: true,
      connectedAt: true,
      lastError: true,
      lastErrorAt: true,
    },
  });

  const byProvider = new Map(connections.map((connection) => [connection.provider, connection]));

  return INTEGRATIONS.map((descriptor) => {
    const connection = byProvider.get(descriptor.provider);
    const config = (connection?.config as Record<string, unknown> | null) ?? null;
    return {
      ...descriptor,
      connection: connection
        ? {
            id: connection.id,
            status: connection.status,
            displayName: connection.displayName,
            connectedAt: connection.connectedAt?.toISOString() ?? null,
            lastError: connection.lastError,
            lastErrorAt: connection.lastErrorAt?.toISOString() ?? null,
            // Nur nicht-geheime Teile der Konfiguration.
            host: typeof config?.host === "string" ? config.host : null,
            port: typeof config?.port === "number" ? config.port : null,
            user: typeof config?.user === "string" ? config.user : null,
            fromAddress: typeof config?.fromAddress === "string" ? config.fromAddress : null,
          }
        : null,
    };
  });
}

/**
 * Verbindet einen SMTP-Postausgang. Die Zugangsdaten werden **vor** dem
 * Speichern geprüft — eine Verbindung, die nicht funktioniert, wird gar nicht
 * erst angelegt.
 */
export async function connectSmtp(ctx: ActorContext, input: z.input<typeof smtpConnectionSchema>) {
  assertPermission(ctx, "settings.manage");
  const data = smtpConnectionSchema.parse(input);

  const config = parseSmtpConfig({
    host: data.host,
    port: data.port,
    secure: data.secure,
    user: data.user,
    fromAddress: data.fromAddress,
    fromName: data.fromName,
  });
  if (!config) throw ValidationError("Die Verbindungsdaten sind unvollständig.");

  const verification = await verifySmtp(config, data.password);
  if (!verification.ok) {
    throw ValidationError(`Der Postausgang hat die Verbindung abgelehnt: ${verification.reason}`);
  }

  // Der zusammengesetzte Schlüssel enthält userId; für eine
  // organisationsweite Verbindung ist der Eintrag ohne Benutzer gemeint.
  const existing = await prisma.integrationConnection.findFirst({
    where: { organizationId: ctx.organizationId, provider: "SMTP", userId: null },
    select: { id: true },
  });

  const connection = await prisma.integrationConnection.upsert({
    where: { id: existing?.id ?? "neu" },
    create: {
      organizationId: ctx.organizationId,
      provider: "SMTP",
      status: "CONNECTED",
      displayName: `${config.host}:${config.port}`,
      config: { host: config.host, port: config.port, secure: config.secure, user: config.user, fromAddress: config.fromAddress, fromName: config.fromName ?? null },
      secretCipher: encryptSecret(data.password),
      connectedAt: new Date(),
      lastError: null,
      lastErrorAt: null,
    },
    update: {
      status: "CONNECTED",
      displayName: `${config.host}:${config.port}`,
      config: { host: config.host, port: config.port, secure: config.secure, user: config.user, fromAddress: config.fromAddress, fromName: config.fromName ?? null },
      secretCipher: encryptSecret(data.password),
      connectedAt: new Date(),
      lastError: null,
      lastErrorAt: null,
    },
    select: { id: true, provider: true, status: true, displayName: true, connectedAt: true },
  });

  await writeAudit(ctx, {
    action: "integration.connected",
    entityType: "IntegrationConnection",
    entityId: connection.id,
    // Der Benutzername ja, das Passwort nie.
    after: { provider: "SMTP", host: config.host, port: config.port, user: config.user, fromAddress: config.fromAddress },
  });

  return { ...connection, connectedAt: connection.connectedAt?.toISOString() ?? null };
}

export async function disconnectIntegration(ctx: ActorContext, id: string) {
  assertPermission(ctx, "settings.manage");
  const connection = assertFound(
    await prisma.integrationConnection.findFirst({ where: { id, ...scope(ctx) }, select: { id: true, provider: true } }),
    "Diese Verbindung wurde nicht gefunden.",
  );

  await prisma.integrationConnection.delete({ where: { id: connection.id } });
  await writeAudit(ctx, {
    action: "integration.disconnected",
    entityType: "IntegrationConnection",
    entityId: connection.id,
    before: { provider: connection.provider },
  });
}

/** Prüft eine bestehende Verbindung erneut, ohne etwas zu senden. */
export async function testConnection(ctx: ActorContext, id: string) {
  assertPermission(ctx, "settings.manage");
  const connection = assertFound(
    await prisma.integrationConnection.findFirst({ where: { id, ...scope(ctx) } }),
    "Diese Verbindung wurde nicht gefunden.",
  );

  const descriptor = findIntegration(connection.provider);
  if (connection.provider !== "SMTP") {
    return { ok: false, reason: `Für ${descriptor?.name ?? connection.provider} gibt es noch keine Prüfung.` };
  }

  const config = parseSmtpConfig(connection.config);
  if (!config || !connection.secretCipher) {
    return { ok: false, reason: "Die gespeicherten Verbindungsdaten sind unvollständig." };
  }

  const result = await verifySmtp(config, decryptSecret(connection.secretCipher));
  await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: result.ok
      ? { status: "CONNECTED", lastError: null, lastErrorAt: null }
      : { status: "ERROR", lastError: result.reason.slice(0, 300), lastErrorAt: new Date() },
  });

  return result.ok ? { ok: true as const } : { ok: false as const, reason: result.reason };
}
