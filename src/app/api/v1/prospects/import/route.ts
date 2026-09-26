import { z } from "zod";
import { route, readBody } from "@/lib/api/route";
import { ValidationError } from "@/lib/api/errors";
import { intakeCandidates } from "@/server/services/acquisition/intake";
import { candidatesFromCsv, CSV_PROSPECT_FIELDS } from "@/server/acquisition/providers/csv";
import { prospectingProvider } from "@/server/acquisition/providers/registry";

/**
 * Übernahme aus einer Quelle.
 *
 * Zwei Wege, ein Ergebnis: eine Tabelle mit Spaltenzuordnung, oder eine Suche
 * bei einer Quelle, die suchen kann. Beide landen in derselben Übernahme — mit
 * Dublettenprüfung, Herkunft und Kontaktsperre.
 */
const importSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("csv"),
    filename: z.string().max(200).default("import.csv"),
    content: z.string().max(10 * 1024 * 1024),
    mapping: z.record(z.string().max(200), z.enum(CSV_PROSPECT_FIELDS)),
    listId: z.string().max(30).optional(),
    ownerId: z.string().max(30).optional(),
  }),
  z.object({
    mode: z.literal("search"),
    sourceKey: z.string().max(40),
    freeText: z.string().max(200).optional(),
    industry: z.string().max(120).optional(),
    location: z.string().max(120).optional(),
    minEmployees: z.coerce.number().int().min(0).max(10_000_000).optional(),
    maxEmployees: z.coerce.number().int().min(0).max(10_000_000).optional(),
    hasWebsite: z.boolean().optional(),
    role: z.string().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    listId: z.string().max(30).optional(),
    ownerId: z.string().max(30).optional(),
  }),
]);

export const POST = route(async ({ req, ctx }) => {
  const input = await readBody(req, importSchema);

  if (input.mode === "csv") {
    const { candidates, skipped } = candidatesFromCsv(input.content, input.mapping, input.filename);
    const result = await intakeCandidates(ctx, "csv", candidates, {
      listId: input.listId ?? null,
      ownerId: input.ownerId ?? null,
    });
    return { ...result, skipped: result.skipped + skipped };
  }

  const provider = prospectingProvider(input.sourceKey);
  if (!provider) throw ValidationError("Diese Quelle ist nicht angebunden.");
  if (provider.capabilities.length === 0) {
    throw ValidationError(`„${provider.label}" durchsucht nichts. ${provider.description}`);
  }
  if (!(await provider.available(ctx))) {
    throw ValidationError(`„${provider.label}" ist in dieser Organisation nicht verfügbar.`);
  }

  const found = await provider.search(ctx, input);
  const result = await intakeCandidates(ctx, provider.key, found.candidates, {
    listId: input.listId ?? null,
    ownerId: input.ownerId ?? null,
  });
  return { ...result, note: found.note ?? null };
});
