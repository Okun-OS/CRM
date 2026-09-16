"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarDays, ListChecks, Plus, Sparkles, StickyNote, Target, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/modal";
import { Dropdown, DropdownItem } from "@/components/ui/misc";
import { ContactForm } from "@/components/crm/forms/contact-form";
import { CompanyForm } from "@/components/crm/forms/company-form";
import { LeadForm } from "@/components/crm/forms/lead-form";
import { DealForm } from "@/components/crm/forms/deal-form";
import { TaskForm, MeetingForm } from "@/components/crm/forms/simple-forms";
import type { Permission } from "@/lib/rbac";

/**
 * Global quick create. Everything opens in a drawer so the user never loses the
 * screen they were working on.
 */
type CreateKind = "contact" | "company" | "lead" | "deal" | "task" | "meeting";

const ENTRIES: { kind: CreateKind; label: string; icon: React.ReactNode; permission: Permission }[] = [
  { kind: "contact", label: "Kontakt", icon: <Users className="h-4 w-4" />, permission: "contacts.write" },
  { kind: "company", label: "Unternehmen", icon: <Building2 className="h-4 w-4" />, permission: "companies.write" },
  { kind: "lead", label: "Lead", icon: <Sparkles className="h-4 w-4" />, permission: "leads.write" },
  { kind: "deal", label: "Deal", icon: <Target className="h-4 w-4" />, permission: "deals.write" },
  { kind: "task", label: "Aufgabe", icon: <ListChecks className="h-4 w-4" />, permission: "tasks.write" },
  { kind: "meeting", label: "Termin", icon: <CalendarDays className="h-4 w-4" />, permission: "meetings.write" },
];

const TITLES: Record<CreateKind, string> = {
  contact: "Neuer Kontakt",
  company: "Neues Unternehmen",
  lead: "Neuer Lead",
  deal: "Neuer Deal",
  task: "Neue Aufgabe",
  meeting: "Neuer Termin",
};

export function QuickCreate({ permissions }: { permissions: Permission[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState<CreateKind | null>(null);
  const allowed = React.useMemo(() => new Set(permissions), [permissions]);
  const entries = ENTRIES.filter((entry) => allowed.has(entry.permission));

  if (entries.length === 0) return null;

  const close = () => setOpen(null);
  const done = (path?: string) => {
    close();
    if (path) router.push(path);
    router.refresh();
  };

  return (
    <>
      <Dropdown
        trigger={
          <Button variant="primary" size="md" icon={<Plus className="h-4 w-4" />}>
            <span className="hidden sm:inline">Erstellen</span>
          </Button>
        }
      >
        {(closeMenu) => (
          <>
            <p className="px-2.5 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-400">
              Schnell erstellen
            </p>
            {entries.map((entry) => (
              <DropdownItem
                key={entry.kind}
                icon={entry.icon}
                onClick={() => {
                  closeMenu();
                  setOpen(entry.kind);
                }}
              >
                {entry.label}
              </DropdownItem>
            ))}
          </>
        )}
      </Dropdown>

      <Drawer open={open !== null} onClose={close} title={open ? TITLES[open] : ""} width={open === "deal" ? "lg" : "md"}>
        {open === "contact" ? <ContactForm onDone={(contact) => done(`/contacts/${contact.id}`)} onCancel={close} /> : null}
        {open === "company" ? <CompanyForm onDone={(company) => done(`/companies/${company.id}`)} onCancel={close} /> : null}
        {open === "lead" ? <LeadForm onDone={(lead) => done(`/leads/${lead.id}`)} onCancel={close} /> : null}
        {open === "deal" ? <DealForm onDone={(deal) => done(`/deals/${deal.id}`)} onCancel={close} /> : null}
        {open === "task" ? <TaskForm onDone={() => done()} onCancel={close} /> : null}
        {open === "meeting" ? <MeetingForm onDone={() => done()} onCancel={close} /> : null}
      </Drawer>
    </>
  );
}

/** Same drawer, opened from a record page with the links pre-filled. */
export function RecordQuickCreate({
  kind,
  links,
  open,
  onClose,
  onDone,
}: {
  kind: "task" | "meeting" | "note" | "activity";
  links: { contactId?: string; companyId?: string; dealId?: string; leadId?: string };
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const titles = {
    task: "Aufgabe erstellen",
    meeting: "Termin erstellen",
    note: "Notiz hinzufügen",
    activity: "Aktivität protokollieren",
  };

  return (
    <Drawer open={open} onClose={onClose} title={titles[kind]}>
      {kind === "task" ? <TaskForm links={links} onDone={onDone} onCancel={onClose} /> : null}
      {kind === "meeting" ? <MeetingForm links={links} onDone={onDone} onCancel={onClose} /> : null}
    </Drawer>
  );
}
