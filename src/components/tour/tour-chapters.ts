import type { TourChapter } from "./types";

/**
 * Der Inhalt der Produkttour.
 *
 * Aufgebaut als Arbeitsweg, nicht als Menürundgang: Die Tour legt zuerst ein
 * Unternehmen an, dann einen Kontakt dazu, dann eine Chance — weil genau diese
 * Reihenfolge erklärt, warum die Objekte getrennt sind. Jeder Schritt sagt,
 * *warum* es den Knopf gibt, nicht nur, dass es ihn gibt.
 *
 * Schritte, deren Ziel fehlt — weil ein Recht fehlt oder die Oberfläche schmal
 * ist —, werden still übersprungen. Die Tour darf nie im Weg stehen.
 */
export const TOUR_CHAPTERS: TourChapter[] = [
  /* ── 1 Begrüßung ─────────────────────────────────────────────────────── */
  {
    id: "willkommen",
    title: "Willkommen",
    summary: "Was diese Einführung mit Ihnen vorhat.",
    route: "/dashboard",
    steps: [
      {
        id: "intro",
        title: "Einmal quer durch OKUN CRM",
        body:
          "Diese Einführung zeigt nicht nur, wo welcher Knopf sitzt. Sie legen dabei wirklich " +
          "ein Unternehmen, einen Kontakt und eine Chance an — am Ende haben Sie etwas in der " +
          "Hand, nicht nur zugesehen.",
        why:
          "Ein Rundgang, den man nur anschaut, ist nach zehn Minuten vergessen. Etwas, das man " +
          "selbst getan hat, bleibt.",
        advance: { on: "manual" },
        cta: "Los geht’s",
        offerLater: true,
      },
      {
        id: "spielregeln",
        title: "Sie behalten die Kontrolle",
        body:
          "Mit Esc brechen Sie jederzeit ab, Ihr Fortschritt bleibt erhalten — auch über einen " +
          "Geräte- oder Browserwechsel hinweg. Und über das Benutzermenü oben rechts können Sie " +
          "die Einführung jederzeit erneut starten.",
        advance: { on: "manual" },
        cta: "Verstanden",
      },
    ],
  },

  /* ── 2 Navigation ────────────────────────────────────────────────────── */
  {
    id: "navigation",
    title: "Orientierung",
    summary: "Wie die Anwendung gegliedert ist.",
    route: "/dashboard",
    steps: [
      {
        id: "sidebar",
        target: '[data-tour="nav-dashboard"]',
        placement: "right",
        title: "Die Navigation folgt Ihrer Arbeit",
        body:
          "Die Gliederung links ist nicht nach Datenbanktabellen sortiert, sondern nach " +
          "Arbeitsweise: CRM, Vertrieb, Kommunikation, Automatisierung, Berichte, Administration.",
        why:
          "Wer morgens anfängt, sucht keine Tabelle — er sucht den nächsten Schritt. Deshalb " +
          "steht „Heute“ ganz oben und die Verwaltung ganz unten.",
        advance: { on: "manual" },
      },
      {
        id: "heute",
        target: '[data-tour="nav-heute"]',
        placement: "right",
        title: "„Heute“ ist der Einstieg, nicht das Dashboard",
        body:
          "Dort steht, was heute Ihre Entscheidung braucht: fällige nächste Aktionen, überfällige " +
          "Aufgaben, Vorgänge, die stillstehen.",
        why:
          "Das Dashboard beantwortet „Wie läuft es?“. „Heute“ beantwortet „Was muss ich tun?“. " +
          "Das sind zwei verschiedene Fragen, und die zweite stellt sich öfter.",
        advance: { on: "manual" },
      },
      {
        id: "suche",
        target: '[data-tour="topbar-search"]',
        placement: "bottom",
        title: "Eine Suche für alles",
        body:
          "Hier finden Sie Kontakte, Unternehmen, Leads und Deals gleichzeitig — ohne vorher zu " +
          "überlegen, in welcher Liste Sie suchen müssen.",
        optional: true,
        advance: { on: "manual" },
      },
      {
        id: "schnellanlage",
        target: '[data-tour="topbar-create"]',
        placement: "bottom",
        title: "Schnell etwas anlegen",
        body:
          "Von jeder Seite aus, ohne den Kontext zu verlassen. Praktisch, wenn mitten im Telefonat " +
          "ein neuer Name fällt.",
        optional: true,
        advance: { on: "manual" },
      },
    ],
  },

  /* ── 3 Unternehmen ───────────────────────────────────────────────────── */
  {
    id: "unternehmen",
    title: "Unternehmen",
    summary: "Der Anker, an dem alles andere hängt.",
    route: "/companies",
    requires: "companies.read",
    steps: [
      {
        id: "warum-zuerst",
        title: "Warum wir mit dem Unternehmen anfangen",
        body:
          "Ein Kontakt ohne Unternehmen ist eine Visitenkarte. Ein Kontakt *mit* Unternehmen ist " +
          "Teil eines Kundenbildes — Sie sehen später alle Menschen dort, alle laufenden Chancen " +
          "und den gesamten Verlauf an einem Ort.",
        why:
          "Deshalb legen wir hier zuerst die Firma an und hängen den Menschen gleich daran. " +
          "Umgekehrt wäre es doppelte Arbeit.",
        advance: { on: "manual" },
      },
      {
        id: "erstellen-zeigen",
        target: '[data-tour="list-create"]',
        placement: "bottom",
        title: "Jetzt sind Sie dran",
        body: "Klicken Sie auf „Unternehmen erstellen“. Das Formular öffnet sich seitlich.",
        waitingFor: "Warte auf Ihren Klick auf „Unternehmen erstellen“",
        requires: "companies.write",
        advance: { on: "click" },
      },
      {
        id: "name",
        target: "#name",
        placement: "left",
        title: "Der Name genügt zum Anfangen",
        body:
          "Pflicht ist nur der Name. Alles andere können Sie jetzt oder später ausfüllen — das " +
          "System verlangt keine Vollständigkeit, bevor es nützlich wird.",
        why:
          "Formulare, die zwanzig Pflichtfelder verlangen, werden umgangen. Dann steht der Kunde " +
          "am Ende in einer Tabelle auf dem Desktop statt im CRM.",
        optional: true,
        advance: { on: "manual" },
      },
      {
        id: "domain",
        target: "#domain",
        placement: "left",
        title: "Die Domain ist mehr als ein Feld",
        body:
          "Sie dient dem System als Erkennungsmerkmal: Bei Import und Dublettenprüfung werden " +
          "Firmen darüber zusammengeführt, auch wenn der Name unterschiedlich geschrieben ist.",
        why: "„Muster GmbH“, „Muster G.m.b.H.“ und „Muster“ sind dieselbe Firma — die Domain weiß das.",
        optional: true,
        advance: { on: "manual" },
      },
      {
        id: "speichern",
        target: '[data-tour="drawer"] button[type="submit"]',
        placement: "top",
        title: "Speichern",
        body: "Tragen Sie einen Namen ein und speichern Sie. Danach geht es weiter.",
        waitingFor: "Warte darauf, dass das Formular gespeichert und geschlossen wird",
        optional: true,
        skippable: true,
        advance: { on: "disappear", selector: '[data-tour="drawer"]' },
      },
      {
        id: "liste",
        target: '[data-tour="list-table"]',
        placement: "top",
        title: "Die Liste, und was sie kann",
        body:
          "Jede Liste im System funktioniert gleich: Volltextsuche, Filter über jedes Feld, " +
          "Spaltenauswahl, Sortierung und CSV-Export der *aktuellen* Abfrage.",
        why:
          "Ein Export, der immer alles ausgibt, ist wertlos. Hier bekommen Sie genau das, was Sie " +
          "gerade auf dem Schirm haben.",
        advance: { on: "manual" },
      },
      {
        id: "ansichten",
        target: '[data-tour="list-views"]',
        placement: "bottom",
        title: "Gespeicherte Ansichten",
        body:
          "Filter, Spalten und Sortierung lassen sich als benannte Ansicht sichern — und fürs Team " +
          "freigeben. „Kunden ohne Aktivität seit 60 Tagen“ ist dann ein Klick, keine Fleißarbeit.",
        optional: true,
        advance: { on: "manual" },
      },
    ],
  },

  /* ── 4 Kontakte ──────────────────────────────────────────────────────── */
  {
    id: "kontakte",
    title: "Kontakte",
    summary: "Die Menschen — und warum die Verknüpfung zählt.",
    route: "/contacts",
    requires: "contacts.read",
    steps: [
      {
        id: "erstellen",
        target: '[data-tour="list-create"]',
        placement: "bottom",
        title: "Legen wir einen Menschen an",
        body: "Klicken Sie auf „Kontakt erstellen“.",
        waitingFor: "Warte auf Ihren Klick auf „Kontakt erstellen“",
        requires: "contacts.write",
        advance: { on: "click" },
      },
      {
        id: "unternehmen-feld",
        target: "#companyId",
        placement: "left",
        title: "Hier entsteht die Verbindung",
        body:
          "Wählen Sie das eben angelegte Unternehmen aus. Ab diesem Moment erscheint dieser Mensch " +
          "auch auf der Firmenseite, und jede Aktivität zählt für beide.",
        why:
          "Das ist der Unterschied zwischen einem Adressbuch und einem CRM: Die Verbindung trägt " +
          "die Information, nicht der einzelne Datensatz.",
        optional: true,
        advance: { on: "manual" },
      },
      {
        id: "lifecycle",
        target: "#lifecycleStage",
        placement: "left",
        title: "Lifecycle-Stufe: wie weit ist die Beziehung?",
        body:
          "Von „Interessent“ bis „Kunde“. Die Stufen sind nicht fest einprogrammiert — Sie " +
          "definieren sie in den Einstellungen so, wie Ihr Vertrieb wirklich arbeitet.",
        optional: true,
        advance: { on: "manual" },
      },
      {
        id: "speichern",
        target: '[data-tour="drawer"] button[type="submit"]',
        placement: "top",
        title: "Speichern und weiter",
        body: "Vor- und Nachname genügen. Speichern Sie, dann sehen wir uns die Kontaktakte an.",
        waitingFor: "Warte darauf, dass der Kontakt gespeichert ist",
        optional: true,
        skippable: true,
        advance: { on: "disappear", selector: '[data-tour="drawer"]' },
      },
      {
        id: "oeffnen",
        target: '[data-tour="list-table"] tbody tr:first-child a',
        placement: "bottom",
        title: "Öffnen Sie den Kontakt",
        body: "Ein Klick auf den Namen führt zur Akte — dort steckt der eigentliche Wert.",
        waitingFor: "Warte darauf, dass Sie einen Kontakt öffnen",
        optional: true,
        skippable: true,
        advance: { on: "navigate", match: "/contacts/" },
      },
    ],
  },

  /* ── 5 Die Akte ──────────────────────────────────────────────────────── */
  {
    id: "akte",
    title: "Die Akte",
    summary: "Wo Verlauf, Zustand und nächster Schritt zusammenkommen.",
    route: "/contacts",
    matches: (pathname) => /^\/(contacts|companies|deals|leads)\/[^/]+$/.test(pathname),
    steps: [
      {
        id: "ueberblick",
        title: "Die Detailseite ist das Herz des Systems",
        body:
          "Links die Stammdaten, in der Mitte der Verlauf, rechts der Zustand und die nächste " +
          "Aktion. Alles, was jemals an diesem Menschen passiert ist, steht hier — auch das, was " +
          "eine Kollegin getan hat.",
        why:
          "Damit ist Urlaubsvertretung kein Problem mehr: Wer die Akte öffnet, weiß in dreißig " +
          "Sekunden Bescheid, statt drei Leute zu fragen.",
        advance: { on: "manual" },
      },
      {
        id: "naechste-aktion",
        target: '[data-tour="next-action"]',
        placement: "left",
        title: "Die nächste Aktion",
        body:
          "Ein einziger, begründeter Vorschlag — nicht zwölf gleichrangige. Sie können ihn " +
          "erledigen, verschieben oder mit Begründung verwerfen.",
        why:
          "Eine Liste aus zwölf Vorschlägen ist keine Hilfe, sondern eine zweite Aufgabenliste. " +
          "Deshalb gibt es pro Datensatz genau einen.",
        optional: true,
        advance: { on: "manual" },
      },
      {
        id: "verlauf",
        target: '[data-tour="timeline"]',
        placement: "top",
        title: "Der Verlauf",
        body:
          "Notizen, Anrufe, E-Mails, Termine, Aufgaben und Feldänderungen in einer Spur. Legen " +
          "Sie ruhig eine Notiz an — sie landet sofort oben.",
        optional: true,
        advance: { on: "manual" },
      },
    ],
  },

  /* ── 6 Deals und Pipeline ────────────────────────────────────────────── */
  {
    id: "deals",
    title: "Chancen",
    summary: "Aus einem Kontakt wird ein Geschäft.",
    route: "/deals",
    requires: "deals.read",
    steps: [
      {
        id: "was-ist-ein-deal",
        title: "Ein Deal ist eine Chance, kein Kunde",
        body:
          "Derselbe Kunde kann drei laufende Chancen haben und zwei verlorene. Deshalb ist der " +
          "Deal ein eigenes Objekt mit Wert, erwartetem Abschluss und einer Stage.",
        why:
          "Nur so lässt sich messen, was funktioniert: Ein verlorener Deal ist eine Information, " +
          "kein gelöschter Datensatz.",
        advance: { on: "manual" },
      },
      {
        id: "erstellen",
        target: '[data-tour="list-create"]',
        placement: "bottom",
        title: "Legen Sie eine Chance an",
        body: "Name, Pipeline, Stage und Wert — mehr braucht es nicht zum Start.",
        waitingFor: "Warte auf Ihren Klick auf „Deal erstellen“",
        requires: "deals.write",
        advance: { on: "click" },
      },
      {
        id: "betrag",
        target: "#amount",
        placement: "left",
        title: "Der Wert trägt die Auswertung",
        body:
          "Aus diesem Feld entstehen Pipelinewert, Forecast und jede Umsatzauswertung. Eine grobe " +
          "Schätzung ist besser als eine leere Zahl.",
        optional: true,
        advance: { on: "manual" },
      },
      {
        id: "speichern",
        target: '[data-tour="drawer"] button[type="submit"]',
        placement: "top",
        title: "Speichern",
        body: "Speichern Sie — danach sehen wir uns das Board an.",
        waitingFor: "Warte darauf, dass der Deal gespeichert ist",
        optional: true,
        skippable: true,
        advance: { on: "disappear", selector: '[data-tour="drawer"]' },
      },
    ],
  },
  {
    id: "pipeline",
    title: "Pipeline",
    summary: "Fortschritt sichtbar machen.",
    route: "/pipeline",
    requires: "deals.read",
    steps: [
      {
        id: "board",
        title: "Das Board zeigt den Fluss, nicht den Bestand",
        body:
          "Jede Spalte ist eine Stage, jede Karte ein Deal, oben die Summe je Spalte. Ein Deal " +
          "wechselt die Stage, indem Sie ihn verschieben.",
        why:
          "Jeder Wechsel wird protokolliert. Daraus entstehen später Funnel, Zykluszeit und die " +
          "Antwort auf die Frage, wo Geschäfte regelmäßig hängen bleiben.",
        advance: { on: "manual" },
      },
      {
        id: "verschieben",
        title: "Probieren Sie es aus",
        body:
          "Ziehen Sie Ihre Karte eine Spalte weiter. Der Wechsel ist sofort gespeichert — und " +
          "kann einen Workflow auslösen, den wir gleich bauen.",
        advance: { on: "manual" },
        cta: "Weiter",
      },
    ],
  },

  /* ── 7 Heute und Aufgaben ────────────────────────────────────────────── */
  {
    id: "heute",
    title: "Heute",
    summary: "Das Aktionszentrum.",
    route: "/heute",
    steps: [
      {
        id: "aktionszentrum",
        title: "Hier fängt Ihr Arbeitstag an",
        body:
          "Fällige nächste Aktionen, überfällige Aufgaben und stillstehende Vorgänge — " +
          "zusammengeführt aus allen Objekten, sortiert nach Dringlichkeit.",
        why:
          "Das System rät dabei nicht. Jeder Eintrag geht auf ein Ereignis zurück, das wirklich " +
          "stattgefunden hat, und auf eine Regel, die Sie in den Einstellungen nachlesen können.",
        advance: { on: "manual" },
      },
      {
        id: "regeln",
        title: "Die Regeln sind einsehbar",
        body:
          "Unter Einstellungen → Aktives CRM steht jede Regel mit ihrer Bedingung, ihrer " +
          "Verzögerung und ihrer Priorität. Jede lässt sich einzeln abschalten.",
        why:
          "Ein System, das Vorschläge macht, ohne sie zu begründen, wird nach zwei Wochen " +
          "ignoriert. Deshalb liegt das Regelwerk offen.",
        advance: { on: "manual" },
      },
    ],
  },

  /* ── 8 Workflows ─────────────────────────────────────────────────────── */
  {
    id: "workflows",
    title: "Automatisierung",
    summary: "Ihre eigenen Regeln, ohne Code.",
    route: "/workflows",
    requires: "workflows.read",
    steps: [
      {
        id: "aufbau",
        title: "Jeder Workflow hat denselben Aufbau",
        body:
          "Auslöser — wann geht es los. Bedingungen — für welche Datensätze gilt es. Aktionen — " +
          "was geschieht dann. Bis zu zehn Aktionen je Workflow.",
        why:
          "Weil Automatisierung sonst unkontrollierbar wird: Wer die drei Teile sieht, kann " +
          "vorhersagen, was die Regel tut, bevor sie auf echte Daten losgeht.",
        advance: { on: "manual" },
      },
      {
        id: "erstellen",
        target: '[data-tour="workflow-create"]',
        placement: "bottom",
        title: "Bauen wir einen",
        body: "Klicken Sie auf „Workflow erstellen“.",
        waitingFor: "Warte auf Ihren Klick auf „Workflow erstellen“",
        requires: "workflows.manage",
        advance: { on: "click" },
      },
      {
        id: "ausloeser",
        target: "#workflow-trigger",
        placement: "left",
        title: "Der Auslöser",
        body:
          "Fünf Möglichkeiten: Datensatz erstellt, Eigenschaft geändert, Deal-Stage geändert, " +
          "Lead-Status geändert, Aufgabe überfällig.",
        optional: true,
        advance: { on: "manual" },
      },
      {
        id: "bedingung",
        title: "Bedingungen sind der wichtigste Teil",
        body:
          "Ohne Bedingung feuert ein Workflow für *jeden* Datensatz — auch für importierte. " +
          "Eine Bedingung wie „Quelle ist gleich Website“ grenzt das ein.",
        why:
          "Der häufigste Automatisierungsfehler ist nicht die falsche Aktion, sondern die " +
          "fehlende Einschränkung. Dann stehen am nächsten Morgen 400 Aufgaben in der Liste.",
        advance: { on: "manual" },
      },
      {
        id: "inaktiv",
        title: "Neu heißt inaktiv",
        body:
          "Ein frisch gespeicherter Workflow ist bewusst noch nicht scharf. Sie aktivieren ihn " +
          "erst, wenn er fertig ist — mit einem Klick in der Liste.",
        why: "Damit eine halbfertige Regel nicht schon auf echte Kundendaten losgeht.",
        advance: { on: "manual" },
      },
      {
        id: "protokoll",
        title: "Jeder Lauf wird protokolliert",
        body:
          "Mit Status und einem Schritt-für-Schritt-Log jeder Aktion. Schlägt etwas fehl, steht " +
          "dort, was und warum — der Workflow verschwindet nicht stillschweigend.",
        advance: { on: "manual" },
      },
    ],
  },

  /* ── 9 Auswertung ────────────────────────────────────────────────────── */
  {
    id: "reports",
    title: "Auswertung",
    summary: "Acht Fragen, acht Berichte.",
    route: "/reports",
    requires: "reports.read",
    steps: [
      {
        id: "berichte",
        title: "Jeder Bericht beantwortet eine Frage",
        body:
          "Funnel: Wo bleiben Deals hängen? Quellen: Was bringt wirklich Abschlüsse? Zykluszeit: " +
          "Wo geht die Zeit verloren? Forecast, Conversion, Aktivität, Performance.",
        advance: { on: "manual" },
      },
      {
        id: "ehrlichkeit",
        title: "Was hier bewusst fehlt",
        body:
          "Es gibt keine vom System erfundene Abschlusswahrscheinlichkeit pro Deal und keinen " +
          "automatischen Lead-Score. Der Forecast rechnet ausschließlich mit den " +
          "Wahrscheinlichkeiten, die Sie an den Stages hinterlegt haben.",
        why:
          "Eine Zahl, deren Herkunft niemand erklären kann, ist im Vertrieb gefährlicher als " +
          "gar keine Zahl.",
        advance: { on: "manual" },
      },
    ],
  },

  /* ── 10 Verwaltung ───────────────────────────────────────────────────── */
  {
    id: "einstellungen",
    title: "Einrichtung",
    summary: "Was Sie selbst anpassen können.",
    route: "/settings",
    steps: [
      {
        id: "konfiguration",
        title: "Fast alles ist Einstellung, nicht Programmierung",
        body:
          "Eigene Felder, Pipelines und Stages, Lifecycle-Stufen, Lead-Status, Tags, Rollen, " +
          "Teams — alles zur Laufzeit änderbar, ohne Entwickler.",
        why:
          "Weil sich Ihr Vertriebsprozess ändern wird. Ein System, für das man dafür jemanden " +
          "beauftragen muss, wird stattdessen umgangen.",
        advance: { on: "manual" },
      },
      {
        id: "eigenschaften",
        target: '[data-tour="settings-properties"]',
        placement: "right",
        title: "Eigene Felder",
        body:
          "Zusätzliche Felder je Objekttyp. Sie sind vollwertig: filterbar, in Ansichten " +
          "verwendbar, im Export enthalten und als Workflow-Bedingung nutzbar.",
        optional: true,
        advance: { on: "manual" },
      },
      {
        id: "import",
        target: '[data-tour="settings-import"]',
        placement: "right",
        title: "Import",
        body:
          "CSV hochladen, Spalten zuordnen, Dublettenstrategie wählen. Danach ein Ergebnisbericht " +
          "mit Zahlen — nicht nur eine Erfolgsmeldung.",
        optional: true,
        advance: { on: "manual" },
      },
      {
        id: "audit",
        target: '[data-tour="settings-audit"]',
        placement: "right",
        title: "Audit-Log",
        body: "Wer hat wann was geändert, mit Vorher und Nachher. Auch jede Detailseite führt ihren eigenen Verlauf.",
        optional: true,
        advance: { on: "manual" },
      },
    ],
  },

  /* ── 11 Abschluss ────────────────────────────────────────────────────── */
  {
    id: "abschluss",
    title: "Fertig",
    summary: "Was jetzt sinnvoll ist.",
    route: "/heute",
    steps: [
      {
        id: "ende",
        title: "Das war der Rundgang",
        body:
          "Sie haben ein Unternehmen, einen Kontakt und eine Chance angelegt und wissen, wo " +
          "Automatisierung, Auswertung und Einrichtung sitzen.",
        why:
          "Der sinnvollste nächste Schritt ist meist der Import Ihres Bestands — danach wird das " +
          "System sofort nützlich, statt langsam zu wachsen.",
        advance: { on: "manual" },
        cta: "Tour beenden",
      },
    ],
  },
];
