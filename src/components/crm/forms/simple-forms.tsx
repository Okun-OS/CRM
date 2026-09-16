"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useReference, useContactOptions } from "@/components/app/reference-provider";
import { api } from "@/lib/api-client";
import { cleanPayload, FormError, useRecordForm } from "./form-kit";

export type RecordLinks = {
  contactId?: string;
  companyId?: string;
  dealId?: string;
  leadId?: string;
};

/** Task creation and editing. */
export function TaskForm({
  initial,
  links,
  onDone,
  onCancel,
}: {
  initial?: {
    id?: string;
    title?: string;
    description?: string | null;
    status?: string;
    priority?: string;
    dueAt?: string | null;
    ownerId?: string | null;
  };
  links?: RecordLinks;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { data } = useReference();
  const [values, setValues] = React.useState({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    status: initial?.status ?? "OPEN",
    priority: initial?.priority ?? "MEDIUM",
    dueAt: initial?.dueAt ? initial.dueAt.slice(0, 16) : "",
    ownerId: initial?.ownerId ?? "",
  });

  const { pending, formError, fieldErrors, handleSubmit } = useRecordForm({
    submit: async () => {
      const payload = cleanPayload({ ...values, ...links });
      return initial?.id ? api.patch(`/api/v1/tasks/${initial.id}`, payload) : api.post("/api/v1/tasks", payload);
    },
    onSuccess: onDone,
    successMessage: initial?.id ? "Aufgabe aktualisiert." : "Aufgabe erstellt.",
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <FormError message={formError} />

      <Field label="Titel" htmlFor="title" error={fieldErrors.title} required>
        <Input
          id="title"
          value={values.title}
          onChange={(event) => setValues({ ...values, title: event.target.value })}
          autoFocus
          required
        />
      </Field>

      <Field label="Beschreibung" htmlFor="description" error={fieldErrors.description}>
        <Textarea
          id="description"
          rows={3}
          value={values.description ?? ""}
          onChange={(event) => setValues({ ...values, description: event.target.value })}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Fällig am" htmlFor="dueAt" error={fieldErrors.dueAt}>
          <Input
            id="dueAt"
            type="datetime-local"
            value={values.dueAt}
            onChange={(event) => setValues({ ...values, dueAt: event.target.value })}
          />
        </Field>
        <Field label="Priorität" htmlFor="priority">
          <Select
            id="priority"
            value={values.priority}
            onChange={(event) => setValues({ ...values, priority: event.target.value })}
          >
            <option value="LOW">Niedrig</option>
            <option value="MEDIUM">Mittel</option>
            <option value="HIGH">Hoch</option>
            <option value="URGENT">Dringend</option>
          </Select>
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value })}>
            <option value="OPEN">Offen</option>
            <option value="IN_PROGRESS">In Arbeit</option>
            <option value="COMPLETED">Erledigt</option>
            <option value="CANCELLED">Abgebrochen</option>
          </Select>
        </Field>
        <Field label="Owner" htmlFor="ownerId" error={fieldErrors.ownerId}>
          <Select id="ownerId" value={values.ownerId ?? ""} onChange={(event) => setValues({ ...values, ownerId: event.target.value })}>
            <option value="">— mir zuweisen —</option>
            {data?.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex justify-end gap-2 border-t border-ink-200 pt-4">
        {onCancel ? (
          <Button onClick={onCancel} disabled={pending}>
            Abbrechen
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={pending}>
          {initial?.id ? "Speichern" : "Aufgabe erstellen"}
        </Button>
      </div>
    </form>
  );
}

/** Note composer used on every record timeline. */
export function NoteForm({ links, onDone, onCancel }: { links: RecordLinks; onDone: () => void; onCancel?: () => void }) {
  const [body, setBody] = React.useState("");

  const { pending, formError, fieldErrors, handleSubmit } = useRecordForm({
    submit: async () => api.post("/api/v1/notes", { body, ...links }),
    onSuccess: () => {
      setBody("");
      onDone();
    },
    successMessage: "Notiz gespeichert.",
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      <FormError message={formError} />
      <Field htmlFor="note-body" error={fieldErrors.body}>
        <Textarea
          id="note-body"
          rows={3}
          placeholder="Notiz hinzufügen…"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button onClick={onCancel} disabled={pending} size="sm">
            Abbrechen
          </Button>
        ) : null}
        <Button type="submit" variant="primary" size="sm" loading={pending} disabled={body.trim().length === 0}>
          Notiz speichern
        </Button>
      </div>
    </form>
  );
}

/** Logs a call, e-mail or meeting that happened outside the CRM. */
export function ActivityForm({ links, onDone, onCancel }: { links: RecordLinks; onDone: () => void; onCancel?: () => void }) {
  // An activity must be linked to a record; when opened without context the
  // form asks for the contact instead of failing on submit.
  const needsContact = !links.contactId && !links.companyId && !links.dealId && !links.leadId;
  const [contactSearch, setContactSearch] = React.useState("");
  const [contactId, setContactId] = React.useState("");
  const contacts = useContactOptions(contactSearch);

  const [values, setValues] = React.useState({
    type: "CALL",
    subject: "",
    body: "",
    direction: "OUTBOUND",
    outcome: "",
    durationMinutes: "",
    occurredAt: new Date().toISOString().slice(0, 16),
  });

  const { pending, formError, fieldErrors, handleSubmit } = useRecordForm({
    submit: async () =>
      api.post("/api/v1/activities", {
        ...cleanPayload({
          ...values,
          durationMinutes: values.durationMinutes === "" ? undefined : Number(values.durationMinutes),
        }),
        ...links,
        ...(needsContact ? { contactId } : {}),
      }),
    onSuccess: onDone,
    successMessage: "Aktivität protokolliert.",
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <FormError message={formError} />

      {needsContact ? (
        <Field label="Kontakt" htmlFor="activity-contact" error={fieldErrors.contactId} required>
          <div className="space-y-1.5">
            <Input
              placeholder="Kontakt suchen…"
              value={contactSearch}
              onChange={(event) => setContactSearch(event.target.value)}
            />
            <Select id="activity-contact" value={contactId} onChange={(event) => setContactId(event.target.value)} required>
              <option value="">— Kontakt auswählen —</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </Select>
          </div>
        </Field>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Typ" htmlFor="type">
          <Select id="type" value={values.type} onChange={(event) => setValues({ ...values, type: event.target.value })}>
            <option value="CALL">Anruf</option>
            <option value="EMAIL">E-Mail</option>
            <option value="MEETING">Meeting</option>
            <option value="NOTE">Notiz</option>
          </Select>
        </Field>
        <Field label="Zeitpunkt" htmlFor="occurredAt" error={fieldErrors.occurredAt}>
          <Input
            id="occurredAt"
            type="datetime-local"
            value={values.occurredAt}
            onChange={(event) => setValues({ ...values, occurredAt: event.target.value })}
          />
        </Field>
        <Field label="Richtung" htmlFor="direction">
          <Select
            id="direction"
            value={values.direction}
            onChange={(event) => setValues({ ...values, direction: event.target.value })}
          >
            <option value="OUTBOUND">Ausgehend</option>
            <option value="INBOUND">Eingehend</option>
          </Select>
        </Field>
        <Field label="Dauer (Minuten)" htmlFor="durationMinutes" error={fieldErrors.durationMinutes}>
          <Input
            id="durationMinutes"
            type="number"
            min={0}
            value={values.durationMinutes}
            onChange={(event) => setValues({ ...values, durationMinutes: event.target.value })}
          />
        </Field>
      </div>

      <Field label="Betreff" htmlFor="subject" error={fieldErrors.subject}>
        <Input id="subject" value={values.subject} onChange={(event) => setValues({ ...values, subject: event.target.value })} />
      </Field>

      <Field label="Ergebnis" htmlFor="outcome" error={fieldErrors.outcome}>
        <Input id="outcome" value={values.outcome} onChange={(event) => setValues({ ...values, outcome: event.target.value })} />
      </Field>

      <Field label="Details" htmlFor="body" error={fieldErrors.body}>
        <Textarea id="body" rows={3} value={values.body} onChange={(event) => setValues({ ...values, body: event.target.value })} />
      </Field>

      <div className="flex justify-end gap-2 border-t border-ink-200 pt-4">
        {onCancel ? (
          <Button onClick={onCancel} disabled={pending}>
            Abbrechen
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={pending} disabled={needsContact && !contactId}>
          Aktivität protokollieren
        </Button>
      </div>
    </form>
  );
}

/** Meeting scheduling; external calendar sync is not connected yet. */
export function MeetingForm({
  links,
  initial,
  onDone,
  onCancel,
}: {
  links?: RecordLinks;
  initial?: { id?: string; title?: string; startAt?: string; endAt?: string; location?: string | null; meetingUrl?: string | null; description?: string | null };
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { data } = useReference();
  const defaultStart = new Date(Math.ceil(Date.now() / 1_800_000) * 1_800_000);
  const [values, setValues] = React.useState({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    startAt: (initial?.startAt ?? defaultStart.toISOString()).slice(0, 16),
    endAt: (initial?.endAt ?? new Date(defaultStart.getTime() + 3_600_000).toISOString()).slice(0, 16),
    location: initial?.location ?? "",
    meetingUrl: initial?.meetingUrl ?? "",
    ownerId: "",
  });

  const { pending, formError, fieldErrors, handleSubmit } = useRecordForm({
    submit: async () => {
      const payload = cleanPayload({ ...values, ...links });
      return initial?.id ? api.patch(`/api/v1/meetings/${initial.id}`, payload) : api.post("/api/v1/meetings", payload);
    },
    onSuccess: onDone,
    successMessage: initial?.id ? "Termin aktualisiert." : "Termin erstellt.",
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <FormError message={formError} />

      <Field label="Titel" htmlFor="title" error={fieldErrors.title} required>
        <Input id="title" value={values.title} onChange={(event) => setValues({ ...values, title: event.target.value })} autoFocus required />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Beginn" htmlFor="startAt" error={fieldErrors.startAt} required>
          <Input
            id="startAt"
            type="datetime-local"
            value={values.startAt}
            onChange={(event) => setValues({ ...values, startAt: event.target.value })}
            required
          />
        </Field>
        <Field label="Ende" htmlFor="endAt" error={fieldErrors.endAt} required>
          <Input
            id="endAt"
            type="datetime-local"
            value={values.endAt}
            onChange={(event) => setValues({ ...values, endAt: event.target.value })}
            required
          />
        </Field>
        <Field label="Ort" htmlFor="location" error={fieldErrors.location}>
          <Input id="location" value={values.location ?? ""} onChange={(event) => setValues({ ...values, location: event.target.value })} />
        </Field>
        <Field label="Meeting-Link" htmlFor="meetingUrl" error={fieldErrors.meetingUrl}>
          <Input
            id="meetingUrl"
            type="url"
            placeholder="https://…"
            value={values.meetingUrl ?? ""}
            onChange={(event) => setValues({ ...values, meetingUrl: event.target.value })}
          />
        </Field>
        <Field label="Owner" htmlFor="ownerId" error={fieldErrors.ownerId}>
          <Select id="ownerId" value={values.ownerId} onChange={(event) => setValues({ ...values, ownerId: event.target.value })}>
            <option value="">— mir zuweisen —</option>
            {data?.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Notiz" htmlFor="description" error={fieldErrors.description}>
        <Textarea
          id="description"
          rows={3}
          value={values.description ?? ""}
          onChange={(event) => setValues({ ...values, description: event.target.value })}
        />
      </Field>

      <div className="flex justify-end gap-2 border-t border-ink-200 pt-4">
        {onCancel ? (
          <Button onClick={onCancel} disabled={pending}>
            Abbrechen
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={pending}>
          {initial?.id ? "Speichern" : "Termin erstellen"}
        </Button>
      </div>
    </form>
  );
}
