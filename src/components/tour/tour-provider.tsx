"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { TOUR_CHAPTERS } from "./tour-chapters";
import type { TourChapter, TourStep } from "./types";
import type { Permission } from "@/lib/rbac";

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
  start: () => void;
  next: () => void;
  back: () => void;
  stop: (reason: "finished" | "aborted") => void;
  /** Ob die aktuelle Seite zum laufenden Kapitel gehört. */
  onRoute: boolean;
  /** Zurück auf die Seite, auf der das Kapitel spielt. */
  returnToChapter: () => void;
  /** Ob die Tour überhaupt angeboten werden kann. */
  available: boolean;
};

const TourContext = React.createContext<TourContextValue | null>(null);

export function useTour() {
  const value = React.useContext(TourContext);
  if (!value) throw new Error("useTour außerhalb des TourProvider verwendet");
  return value;
}

/** Fragt den gespeicherten Zustand ab und schreibt ihn zurück. */
async function readState(): Promise<{ shouldStart: boolean; progress: { chapter: string; step: number } | null } | null> {
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

  const chapter = active ? chapters[chapterIndex] ?? null : null;
  const step = chapter ? chapter.steps[stepIndex] ?? null : null;

  /* ── Start: nur für Menschen, die sie noch nicht gesehen haben ───────── */
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await readState();
      if (cancelled || !state?.shouldStart) return;
      if (state.progress) {
        const index = chapters.findIndex((c) => c.id === state.progress!.chapter);
        if (index >= 0) {
          setChapterIndex(index);
          setStepIndex(Math.min(state.progress.step, chapters[index].steps.length - 1));
        }
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
   */
  const wantsNavigation = React.useRef(false);

  React.useEffect(() => {
    if (!active || !chapter || onRoute) return;
    if (!wantsNavigation.current) return;
    wantsNavigation.current = false;
    router.push(chapter.route);
  }, [active, chapter, onRoute, router]);

  const returnToChapter = React.useCallback(() => {
    if (chapter) router.push(chapter.route);
  }, [chapter, router]);

  /* `next` und `back` werden weiter unten erklärt; sie setzen `wantsNavigation`,
     bevor sie das Kapitel wechseln. */

  const stop = React.useCallback((reason: "finished" | "aborted") => {
    setActive(false);
    void writeState({ status: "finished" });
    // `reason` unterscheidet nur die Rückmeldung an den Menschen; gespeichert
    // wird in beiden Fällen dasselbe: Diese Fassung wurde gesehen.
    if (reason === "finished") {
      window.dispatchEvent(new CustomEvent("okun:tour-finished"));
    }
  }, []);

  const next = React.useCallback(() => {
    if (!chapter) return;
    if (stepIndex + 1 < chapter.steps.length) {
      setStepIndex(stepIndex + 1);
      return;
    }
    if (chapterIndex + 1 < chapters.length) {
      wantsNavigation.current = true;
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
      wantsNavigation.current = true;
      setChapterIndex(chapterIndex - 1);
      setStepIndex(Math.max(0, previous.steps.length - 1));
    }
  }, [chapterIndex, chapters, stepIndex]);

  const start = React.useCallback(() => {
    wantsNavigation.current = true;
    setChapterIndex(0);
    setStepIndex(0);
    setActive(true);
    void writeState({ status: "restart" });
  }, []);

  /* ── Von überall aus startbar, ohne den Kontext durchzureichen ───────── */
  React.useEffect(() => {
    const handler = () => start();
    window.addEventListener("okun:tour-start", handler);
    return () => window.removeEventListener("okun:tour-start", handler);
  }, [start]);

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
      next,
      back,
      stop,
      onRoute,
      returnToChapter,
      available: chapters.length > 0,
    }),
    [
      active, back, chapter, chapterIndex, chapters.length, doneSteps, next, onRoute,
      returnToChapter, start, step, stepIndex, stop, totalSteps,
    ],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

/** Startet die Tour von außerhalb des Kontexts, etwa aus dem Benutzermenü. */
export function startTour() {
  window.dispatchEvent(new Event("okun:tour-start"));
}
