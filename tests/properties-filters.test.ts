import { describe, expect, it } from "vitest";
import { createTestOrganization } from "./setup/factories";
import { createDefinition, deleteDefinition, updateDefinition } from "@/server/services/property-definitions";
import { createContact, listContacts, updateContact, getContact } from "@/server/services/contacts";
import { createView, listViews } from "@/server/services/views";
import { buildWhere, resolveDateValue, OPERATORS_BY_TYPE } from "@/lib/filters";
import { coerceValue, columnForType, type PropertyDefinitionDTO } from "@/lib/properties";

const textDefinition: PropertyDefinitionDTO = {
  id: "def-1",
  objectType: "CONTACT",
  key: "region",
  label: "Region",
  description: null,
  type: "SELECT",
  options: [
    { value: "nord", label: "Nord" },
    { value: "sued", label: "Süd" },
  ],
  isRequired: false,
  isSystem: false,
  isArchived: false,
  groupName: null,
  position: 0,
};

describe("Eigene Eigenschaften", () => {
  it("wählt die Spalte passend zum Datentyp", () => {
    expect(columnForType("TEXT")).toBe("valueText");
    expect(columnForType("CURRENCY")).toBe("valueNumber");
    expect(columnForType("BOOLEAN")).toBe("valueBoolean");
    expect(columnForType("DATETIME")).toBe("valueDate");
    expect(columnForType("MULTISELECT")).toBe("valueJson");
  });

  it("validiert Werte gegen ihre Definition", () => {
    expect(coerceValue(textDefinition, "nord").valueText).toBe("nord");
    expect(() => coerceValue(textDefinition, "west")).toThrow();

    const numberDefinition = { ...textDefinition, type: "NUMBER" as const, options: [] };
    expect(coerceValue(numberDefinition, "12,5").valueNumber).toBe(12.5);
    expect(() => coerceValue(numberDefinition, "keine Zahl")).toThrow();

    const requiredDefinition = { ...textDefinition, isRequired: true };
    expect(() => coerceValue(requiredDefinition, "")).toThrow();
  });

  it("speichert und liest eigene Eigenschaften am Kontakt", async () => {
    const { ctx } = await createTestOrganization();
    await createDefinition(ctx, {
      objectType: "CONTACT",
      key: "budget",
      label: "Budget",
      type: "CURRENCY",
      isRequired: false,
    });

    const contact = await createContact(ctx, {
      firstName: "Eigenschaft",
      lastName: "Test",
      properties: { budget: 25_000 },
    });

    expect(contact.properties.budget).toBe(25_000);

    await updateContact(ctx, contact.id, { properties: { budget: 30_000 } });
    const updated = await getContact(ctx, contact.id);
    expect(updated.properties.budget).toBe(30_000);
  });

  it("weist unbekannte Eigenschaften ab", async () => {
    const { ctx } = await createTestOrganization();
    await expect(
      createContact(ctx, { firstName: "Unbekannt", lastName: "Feld", properties: { gibtEsNicht: 1 } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("erzwingt Pflichteigenschaften beim Anlegen", async () => {
    const { ctx } = await createTestOrganization();
    await createDefinition(ctx, {
      objectType: "CONTACT",
      key: "quelle_detail",
      label: "Quelle im Detail",
      type: "TEXT",
      isRequired: true,
    });

    await expect(createContact(ctx, { firstName: "Ohne", lastName: "Pflichtfeld" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    const ok = await createContact(ctx, {
      firstName: "Mit",
      lastName: "Pflichtfeld",
      properties: { quelle_detail: "Messe" },
    });
    expect(ok.properties.quelle_detail).toBe("Messe");
  });

  it("verweigert das Löschen von Eigenschaften mit gespeicherten Werten", async () => {
    const { ctx } = await createTestOrganization();
    const definition = await createDefinition(ctx, {
      objectType: "CONTACT",
      key: "vertragsende",
      label: "Vertragsende",
      type: "DATE",
      isRequired: false,
    });

    await createContact(ctx, { firstName: "Mit", lastName: "Wert", properties: { vertragsende: "2026-12-31" } });

    await expect(deleteDefinition(ctx, definition.id)).rejects.toMatchObject({ code: "CONFLICT" });

    // Archiving stays possible.
    const archived = await updateDefinition(ctx, definition.id, { label: "Vertragsende", isRequired: false, isArchived: true });
    expect(archived.isArchived).toBe(true);
  });

  it("erzwingt Optionen bei Auswahlfeldern", async () => {
    const { ctx } = await createTestOrganization();
    await expect(
      createDefinition(ctx, { objectType: "DEAL", key: "kategorie", label: "Kategorie", type: "SELECT", isRequired: false }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("lässt ein Auswahlfeld ändern, ohne die Optionen erneut zu senden", async () => {
    const { ctx } = await createTestOrganization();
    const definition = await createDefinition(ctx, {
      objectType: "CONTACT",
      key: "betreuungsstufe",
      label: "Betreuungsstufe",
      type: "SELECT",
      isRequired: false,
      options: [
        { value: "basis", label: "Basis" },
        { value: "key_account", label: "Key Account" },
      ],
    });

    // Ein Teil-Update ohne `options` darf nicht daran scheitern, dass es die
    // vorhandenen Optionen nicht mitschickt — und es darf sie nicht löschen.
    const renamed = await updateDefinition(ctx, definition.id, { label: "Betreuungsstufe (intern)", isRequired: false });
    expect(renamed.label).toBe("Betreuungsstufe (intern)");
    expect(renamed.options.map((option) => option.value)).toEqual(["basis", "key_account"]);

    const archived = await updateDefinition(ctx, definition.id, { label: renamed.label, isRequired: false, isArchived: true });
    expect(archived.isArchived).toBe(true);
    expect(archived.options).toHaveLength(2);

    // Ausdrücklich leere Optionen bleiben ein Fehler.
    await expect(
      updateDefinition(ctx, definition.id, { label: renamed.label, isRequired: false, options: [] }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("Filter-Engine", () => {
  const resolve = (field: string) =>
    field === "lastName"
      ? ({ kind: "scalar", path: "lastName", type: "string" } as const)
      : field === "amount"
        ? ({ kind: "scalar", path: "amount", type: "currency" } as const)
        : field === "createdAt"
          ? ({ kind: "scalar", path: "createdAt", type: "datetime" } as const)
          : field === "property:region"
            ? ({ kind: "property", definition: textDefinition } as const)
            : null;

  it("bietet je Datentyp nur passende Operatoren an", () => {
    expect(OPERATORS_BY_TYPE.string).toContain("contains");
    expect(OPERATORS_BY_TYPE.number).not.toContain("contains");
    expect(OPERATORS_BY_TYPE.boolean).toEqual(["eq"]);
  });

  it("übersetzt Textbedingungen", () => {
    const where = buildWhere(
      { combinator: "AND", conditions: [{ field: "lastName", operator: "contains", value: "meier" }] },
      resolve,
    );
    expect(where).toEqual({ AND: [{ lastName: { contains: "meier", mode: "insensitive" } }] });
  });

  it("übersetzt Zahlenvergleiche", () => {
    const where = buildWhere({ combinator: "AND", conditions: [{ field: "amount", operator: "gt", value: 10_000 }] }, resolve);
    expect(where).toEqual({ AND: [{ amount: { gt: 10_000 } }] });
  });

  it("verknüpft Gruppen mit ODER", () => {
    const where = buildWhere(
      {
        combinator: "OR",
        conditions: [
          { field: "lastName", operator: "eq", value: "Nord" },
          { field: "amount", operator: "lt", value: 500 },
        ],
      },
      resolve,
    );
    expect(where).toHaveProperty("OR");
    expect((where as { OR: unknown[] }).OR).toHaveLength(2);
  });

  it("filtert über eigene Eigenschaften", () => {
    const where = buildWhere(
      { combinator: "AND", conditions: [{ field: "property:region", operator: "eq", value: "nord" }] },
      resolve,
    ) as { AND: { propertyValues: { some: Record<string, unknown> } }[] };

    expect(where.AND[0].propertyValues.some).toMatchObject({ definitionId: "def-1" });
  });

  it("weist unbekannte Felder ab statt alles zu matchen", () => {
    expect(() =>
      buildWhere({ combinator: "AND", conditions: [{ field: "geheim", operator: "eq", value: "x" }] }, resolve),
    ).toThrow();
  });

  it("löst relative Datumsangaben auf", () => {
    const now = Date.now();
    const past = resolveDateValue("-14d").getTime();
    const future = resolveDateValue("+7d").getTime();

    expect(now - past).toBeGreaterThan(13 * 86_400_000);
    expect(future - now).toBeGreaterThan(6 * 86_400_000);
    expect(() => resolveDateValue("kein Datum")).toThrow();
  });

  it("wendet gespeicherte Filter auf echte Daten an", async () => {
    const { ctx } = await createTestOrganization();
    await createContact(ctx, { firstName: "Bertha", lastName: "Berg", city: "Hamburg" });
    await createContact(ctx, { firstName: "Clara", lastName: "Cloud", city: "München" });

    const filtered = await listContacts(ctx, {
      page: 1,
      pageSize: 25,
      sortDirection: "desc",
      filter: { combinator: "AND", conditions: [{ field: "city", operator: "eq", value: "Hamburg" }] },
    });

    expect(filtered.total).toBe(1);
    expect(filtered.items[0].lastName).toBe("Berg");
  });
});

describe("Gespeicherte Ansichten", () => {
  it("speichert Filter, Spalten und Sortierung", async () => {
    const { ctx } = await createTestOrganization();

    await createView(ctx, {
      objectType: "CONTACT",
      name: "Hamburger Kontakte",
      filter: { combinator: "AND", conditions: [{ field: "city", operator: "eq", value: "Hamburg" }] },
      columns: ["lastName", "email", "city"],
      sort: { field: "lastName", direction: "asc" },
      isShared: true,
    });

    const views = await listViews(ctx, "CONTACT");
    expect(views).toHaveLength(1);
    expect(views[0].name).toBe("Hamburger Kontakte");
    expect(views[0].columns).toContain("city");
    expect(views[0].isOwn).toBe(true);
  });

  it("verhindert doppelte Namen je Benutzer", async () => {
    const { ctx } = await createTestOrganization();
    const view = {
      objectType: "CONTACT" as const,
      name: "Meine Ansicht",
      filter: { combinator: "AND" as const, conditions: [] },
      columns: ["lastName"],
      isShared: false,
    };

    await createView(ctx, view);
    await expect(createView(ctx, view)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
