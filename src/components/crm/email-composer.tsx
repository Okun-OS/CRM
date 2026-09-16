"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useContactOptions } from "@/components/app/reference-provider";
import { api, ApiError } from "@/lib/api-client";
import { FormError } from "./forms/form-kit";

type Template = { id: string; name: string; subject: string; bodyHtml: string };

/**
 * Compose an e-mail against a CRM record. Sending requires a connected
 * transport; without one the message is saved as a draft and the user is told
 * exactly why it was not sent.
 */
export function EmailComposer({
  contactId,
  companyId,
  dealId,
  defaultTo,
  onDone,
  onCancel,
}: {
  contactId?: string;
  companyId?: string;
  dealId?: string;
  defaultTo?: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const toast = useToast();
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [templateId, setTemplateId] = React.useState("");
  const [to, setTo] = React.useState(defaultTo ?? "");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [pending, setPending] = React.useState<"send" | "draft" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const [contactSearch, setContactSearch] = React.useState("");
  const contacts = useContactOptions(contactSearch);
  const [selectedContactId, setSelectedContactId] = React.useState(contactId ?? "");

  React.useEffect(() => {
    api
      .get<Template[]>("/api/v1/templates")
      .then(setTemplates)
      .catch(() => undefined);
  }, []);

  async function applyTemplate(id: string) {
    setTemplateId(id);
    if (!id) return;
    const template = templates.find((item) => item.id === id);
    if (!template) return;

    // Render server-side so placeholders resolve against the real record.
    const params = new URLSearchParams();
    if (selectedContactId) params.set("contactId", selectedContactId);
    if (companyId) params.set("companyId", companyId);
    if (dealId) params.set("dealId", dealId);

    try {
      const preview = await api.get<{ subject: string; bodyHtml: string }>(
        `/api/v1/templates/${id}/preview?${params.toString()}`,
      );
      setSubject(preview.subject);
      setBody(preview.bodyHtml);
    } catch {
      setSubject(template.subject);
      setBody(template.bodyHtml);
    }
  }

  async function submit(mode: "send" | "draft") {
    setPending(mode);
    setError(null);
    setFieldErrors({});
    const payload = {
      subject,
      bodyHtml: body,
      to: to
        .split(/[,;]/)
        .map((address) => address.trim())
        .filter(Boolean),
      templateId: templateId || undefined,
      contactId: selectedContactId || undefined,
      companyId,
      dealId,
    };

    try {
      await api.post(mode === "send" ? "/api/v1/emails/send" : "/api/v1/emails", payload);
      toast.success(mode === "send" ? "E-Mail gesendet." : "Entwurf gespeichert.");
      onDone();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setFieldErrors(cause.fields);
        // A missing transport still stores the draft — reflect that.
        if (cause.code === "INTEGRATION_NOT_CONNECTED") toast.error("Nicht gesendet", cause.message);
      } else {
        setError("Die E-Mail konnte nicht verarbeitet werden.");
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <FormError message={error} />

      {!contactId ? (
        <Field label="Kontakt" htmlFor="composer-contact" hint="Ordnet die E-Mail der Timeline des Kontakts zu.">
          <div className="space-y-1.5">
            <Input placeholder="Kontakt suchen…" value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} />
            <Select
              id="composer-contact"
              value={selectedContactId}
              onChange={(event) => setSelectedContactId(event.target.value)}
            >
              <option value="">— ohne Kontaktbezug —</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </Select>
          </div>
        </Field>
      ) : null}

      {templates.length > 0 ? (
        <Field label="Vorlage" htmlFor="composer-template">
          <Select id="composer-template" value={templateId} onChange={(event) => applyTemplate(event.target.value)}>
            <option value="">— ohne Vorlage —</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field label="An" htmlFor="composer-to" error={fieldErrors.to} required hint="Mehrere Adressen mit Komma trennen.">
        <Input id="composer-to" value={to} onChange={(event) => setTo(event.target.value)} placeholder="name@unternehmen.de" />
      </Field>

      <Field label="Betreff" htmlFor="composer-subject" error={fieldErrors.subject} required>
        <Input id="composer-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
      </Field>

      <Field label="Nachricht" htmlFor="composer-body" error={fieldErrors.bodyHtml} required>
        <Textarea id="composer-body" rows={10} value={body} onChange={(event) => setBody(event.target.value)} />
      </Field>

      <div className="flex justify-end gap-2 border-t border-ink-200 pt-4">
        {onCancel ? (
          <Button onClick={onCancel} disabled={pending !== null}>
            Abbrechen
          </Button>
        ) : null}
        <Button onClick={() => submit("draft")} loading={pending === "draft"}>
          Als Entwurf speichern
        </Button>
        <Button variant="primary" onClick={() => submit("send")} loading={pending === "send"}>
          Senden
        </Button>
      </div>
    </div>
  );
}
