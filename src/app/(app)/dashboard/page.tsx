import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ListChecks,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { getActor } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { scope } from "@/lib/tenant";
import { dashboardSummary, dealsOverTime, pipelineFunnel, salesForecast } from "@/server/services/reports";
import { getOrganization, onboardingStatus } from "@/server/services/organizations";
import { listActivities } from "@/server/services/activities";
import { getActiveCrmSummary } from "@/server/services/next-actions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { DealsOverTimeChart, ForecastChart, PipelineFunnelChart } from "@/components/charts/dashboard-charts";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { OnboardingChecklist } from "@/components/app/onboarding-checklist";
import { formatCurrency, formatDate, formatNumber, formatRelative, formatTime } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * The dashboard answers two questions on open: what is happening in sales, and
 * what do I need to do next. Every figure is computed from this organization's
 * own records — there are no sample values anywhere on this screen.
 */
export default async function DashboardPage() {
  const actor = await getActor();
  if (!actor) return null;

  const [organization, summary, active, funnel, forecast, timeline, onboarding, deals, tasks, meetings] = await Promise.all([
    getOrganization(actor),
    dashboardSummary(actor),
    getActiveCrmSummary(actor),
    pipelineFunnel(actor),
    salesForecast(actor, {}),
    listActivities(actor, { page: 1, pageSize: 8 }),
    onboardingStatus(actor),
    dealsOverTime(actor, {}),
    prisma.task.findMany({
      where: { ...scope(actor), deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] }, ownerId: actor.userId },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }],
      take: 6,
      select: { id: true, title: true, dueAt: true, priority: true },
    }),
    prisma.meeting.findMany({
      where: { ...scope(actor), deletedAt: null, startAt: { gte: new Date() } },
      orderBy: { startAt: "asc" },
      take: 5,
      select: {
        id: true,
        title: true,
        startAt: true,
        contact: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
  ]);

  const currency = organization?.currency ?? "EUR";
  const firstName = actor.name.split(" ")[0];
  const greeting = new Date().getHours() < 11 ? "Guten Morgen" : new Date().getHours() < 18 ? "Guten Tag" : "Guten Abend";

  const kpis = [
    {
      label: "Kontakte",
      value: formatNumber(summary.contacts),
      hint: summary.newContacts > 0 ? `+${summary.newContacts} in 30 Tagen` : "Keine neuen in 30 Tagen",
      icon: <Users className="h-4 w-4" />,
      href: "/contacts",
    },
    {
      label: "Offene Deals",
      value: formatNumber(summary.openDeals),
      hint: `${formatCurrency(summary.pipelineValue, currency)} Pipeline-Wert`,
      icon: <Target className="h-4 w-4" />,
      href: "/deals",
    },
    {
      label: "Gewonnen (Monat)",
      value: formatNumber(summary.wonThisMonth),
      hint: formatCurrency(summary.wonValueThisMonth, currency),
      icon: <CheckCircle2 className="h-4 w-4" />,
      href: "/reports",
    },
    {
      label: "Abschlussquote",
      value: summary.winRate === null ? "—" : `${summary.winRate} %`,
      hint: summary.winRate === null ? "Noch keine abgeschlossenen Deals" : "Gewonnen / abgeschlossen (Monat)",
      icon: <TrendingUp className="h-4 w-4" />,
      href: "/reports",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description="Hier ist der aktuelle Überblick über deinen Vertrieb."
      />

      {!onboarding.completed ? <OnboardingChecklist status={onboarding} /> : null}

      <Card>
        <CardHeader
          title="Aktives CRM"
          description="Woran das System gerade arbeitet – und wo es auf eine Entscheidung wartet."
          action={
            <Link href="/heute" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              Zum Action Center <ArrowRight className="h-3 w-3" />
            </Link>
          }
        />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Überfällig" value={formatNumber(active.overdue)} tone={active.overdue > 0 ? "danger" : undefined} />
            <StatTile label="Heute fällig" value={formatNumber(active.today)} />
            <StatTile
              label="Ohne nächste Aktion"
              value={formatNumber(active.withoutNextAction)}
              tone={active.withoutNextAction > 0 ? "warning" : undefined}
            />
            <StatTile label="Wartet auf uns" value={formatNumber(active.waitingForUs)} />
            <StatTile label="Wartet auf Kunden" value={formatNumber(active.waitingForCustomer)} />
            <StatTile label="Stagniert" value={formatNumber(active.stalled)} tone={active.stalled > 0 ? "danger" : undefined} />
          </div>
          <p className="mt-3 text-2xs text-ink-500">
            {active.automationsPending} geplante Automation(en) · {active.automationsExecutedToday} heute ausgeführt. Jede
            Automation prüft ihre Bedingungen unmittelbar vor der Ausführung erneut.
          </p>
        </CardBody>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Link key={kpi.label} href={kpi.href} className="group">
            <Card className="h-full transition-shadow hover:shadow-raised">
              <CardBody className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-ink-500">{kpi.label}</span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-brand-500">
                    {kpi.icon}
                  </span>
                </div>
                <p className="mt-2.5 text-2xl font-semibold tracking-tight text-ink-900 tabular-nums">{kpi.value}</p>
                <p className="mt-1 text-2xs text-ink-500">{kpi.hint}</p>
              </CardBody>
            </Card>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Vertriebs-Pipeline"
            description={funnel.pipeline ? funnel.pipeline.name : "Keine Pipeline konfiguriert"}
            action={
              <Link href="/pipeline" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
                Zur Pipeline <ArrowRight className="h-3 w-3" />
              </Link>
            }
          />
          <CardBody>
            <PipelineFunnelChart stages={funnel.stages} currency={currency} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Heute" description="Was jetzt ansteht" />
          <CardBody className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Aktivitäten heute" value={formatNumber(summary.activitiesToday)} />
              <StatTile
                label="Überfällige Aufgaben"
                value={formatNumber(summary.overdueTasks)}
                tone={summary.overdueTasks > 0 ? "danger" : "neutral"}
              />
              <StatTile label="Offene Aufgaben" value={formatNumber(summary.openTasks)} />
              <StatTile label="Termine (7 Tage)" value={formatNumber(summary.upcomingMeetings)} />
            </div>

            <div>
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-400">Meine Aufgaben</p>
              {tasks.length === 0 ? (
                <p className="rounded-md bg-ink-50 px-3 py-4 text-center text-xs text-ink-500">
                  Keine offenen Aufgaben. Gut gemacht.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {tasks.map((task) => {
                    const overdue = task.dueAt && task.dueAt.getTime() < Date.now();
                    return (
                      <li key={task.id}>
                        <Link
                          href={`/tasks?taskId=${task.id}`}
                          className="flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-ink-50"
                        >
                          <ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-ink-800">{task.title}</span>
                            <span className={`text-2xs ${overdue ? "text-danger-600" : "text-ink-500"}`}>
                              {task.dueAt ? formatRelative(task.dueAt) : "Ohne Fälligkeit"}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Deal-Entwicklung" description="Angelegte, gewonnene und verlorene Deals je Monat" />
          <CardBody>
            <DealsOverTimeChart data={deals} currency={currency} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Sales Forecast" description="Offene Deals nach erwartetem Abschlussmonat" />
          <CardBody>
            <ForecastChart data={forecast} currency={currency} />
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Letzte Aktivitäten"
            action={
              <Link href="/activities" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
                Alle ansehen <ArrowRight className="h-3 w-3" />
              </Link>
            }
          />
          <CardBody className="p-0">
            {timeline.items.length === 0 ? (
              <EmptyState
                title="Noch keine Aktivitäten"
                description="Anrufe, E-Mails, Meetings und Systemereignisse erscheinen hier, sobald im CRM gearbeitet wird."
                compact
              />
            ) : (
              <div className="p-4">
                <ActivityTimeline items={timeline.items} compact />
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Kommende Termine"
            action={
              <Link href="/calendar" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
                Kalender <ArrowRight className="h-3 w-3" />
              </Link>
            }
          />
          <CardBody className="p-4">
            {meetings.length === 0 ? (
              <p className="rounded-md bg-ink-50 px-3 py-6 text-center text-xs text-ink-500">
                Keine anstehenden Termine.
              </p>
            ) : (
              <ul className="space-y-2">
                {meetings.map((meeting) => (
                  <li key={meeting.id}>
                    <Link
                      href={`/calendar?meetingId=${meeting.id}`}
                      className="flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-ink-50"
                    >
                      <span className="flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded-md bg-brand-50 text-brand-600">
                        <CalendarClock className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-ink-800">{meeting.title}</span>
                        <span className="block text-2xs text-ink-500">
                          {formatDate(meeting.startAt)} · {formatTime(meeting.startAt)}
                          {meeting.contact ? ` · ${meeting.contact.firstName} ${meeting.contact.lastName}` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "danger" | "warning";
}) {
  const valueTone =
    tone === "danger" ? "text-danger-600" : tone === "warning" ? "text-warning-700" : "text-ink-900";
  return (
    <div className="rounded-md border border-ink-200/70 bg-ink-50/50 px-3 py-2.5">
      <p className="text-2xs text-ink-500">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${valueTone}`}>{value}</p>
    </div>
  );
}
