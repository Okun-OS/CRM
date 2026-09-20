# Betreiber-Backoffice

Die Ebene, auf der OKUN Software seine Kunden verwaltet — getrennt von den
Mandanten, in denen diese Kunden arbeiten.

---

## 1. Die Grenze

Das CRM ist mandantenfähig: Jede **Organisation** ist ein abgeschotteter
Mandant, jede Abfrage serverseitig auf `organizationId` eingegrenzt. Das
Backoffice ist die einzige Stelle, die über einen Mandanten hinaussieht — und
sie sieht bewusst wenig:

| Sichtbar | Nicht sichtbar |
| --- | --- |
| Name, Kennung, Anlagedatum, Zustand | Kontakte, Unternehmen, Leads, Deals |
| Anzahl Kontakte, Unternehmen, Deals, Aktivitäten | Notizen, E-Mails, Dateien, Aktivitätsinhalte |
| Mitglieder mit Rolle und letzter Anmeldung | Gespeicherte Berichte, Ansichten, Automationen |
| Offene Einladungen | Alles, was ein Mandant über seine Kunden weiß |

Das ist keine Konvention, sondern eine Eigenschaft des Codes:
`src/server/services/platform.ts` enthält keine Funktion, die Inhalte eines
Mandanten zurückgibt. Ein Test prüft das ausdrücklich, indem er einen Kontakt
anlegt und danach dessen Namen in der gesamten Rückgabe des Backoffice sucht —
er darf nicht vorkommen.

Wer Kundendaten sehen muss, braucht eine Mitgliedschaft in dieser Organisation.
Die ist im Backoffice sichtbar und im Audit-Log des Mandanten protokolliert.

---

## 2. Technische Trennung

- **Eigener Aktor.** `PlatformActor` ist kein Sonderfall von `ActorContext`.
  Dadurch kann kein Service, der einen `ActorContext` erwartet, versehentlich
  mit Betreiberrechten laufen.
- **Eigene Route-Hülle.** `platformRoute` prüft Origin, CSRF und
  `isPlatformAdmin` — dieselbe Absicherung, anderer Aktor.
- **Eigenes Protokoll.** `PlatformAuditLog` steht neben dem `AuditLog` der
  Mandanten. Deren Einträge gehören ihnen; die Betreibereinträge überdauern
  eine gelöschte Organisation.
- **Kein Weg von unten nach oben.** Auch der Super-Administrator einer
  Organisation ist kein Betreiber. Das Recht wird ausschließlich an der
  Infrastruktur vergeben (Abschnitt 3).

---

## 3. Ersten Betreiberzugang anlegen

Auf Railway im Reiter *Console* des CRM-Dienstes:

```bash
pnpm platform:admin create kontakt@okun-systems.com "Felix Okun" "EinLangesPasswort2026"
```

Weitere Befehle:

```bash
pnpm platform:admin list                          # wer Betreiber ist
pnpm platform:admin grant  person@okun-systems.com   # bestehendes Konto erheben
pnpm platform:admin revoke person@okun-systems.com   # Recht entziehen
```

`create` legt ein Konto an, das **ausschließlich** Betreiber ist — ohne
Mitgliedschaft in irgendeiner Kundenorganisation. Nach der Anmeldung unter
`/login` landet dieses Konto direkt auf `/admin`.

---

## 4. Kunden anlegen

*Betreiberverwaltung → Kunden → Kunde anlegen.*

Dabei entsteht:

1. eine Organisation mit Standardkonfiguration (Pipeline mit Stages,
   Lifecycle Stages, Lead-Status),
2. eine Einladung für die erste Ansprechperson als **Super-Administrator**,
   14 Tage gültig, einmalig verwendbar.

**Es wird kein Passwort gesetzt.** Der Kunde legt es über den Einladungslink
selbst fest; der Betreiber kennt es nie. Ist ein Postausgang konfiguriert, geht
die Einladung als E-Mail raus — sonst wird der Link angezeigt und kann von Hand
weitergegeben werden. Vorgetäuscht wird nichts.

---

## 5. Stilllegen und reaktivieren

Eine Stilllegung verlangt eine Begründung und wirkt sofort:

- laufende Sitzungen werden beendet,
- die Anmeldung erklärt den Zustand, statt wortlos zu scheitern
  („Der Zugang dieser Organisation ist derzeit stillgelegt."),
- **alle Daten bleiben vollständig erhalten.**

Reaktivieren stellt den Zugang unverändert wieder her. Beides steht im
Betreiberprotokoll.

---

## 6. E-Mail-Versand

Es gibt zwei getrennte Postausgänge, und das mit Absicht:

| | Zweck | Konfiguration |
| --- | --- | --- |
| **Betrieb** | Einladungen an künftige Kunden | Umgebungsvariablen (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, optional `SMTP_FROM_NAME`, `SMTP_SECURE=1`) |
| **Mandant** | E-Mails aus dem CRM, Einladungen an Kolleginnen | *Einstellungen → Integrationen → SMTP verbinden* |

Ein künftiger Kunde kann keine Einladung über seinen eigenen Postausgang
erhalten — den gibt es zu diesem Zeitpunkt noch nicht. Deshalb die Trennung.

Die Zugangsdaten eines Mandanten werden **vor dem Speichern geprüft**: Eine
Verbindung, die nicht trägt, wird gar nicht erst angelegt. Das Passwort liegt
AES-256-GCM-verschlüsselt und wird von keiner Abfrage je zurückgegeben.

---

## 7. Was hier bewusst nicht ist

1. **Kein Zugriff auf Kundendaten** — siehe Abschnitt 1. Auch nicht „im
   Supportfall": Dafür braucht es eine sichtbare Mitgliedschaft.
2. **Kein Löschen von Organisationen.** Stilllegen ja, löschen nein — der
   Datenverlust wäre endgültig und ist aus einer Oberfläche heraus zu leicht
   auszulösen.
3. **Keine Abrechnung, keine Tarife.** Das Datenmodell trägt nichts davon; es
   wird auch nichts angedeutet.
4. **Keine Selbstbedienung für das Betreiberrecht.** Es entsteht nur an der
   Infrastruktur, nicht aus der Oberfläche heraus.
