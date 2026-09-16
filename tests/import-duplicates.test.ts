import { describe, expect, it } from "vitest";
import { createTestOrganization } from "./setup/factories";
import { parseCsv, detectDelimiter, toCsv } from "@/lib/csv";
import { analyzeImport, runImport } from "@/server/services/imports";
import { createContact, getContact, listContacts } from "@/server/services/contacts";
import { createCompany } from "@/server/services/companies";
import { findContactDuplicates, findCompanyDuplicates, mergeContacts } from "@/server/services/duplicates";
import { createTask } from "@/server/services/tasks";
import { createNote } from "@/server/services/notes";
import { prisma } from "@/lib/db";

describe("CSV-Verarbeitung", () => {
  it("erkennt das Trennzeichen", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });

  it("liest Anführungszeichen, eingebettete Trennzeichen und Zeilenumbrüche", () => {
    const csv = 'Name;Notiz\n"Meier, Klaus";"Zeile 1\nZeile 2"\n"Er sagte ""hallo""";kurz\n';
    const parsed = parseCsv(csv);

    expect(parsed.headers).toEqual(["Name", "Notiz"]);
    expect(parsed.rows[0][0]).toBe("Meier, Klaus");
    expect(parsed.rows[0][1]).toBe("Zeile 1\nZeile 2");
    expect(parsed.rows[1][0]).toBe('Er sagte "hallo"');
  });

  it("entfernt das BOM und leere Zeilen", () => {
    const parsed = parseCsv("﻿a,b\n1,2\n\n");
    expect(parsed.headers).toEqual(["a", "b"]);
    expect(parsed.rows).toHaveLength(1);
  });

  it("schreibt CSV mit korrektem Quoting", () => {
    const csv = toCsv(["Name", "Ort"], [["Meier; Klaus", "Hamburg"], ['Mit "Zitat"', null]], ";");
    expect(csv).toContain('"Meier; Klaus";Hamburg');
    expect(csv).toContain('"Mit ""Zitat""";');
  });
});

