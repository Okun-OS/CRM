# Meta Lead Ads: Leads aus Facebook und Instagram automatisch ins CRM

Füllt jemand ein Lead-Formular in einer Facebook- oder Instagram-Anzeige aus,
steht er wenige Sekunden später als Lead im CRM. Die eingestellten Adressen
bekommen eine E-Mail mit Name, Telefon, E-Mail, den Antworten aus dem Formular
und einem Knopf zur Akte.

## Was im CRM passiert

1. Meta meldet die Einsendung an
   `https://<CRM-Adresse>/api/integrations/meta/webhook`. Die Meldung ist mit dem
   App-Geheimnis signiert. Das CRM prüft die Signatur und antwortet sofort.
2. Das CRM holt die Angaben mit dem gespeicherten Seiten-Token ab
   (`GET /{leadgen_id}`) und legt den Lead an:
   - Name, E-Mail, Telefon, Unternehmen und Position aus den Standardfragen.
   - Quelle `Meta Lead Ads (Facebook)` bzw. `(Instagram)`, Status „Neu“.
   - Verantwortlich ist die in den Einstellungen gewählte Person, sonst die
     Person, die verbunden hat.
   - Eine Notiz mit allen weiteren Antworten, Formular, Kampagne,
     Anzeigengruppe und Anzeige.
   - Gibt es schon einen Kontakt mit dieser E-Mail-Adresse, wird der Lead
     mit ihm verknüpft.
3. Hat dieselbe Person schon einen **offenen** Lead (gleiche E-Mail, letzte
   90 Tage), entsteht kein zweiter: Die neue Anfrage kommt als Notiz dazu,
   die E-Mail heißt dann „Erneute Anfrage“.
4. Benachrichtigung im CRM (Glocke) an die verantwortliche Person und eine
   E-Mail an die eingestellten Adressen, über Resend bzw. den Postausgang
   des Betriebs (siehe OPERATIONS.md).

Meta wiederholt eine Meldung bis zu 36 Stunden. Jede Einsendung wird über
ihre `leadgen_id` genau einmal angelegt. Scheitert das Abholen (Meta nicht
erreichbar, Token abgelaufen), versucht das CRM es automatisch erneut: nach
1, 5, 15 Minuten, 1, 3, 6 und 12 Stunden. Unter *Einstellungen →
Integrationen → Meta Lead Ads* stehen die letzten Einsendungen mit Status,
der Grund eines Fehlers und „Jetzt erneut versuchen“.

## Einrichtung (einmalig, ca. 20 Minuten)

### 1. Meta-App anlegen

1. Auf [developers.facebook.com/apps](https://developers.facebook.com/apps)
   eine neue App anlegen, Typ **Business**, und mit dem Business-Portfolio
   verknüpfen, dem die Facebook-Seite gehört.
2. *App-Einstellungen → Allgemein*: App-ID und App-Geheimcode notieren.
   Dort auch die Adresse der Datenschutzerklärung eintragen.

### 2. Variablen auf Railway

Beim CRM-Dienst unter *Variables* (nicht in einen Chat kopieren):

| Variable | Wert |
| --- | --- |
| `META_APP_ID` | App-ID |
| `META_APP_SECRET` | App-Geheimcode |
| `META_WEBHOOK_VERIFY_TOKEN` | eine selbst gewählte, lange Zeichenfolge |

Railway startet den Dienst danach neu.

### 3. Webhook in der Meta-App

1. In der App das Produkt **Webhooks** hinzufügen.
2. Objekt **Page** wählen, *Callback-URL*:
   `https://crm-production-8f9e.up.railway.app/api/integrations/meta/webhook`
   (steht auch zum Kopieren in den CRM-Einstellungen),
   *Bestätigungs-Token*: der Wert von `META_WEBHOOK_VERIFY_TOKEN`.
3. Das Feld **leadgen** abonnieren.
4. Die App auf **Live** stellen.

### 4. Seite im CRM verbinden

1. Im [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
   oben die eigene App wählen, *Nutzer-Token* erzeugen und diese
   Berechtigungen erlauben: `leads_retrieval`, `pages_manage_metadata`,
   `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`,
   `ads_management`. Beim Bestätigen die Facebook-Seite auswählen.
2. Im CRM unter *Einstellungen → Integrationen → Meta Lead Ads* das Token
   einfügen, **Seiten laden**, Seite ankreuzen, **Verbinden**.
   Das CRM tauscht das Token gegen ein dauerhaftes Seiten-Token (läuft nicht
   ab), speichert nur dieses verschlüsselt und abonniert die Seite.
3. Verantwortliche Person und Empfänger der E-Mail wählen, **Test-E-Mail
   senden**.

Die Person, deren Token verwendet wird, braucht auf der Seite die Aufgabe
„Werbeanzeigen erstellen“. Ist im Business-Manager der *Lead-Zugriff*
(Leads Access Manager) eingeschränkt, muss sie dort freigegeben sein.

### 5. Testen

Mit dem [Lead-Ads-Testtool](https://developers.facebook.com/tools/lead-ads-testing)
Seite und Formular wählen und einen Testlead abschicken. Er erscheint nach
wenigen Sekunden in den Einstellungen unter „Zuletzt eingegangen“ und als
Lead im CRM, die E-Mail geht an die eingestellten Adressen. Je Formular kann
es nur einen Testlead geben; vor dem nächsten den alten im Testtool löschen.

## Zugriff und Prüfung durch Meta

Für die eigene Seite genügt der **Standardzugriff**: Er gilt für Personen,
die in der App eine Rolle haben (Administrator, Entwickler, Tester). Eine
App-Prüfung durch Meta ist dafür nicht nötig. Sollen später auch Kunden des
CRM ihre eigenen Seiten verbinden, braucht die App **Advanced Access** für
die Berechtigungen oben, und damit eine Unternehmensverifizierung und eine
App-Prüfung durch Meta.

## Technik

| Datei | Inhalt |
| --- | --- |
| `src/app/api/integrations/meta/webhook/route.ts` | Webhook: Bestätigung (GET), Meldungen mit Signaturprüfung (POST) |
| `src/server/integrations/meta.ts` | Graph API: Token tauschen, Seiten, Abo, Lead abrufen |
| `src/server/services/meta-leads.ts` | Meldung festhalten, Lead anlegen, Dubletten, Benachrichtigung, Wiederholung |
| `src/server/services/meta-settings.ts` | Einstellungen: verbinden, Empfänger, Test-E-Mail, Neuversuch |
| `src/server/integrations/lead-notification-mail.ts` | E-Mail „Neuer Lead“ |
| Tabellen `MetaLeadPage`, `MetaLeadEvent` | verbundene Seiten (Token verschlüsselt) und jede Einsendung genau einmal |

Graph-API-Version: `v27.0`, änderbar mit `META_GRAPH_VERSION`. Jeder Aufruf
geht mit `appsecret_proof`.
