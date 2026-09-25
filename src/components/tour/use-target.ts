"use client";

import * as React from "react";

export type Rect = { top: number; left: number; width: number; height: number };

/**
 * Verfolgt ein Element der Oberfläche.
 *
 * Sucht es anhand einer CSS-Auswahl und hält seine Position aktuell — auch
 * wenn gescrollt, umgebrochen oder der Datensatz nachgeladen wird. Fehlt das
 * Element, ist das Ergebnis `null`; die Tour entscheidet dann selbst, ob sie
 * wartet oder den Schritt überspringt.
 */
export function useTarget(selector: string | undefined, active: boolean) {
  const [rect, setRect] = React.useState<Rect | null>(null);
  const [found, setFound] = React.useState(false);
  const elementRef = React.useRef<Element | null>(null);

  React.useEffect(() => {
    if (!active || !selector) {
      setRect(null);
      setFound(false);
      elementRef.current = null;
      return;
    }

    let frame = 0;
    let stopped = false;

    const measure = () => {
      const element = document.querySelector(selector);
      elementRef.current = element;
      if (!element) {
        setFound(false);
        setRect(null);
        return;
      }
      const box = element.getBoundingClientRect();
      // Ein Element mit Nullfläche ist zwar da, aber nicht zu sehen —
      // etwa weil es in einem eingeklappten Bereich sitzt.
      if (box.width === 0 && box.height === 0) {
        setFound(false);
        setRect(null);
        return;
      }
      setFound(true);
      setRect((current) => {
        if (
          current &&
          Math.abs(current.top - box.top) < 0.5 &&
          Math.abs(current.left - box.left) < 0.5 &&
          Math.abs(current.width - box.width) < 0.5 &&
          Math.abs(current.height - box.height) < 0.5
        ) {
          return current;
        }
        return { top: box.top, left: box.left, width: box.width, height: box.height };
      });
    };

    const loop = () => {
      if (stopped) return;
      measure();
      frame = window.requestAnimationFrame(loop);
    };

    // Ein Messtakt pro Bild ist hier das Einfachste, was verlässlich
    // funktioniert: Er deckt Scrollen, Umbruch, Nachladen und Animationen
    // gleichermaßen ab, ohne für jeden Fall einen eigenen Beobachter.
    loop();
    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
    };
  }, [selector, active]);

  return { rect, found, element: elementRef };
}

/** Holt das Ziel sanft in den sichtbaren Bereich. */
export function scrollIntoView(selector: string | undefined) {
  if (!selector) return;
  const element = document.querySelector(selector);
  if (!element) return;
  const box = element.getBoundingClientRect();
  const fullyVisible = box.top >= 72 && box.bottom <= window.innerHeight - 24;
  if (fullyVisible) return;
  element.scrollIntoView({ block: "center", behavior: "smooth" });
}
