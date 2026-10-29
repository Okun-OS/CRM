"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { TOUR_CHAPTERS } from "./tour-chapters";
import type { TourChapter, TourStep } from "./types";
import type { Permission } from "@/lib/rbac";
import { useToast } from "@/components/ui/toast";

/**
 * Ablaufsteuerung der Produkttour.
 *
 * Der Zustand liegt hier, die Darstellung in `tour-overlay.tsx`. Getrennt,
 * weil die Steuerung Dinge tun muss, die nichts mit Aussehen zu tun haben:
 * Rechte auswerten, Schritte mit fehlendem Ziel überspringen, auf echte Klicks
 * warten, Seiten wechseln und den Fortschritt sichern.
 */

type TourContextValue = {
  active: boolean;
  chapter: TourChapter | null;
  step: TourStep | null;
  chapterIndex: number;
  stepIndex: number;
  totalChapters: number;
  totalSteps: number;
  /** Fortschritt über die ganze Tour, 0–1. */
  progress: number;
  /** Von vorn beginnen. */
  start: () => void;
  /** Dort weitermachen, wo zuletzt gespeichert und beendet wurde. */
  resume: () => void;
  next: () => void;
  back: () => void;
  /**
   * `finished`: durch, der Fortschritt ist erledigt.
   * `paused`: für jetzt beendet — der Fortschritt bleibt für „Fortsetzen“.
   */
  stop: (reason: "finished" | "paused") => void;
  /** Gespeicherter Stand außerhalb einer laufenden Tour, für „Tour fortsetzen“. */
  saved: { chapterTitle: string; chapterNumber: number } | null;
  /** Ob die Tour schon einmal bis zum Ende durchlaufen wurde. */
  finishedBefore: boolean;
  /** Ob die aktuelle Seite zum laufenden Kapitel gehört. */
  onRoute: boolean;
  /** Die Tour wechselt gerade selbst die Seite; bis dahin zeigt sie nichts. */
  navigating: boolean;
  /** Zurück auf die Seite, auf der das Kapitel spielt. */
  returnToChapter: () => void;
  /** Ob die Tour überhaupt angeboten werden kann. */
  available: boolean;
};

const TourContext = React.createContext<TourContextValue | null>(null);

/** Kann die Tour selbst auf die Seite des Kapitels führen? */
function reachable(chapter: TourChapter): boolean {
  return chapter.matches ? chapter.matches(chapter.route) : true;
}

export function useTour() {
  const value = React.useContext(TourContext);
  if (!value) throw new Error("useTour außerhalb des TourProvider verwendet");
  return value;
}

/** Fragt den gespeicherten Zustand ab und schreibt ihn zurück. */
type SavedProgress = { chapter: string; step: number };

