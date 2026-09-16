# Branding

OKUN CRM ist ein Produkt von OKUN Software. Die Marke ist kein Zusatz auf dem
Login-Bildschirm, sondern zieht sich durch die gesamte Anwendung – und sie ist
zentral gesteuert, damit sie sich pflegen lässt.

---

## 1. Markenordnung

| Ebene | Bedeutung |
| --- | --- |
| **OKUN Systems** | Agentur- und Implementierungsdienstleistungen |
| **OKUN Software** | Softwareentwicklung, Softwareprodukte, Lizenzierung |
| **OKUN CRM** | Produkt von OKUN Software |

Der Hersteller erscheint als Endorsement: **Powered by OKUN Software** – im
Login, im Sidebar-Footer und in den Einstellungen.

## 2. Leitidee und Botschaften

- Claim: **Kunden. Beziehungen. Wachstum.**
- Kommunikative Ebene: **Mehr als Kontakte. Echte Möglichkeiten.**
- Haltung: hochwertig, modern, technologisch, ruhig, präzise, Premium-B2B.
  Keine verspielten Effekte, keine Neon-Oberflächen.

## 3. Farbwelt

Die Tokens stehen in `src/app/globals.css` (`@theme`) und in
`src/lib/brand/config.ts`.

| Rolle | Wert |
| --- | --- |
| Primary Dark | `#0D1117` |
| Dark | `#1A1F26` |
| Primary Blue | `#2563EB` |
| Accent Cyan | `#06B6D4` |
| Light | `#E5E7EB` |

Die Arbeitsoberfläche ist hell und datenorientiert. Dunkle OKUN-Flächen sind
Markenmomente: Navigation, Login, besondere Header.

Statusfarben (Erfolg, Warnung, Gefahr) tragen ausschließlich Bedeutung und
werden nie dekorativ verwendet.

### Diagrammfarben

Diagramme führen die Marke an, ohne Lesbarkeit zu opfern:

- **Einzelne Serie** (Funnel, Quellen, Aktivitäten): OKUN Primary Blue.
- **Geordnete Stufen** (Pipeline-Funnel): eine Blau-Rampe.
- **Mehrere Serien**: eine feste Reihenfolge, die auf Farbfehlsichtigkeit
  geprüft ist (`src/lib/charts.ts`). Eine reine Blau-Cyan-Palette besteht diese
  Prüfung nicht – Cyan bleibt deshalb Akzentfarbe der Oberfläche, nicht
  Serienfarbe direkt neben Blau.
- **Gewonnen/Verloren** nutzen Statusfarben, weil das Zustände sind.

Jede Serie ist zusätzlich über Legende oder direkte Beschriftung erkennbar –
Farbe allein trägt nie die Information.

## 4. Produktzeichen

Das CRM hat ein eigenes Produktzeichen: eine abstrahierte Person (Kunde) in
einem offenen Ring (Beziehung), aus dem aufsteigende Balken (Wachstum)
ausbrechen. Das Unternehmenszeichen von OKUN Software wird **nicht** als
Produktzeichen verwendet.

Im Wortzeichen **OKUN** gehört der kleine Punkt oben rechts am „O" zur
Markenidentität und darf nie entfallen.

### Assets

Quelle der Wahrheit sind Vektorkomponenten:

```
src/components/brand/marks.tsx     OkunCrmIcon, OkunWordmark, CrmWordmark,
                                   OkunCrmLogo, PoweredByOkunSoftware
```

Daraus erzeugt `pnpm brand:build` die statischen Dateien für Favicon, E-Mail,
OG-Bilder und Dokumentation:

```
public/brand/okun-crm/         icon.svg · icon-dark.svg · icon-light.svg
                               logo-horizontal(-inverse).svg
                               logo-vertical(-inverse).svg
public/brand/okun-software/    wordmark(-inverse).svg
                               powered-by(-inverse).svg
```

> **Status der Assets:** Die Zeichen sind aus der Markenreferenz rekonstruiert,
> damit das Produkt vollständig gebrandet ausgeliefert werden kann. Sobald die
> finalen Vektordateien aus dem Markenpaket vorliegen, ersetzen sie die Dateien
> in `public/brand/` und die Pfade in `src/lib/brand/config.ts`. Kein anderer
> Teil der Anwendung zeichnet ein Logo – der Austausch ist damit eine
> Dateiablösung, kein Refactoring.

## 5. Marke in der Oberfläche

| Ort | Auftritt |
| --- | --- |
| Login | Dunkle Markenfläche, großes Produktlogo, Claim, Powered by OKUN Software |
| Sidebar | Produktlogo oben, Endorsement unten, Cyan-Akzent auf der aktiven Navigation |
| Primäraktionen | OKUN Primary Blue |
| Karten und Tabellen | Ruhige Ränder, zurückhaltende Schatten |
| Diagramme | Markenfarben nach den Regeln oben |
| Einstellungen | Abschnitt „Produkt & Marke" mit Herstellerangabe |

## 6. Designsystem

Tokens in `src/app/globals.css`: Farben, Typografie (Inter), Abstände, Radien,
Schatten, Fokusring, Übergänge. Primitive in `src/components/ui`: Button,
Field/Input/Select/Textarea/Checkbox, Card, Badge, Table, Pagination, Modal,
Drawer, ConfirmDialog, Dropdown, Tabs, Avatar, Tooltip, Toast, Skeleton,
EmptyState, PageHeader.

Regel: Keine Seite definiert eigene Markenfarben oder eigene Abstände. Wenn ein
Baustein fehlt, kommt er in das Designsystem – nicht in die Seite.

## 7. White-Label-Vorbereitung

`Organization.brandConfig` (JSON) ist im Datenmodell vorhanden und dafür
gedacht, die Werte aus `src/lib/brand/config.ts` pro Organisation zu
überschreiben. Da alle Komponenten diese Konfiguration und die CSS-Tokens
verwenden, ist ein späteres White-Label eine Konfigurations-, keine
Codeänderung.

Ausdrücklich gilt: Standard- und Hauptmarke ist **OKUN CRM by OKUN Software**.
Die White-Label-Fähigkeit ist vorbereitet, aber nicht auf Kosten der
Produktqualität ausgebaut.
