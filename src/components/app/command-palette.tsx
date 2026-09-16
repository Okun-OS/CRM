"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, Search, Sparkles, Target, Users, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api-client";

type SearchResult = {
  type: "contact" | "company" | "lead" | "deal";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

const TYPE_META: Record<SearchResult["type"], { label: string; icon: React.ReactNode }> = {
  contact: { label: "Kontakt", icon: <Users className="h-3.5 w-3.5" /> },
  company: { label: "Unternehmen", icon: <Building2 className="h-3.5 w-3.5" /> },
  lead: { label: "Lead", icon: <Sparkles className="h-3.5 w-3.5" /> },
  deal: { label: "Deal", icon: <Target className="h-3.5 w-3.5" /> },
};

/**
 * Global search / command palette (⌘K). Results come from the server-side
 * search endpoint, which only returns records the user may read.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setHighlight(0);
    }
  }, [open]);

  React.useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.get<SearchResult[]>(`/api/v1/search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        setResults(data);
        setHighlight(0);
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const go = React.useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-ink-200 bg-white px-3 text-sm text-ink-400 transition-colors hover:border-ink-300 hover:text-ink-600"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Kontakte, Unternehmen, Deals suchen…</span>
        <kbd className="hidden rounded border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-2xs text-ink-500 sm:inline">
          ⌘K
        </kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[75] flex items-start justify-center bg-okun-950/45 p-4 pt-[12vh] animate-okun-fade"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Globale Suche"
            className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-overlay animate-okun-rise"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-ink-200 px-4">
              <Search className="h-4 w-4 text-ink-400" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setHighlight((value) => Math.min(value + 1, results.length - 1));
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setHighlight((value) => Math.max(value - 1, 0));
                  }
                  if (event.key === "Enter" && results[highlight]) go(results[highlight].href);
                }}
                placeholder="Suchen…"
                className="h-12 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-400"
              />
            </div>

            <div className="max-h-[22rem] overflow-y-auto p-2">
              {query.trim().length < 2 ? (
                <p className="px-3 py-6 text-center text-xs text-ink-500">
                  Mindestens zwei Zeichen eingeben, um Kontakte, Unternehmen, Leads und Deals zu durchsuchen.
                </p>
              ) : loading && results.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-ink-500">Suche läuft…</p>
              ) : results.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-ink-500">Keine Treffer für „{query}“.</p>
              ) : (
                <ul>
                  {results.map((result, index) => (
                    <li key={`${result.type}-${result.id}`}>
                      <button
                        type="button"
                        onMouseEnter={() => setHighlight(index)}
                        onClick={() => go(result.href)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                          index === highlight ? "bg-brand-50" : "hover:bg-ink-50",
                        )}
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ink-100 text-ink-500">
                          {TYPE_META[result.type].icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink-900">{result.title}</span>
                          {result.subtitle ? (
                            <span className="block truncate text-xs text-ink-500">{result.subtitle}</span>
                          ) : null}
                        </span>
                        <span className="text-2xs uppercase tracking-wide text-ink-400">
                          {TYPE_META[result.type].label}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-ink-200 bg-ink-50/60 px-4 py-2 text-2xs text-ink-500">
              <span className="flex items-center gap-1.5">
                <CornerDownLeft className="h-3 w-3" /> Öffnen
              </span>
              <span>↑ ↓ Navigieren · Esc Schließen</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
