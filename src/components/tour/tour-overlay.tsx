"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, MousePointerClick, X } from "lucide-react";
import { useTour } from "./tour-provider";
import { scrollIntoView, useTarget, type Rect } from "./use-target";
import { cn } from "@/lib/cn";

/**
 * Darstellung der Tour.
 *
 * Das Ziel wird **freigestellt**, nicht überdeckt: Vier Flächen legen sich um
 * das Element, die Fläche darüber bleibt frei. Dadurch klickt man den echten
 * Knopf, nicht eine Nachbildung — und die Anwendung tut wirklich, was sie
 * immer tut.
 */

const PAD = 6;
const CARD_WIDTH = 384;
const GAP = 14;

type Placement = "top" | "bottom" | "left" | "right";

function choosePlacement(rect: Rect, preferred: Placement | "auto" | undefined, cardHeight: number): Placement {
  const room = {
    top: rect.top,
    bottom: window.innerHeight - (rect.top + rect.height),
    left: rect.left,
    right: window.innerWidth - (rect.left + rect.width),
  };
  if (preferred && preferred !== "auto") {
    const needed = preferred === "top" || preferred === "bottom" ? cardHeight + GAP : CARD_WIDTH + GAP;
    if (room[preferred] >= needed) return preferred;
  }
  // Sonst die Seite mit dem meisten Platz — eine feste Reihenfolge legt die
  // Karte sonst über ein Formular, obwohl daneben die halbe Seite frei ist.
  const sides: Placement[] = ["bottom", "top", "right", "left"];
  const fitting = sides.filter((side) => {
    const needed = side === "top" || side === "bottom" ? cardHeight + GAP : CARD_WIDTH + GAP;
    return room[side] >= needed;
  });
  if (fitting.length === 0) return "bottom";
  return fitting.reduce((best, side) => (room[side] > room[best] ? side : best), fitting[0]);
}

function cardPosition(rect: Rect, placement: Placement, cardHeight: number) {
  const clampX = (x: number) => Math.max(12, Math.min(x, window.innerWidth - CARD_WIDTH - 12));
  const clampY = (y: number) => Math.max(12, Math.min(y, window.innerHeight - cardHeight - 12));

  switch (placement) {
    case "top":
      return { left: clampX(rect.left + rect.width / 2 - CARD_WIDTH / 2), top: clampY(rect.top - cardHeight - GAP) };
    case "left":
      return { left: clampX(rect.left - CARD_WIDTH - GAP), top: clampY(rect.top + rect.height / 2 - cardHeight / 2) };
    case "right":
      return { left: clampX(rect.left + rect.width + GAP), top: clampY(rect.top + rect.height / 2 - cardHeight / 2) };
    default:
      return { left: clampX(rect.left + rect.width / 2 - CARD_WIDTH / 2), top: clampY(rect.top + rect.height + GAP) };
  }
}

