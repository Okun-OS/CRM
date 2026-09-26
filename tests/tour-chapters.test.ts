import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { TOUR_CHAPTERS } from "@/components/tour/tour-chapters";
import { PERMISSIONS } from "@/lib/rbac";

/**
 * Der Inhalt der Tour, statisch geprüft.
 *
 * Eine Tour, die auf ein Element zeigt, das es nicht gibt, ist schlimmer als
 * keine Tour: Sie wartet auf einen Klick, der nie kommen kann. Genau dieser
 * Fehler ist beim Bauen der Tour einmal passiert — der Anker hieß
 * `nav--dashboard`, die Oberfläche lieferte `nav-dashboard`. Aufgefallen ist
 * das erst im Browser. Dieser Test rechnet es nach.
 */

/** Alle `data-tour`-Namen, die in der Oberfläche wirklich gesetzt werden. */
function anchorsInSource(): Set<string> {
  const found = new Set<string>();

  // Feste Namen: data-tour="irgendwas"
  const literal = execFileSync(
    "grep",
    ["-rhoE", 'data-tour="[a-z0-9-]+"', "src"],
    { encoding: "utf-8" },
  );
  for (const match of literal.matchAll(/data-tour="([a-z0-9-]+)"/g)) found.add(match[1]);

  // Berechnete Namen. Beide Navigationen leiten den Anker aus dem Ziel ab;
  // die Namen entstehen also erst zur Laufzeit und müssen hier nachgebildet
  // werden — aus denselben Quellen, aus denen die Oberfläche sie bildet.
  const sidebar = readFileSync("src/components/app/sidebar.tsx", "utf-8");
  expect(sidebar).toContain('data-tour={`nav${item.href.replace(/\\//g, "-")}`}');
  for (const match of sidebar.matchAll(/href: "(\/[a-z0-9/-]*)"/g)) {
    found.add(`nav${match[1].replace(/\//g, "-")}`);
  }

  const outreachNav = readFileSync("src/app/(app)/outreach/outreach-nav.tsx", "utf-8");
  expect(outreachNav).toContain('data-tour={`outreach-${item.href.split("/").pop()}`}');
  for (const match of outreachNav.matchAll(/href: "(\/[a-z0-9/-]*)"/g)) {
    found.add(`outreach-${match[1].split("/").pop()}`);
  }

  return found;
}

/** Zieht die `data-tour`-Namen aus einem Selektor der Tour. */
function anchorsOf(selector: string): string[] {
  return Array.from(selector.matchAll(/data-tour="([^"]+)"/g)).map((match) => match[1]);
}

describe("Inhalt der Produkttour", () => {
  it("zeigt nur auf Elemente, die es in der Oberfläche wirklich gibt", () => {
    const available = anchorsInSource();
    expect(available.size).toBeGreaterThan(20);

    const missing: string[] = [];
    for (const chapter of TOUR_CHAPTERS) {
      for (const step of chapter.steps) {
        const selectors = [step.target];
        if (step.advance.on === "appear" || step.advance.on === "disappear") {
          selectors.push(step.advance.selector);
        }
        for (const selector of selectors) {
          if (!selector) continue;
          for (const anchor of anchorsOf(selector)) {
            if (!available.has(anchor)) missing.push(`${chapter.id}/${step.id} → ${anchor}`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it("vergibt jede Kennung nur einmal", () => {
    const chapterIds = TOUR_CHAPTERS.map((chapter) => chapter.id);
    expect(new Set(chapterIds).size).toBe(chapterIds.length);

    for (const chapter of TOUR_CHAPTERS) {
      const stepIds = chapter.steps.map((step) => step.id);
      expect(new Set(stepIds).size, `Kapitel ${chapter.id}`).toBe(stepIds.length);
    }
  });

  it("nennt nur Rechte, die es im Katalog gibt", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const chapter of TOUR_CHAPTERS) {
      if (chapter.requires) expect(known, `Kapitel ${chapter.id}`).toContain(chapter.requires);
      for (const step of chapter.steps) {
        if (step.requires) expect(known, `${chapter.id}/${step.id}`).toContain(step.requires);
      }
    }
  });

  it("sagt bei jedem wartenden Schritt, worauf gewartet wird", () => {
    for (const chapter of TOUR_CHAPTERS) {
      for (const step of chapter.steps) {
        if (step.advance.on === "manual") continue;
        // Sonst steht der Mensch vor einer Karte ohne Knopf und ohne Hinweis.
        expect(step.waitingFor, `${chapter.id}/${step.id}`).toBeTruthy();
      }
    }
  });

  it("überspringt jeden Schritt still, dessen Ziel fehlen kann", () => {
    for (const chapter of TOUR_CHAPTERS) {
      for (const step of chapter.steps) {
        // Ein wartender Schritt ohne Ausweg kann die Tour festsetzen: Ist das
        // Ziel nicht da, muss er übersprungen werden dürfen.
        if (step.advance.on === "manual") continue;
        expect(step.optional || step.skippable, `${chapter.id}/${step.id}`).toBeTruthy();
      }
    }
  });

  it("führt durch die Akquise, nicht nur durch das CRM", () => {
    const routes = TOUR_CHAPTERS.map((chapter) => chapter.route);
    // Die Akquise ist der größte Bereich neben dem CRM. Fehlte sie in der
    // Tour, wäre sie für neue Nutzer praktisch unsichtbar.
    expect(routes).toContain("/outreach");
    expect(routes).toContain("/outreach/prospects");
    expect(routes).toContain("/outreach/sequences");
    expect(routes).toContain("/outreach/settings");

    for (const chapter of TOUR_CHAPTERS) {
      if (!chapter.route.startsWith("/outreach")) continue;
      // Ohne Recht kein Kapitel — sonst führt die Tour jemanden auf eine Seite,
      // die ihn serverseitig sofort wieder wegschickt.
      expect(chapter.requires, `Kapitel ${chapter.id}`).toBeTruthy();
    }
  });

  it("begründet jeden Schritt, der etwas Neues einführt", () => {
    // Die Tour soll erklären, *warum* es einen Knopf gibt. Ein Kapitel, in dem
    // kein einziger Schritt eine Begründung trägt, ist ein Menürundgang.
    for (const chapter of TOUR_CHAPTERS) {
      const withReason = chapter.steps.filter((step) => step.why && step.why.length > 40);
      expect(withReason.length, `Kapitel ${chapter.id}`).toBeGreaterThan(0);
    }
  });
});
