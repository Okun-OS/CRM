import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mailwinOpenApi } from "../src/server/mailwin/openapi";

/**
 * Schreibt die OpenAPI-Spezifikation der Mailwin Connect API nach
 * docs/mailwin/openapi.json. Ein Test prüft, dass Datei und ausgelieferte
 * Spezifikation übereinstimmen — nach jeder Änderung an
 * src/server/mailwin/openapi.ts einmal ausführen: `pnpm mailwin:openapi`.
 */
const target = "docs/mailwin/openapi.json";
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(mailwinOpenApi(), null, 2)}\n`);
console.log(`OpenAPI geschrieben: ${target}`);
