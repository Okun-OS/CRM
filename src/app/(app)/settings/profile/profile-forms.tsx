"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Monitor, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/crm/forms/form-kit";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime, formatRelative } from "@/lib/format";

type Session = {
  id: string;
  ip: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  createdAt: string;
  isCurrent: boolean;
};

const TIMEZONES = ["Europe/Berlin", "Europe/Vienna", "Europe/Zurich", "Europe/London", "UTC"];

export function ProfileForms({
  profile,
  twoFactorEnabled,
  sessions,
}: {
  profile: { name: string; email: string; timezone: string; locale: string };
  twoFactorEnabled: boolean;
  sessions: Session[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [values, setValues] = React.useState(profile);
  const [savingProfile, setSavingProfile] = React.useState(false);
  const [profileError, setProfileError] = React.useState<string | null>(null);

  const [passwords, setPasswords] = React.useState({ currentPassword: "", newPassword: "" });
  const [savingPassword, setSavingPassword] = React.useState(false);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [passwordFields, setPasswordFields] = React.useState<Record<string, string>>({});

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSavingProfile(true);
    setProfileError(null);
    try {
      await api.patch("/api/v1/auth/profile", values);
      toast.success("Profil gespeichert.");
      router.refresh();
    } catch (cause) {
      setProfileError(cause instanceof ApiError ? cause.message : "Das Profil konnte nicht gespeichert werden.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setSavingPassword(true);
    setPasswordError(null);
    setPasswordFields({});
    try {
      await api.post("/api/v1/auth/password", passwords);
      toast.success("Passwort geändert.", "Andere Sitzungen wurden abgemeldet.");
      setPasswords({ currentPassword: "", newPassword: "" });
      router.refresh();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setPasswordError(cause.message);
        setPasswordFields(cause.fields);
      } else {
        setPasswordError("Das Passwort konnte nicht geändert werden.");
      }
    } finally {
      setSavingPassword(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api.delete(`/api/v1/auth/sessions/${id}`);
      toast.success("Sitzung beendet.");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Sitzung konnte nicht beendet werden.");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Persönliche Angaben" />
        <CardBody>
          <form onSubmit={saveProfile} className="space-y-4" noValidate>
            <FormError message={profileError} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="profile-name" required>
                <Input id="profile-name" value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} required />
              </Field>
              <Field label="E-Mail" htmlFor="profile-email" hint="Die E-Mail-Adresse ist die Anmeldekennung und kann nicht geändert werden.">
                <Input id="profile-email" value={values.email} disabled />
              </Field>
              <Field label="Zeitzone" htmlFor="profile-timezone">
                <Select id="profile-timezone" value={values.timezone} onChange={(event) => setValues({ ...values, timezone: event.target.value })}>
                  {TIMEZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Sprache" htmlFor="profile-locale">
                <Select id="profile-locale" value={values.locale} onChange={(event) => setValues({ ...values, locale: event.target.value })}>
                  <option value="de-DE">Deutsch</option>
                  <option value="en-US">English</option>
                </Select>
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={savingProfile}>
                Speichern
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Passwort ändern" description="Nach einer Änderung werden alle anderen Sitzungen abgemeldet." />
        <CardBody>
          <form onSubmit={changePassword} className="space-y-4" noValidate>
            <FormError message={passwordError} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Aktuelles Passwort" htmlFor="current-password" error={passwordFields.currentPassword} required>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={passwords.currentPassword}
                  onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })}
                  required
                />
              </Field>
              <Field
                label="Neues Passwort"
                htmlFor="new-password"
                error={passwordFields.newPassword}
                hint="Mindestens 12 Zeichen, Groß- und Kleinbuchstaben sowie eine Ziffer."
                required
              >
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={passwords.newPassword}
                  onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })}
                  required
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={savingPassword}>
                Passwort ändern
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Zwei-Faktor-Authentifizierung" />
        <CardBody>
          <div className="flex items-start gap-3 rounded-md border border-ink-200 bg-ink-50/60 px-3 py-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
            <div>
              <p className="text-sm text-ink-800">{twoFactorEnabled ? "Aktiv" : "Noch nicht eingerichtet"}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
                Das Datenmodell und die Sitzungsprüfung sind für TOTP vorbereitet; die Einrichtung im Self-Service folgt in
                einer späteren Version. Bis dahin schützen Passwortrichtlinie, Sperre nach Fehlversuchen und
                Sitzungsverwaltung das Konto.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Aktive Sitzungen" description="Geräte, die aktuell an deinem Konto angemeldet sind." />
        <CardBody className="p-0">
          <ul className="divide-y divide-ink-100">
            {sessions.map((session) => (
              <li key={session.id} className="flex items-center gap-3 px-5 py-3">
                <Monitor className="h-4 w-4 shrink-0 text-ink-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-ink-800">
                    {session.userAgent ?? "Unbekanntes Gerät"}
                    {session.isCurrent ? <span className="ml-2 text-2xs text-brand-600">· aktuelle Sitzung</span> : null}
                  </p>
                  <p className="text-2xs text-ink-500">
                    Zuletzt aktiv {formatRelative(session.lastSeenAt)} · angemeldet {formatDateTime(session.createdAt)}
                    {session.ip ? ` · ${session.ip}` : ""}
                  </p>
                </div>
                {!session.isCurrent ? (
                  <Button size="sm" variant="ghost" onClick={() => revoke(session.id)}>
                    Beenden
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
