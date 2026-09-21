import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { toErrorResponse } from "@/lib/api/route";
import { serialize } from "@/lib/api/json";
import { AppError } from "@/lib/api/errors";
import { paginate, paginationSchema, skipTake } from "@/lib/api/pagination";
import { z } from "zod";
import { contactInputSchema, dealInputSchema } from "@/lib/schemas/crm";
import { passwordSchema } from "@/lib/schemas/auth";

/**
 * The API contract: what clients can rely on. Error envelopes, pagination and
 * input validation behave the same for every endpoint.
 */
describe("API-Vertrag", () => {
  it("bildet Anwendungsfehler auf Status und Code ab", async () => {
    const response = toErrorResponse(new AppError("NOT_FOUND", "Nicht gefunden"));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toMatchObject({ code: "NOT_FOUND", message: "Nicht gefunden" });
  });

  it("gibt Validierungsfehler feldbezogen zurück", async () => {
    const parsed = z.object({ email: z.string().email() }).safeParse({ email: "keine-mail" });
    const response = toErrorResponse(parsed.success ? new Error("unerwartet") : parsed.error);

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.fields).toHaveProperty("email");
  });

  it("verrät bei unerwarteten Fehlern keine Details", async () => {
    const request = new NextRequest("http://localhost/api/v1/contacts");
    const response = toErrorResponse(new Error("Interne Datenbankverbindung xyz fehlgeschlagen"), request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.message).toBe("Es ist ein unerwarteter Fehler aufgetreten.");
    expect(JSON.stringify(body)).not.toContain("Datenbankverbindung");
  });

  it("serialisiert Datumswerte und Dezimalzahlen stabil", () => {
    const decimalLike = {
      d: [1],
      e: 3,
      s: 1,
      toFixed: (places?: number) => (1234.5).toFixed(places ?? 2),
    };
    const result = serialize({
      date: new Date("2026-03-01T10:00:00.000Z"),
      amount: decimalLike,
      nested: { big: BigInt(42) },
    }) as Record<string, unknown>;

    expect(result.date).toBe("2026-03-01T10:00:00.000Z");
    expect(result.amount).toBe(1234.5);
    expect((result.nested as Record<string, unknown>).big).toBe("42");
  });

  it("begrenzt die Seitengröße", () => {
    expect(paginationSchema.parse({}).pageSize).toBe(25);
    expect(() => paginationSchema.parse({ pageSize: 5000 })).toThrow();
    expect(skipTake({ page: 3, pageSize: 20 })).toEqual({ skip: 40, take: 20 });
    expect(paginate([1, 2], 42, { page: 1, pageSize: 20 })).toMatchObject({ total: 42, totalPages: 3 });
  });

  it("normalisiert und validiert Kontakteingaben", () => {
    const parsed = contactInputSchema.parse({
      firstName: "  Maria ",
      lastName: "Nord",
      email: "Maria@Example.DE",
      phone: "",
    });

    expect(parsed.firstName).toBe("Maria");
    expect(parsed.email).toBe("maria@example.de");
    // An empty string means "clear this field", so it normalises to null.
    expect(parsed.phone).toBeNull();
    expect(contactInputSchema.parse({ firstName: "A", lastName: "B", phone: null }).phone).toBeNull();
    expect(contactInputSchema.parse({ firstName: "A", lastName: "B" }).phone).toBeUndefined();

    expect(() => contactInputSchema.parse({ firstName: "", lastName: "Nord" })).toThrow();
    expect(() => contactInputSchema.parse({ firstName: "A", lastName: "B", email: "kaputt" })).toThrow();
  });

  it("erzwingt Pflichtangaben bei Deals", () => {
    expect(() => dealInputSchema.parse({ name: "Deal" })).toThrow();
    const parsed = dealInputSchema.parse({ name: "Deal", pipelineId: "p1", stageId: "s1" });
    expect(parsed.amount).toBe(0);
    expect(parsed.currency).toBe("EUR");
  });

  it("erzwingt die Passwortrichtlinie", () => {
    expect(() => passwordSchema.parse("kurz")).toThrow();
    expect(() => passwordSchema.parse("nurkleinbuchstaben")).toThrow();
    expect(() => passwordSchema.parse("KeineZifferHier")).toThrow();
    expect(passwordSchema.parse("EinSicheresPasswort1")).toBe("EinSicheresPasswort1");
  });
});

describe("Rate Limiting für Anmeldungen", () => {
  it("zählt nur Fehlversuche und setzt nach Erfolg zurück", async () => {
    const { assertUnderRateLimit, recordRateLimitFailure, clearRateLimit, resetRateLimits } = await import(
      "@/lib/api/rate-limit"
    );
    resetRateLimits();
    const rule = { key: "auth:login:test@example.de", limit: 3, windowMs: 60_000 };

    // Successful attempts never consume the budget.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(() => assertUnderRateLimit(rule)).not.toThrow();
      clearRateLimit(rule.key);
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      assertUnderRateLimit(rule);
      recordRateLimitFailure(rule);
    }
    expect(() => assertUnderRateLimit(rule)).toThrow();

    // A different account is unaffected — one attacker cannot lock everyone out.
    expect(() => assertUnderRateLimit({ ...rule, key: "auth:login:andere@example.de" })).not.toThrow();

    clearRateLimit(rule.key);
    expect(() => assertUnderRateLimit(rule)).not.toThrow();
  });
});

describe("Origin-Prüfung schreibender Anfragen", async () => {
  const { assertSameOrigin } = await import("@/lib/api/route");

  function request(headers: Record<string, string>, url = "https://crm.example.com/api/v1/contacts") {
    return {
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      nextUrl: new URL(url),
    } as unknown as Parameters<typeof assertSameOrigin>[0];
  }

  it("lässt eine Anfrage von derselben Adresse durch", () => {
    expect(() =>
      assertSameOrigin(request({ origin: "https://crm.example.com", host: "crm.example.com" })),
    ).not.toThrow();
  });

  it("weist eine fremde Herkunft ab", () => {
    expect(() => assertSameOrigin(request({ origin: "https://boeswillig.test", host: "crm.example.com" }))).toThrow(
      /fremden Herkunft/,
    );
  });

  it("überlebt eine falsch gesetzte APP_URL", () => {
    // APP_URL zeigt in den Tests nicht auf crm.example.com. Früher hätte das
    // jede schreibende Anfrage blockiert; jetzt entscheidet der Host-Header.
    expect(() =>
      assertSameOrigin(request({ origin: "https://andere-domain.test", host: "andere-domain.test" })),
    ).not.toThrow();
  });

  it("prüft nur, wenn der Browser eine Herkunft mitschickt", () => {
    expect(() => assertSameOrigin(request({ host: "crm.example.com" }))).not.toThrow();
  });
});
