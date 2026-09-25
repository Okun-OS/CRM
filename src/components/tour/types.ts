import type { Permission } from "@/lib/rbac";

/**
 * Bauteile der Produkttour.
 *
 * Eine Tour ist eine Folge von **Kapiteln**, jedes einer Seite zugeordnet.
 * Ein Kapitel besteht aus **Schritten**, die jeweils ein echtes Element der
 * Oberfläche freistellen und erklären.
 *
 * Der Leitgedanke: Es wird nichts nachgebaut und nichts simuliert. Die Tour
 * zeigt auf die Knöpfe, die es wirklich gibt, und wartet darauf, dass man sie
 * benutzt. Wer die Tour durchläuft, hat danach tatsächlich einen Kontakt
 * angelegt — nicht nur zugesehen.
 */

/** Woran ein Schritt erkennt, dass er vorbei ist. */
export type TourAdvance =
  /** Der Mensch drückt „Weiter". Für reine Erklärschritte. */
  | { on: "manual" }
  /** Erst weiter, wenn das freigestellte Element geklickt wurde. */
  | { on: "click" }
  /** Erst weiter, wenn ein anderes Element auftaucht — etwa ein geöffnetes Formular. */
  | { on: "appear"; selector: string }
  /** Erst weiter, wenn ein Element verschwindet — etwa ein geschlossenes Formular. */
  | { on: "disappear"; selector: string }
  /** Erst weiter, wenn die Adresse passt. Für Schritte, die eine Seite wechseln. */
  | { on: "navigate"; match: string };

export type TourStep = {
  id: string;
  /**
   * CSS-Auswahl des Elements, das freigestellt wird. Ohne Ziel erscheint die
   * Karte mittig — für Kapitelanfang und Abschluss.
   */
  target?: string;
  title: string;
  /** Was hier geschieht. Ein bis zwei Sätze, keine Bedienungsanleitung. */
  body: string;
  /** Warum es das gibt. Steht abgesetzt, weil das die eigentliche Frage ist. */
  why?: string;
  /** Wo die Karte relativ zum Ziel sitzt. „auto" sucht die freie Seite. */
  placement?: "top" | "bottom" | "left" | "right" | "auto";
  advance: TourAdvance;
  /** Ist das Ziel nicht da, wird der Schritt still übersprungen. */
  optional?: boolean;
  /** Ohne dieses Recht wird der Schritt übersprungen. */
  requires?: Permission;
  /**
   * Text auf dem Weiter-Knopf. Bei wartenden Schritten steht stattdessen ein
   * Hinweis, was zu tun ist.
   */
  cta?: string;
  /** Hinweis bei wartenden Schritten, z. B. „Klicken Sie auf ‚Kontakt erstellen'". */
  waitingFor?: string;
  /** Lässt den wartenden Schritt zusätzlich per Knopf überspringen. */
  skippable?: boolean;
  /**
   * Zeigt zusätzlich „Später". Nur für den Einstiegsschritt gedacht: Wer die
   * Einführung gerade nicht will, soll sie wegklicken können, ohne dass sie
   * beim nächsten Anmelden erneut aufspringt.
   */
  offerLater?: boolean;
};

export type TourChapter = {
  id: string;
  /** Kapitelname in der Fortschrittsanzeige. */
  title: string;
  /** Ein Satz darüber, worum es in diesem Kapitel geht. */
  summary: string;
  /** Adresse, auf der das Kapitel spielt. Die Tour navigiert selbst dorthin. */
  route: string;
  /**
   * Passt die aktuelle Adresse zum Kapitel? Für Kapitel auf Detailseiten,
   * deren Adresse eine ID enthält.
   */
  matches?: (pathname: string) => boolean;
  /** Ohne dieses Recht wird das ganze Kapitel übersprungen. */
  requires?: Permission;
  steps: TourStep[];
};
