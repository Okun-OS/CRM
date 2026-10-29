"use client";

import { Bookmark, Compass, Play, RotateCcw } from "lucide-react";
import { Dropdown, DropdownItem } from "@/components/ui/misc";
import { useTour } from "./tour-provider";

/**
 * Der Knopf „Einführung“ in der Kopfzeile.
 *
 * Ein eigener Knopf statt eines Eintrags im Benutzermenü: Wer die Tour
 * unterbrochen hat, soll sehen, dass sie auf ihn wartet — und mit einem Klick
 * dort weitermachen, wo er aufgehört hat.
 */
export function TourMenu() {
  const tour = useTour();
  if (!tour.available) return null;

  const restartLabel = tour.saved || tour.finishedBefore || tour.active ? "Tour neu starten" : "Tour starten";

  return (
    <Dropdown
      className="w-64"
      trigger={
        <button
          type="button"
          className="relative inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
          aria-label="Einführung"
          data-tour="topbar-tour"
        >
          <Compass className="h-4 w-4" />
          <span className="hidden sm:inline">Einführung</span>
          {/* Ein Punkt verrät, dass eine unterbrochene Tour wartet. */}
          {tour.saved && !tour.active ? (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
          ) : null}
        </button>
      }
    >
      {(close) => (
        <>
          <p className="px-2.5 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-400">Einführung</p>
          {tour.active ? (
            <DropdownItem
              icon={<Bookmark className="h-4 w-4" />}
              onClick={() => {
                close();
                tour.stop("paused");
              }}
            >
              Speichern und beenden
            </DropdownItem>
          ) : tour.saved ? (
            <DropdownItem
              icon={<Play className="h-4 w-4" />}
              onClick={() => {
                close();
                tour.resume();
              }}
            >
              <span className="flex flex-col">
                <span>Tour fortsetzen</span>
                <span className="text-2xs text-ink-500">
                  Weiter bei Kapitel {tour.saved.chapterNumber}: {tour.saved.chapterTitle}
                </span>
              </span>
            </DropdownItem>
          ) : null}
          <DropdownItem
            icon={<RotateCcw className="h-4 w-4" />}
            onClick={() => {
              close();
              tour.start();
            }}
          >
            {restartLabel}
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}
