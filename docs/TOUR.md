# Produkttour

Die Einführung, die jedes neue Konto einmal bekommt. Sie ist keine Folge von
Pop-ups: Sie stellt echte Bedienelemente frei, wartet auf echte Klicks, und am
Ende hat der Mensch wirklich ein Unternehmen, einen Kontakt und eine Chance
angelegt.

---

## 1. Leitgedanken

| Grundsatz | Warum |
| --- | --- |
| **Nichts nachbauen** | Die Tour zeigt auf die Knöpfe, die es wirklich gibt. Es gibt keine Attrappe, keinen Demomodus und keine erfundenen Daten. |
| **Auf Handlung warten** | Ein Schritt, der eine Handlung verlangt, bietet kein „Weiter“ an — sonst wäre das Warten Zierde. |
| **Erklären, warum** | Jeder wichtige Schritt hat einen abgesetzten „Warum“-Abschnitt. Das ist die Frage, die ein Rundgang sonst offen lässt. |
| **Nie im Weg stehen** | Esc beendet jederzeit. Wer wegnavigiert, wird nicht zurückgezerrt. Fehlt ein Ziel, wird der Schritt still übersprungen. |
| **Einmal, nicht ständig** | Der Zustand hängt am Menschen, nicht an der Organisation oder am Browser. |

## 2. Aufbau

```
src/components/tour/
  types.ts           Bauteile: Kapitel, Schritt, Fortschaltbedingung
  tour-chapters.ts   Der Inhalt — fünfzehn Kapitel, rund sechzig Schritte
  tour-provider.tsx  Ablaufsteuerung: Rechte, Fortschritt, Seitenwechsel
  tour-overlay.tsx   Darstellung: Freistellung und Erklärkarte
  use-target.ts      Verfolgt das Zielelement und seine Position
```

Inhalt und Steuerung sind getrennt. Wer die Tour ändern will, fasst in aller
Regel nur `tour-chapters.ts` an.

Der Weg ist ein Arbeitsweg, kein Menürundgang:

| # | Kapitel | Frage |
| --- | --- | --- |
| 1–2 | Begrüßung, Orientierung | Wo bin ich, und wo fange ich an? |
| 3–5 | Unternehmen, Kontakte, Akte | Warum sind das getrennte Objekte? |
| 6 | Deals und Pipeline | Was ist eine Chance, und wie bewegt sie sich? |
| 7–10 | Akquise, Prospects, Sequenzen, Versand | Woher kommen neue Gespräche? |
| 11 | Heute | Was muss ich jetzt tun? |
| 12–13 | Automatisierung, Auswertung | Was macht das System selbst? |
| 14–15 | Einrichtung, Abschluss | Was stelle ich noch ein? |

Die Reihenfolge ist Absicht: Erst wenn klar ist, was ein Kontakt und eine
Chance sind, lässt sich erklären, warum ein **Prospect** etwas anderes ist.

## 3. Wie die Freistellung funktioniert

Nicht als Loch in einer Maske, sondern als **vier Flächen um das Ziel herum**.
Über dem Ziel liegt dadurch nichts — der Klick trifft den echten Knopf, und die
Anwendung tut, was sie immer tut. Ein Rahmen darüber (`pointer-events: none`)
markiert die Stelle und pulst, solange auf eine Handlung gewartet wird.

Ein E2E-Test prüft genau das: Er fragt über `document.elementFromPoint`, ob in
der Mitte des Ziels wirklich das Ziel liegt und nicht die Abdunklung.

## 4. Fortschaltbedingungen

| Bedingung | Der Schritt endet, wenn … |
| --- | --- |
| `manual` | der Mensch „Weiter“ drückt |
| `click` | das freigestellte Element geklickt wurde |
| `appear` | ein Element auftaucht — etwa ein geöffnetes Formular |
| `disappear` | ein Element verschwindet — etwa ein gespeichertes Formular |
| `navigate` | die Adresse passt — etwa nach dem Öffnen einer Detailseite |

## 5. Wann die Tour navigiert — und wann nicht

Sie navigiert **nur**, wenn sie selbst ein Kapitel weiterschaltet. Nicht beim
Fortsetzen nach einem Neuladen und nicht, wenn jemand sich umsieht: Beides
würde den Menschen von der Seite reißen, die er gerade sehen wollte.

Ist die Tour auf der falschen Seite, dunkelt sie nichts ab, sondern wartet
sichtbar unten rechts — mit „Weitermachen“ und „Beenden“.

## 6. Zustand

Auf dem `User`, nicht auf der Organisation:

