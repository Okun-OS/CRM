"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, Pencil, Plus, Trash2 } from "lucide-react";
import type { CrmObjectType } from "@/generated/prisma/enums";
import type { PropertyDefinitionDTO } from "@/lib/properties";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Drawer, ConfirmDialog } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/crm/forms/form-kit";
import { api, ApiError } from "@/lib/api-client";
import { OBJECT_LABELS } from "@/lib/crm/fields";

const TYPE_LABELS: Record<string, string> = {
  TEXT: "Text",
  TEXTAREA: "Mehrzeiliger Text",
  NUMBER: "Zahl",
  CURRENCY: "Betrag",
  DATE: "Datum",
  DATETIME: "Datum & Uhrzeit",
  BOOLEAN: "Ja/Nein",
  SELECT: "Auswahl",
  MULTISELECT: "Mehrfachauswahl",
  URL: "URL",
  EMAIL: "E-Mail",
  PHONE: "Telefon",
};

export function PropertiesView({ definitions }: { definitions: PropertyDefinitionDTO[] }) {
  const router = useRouter();
  const toast = useToast();
  const [objectType, setObjectType] = React.useState<CrmObjectType>("CONTACT");
  const [editing, setEditing] = React.useState<PropertyDefinitionDTO | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<PropertyDefinitionDTO | null>(null);

  const filtered = definitions.filter((definition) => definition.objectType === objectType);

  async function archive(definition: PropertyDefinitionDTO) {
    try {
      await api.patch(`/api/v1/properties/${definition.id}`, {
        label: definition.label,
        description: definition.description ?? undefined,
        options: definition.options,
        isRequired: definition.isRequired,
        groupName: definition.groupName ?? undefined,
        isArchived: !definition.isArchived,
      });
      toast.success(definition.isArchived ? "Eigenschaft reaktiviert." : "Eigenschaft archiviert.");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Änderung war nicht möglich.");
    }
  }

  async function remove() {
    if (!deleting) return;
    try {
      await api.delete(`/api/v1/properties/${deleting.id}`);
      toast.success("Eigenschaft gelöscht.");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Eigenschaft konnte nicht gelöscht werden.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          active={objectType}
          onChange={(key) => setObjectType(key as CrmObjectType)}
          tabs={(Object.keys(OBJECT_LABELS) as CrmObjectType[]).map((key) => ({
            key,
            label: OBJECT_LABELS[key].plural,
            count: definitions.filter((definition) => definition.objectType === key).length,
          }))}
        />
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
          Eigenschaft erstellen
        </Button>
      </div>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            title={`Noch keine eigenen Eigenschaften für ${OBJECT_LABELS[objectType].plural}`}
            description="Ergänze Felder, die dein Vertrieb wirklich braucht – etwa Budget, Vertragsende oder Region."
            actions={
              <Button variant="primary" onClick={() => setEditing("new")}>
                Eigenschaft erstellen
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {filtered.map((definition) => (
              <li key={definition.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
                    {definition.label}
                    {definition.isRequired ? <Badge tone="warning">Pflichtfeld</Badge> : null}
                    {definition.isSystem ? <Badge>System</Badge> : null}
                    {definition.isArchived ? <Badge tone="neutral">Archiviert</Badge> : null}
                  </p>
                  <p className="mt-0.5 text-2xs text-ink-500">
                    <code className="font-mono">{definition.key}</code> · {TYPE_LABELS[definition.type] ?? definition.type}
                    {definition.options.length > 0 ? ` · ${definition.options.length} Optionen` : ""}
                    {definition.groupName ? ` · Gruppe: ${definition.groupName}` : ""}
                  </p>
                  {definition.description ? <p className="mt-1 text-2xs text-ink-500">{definition.description}</p> : null}
                </div>

                {!definition.isSystem ? (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setEditing(definition)} aria-label="Bearbeiten">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => archive(definition)} aria-label="Archivieren">
                      <Archive className="h-3.5 w-3.5 text-ink-400" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(definition)} aria-label="Löschen">
                      <Trash2 className="h-3.5 w-3.5 text-ink-400" />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Eigenschaft erstellen" : "Eigenschaft bearbeiten"}
      >
        {editing ? (
          <PropertyForm
            objectType={objectType}
            definition={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Eigenschaft löschen?"
        description="Das Löschen ist nur möglich, solange keine Werte gespeichert sind. Andernfalls kann die Eigenschaft archiviert werden."
      />
    </div>
  );
}

function PropertyForm({
  objectType,
  definition,
  onDone,
  onCancel,
}: {
  objectType: CrmObjectType;
  definition: PropertyDefinitionDTO | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [values, setValues] = React.useState({
    key: definition?.key ?? "",
    label: definition?.label ?? "",
    description: definition?.description ?? "",
    type: definition?.type ?? "TEXT",
    isRequired: definition?.isRequired ?? false,
    groupName: definition?.groupName ?? "",
  });
  const [options, setOptions] = React.useState(definition?.options ?? []);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const needsOptions = values.type === "SELECT" || values.type === "MULTISELECT";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const payload = {
        label: values.label,
        description: values.description || undefined,
        isRequired: values.isRequired,
        groupName: values.groupName || undefined,
        options: needsOptions ? options : undefined,
      };
      if (definition) {
        await api.patch(`/api/v1/properties/${definition.id}`, payload);
      } else {
        await api.post("/api/v1/properties", { ...payload, objectType, key: values.key, type: values.type });
      }
      toast.success(definition ? "Eigenschaft gespeichert." : "Eigenschaft erstellt.");
      onDone();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setFieldErrors(cause.fields);
      } else {
        setError("Die Eigenschaft konnte nicht gespeichert werden.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError message={error} />

      <Field label="Bezeichnung" htmlFor="property-label" error={fieldErrors.label} required>
        <Input
          id="property-label"
          value={values.label}
          onChange={(event) => {
            const label = event.target.value;
            setValues((current) => ({
              ...current,
              label,
              // Derive the technical key from the label while creating.
              key: definition ? current.key : slugifyKey(label),
            }));
          }}
          autoFocus
          required
        />
      </Field>

      <Field
        label="Technischer Schlüssel"
        htmlFor="property-key"
        error={fieldErrors.key}
        hint="Wird in Filtern, Importen und der API verwendet und kann später nicht geändert werden."
        required
      >
        <Input
          id="property-key"
          value={values.key}
          onChange={(event) => setValues({ ...values, key: event.target.value })}
          disabled={Boolean(definition)}
          required
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Typ" htmlFor="property-type" error={fieldErrors.type}>
          <Select
            id="property-type"
            value={values.type}
            onChange={(event) => setValues({ ...values, type: event.target.value as PropertyDefinitionDTO["type"] })}
            disabled={Boolean(definition)}
          >
            {Object.entries(TYPE_LABELS).map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Gruppe" htmlFor="property-group" hint="Optionale Gruppierung im Formular.">
          <Input
            id="property-group"
            value={values.groupName}
            onChange={(event) => setValues({ ...values, groupName: event.target.value })}
          />
        </Field>
      </div>

      <Field label="Beschreibung" htmlFor="property-description">
        <Textarea
          id="property-description"
          rows={2}
          value={values.description}
          onChange={(event) => setValues({ ...values, description: event.target.value })}
        />
      </Field>

      {needsOptions ? (
        <div className="space-y-2 rounded-md border border-ink-200 p-3">
          <p className="text-2xs font-semibold uppercase tracking-wider text-ink-400">Optionen</p>
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={option.label}
                onChange={(event) =>
                  setOptions((current) =>
                    current.map((item, i) =>
                      i === index ? { label: event.target.value, value: item.value || slugifyKey(event.target.value) } : item,
                    ),
                  )
                }
                placeholder="Bezeichnung"
              />
              <Input
                value={option.value}
                onChange={(event) =>
                  setOptions((current) => current.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)))
                }
                placeholder="Wert"
                className="w-36"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                aria-label="Option entfernen"
              >
                <Trash2 className="h-3.5 w-3.5 text-ink-400" />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setOptions((current) => [...current, { label: "", value: "" }])}
          >
            Option hinzufügen
          </Button>
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-sm text-ink-700">
        <Checkbox checked={values.isRequired} onChange={(event) => setValues({ ...values, isRequired: event.target.checked })} />
        Pflichtfeld beim Anlegen
      </label>

      <div className="flex justify-end gap-2 border-t border-ink-200 pt-4">
        <Button onClick={onCancel} disabled={pending}>
          Abbrechen
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          {definition ? "Speichern" : "Eigenschaft erstellen"}
        </Button>
      </div>
    </form>
  );
}

function slugifyKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}