export function TourOverlay() {
  const tour = useTour();
  const pathname = usePathname();
  const { active, step, chapter } = tour;

  const { rect, found, element } = useTarget(step?.target, active);
  const [cardHeight, setCardHeight] = React.useState(220);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const [waited, setWaited] = React.useState(false);

  /* ── Ziel in den Blick holen ─────────────────────────────────────────── */
  React.useEffect(() => {
    if (!active || !step?.target) return;
    const timer = window.setTimeout(() => scrollIntoView(step.target), 120);
    return () => window.clearTimeout(timer);
  }, [active, step]);

  /* ── Kartenhöhe messen, damit die Platzierung stimmt ─────────────────── */
  React.useEffect(() => {
    if (!cardRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setCardHeight(entry.contentRect.height);
    });
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [step?.id]);

  /* ── Fehlt das Ziel dauerhaft, überspringen wir den Schritt ──────────── */
  React.useEffect(() => {
    setWaited(false);
    if (!active || !step?.target) return;
    const timer = window.setTimeout(() => setWaited(true), 1400);
    return () => window.clearTimeout(timer);
  }, [active, step?.id, step?.target]);

  React.useEffect(() => {
    if (!active || !step || !step.target || found || !waited) return;
    if (step.optional) tour.next();
  }, [active, found, step, tour, waited]);

  /* ── Auf echte Handlungen warten ─────────────────────────────────────── */
  React.useEffect(() => {
    if (!active || !step) return;
    const advance = step.advance;

    if (advance.on === "click") {
      const onClick = (event: MouseEvent) => {
        const target = element.current;
        if (!target) return;
        if (event.target instanceof Node && target.contains(event.target)) {
          // Erst nach dem Klick weitergehen, damit die Anwendung ihre eigene
          // Wirkung entfalten kann, bevor der nächste Schritt danach sucht.
          window.setTimeout(() => tour.next(), 260);
        }
      };
      document.addEventListener("click", onClick, true);
      return () => document.removeEventListener("click", onClick, true);
    }

    if (advance.on === "appear" || advance.on === "disappear") {
      const wanted = advance.on === "appear";
      let seenOpposite = !wanted;
      const check = () => {
        const there = Boolean(document.querySelector(advance.selector));
        if (there !== wanted) {
          seenOpposite = true;
          return;
        }
        if (seenOpposite && there === wanted) tour.next();
      };
      const timer = window.setInterval(check, 220);
      return () => window.clearInterval(timer);
    }

    return undefined;
  }, [active, element, step, tour]);

  /* ── Schritte, die einen Seitenwechsel erwarten ──────────────────────── */
  React.useEffect(() => {
    if (!active || !step || step.advance.on !== "navigate") return;
    if (pathname.includes(step.advance.match)) tour.next();
  }, [active, pathname, step, tour]);

  /* ── Esc bricht ab ───────────────────────────────────────────────────── */
  React.useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        tour.stop("aborted");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, tour]);

  if (!active || !step || !chapter) return null;

  /* Der Mensch hat sich umgesehen. Statt ihn zurückzuzerren, bietet die Karte
     die Rückkehr an — und bleibt ansonsten aus dem Weg. */
  if (!tour.onRoute) {
    return (
      <div className="okun-tour">
        <div className="okun-tour-card okun-tour-card-parked">
          <p className="text-2xs font-medium uppercase tracking-wider text-brand-600">Einführung pausiert</p>
          <h2 className="mt-1 text-sm font-semibold text-ink-900">Kapitel „{chapter.title}“ wartet</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-600">
            Sie haben die Seite gewechselt. Sehen Sie sich in Ruhe um — die Einführung macht weiter,
            sobald Sie zurückkehren.
          </p>
          <div className="mt-3 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => tour.stop("aborted")}
              className="rounded-md px-2 py-1.5 text-xs text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
            >
              Beenden
            </button>
            <button
              type="button"
              onClick={tour.returnToChapter}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-600"
            >
              Weitermachen
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const waiting = step.advance.on !== "manual";
  const hasSpot = Boolean(step.target) && found && rect !== null;
  const placement = hasSpot ? choosePlacement(rect!, step.placement, cardHeight) : "bottom";
  const position = hasSpot
    ? cardPosition(rect!, placement, cardHeight)
    : {
        left: Math.max(12, window.innerWidth / 2 - CARD_WIDTH / 2),
        top: Math.max(12, window.innerHeight / 2 - cardHeight / 2),
      };

  const spot = hasSpot
    ? {
        top: rect!.top - PAD,
        left: rect!.left - PAD,
        width: rect!.width + PAD * 2,
        height: rect!.height + PAD * 2,
      }
    : null;

  return (
    <div className="okun-tour" role="dialog" aria-modal="false" aria-labelledby="okun-tour-title">
      {/* Abdunklung als vier Flächen um das Ziel herum — die Mitte bleibt frei
          und damit anklickbar. */}
      {spot ? (
        <>
          <div className="okun-tour-mask" style={{ top: 0, left: 0, right: 0, height: Math.max(0, spot.top) }} />
          <div className="okun-tour-mask" style={{ top: spot.top + spot.height, left: 0, right: 0, bottom: 0 }} />
          <div className="okun-tour-mask" style={{ top: spot.top, left: 0, width: Math.max(0, spot.left), height: spot.height }} />
          <div className="okun-tour-mask" style={{ top: spot.top, left: spot.left + spot.width, right: 0, height: spot.height }} />
          <div
            className={cn("okun-tour-ring", waiting && "okun-tour-ring-waiting")}
            style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
          />
        </>
      ) : (
        <div className="okun-tour-mask" style={{ inset: 0 }} />
      )}

      <div
        ref={cardRef}
        className="okun-tour-card"
        style={{ left: position.left, top: position.top, width: CARD_WIDTH }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xs font-medium uppercase tracking-wider text-brand-600">
              {chapter.title} · Schritt {tour.stepIndex + 1} von {chapter.steps.length}
            </p>
            <h2 id="okun-tour-title" className="mt-1 text-base font-semibold leading-snug text-ink-900">
              {step.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => tour.stop("aborted")}
            className="-mr-1 -mt-1 rounded-md p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
            aria-label="Tour beenden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2.5 text-sm leading-relaxed text-ink-600">{step.body}</p>

        {step.why ? (
          <div className="mt-3 rounded-md border-l-2 border-accent-400 bg-accent-50 px-3 py-2">
            <p className="text-2xs font-semibold uppercase tracking-wider text-accent-700">Warum</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{step.why}</p>
          </div>
        ) : null}

        {waiting ? (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-brand-50 px-3 py-2">
            <MousePointerClick className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
            <p className="text-xs leading-relaxed text-brand-800">
              {step.waitingFor ?? "Führen Sie die Aktion aus, dann geht es weiter."}
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-200 pt-3">
          <div className="flex items-center gap-1.5">
            <div className="h-1 w-20 overflow-hidden rounded-full bg-ink-200" aria-hidden="true">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round(tour.progress * 100)}%` }} />
            </div>
            <span className="text-2xs tabular-nums text-ink-400">{Math.round(tour.progress * 100)} %</span>
          </div>

          <div className="flex items-center gap-1.5">
            {tour.chapterIndex + tour.stepIndex > 0 ? (
              <button
                type="button"
                onClick={tour.back}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Zurück
              </button>
            ) : null}

            {step.offerLater ? (
              <button
                type="button"
                onClick={() => tour.stop("aborted")}
                className="rounded-md px-2 py-1.5 text-xs text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
              >
                Später
              </button>
            ) : null}

            {waiting ? (
              step.skippable ? (
                <button
                  type="button"
                  onClick={tour.next}
                  className="rounded-md px-2 py-1.5 text-xs text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
                >
                  Überspringen
                </button>
              ) : null
            ) : (
              <button
                type="button"
                onClick={tour.next}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-600"
              >
                {step.cta ?? "Weiter"}
                {step.cta === "Tour beenden" ? <Check className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
