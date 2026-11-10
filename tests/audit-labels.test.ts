import { describe, expect, it } from "vitest";
import { auditActionLabel, auditChanges, auditEntityHref, auditEntityLabel } from "@/lib/audit-labels";

/** Testphase, Zeile 9: Das Audit-Log soll ohne Technikwissen lesbar sein. */
describe("Audit-Log in Klartext", () => {
  it("übersetzt Aktionen und Objekte", () => {
    expect(auditActionLabel("deal.stage_changed")).toBe("Deal Phase geändert");
    expect(auditActionLabel("auth.login")).toBe("Angemeldet");
    expect(auditActionLabel("contact.created")).toBe("Kontakt angelegt");
    expect(auditActionLabel("ganz_neu.irgendwas_passiert")).toBe("ganz neu irgendwas passiert");
    expect(auditEntityLabel("Deal")).toBe("Deal");
    expect(auditEntityLabel("PropertyDefinition")).toBe("Eigenschaft");
    expect(auditEntityHref("Contact", "c1")).toBe("/contacts/c1");
    expect(auditEntityHref("ApiKey", "k1")).toBeNull();
  });

  it("zeigt nur geänderte Felder, mit deutschen Werten", () => {
    expect(auditChanges({ status: "OPEN", title: "A" }, { status: "COMPLETED", title: "A" })).toEqual([
      { field: "status", label: "Status", before: "Offen", after: "Erledigt" },
    ]);
    expect(auditChanges(null, { name: "Muster GmbH", amount: 1200 })).toEqual([
      { field: "name", label: "Name", before: null, after: "Muster GmbH" },
      { field: "amount", label: "Wert", before: null, after: "1200" },
    ]);
  });
});
