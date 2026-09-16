"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";

type Option = { id: string; key: string; label: string; position: number; isSystem: boolean; isTerminal?: boolean };
type Tag = { id: string; name: string; color: string; usage: number };

/**
 * Administrable vocabulary. Each list edits in place; system entries cannot be
 * removed because records and workflows reference their keys.
 */
export function CrmOptionsView({
  lifecycleStages,
  leadStatuses,
  tags,
}: {
  lifecycleStages: Option[];
  leadStatuses: Option[];
  tags: Tag[];
}) {
  return (
    <div className="space-y-4">
      <OptionList
        title="Lifecycle Stages"
        description="Beschreibt, wo Kontakte und Unternehmen im Kundenlebenszyklus stehen."
        endpoint="/api/v1/settings/lifecycle-stages"
        options={lifecycleStages}
      />
      <OptionList
        title="Lead-Status"
        description="Der Qualifizierungsprozess für Leads."
        endpoint="/api/v1/settings/lead-statuses"
        options={leadStatuses}
      />
      <TagList tags={tags} />
    </div>
  );
}

function OptionList({
  title,
  description,
  endpoint,
  options,
}: {
  title: string;
  description: string;
  endpoint: string;
  options: Option[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = React.useState({ key: "", label: "" });
  const [pending, setPending] = React.useState(false);

  async function create() {
    setPending(true);
    try {
      await api.post(endpoint, { key: draft.key, label: draft.label, position: options.length });
      toast.success("Eintrag hinzugefügt.");
      setDraft({ key: "", label: "" });
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Der Eintrag konnte nicht angelegt werden.");
    } finally {
      setPending(false);
    }
  }

  async function rename(option: Option, label: string) {
    if (label === option.label || label.trim().length === 0) return;
    try {
      await api.patch(`${endpoint}/${option.id}`, { label, position: option.position });
      toast.success("Bezeichnung aktualisiert.");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Änderung war nicht möglich.");
    }
  }

  async function remove(option: Option) {
    try {
      await api.delete(`${endpoint}/${option.id}`);
      toast.success("Eintrag gelöscht.");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Der Eintrag konnte nicht gelöscht werden.");
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} description={description} />
      <ul className="divide-y divide-ink-100">
        {options.map((option) => (
          <li key={option.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
            <Input
              defaultValue={option.label}
              onBlur={(event) => rename(option, event.target.value)}
              className="h-8 max-w-xs text-xs"
              aria-label={`Bezeichnung von ${option.key}`}
            />
            <code className="font-mono text-2xs text-ink-500">{option.key}</code>
            {option.isSystem ? <Badge>System</Badge> : null}
            {option.isTerminal ? <Badge tone="neutral">Endstatus</Badge> : null}
            <div className="flex-1" />
            {!option.isSystem ? (
              <Button variant="ghost" size="icon" onClick={() => remove(option)} aria-label="Eintrag löschen">
                <Trash2 className="h-3.5 w-3.5 text-ink-400" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t border-ink-200 px-5 py-3">
        <Input
          value={draft.label}
          onChange={(event) => setDraft({ label: event.target.value, key: slugifyKey(event.target.value) })}
          placeholder="Neue Bezeichnung"
          className="h-8 max-w-xs text-xs"
        />
        <code className="font-mono text-2xs text-ink-400">{draft.key || "schlüssel"}</code>
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus className="h-3.5 w-3.5" />}
          loading={pending}
          disabled={!draft.label || !draft.key}
          onClick={create}
        >
          Hinzufügen
        </Button>
      </div>
    </Card>
  );
}

function TagList({ tags }: { tags: Tag[] }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState("#2563EB");
  const [pending, setPending] = React.useState(false);

  async function create() {
    setPending(true);
    try {
      await api.post("/api/v1/settings/tags", { name, color });
      toast.success("Tag angelegt.");
      setName("");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Das Tag konnte nicht angelegt werden.");
    } finally {
      setPending(false);
    }
  }

  async function remove(tag: Tag) {
    try {
      await api.delete(`/api/v1/settings/tags/${tag.id}`);
      toast.success("Tag gelöscht.");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Das Tag konnte nicht gelöscht werden.");
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Tags" description="Freie Kennzeichnung von Kontakten, Unternehmen und Deals." />
      {tags.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-ink-500">Noch keine Tags angelegt.</p>
      ) : (
        <ul className="flex flex-wrap gap-2 px-5 py-4">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="flex items-center gap-2 rounded-full border border-ink-200 py-1 pl-2 pr-1 text-xs text-ink-700"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: tag.color }} />
              {tag.name}
              <span className="text-2xs text-ink-400">{tag.usage}</span>
              <button
                type="button"
                onClick={() => remove(tag)}
                className="rounded-full p-1 text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-600"
                aria-label={`${tag.name} löschen`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-ink-200 px-5 py-3">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Neues Tag" className="h-8 max-w-xs text-xs" />
        <input
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-ink-200"
          aria-label="Farbe"
        />
        <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} loading={pending} disabled={!name} onClick={create}>
          Hinzufügen
        </Button>
      </div>
    </Card>
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