async function readState(): Promise<{
  shouldStart: boolean;
  progress: SavedProgress | null;
  finishedAt: string | null;
} | null> {
  try {
    const response = await fetch("/api/v1/tour", { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.data ?? null;
  } catch {
    return null;
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)okun_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function writeState(payload: Record<string, unknown>) {
  try {
    await fetch("/api/v1/tour", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-okun-csrf": csrfToken() },
      body: JSON.stringify(payload),
    });
  } catch {
    /* Der Fortschritt ist Komfort, kein Inhalt — ein Fehler darf die Tour nicht stoppen. */
  }
}

export function TourProvider({
  permissions,
  children,
}: {
  permissions: Permission[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const granted = React.useMemo(() => new Set(permissions), [permissions]);

  /** Kapitel und Schritte, für die die nötigen Rechte vorliegen. */
  const chapters = React.useMemo(() => {
    return TOUR_CHAPTERS.filter((chapter) => !chapter.requires || granted.has(chapter.requires)).map((chapter) => ({
      ...chapter,
      steps: chapter.steps.filter((step) => !step.requires || granted.has(step.requires)),
    })).filter((chapter) => chapter.steps.length > 0);
  }, [granted]);

  const [active, setActive] = React.useState(false);
  const [chapterIndex, setChapterIndex] = React.useState(0);
  const [stepIndex, setStepIndex] = React.useState(0);

  const [saved, setSaved] = React.useState<SavedProgress | null>(null);
  const [finishedBefore, setFinishedBefore] = React.useState(false);

  const chapter = active ? chapters[chapterIndex] ?? null : null;
  const step = chapter ? chapter.steps[stepIndex] ?? null : null;

  /**
   * Weitergemacht wird am Anfang des gespeicherten Kapitels, nicht mitten
   * darin: Viele Schritte zeigen in ein geöffnetes Formular, das nach dem
   * Neuladen nicht mehr offen ist. Ab dem Kapitelanfang führt die Tour
   * selbst wieder dorthin.
   */
  const chapterOf = React.useCallback(
    (progress: SavedProgress | null) => {
      if (!progress) return -1;
      return chapters.findIndex((c) => c.id === progress.chapter);
    },
    [chapters],
  );

  /* ── Start: nur für Menschen, die sie noch nicht gesehen haben ───────── */
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await readState();
      if (cancelled || !state) return;
      setFinishedBefore(Boolean(state.finishedAt));
      if (!state.shouldStart) {
        setSaved(state.progress);
        return;
      }
      const index = chapterOf(state.progress);
      if (index >= 0) {
        setChapterIndex(index);
        setStepIndex(0);
      }
      setActive(true);
    })();
    return () => {
      cancelled = true;
    };
    // Absichtlich nur beim ersten Rendern: Die Tour startet einmal je Sitzung.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Fortschritt sichern ─────────────────────────────────────────────── */
  React.useEffect(() => {
    if (!active || !chapter) return;
    void writeState({ status: "running", progress: { chapter: chapter.id, step: stepIndex } });
  }, [active, chapter, stepIndex]);

  /* ── Seitenwechsel ───────────────────────────────────────────────────── */
  const onRoute = chapter ? (chapter.matches ? chapter.matches(pathname) : pathname === chapter.route) : true;

  /**
   * Die Tour navigiert nur, wenn sie selbst ein Kapitel weitergeschaltet hat.
   *
   * Nicht beim Fortsetzen und nicht, wenn jemand sich umsieht: Beides würde
   * den Menschen von der Seite reißen, die er gerade sehen wollte. Ist die
   * Tour auf der falschen Seite, wartet sie sichtbar, statt zu greifen.
   *
   * Gemerkt wird das *Ziel*kapitel, nicht nur „bitte navigieren“: Zwischen
   * `next()` und dem Rendern des neuen Kapitels kann sich die Adresse ändern —
   * etwa weil die Anwendung nach dem Speichern die neue Akte öffnet. Ein
   * bloßes Ja/Nein ließe den Effekt dann noch mit dem *alten* Kapitel laufen,
   * und die Tour führte zurück auf dessen Liste.
   */
  const navigateTo = React.useRef<number | null>(null);
  const [navigating, setNavigating] = React.useState(false);

  React.useEffect(() => {
    if (!active || !chapter || navigateTo.current !== chapterIndex) return;
    if (onRoute) {
      navigateTo.current = null;
      return;
    }
    if (!reachable(chapter)) {
      // Ein Kapitel auf einer Detailseite lässt sich nicht anspringen — etwa
      // „Die Akte“, wenn das Speichern übersprungen wurde. Statt auf eine
      // Seite zu führen, auf der es nie weitergeht, folgt das nächste Kapitel.
      if (chapterIndex + 1 < chapters.length) {
        navigateTo.current = chapterIndex + 1;
        setChapterIndex(chapterIndex + 1);
        setStepIndex(0);
      } else {
        navigateTo.current = null;
      }
      return;
    }
    navigateTo.current = null;
    setNavigating(true);
    router.push(chapter.route);
  }, [active, chapter, chapterIndex, chapters.length, onRoute, router]);

  // Angekommen. Bis hierhin sähe die Tour die alte Seite und hielte das für
  // „umgesehen" — oder würde die Schritte des neuen Kapitels überspringen,
  // weil ihre Ziele auf der alten Seite fehlen.
  React.useEffect(() => {
    if (onRoute) setNavigating(false);
  }, [onRoute]);

  // Kommt die Seite nie an — umgeleitet, abgebrochen —, darf die Tour nicht
  // unsichtbar bleiben. Dann zeigt sie wieder, wo sie steht.
  React.useEffect(() => {
    if (!navigating) return;
    const timer = window.setTimeout(() => setNavigating(false), 8000);
    return () => window.clearTimeout(timer);
  }, [navigating]);

  const returnToChapter = React.useCallback(() => {
    if (!chapter) return;
    // Wohin, wenn das Kapitel nur auf einer Detailseite spielt? Dann weiter
    // zum nächsten Kapitel, statt auf die Liste, wo die Tour wieder wartet.
    if (reachable(chapter)) {
      router.push(chapter.route);
    } else if (chapterIndex + 1 < chapters.length) {
      navigateTo.current = chapterIndex + 1;
      setChapterIndex(chapterIndex + 1);
      setStepIndex(0);
    }
  }, [chapter, chapterIndex, chapters.length, router]);

  /* `next` und `back` werden weiter unten erklärt; sie setzen `navigateTo`,
     bevor sie das Kapitel wechseln. */

  const stop = React.useCallback(
    (reason: "finished" | "paused") => {
      setActive(false);
      if (reason === "finished") {
        setSaved(null);
        setFinishedBefore(true);
        void writeState({ status: "finished" });
        window.dispatchEvent(new CustomEvent("okun:tour-finished"));
        return;
      }
      const current = chapters[chapterIndex];
      const progress = current ? { chapter: current.id, step: stepIndex } : null;
      setSaved(progress);
      if (progress) void writeState({ status: "paused", progress });
      toast.push({
        tone: "info",
        title: "Einführung gespeichert",
        description: "Über „Einführung“ oben rechts machen Sie später dort weiter.",
      });
    },
    [chapterIndex, chapters, stepIndex, toast],
  );

  const next = React.useCallback(() => {
    if (!chapter) return;
    if (stepIndex + 1 < chapter.steps.length) {
      setStepIndex(stepIndex + 1);
      return;
    }
    if (chapterIndex + 1 < chapters.length) {
      navigateTo.current = chapterIndex + 1;
      setChapterIndex(chapterIndex + 1);
      setStepIndex(0);
      return;
    }
    stop("finished");
  }, [chapter, chapterIndex, chapters.length, stepIndex, stop]);

  const back = React.useCallback(() => {
    if (stepIndex > 0) {
      setStepIndex(stepIndex - 1);
      return;
    }
    if (chapterIndex > 0) {
      const previous = chapters[chapterIndex - 1];
      navigateTo.current = chapterIndex - 1;
      setChapterIndex(chapterIndex - 1);
      setStepIndex(Math.max(0, previous.steps.length - 1));
    }
  }, [chapterIndex, chapters, stepIndex]);

  const start = React.useCallback(() => {
    navigateTo.current = 0;
    setSaved(null);
    setChapterIndex(0);
    setStepIndex(0);
    setActive(true);
    void writeState({ status: "restart" });
  }, []);

  const resume = React.useCallback(() => {
    const index = chapterOf(saved);
    if (index < 0) {
      start();
      return;
    }
    navigateTo.current = index;
    setSaved(null);
    setChapterIndex(index);
    setStepIndex(0);
    setActive(true);
  }, [chapterOf, saved, start]);


  const totalSteps = React.useMemo(
    () => chapters.reduce((sum, entry) => sum + entry.steps.length, 0),
    [chapters],
  );
  const doneSteps = React.useMemo(
    () => chapters.slice(0, chapterIndex).reduce((sum, entry) => sum + entry.steps.length, 0) + stepIndex,
    [chapters, chapterIndex, stepIndex],
  );

  const value = React.useMemo<TourContextValue>(
    () => ({
      active,
      chapter,
      step,
      chapterIndex,
      stepIndex,
      totalChapters: chapters.length,
      totalSteps,
      progress: totalSteps === 0 ? 0 : doneSteps / totalSteps,
      start,
      resume,
      next,
      back,
      stop,
      saved: (() => {
        const index = chapterOf(saved);
        return index >= 0 ? { chapterTitle: chapters[index].title, chapterNumber: index + 1 } : null;
      })(),
      finishedBefore,
      onRoute,
      navigating: navigating || (!onRoute && navigateTo.current === chapterIndex),
      returnToChapter,
      available: chapters.length > 0,
    }),
    [
      active, back, chapter, chapterIndex, chapterOf, chapters, doneSteps, finishedBefore, navigating,
      next, onRoute, resume, returnToChapter, saved, start, step, stepIndex, stop, totalSteps,
    ],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