describe("CSV-Import", () => {
  const csv = [
    "Vorname;Nachname;E-Mail;Telefon;Stadt",
    "Anna;Muster;anna@muster.de;+49 40 1;Hamburg",
    "Ben;Beispiel;ben@beispiel.de;+49 89 2;München",
  ].join("\n");

  it("schlägt eine Zuordnung anhand der Kopfzeile vor", async () => {
    const { ctx } = await createTestOrganization();
    const analysis = await analyzeImport(ctx, { objectType: "CONTACT", filename: "kontakte.csv", content: csv });

    expect(analysis.totalRows).toBe(2);
    expect(analysis.delimiter).toBe(";");
    expect(analysis.suggestedMapping).toMatchObject({
      Vorname: "firstName",
      Nachname: "lastName",
      "E-Mail": "email",
      Telefon: "phone",
      Stadt: "city",
    });
    expect(analysis.preview).toHaveLength(2);
  });

  it("importiert Zeilen und meldet das Ergebnis", async () => {
    const { ctx } = await createTestOrganization();
    const result = await runImport(ctx, {
      objectType: "CONTACT",
      filename: "kontakte.csv",
      content: csv,
      mapping: { Vorname: "firstName", Nachname: "lastName", "E-Mail": "email", Telefon: "phone", Stadt: "city" },
      duplicateStrategy: "SKIP",
    });

    expect(result.imported).toBe(2);
    expect(result.errorCount).toBe(0);

    const contacts = await listContacts(ctx, { page: 1, pageSize: 25, sortDirection: "desc" });
    expect(contacts.total).toBe(2);
  });

  it("überspringt oder aktualisiert Duplikate je nach Strategie", async () => {
    const { ctx } = await createTestOrganization();
    await createContact(ctx, { firstName: "Anna", lastName: "Alt", email: "anna@muster.de" });

    const skipped = await runImport(ctx, {
      objectType: "CONTACT",
      filename: "kontakte.csv",
      content: csv,
      mapping: { Vorname: "firstName", Nachname: "lastName", "E-Mail": "email" },
      duplicateStrategy: "SKIP",
    });
    expect(skipped.skipped).toBe(1);
    expect(skipped.imported).toBe(1);

    const updated = await runImport(ctx, {
      objectType: "CONTACT",
      filename: "kontakte.csv",
      content: csv,
      mapping: { Vorname: "firstName", Nachname: "lastName", "E-Mail": "email" },
      duplicateStrategy: "UPDATE",
    });
    expect(updated.updated).toBeGreaterThan(0);

    const contacts = await listContacts(ctx, { page: 1, pageSize: 25, sortDirection: "desc" });
    const anna = contacts.items.find((item) => item.email === "anna@muster.de");
    expect(anna?.lastName).toBe("Muster");
  });

  it("verlangt die Zuordnung von Pflichtfeldern", async () => {
    const { ctx } = await createTestOrganization();
    await expect(
      runImport(ctx, {
        objectType: "CONTACT",
        filename: "kontakte.csv",
        content: csv,
        mapping: { Stadt: "city" },
        duplicateStrategy: "SKIP",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("meldet fehlerhafte Zeilen, ohne den Import abzubrechen", async () => {
    const { ctx } = await createTestOrganization();
    const broken = ["Vorname;Nachname;E-Mail", "Ok;Zeile;ok@example.de", "Fehler;Zeile;keine-email"].join("\n");

    const result = await runImport(ctx, {
      objectType: "CONTACT",
      filename: "kaputt.csv",
      content: broken,
      mapping: { Vorname: "firstName", Nachname: "lastName", "E-Mail": "email" },
      duplicateStrategy: "SKIP",
    });

    expect(result.imported).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(result.errors[0].row).toBe(3);
  });
});

describe("Duplikate", () => {
  it("erkennt Kontakte mit gleicher E-Mail und Unternehmen mit gleicher Domain", async () => {
    const { ctx } = await createTestOrganization();
    await createContact(ctx, { firstName: "Doppel", lastName: "Eins", email: "doppel@example.de" });
    await createContact(ctx, { firstName: "Doppel", lastName: "Zwei", email: "doppel@example.de" });
    await createCompany(ctx, { name: "Doppel GmbH", domain: "doppel.de" });
    await createCompany(ctx, { name: "Doppel Deutschland GmbH", domain: "www.doppel.de" });

    const contactGroups = await findContactDuplicates(ctx);
    const companyGroups = await findCompanyDuplicates(ctx);

    expect(contactGroups).toHaveLength(1);
    expect(contactGroups[0].records).toHaveLength(2);
    expect(companyGroups).toHaveLength(1);
  });

  it("führt Kontakte zusammen, ohne Daten zu verlieren", async () => {
    const { ctx } = await createTestOrganization();
    const primary = await createContact(ctx, { firstName: "Haupt", lastName: "Datensatz", email: "merge@example.de" });
    const duplicate = await createContact(ctx, {
      firstName: "Dupl",
      lastName: "Datensatz",
      email: "merge@example.de",
      phone: "+49 40 999",
      jobTitle: "Einkauf",
    });

    await createTask(ctx, { title: "Aufgabe am Duplikat", contactId: duplicate.id, status: "OPEN", priority: "MEDIUM" });
    await createNote(ctx, { body: "Notiz am Duplikat", contactId: duplicate.id });

    const result = await mergeContacts(ctx, primary.id, duplicate.id);
    expect(result.mergedFields).toContain("phone");

    const merged = await getContact(ctx, primary.id);
    expect(merged.phone).toBe("+49 40 999");
    expect(merged.jobTitle).toBe("Einkauf");
    // The primary record keeps its own first name.
    expect(merged.firstName).toBe("Haupt");

    const [tasks, notes, deleted] = await Promise.all([
      prisma.task.count({ where: { contactId: primary.id } }),
      prisma.note.count({ where: { contactId: primary.id } }),
      prisma.contact.findUnique({ where: { id: duplicate.id }, select: { deletedAt: true } }),
    ]);

    expect(tasks).toBe(1);
    expect(notes).toBe(1);
    expect(deleted?.deletedAt).not.toBeNull();
  });

  it("verweigert das Zusammenführen eines Datensatzes mit sich selbst", async () => {
    const { ctx } = await createTestOrganization();
    const contact = await createContact(ctx, { firstName: "Selbst", lastName: "Merge" });
    await expect(mergeContacts(ctx, contact.id, contact.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
