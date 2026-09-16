"use client";

import * as React from "react";
import { Copy, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { Drawer, ConfirmDialog } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonText } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { PLACEHOLDERS } from "@/lib/templates";
import { formatDate, stripHtml, truncate } from "@/lib/format";
import { FormError } from "@/components/crm/forms/form-kit";

type Template = {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  category: string | null;
  isActive: boolean;
  owner: { id: string; name: string } | null;
  updatedAt: string;
};

export function TemplatesView({ canWrite }: { canWrite: boolean }) {
  const toast = useToast();
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<Template | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<Template | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setTemplates(await api.get<Template[]>("/api/v1/templates?includeInactive=1"));
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Vorlagen konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function remove() {
    if (!deleting) return;
    try {
      await api.delete(`/api/v1/templates/${deleting.id}`);
      toast.success("Vorlage gelöscht.");
      await load();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Vorlage konnte nicht gelöscht werden.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-3">
      {canWrite ? (
        <div className="flex justify-end">
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
            Vorlage erstellen
          </Button>
        </div>
      ) : null}

      {loading ? (
        <Card>
          <div className="p-4">
            <SkeletonText lines={5} />
          </div>
        </Card>
      ) : templates.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title="Noch keine Vorlagen"
            description="Lege wiederkehrende E-Mail-Texte einmal an – Platzhalter wie {{contact.firstName}} werden beim Versand befüllt."
            actions={
              canWrite ? (
                <Button variant="primary" onClick={() => setEditing("new")}>
                  Vorlage erstellen
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <Card key={template.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2 border-b border-ink-200/70 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-900">{template.name}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-500">{template.subject}</p>
                </div>
                {template.isActive ? <Badge tone="success">Aktiv</Badge> : <Badge>Inaktiv</Badge>}
              </div>
              <div className="flex-1 px-4 py-3">
                <p className="text-xs leading-relaxed text-ink-600">{truncate(stripHtml(template.bodyHtml), 180)}</p>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-ink-200/70 px-4 py-2.5">
                <span className="text-2xs text-ink-400">
                  {template.category ? `${template.category} · ` : ""}
                  {formatDate(template.updatedAt)}
                </span>
                {canWrite ? (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setEditing(template)} aria-label="Bearbeiten">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(template)} aria-label="Löschen">
                      <Trash2 className="h-3.5 w-3.5 text-ink-400" />
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Vorlage erstellen" : "Vorlage bearbeiten"}
        width="lg"
      >
        {editing ? (
          <TemplateForm
            template={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              void load();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Vorlage löschen?"
        description={`„${deleting?.name ?? ""}" wird entfernt. Bereits gesendete E-Mails bleiben erhalten.`}
      />
    </div>
  );
}

function TemplateForm({
  template,
  onDone,
  onCancel,
}: {
  template: Template | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [values, setValues] = React.useState({
    name: template?.name ?? "",
    subject: template?.subject ?? "",
    bodyHtml: template?.bodyHtml ?? "",
    category: template?.category ?? "",
    isActive: template?.isActive ?? true,
  });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  function insertPlaceholder(token: string) {
    const textarea = bodyRef.current;
    const snippet = `{{${token}}}`;
    if (!textarea) {
      setValues((current) => ({ ...current, bodyHtml: current.bodyHtml + snippet }));
      return;
    }
    const start = textarea.selectionStart ?? values.bodyHtml.length;
    const end = textarea.selectionEnd ?? start;
    const next = `${values.bodyHtml.slice(0, start)}${snippet}${values.bodyHtml.slice(end)}`;
    setValues((current) => ({ ...current, bodyHtml: next }));
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const payload = { ...values, category: values.category || undefined };
      if (template) await api.put(`/api/v1/templates/${template.id}`, payload);
      else await api.post("/api/v1/templates", payload);
      toast.success(template ? "Vorlage aktualisiert." : "Vorlage erstellt.");
      onDone();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setFieldErrors(cause.fields);
      } else {
        setError("Die Vorlage konnte nicht gespeichert werden.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError message={error} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="template-name" error={fieldErrors.name} required>
          <Input
            id="template-name"
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
            autoFocus
            required
          />
        </Field>
        <Field label="Kategorie" htmlFor="template-category" error={fieldErrors.category}>
          <Input
            id="template-category"
            value={values.category}
            onChange={(event) => setValues({ ...values, category: event.target.value })}
            placeholder="z. B. Erstkontakt"
          />
        </Field>
      </div>

      <Field label="Betreff" htmlFor="template-subject" error={fieldErrors.subject} required>
        <Input
          id="template-subject"
          value={values.subject}
          onChange={(event) => setValues({ ...values, subject: event.target.value })}
          required
        />
      </Field>

      <Field label="Inhalt" htmlFor="template-body" error={fieldErrors.bodyHtml} required>
        <Textarea
          id="template-body"
          ref={bodyRef}
          rows={12}
          value={values.bodyHtml}
          onChange={(event) => setValues({ ...values, bodyHtml: event.target.value })}
          required
        />
      </Field>

      <div>
        <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-400">Platzhalter einfügen</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(PLACEHOLDERS).map(([token, description]) => (
            <button
              key={token}
              type="button"
              title={description}
              onClick={() => insertPlaceholder(token)}
              className="inline-flex items-center gap-1 rounded-full border border-ink-200 px-2 py-1 text-2xs text-ink-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
            >
              <Copy className="h-3 w-3" />
              {`{{${token}}}`}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-700">
        <Checkbox checked={values.isActive} onChange={(event) => setValues({ ...values, isActive: event.target.checked })} />
        Vorlage ist aktiv und im Composer wählbar
      </label>

      <div className="flex justify-end gap-2 border-t border-ink-200 pt-4">
        <Button onClick={onCancel} disabled={pending}>
          Abbrechen
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          {template ? "Änderungen speichern" : "Vorlage erstellen"}
        </Button>
      </div>
    </form>
  );
}
