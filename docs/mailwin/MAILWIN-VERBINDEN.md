# Mailwin verbinden

OKUN Mailwin liest Ihre E-Mails mit und arbeitet dem CRM zu: Aus einer Anfrage
wird ein Lead, bekannte Absender werden im CRM nachgeschlagen, und jede wichtige
Nachricht landet in der Zeitleiste des Kontakts. So müssen Sie nichts von Hand
übertragen.

Die Verbindung richtet eine Administratorin oder ein Administrator ein und
braucht etwa fünf Minuten.

## 1. Schlüssel im CRM erzeugen

1. Öffnen Sie **Einstellungen → Integrationen → OKUN Mailwin**.
2. Klicken Sie unter **API-Schlüssel** auf **Schlüssel erzeugen** und geben Sie
   ihm einen Namen, z. B. „Mailwin“.
3. Kopieren Sie den Schlüssel (er beginnt mit `okun_mw_`) und die **Basis-URL**.

Der Schlüssel wird nur dieses eine Mal angezeigt. Geht er verloren, erzeugen Sie
einfach einen neuen und widerrufen den alten.

## 2. In Mailwin eintragen

Tragen Sie in Mailwin unter der Verbindung zu OKUN CRM die **Basis-URL** und den
**Schlüssel** ein. Mailwin prüft die Verbindung sofort. Im CRM steht danach bei
Mailwin „Verbunden“.

## 3. Rückmeldungen an Mailwin (optional)

Damit Mailwin erfährt, wenn ein Lead die Phase wechselt, gewonnen oder verloren
wird oder sich ein Kontakt ändert:

1. Im CRM unter **Webhooks an Mailwin** ist die Adresse von Mailwin bereits
   vorbelegt.
2. Fügen Sie das **gemeinsame Geheimnis** aus Mailwin ein, oder klicken Sie auf
   **Neues Geheimnis erzeugen** und tragen Sie es in Mailwin ein.
3. **Speichern**, dann **Testereignis senden**. Erscheint „Mailwin hat das
   Testereignis angenommen“, ist alles verbunden.

## 4. Was Mailwin aus E-Mails ableiten darf (optional)

Mailwin erkennt in E-Mails, wenn Sie ein Angebot verschickt haben, ein Kunde
zusagt, absagt, einen Termin möchte oder abwesend ist. Unter **Signale aus
Mailwin** legen Sie fest, was daraus folgt:

- **Phase je Signal:** z. B. „Angebot gesendet“ → Phase *Angebot*. Phasen gehen
  dabei nur vorwärts. Stellen Sie „Phase nicht ändern“ ein, wenn Sie das nicht
  möchten.
- **Zusage und Absage:** Standardmäßig erscheint am Lead ein **Vorschlag**
  („Als gewonnen markieren?“) mit dem Zitat aus der E-Mail — Sie entscheiden mit
  einem Klick auf **Übernehmen** oder **Verwerfen**. Auf Wunsch geschieht das
  automatisch, sobald Mailwin sich sicher genug ist.
- **Angebotswert:** wird standardmäßig nur übernommen, wenn der Lead noch keinen
  Wert hat.

Auch neue Kontaktdaten aus einer Signatur (Telefon, Position) überschreiben
nichts: Leere Felder werden gefüllt, Abweichungen erscheinen als Vorschlag am
Kontakt.

## Was Mailwin im CRM darf — und was nicht

- Mailwin sieht **nur Ihren Arbeitsbereich**, nie die Daten anderer.
- Der Schlüssel öffnet **nur die Mailwin-Schnittstelle**. Mit ihm lassen sich
  weder Einstellungen ändern noch Daten löschen.
- Mailwin **legt an und ergänzt**, überschreibt aber nichts, was Sie gepflegt
  haben: Bei einem bekannten Kontakt füllt Mailwin nur leere Felder.
- Was Mailwin anlegt, trägt die Quelle **Mailwin**. In der Zeitleiste steht
  „über Mailwin“ mit einem Link **In Mailwin öffnen** zur Original-Nachricht;
  Leads haben denselben Link in der Akte.
- Jeder Aufruf steht im **Aufrufprotokoll** auf der Mailwin-Seite (30 Tage);
  jede Änderung zusätzlich im **Audit-Log** mit „über Mailwin“.

## Gut zu wissen

- **Leads** heißen im CRM **Deals**. Was Mailwin als Lead anlegt, finden Sie
  unter **Deals** und in der **Pipeline** — in der Standard-Pipeline, erste
  Phase, sofern Mailwin nichts anderes angibt.
- Absender mit privaten Adressen (Gmail, GMX, web.de …) werden keiner Firma
  zugeordnet.
- Kennt Mailwin keinen Namen, heißt ein neuer Kontakt vorübergehend z. B.
  „Unbekannt info@firma.de“. Sobald Mailwin den Namen erfährt, wird er ersetzt.
- Eigene Pflichtfelder Ihres CRM bleiben bei Datensätzen aus Mailwin zunächst
  leer — Mailwin kennt sie nicht.

## Verbindung trennen

Klicken Sie beim Schlüssel auf **Widerrufen**. Mailwin hat ab sofort keinen
Zugriff mehr. Webhooks pausieren Sie, indem Sie **Webhooks senden** abwählen und
speichern. Alles, was Mailwin angelegt hat, bleibt im CRM erhalten.