| Feld | Bedeutung |
| --- | --- |
| `tourSeenVersion` | Bis zu welcher Fassung dieser Mensch sie gesehen hat |
| `tourProgress` | Kapitel und Schritt, um nach einer Unterbrechung fortzusetzen |
| `tourFinishedAt` | Wann sie abgeschlossen wurde |

`TOUR_VERSION` in `src/server/services/tour.ts` ist die ausgelieferte Fassung.
Liegt sie über `tourSeenVersion`, startet die Tour von selbst. **Erhöhen Sie
sie nur**, wenn die Tour so weit überarbeitet wurde, dass auch erfahrene Nutzer
sie erneut sehen sollen — nicht bei einer Textkorrektur.

Ein beschädigter gespeicherter Fortschritt (etwa nach einer Formatumstellung)
wird stillschweigend verworfen; die Tour beginnt dann von vorn, statt mit einem
Fehler stehen zu bleiben.

## 7. Ankerpunkte

Die Tour findet ihre Ziele über `data-tour`-Merkmale und über die ohnehin
stabilen Feld-IDs der Formulare:

```
nav-<pfad>            jeder Navigationseintrag, etwa nav-contacts
topbar-search         globale Suche
topbar-create         Schnellanlage
topbar-notifications  Benachrichtigungen
topbar-user           Benutzermenü
list-search           Suchfeld einer Liste
list-filter           Filter
list-views            gespeicherte Ansichten
list-export           CSV-Export
list-create           Anlegen-Knopf
list-table            die Tabelle
drawer                ein geöffnetes seitliches Formular
workflow-create       Workflow anlegen
outreach-<seite>      Akquise-Navigation, etwa outreach-prospects
prospect-create       Prospect anlegen
prospect-import       Prospects übernehmen
prospect-search       Suchfeld der Prospects
sequence-create       Sequenz erstellen
sending-account-create  Versandkonto einrichten
suppression-add       Adresse sperren
acquisition-funnel    die Trichterkarte
acquisition-attention offene Punkte
acquisition-attribution  Herkunftstabelle
next-action           die nächste Aktion auf einer Detailseite
timeline              der Verlauf
settings-<bereich>    Einträge der Einstellungsnavigation
```

Wer ein Bedienelement umbaut, sollte sein `data-tour` mitnehmen. Geht es
verloren, überspringt die Tour den Schritt still — sie bricht nicht, aber die
Erklärung fehlt dann.

## 8. Geprüft

- **7 Unit-Tests** (`tests/tour.test.ts`): Angebot für neue Konten, Fortsetzen,
  Abschluss, Trennung pro Mensch, Neustart, Abweisung unbrauchbarer Eingaben,
  Umgang mit beschädigtem Fortschritt.
- **7 Unit-Tests** (`tests/tour-chapters.test.ts`) prüfen den Inhalt statisch:
  Jeder Anker, auf den ein Schritt zeigt, muss in der Oberfläche wirklich
  gesetzt sein — die festen Namen wie die berechneten aus den beiden
  Navigationen. Dazu eindeutige Kennungen, nur existierende Rechte, ein Hinweis
  an jedem wartenden Schritt und ein Notausgang für jeden Schritt, dessen Ziel
  fehlen kann.
- **6 E2E-Tests** (`e2e/tour.spec.ts`): selbsttätiger Start, Freistellung samt
  Erreichbarkeit des echten Knopfs, Warten auf den Klick, Pausieren beim
  Seitenwechsel, Abbrechen ohne erneutes Aufdrängen, Neustart über das Menü —
  und der Weg durch die Akquise samt still übersprungenem Schritt ohne Ziel.
- Die übrigen E2E-Tests schließen die Tour zu Beginn mit Esc (`e2e/helpers.ts`)
  — genauso, wie ein Mensch es täte, statt sie über eine Hintertür abzuschalten.

### Was dieser Inhaltstest gefunden hat

Beim Bauen der Tour zeigte ein Schritt auf `nav--dashboard`, während die
Oberfläche `nav-dashboard` setzt. Aufgefallen ist das erst im Browser. Der
Anker-Test rechnet das jetzt nach.

Dazu kam ein Fund in vier bereits bestehenden Schritten: „Unternehmen
erstellen“, „Kontakt erstellen“, „Deal erstellen“ und „Workflow erstellen“
warteten auf einen Klick, ohne als `optional` markiert zu sein. Fehlte der
Knopf, hätte die Tour ohne Ausweg gewartet. Sie sind jetzt `optional` — der
Klickzwang bleibt, solange der Knopf da ist, und entfällt still, wenn nicht.
