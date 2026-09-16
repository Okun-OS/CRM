"use client";

import * as React from "react";
import { Save } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

type Thresholds = {
  automationEnabled: boolean;
  leadContactWithinHours: number;
  followUpAfterDays: number;
  offerChaseAfterDays: number;
  stagnationAfterDays: number;
  meetingPrepLeadHours: number;
  meetingFollowUpDays: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  workdaysOnly: boolean;
};

type Rule = {
  key: string;
  label: string;
  appliesTo: string[];
  isEnabled: boolean;
  delayDays: number | null;
  priority: number | null;
};

type Configuration = { settings: Thresholds; defaults: Thresholds; rules: Rule[] };

const NUMBER_FIELDS: { key: keyof Thresholds; label: string; hint: string; unit: string }[] = [
  {
    key: "leadContactWithinHours",
    label: "Erstkontakt bei neuen Leads",
    hint: "Nach dieser Zeit ohne Kontaktaufnahme wird der Erstkontakt fällig.",
    unit: "Stunden",
  },
  {
    key: "followUpAfterDays",
    label: "Nachfassen ohne Antwort",
    hint: "So lange wird nach einer ausgehenden Nachricht auf eine Antwort gewartet.",
    unit: "Tage",
  },
  {
    key: "offerChaseAfterDays",
    label: "Angebot nachfassen",
    hint: "Zeitraum zwischen Angebotsversand und Nachfassen.",
    unit: "Tage",
  },
  {
    key: "stagnationAfterDays",
    label: "Stagnation",
    hint: "Ohne jede Aktivität gilt ein Datensatz danach als stagnierend.",
    unit: "Tage",
  },
  {
    key: "meetingPrepLeadHours",
    label: "Terminvorbereitung",
    hint: "So lange vor einem Termin wird dessen Vorbereitung fällig.",
    unit: "Stunden",
  },
  {
    key: "meetingFollowUpDays",
    label: "Nach dem Termin",
    hint: "Danach ist ein nächster Schritt nach einem Termin fällig.",
    unit: "Tage",
  },
];

export function ActiveCrmSettingsView({ initial }: { initial: Configuration }) {
  const toast = useToast();
  const [config, setConfig] = React.useState(initial);
  const [draft, setDraft] = React.useState<Thresholds>(initial.settings);
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const dirty = JSON.stringify(draft) !== JSON.stringify(config.settings);

  async function save() {
    setSaving(true);
    setErrors({});
    try {
      const next = await api.put<Configuration>("/api/v1/settings/active-crm", draft);
      setConfig(next);
      setDraft(next.settings);
      toast.success("Einstellungen gespeichert");
    } catch (cause) {
      if (cause instanceof ApiError) {
        setErrors(cause.fields);
        toast.error(cause.message);
      } else {
        toast.error("Die Einstellungen konnten nicht gespeichert werden.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: Rule, isEnabled: boolean) {
    try {
      const next = await api.put<Configuration>("/api/v1/settings/active-crm/rules", {
        ruleKey: rule.key,
        isEnabled,
        delayDays: rule.delayDays,
        priority: rule.priority,
      });
      setConfig(next);
      toast.success(isEnabled ? "Regel aktiviert" : "Regel deaktiviert", rule.label);
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Regel konnte nicht geändert werden.");
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Fristen"
          description="Nach diesen Zeiträumen entscheidet die Engine, dass etwas zu tun ist."
          action={
            <Button variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={saving} disabled={!dirty} onClick={() => void save()}>
              Speichern
            </Button>
          }
        />
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {NUMBER_FIELDS.map((field) => (
              <Field
                key={field.key}
                label={`${field.label} (${field.unit})`}
                htmlFor={`threshold-${field.key}`}
                hint={`${field.hint} Standard: ${String(config.defaults[field.key])}`}
                error={errors[field.key]}
              >
                <Input
                  id={`threshold-${field.key}`}
                  type="number"
                  min={1}
                  value={String(draft[field.key])}
                  onChange={(event) =>
                    setDraft({ ...draft, [field.key]: Number(event.target.value) })
                  }
                />
              </Field>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Ausführung"
          description="Wann das System selbst tätig werden darf. Außerhalb dieser Zeiten wird eine fällige Automation verschoben, nicht verworfen."
        />
        <CardBody>
          <div className="space-y-4">
            <label className="flex items-start gap-3">
              <Checkbox
                checked={draft.automationEnabled}
                onChange={(event) => setDraft({ ...draft, automationEnabled: event.target.checked })}
              />
              <span>
                <span className="block text-sm text-ink-800">Automationen ausführen</span>
                <span className="block text-xs text-ink-500">
                  Ist dies aus, empfiehlt OKUN CRM weiterhin den nächsten Schritt, führt aber nichts selbst aus.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3">
              <Checkbox
                checked={draft.workdaysOnly}
                onChange={(event) => setDraft({ ...draft, workdaysOnly: event.target.checked })}
              />
              <span>
                <span className="block text-sm text-ink-800">Nur an Werktagen</span>
                <span className="block text-xs text-ink-500">Samstags und sonntags wird nichts automatisch ausgeführt.</span>
              </span>
            </label>

            <div className="grid gap-4 sm:grid-cols-2 lg:w-2/3">
              <Field label="Ruhezeit ab (Stunde)" htmlFor="quiet-start" error={errors.quietHoursStart}>
                <Input
                  id="quiet-start"
                  type="number"
                  min={0}
                  max={23}
                  value={String(draft.quietHoursStart)}
                  onChange={(event) => setDraft({ ...draft, quietHoursStart: Number(event.target.value) })}
                />
              </Field>
              <Field label="Ruhezeit bis (Stunde)" htmlFor="quiet-end" error={errors.quietHoursEnd}>
                <Input
                  id="quiet-end"
                  type="number"
                  min={0}
                  max={23}
                  value={String(draft.quietHoursEnd)}
                  onChange={(event) => setDraft({ ...draft, quietHoursEnd: Number(event.target.value) })}
                />
              </Field>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Regeln"
          description="Die Entscheidungstabelle der Engine, in Auswertungsreihenfolge. Die erste zutreffende Regel bestimmt den nächsten Schritt."
        />
        <CardBody className="p-0">
          <ol className="divide-y divide-ink-100">
            {config.rules.map((rule, index) => (
              <li key={rule.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="w-6 shrink-0 text-2xs tabular-nums text-ink-400">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-900">{rule.label}</p>
                  <p className="text-2xs text-ink-500">
                    <code className="text-ink-600">{rule.key}</code> · gilt für{" "}
                    {rule.appliesTo.map((kind) => (kind === "DEAL" ? "Deals" : "Leads")).join(" und ")}
                    {rule.delayDays ? ` · ${rule.delayDays} Tage Verzug` : ""}
                    {rule.priority !== null ? ` · Priorität ${rule.priority}` : ""}
                  </p>
                </div>
                {rule.key === "fallback.define_next_step" ? (
                  <Badge tone="neutral">immer aktiv</Badge>
                ) : (
                  <label className="flex items-center gap-2 text-xs text-ink-600">
                    <Checkbox checked={rule.isEnabled} onChange={(event) => void toggleRule(rule, event.target.checked)} />
                    aktiv
                  </label>
                )}
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}
