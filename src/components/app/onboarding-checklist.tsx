"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Circle, Rocket, X } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";

type Step = { key: string; label: string; done: boolean; href: string; optional?: boolean };

/**
 * First-run setup. Each step reflects real state — it ticks itself off when the
 * data exists, and no sample records are created to fake progress.
 */
export function OnboardingChecklist({
  status,
}: {
  status: { completed: boolean; progress: number; steps: Step[] };
}) {
  const router = useRouter();
  const [dismissing, setDismissing] = React.useState(false);

  async function complete() {
    setDismissing(true);
    await api.post("/api/v1/organization/onboarding").catch(() => undefined);
    router.refresh();
  }

  return (
    <Card className="border-brand-200/70 bg-gradient-to-br from-brand-50/60 to-white">
      <CardBody className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white">
              <Rocket className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink-900">OKUN CRM einrichten</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                Noch {status.steps.filter((step) => !step.done && !step.optional).length} Schritte bis zum vollständig
                eingerichteten CRM.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={complete} loading={dismissing} icon={<X className="h-3.5 w-3.5" />}>
            Ausblenden
          </Button>
        </div>

        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-ink-200">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent-500 to-brand-500 transition-[width] duration-500"
            style={{ width: `${status.progress}%` }}
          />
        </div>

        <ul className="mt-4 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {status.steps.map((step) => (
            <li key={step.key}>
              <Link
                href={step.href}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs transition-colors",
                  step.done
                    ? "border-transparent bg-white/70 text-ink-500"
                    : "border-ink-200 bg-white text-ink-800 hover:border-brand-300 hover:bg-brand-50/50",
                )}
              >
                {step.done ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-success-500" />
                ) : (
                  <Circle className="h-3.5 w-3.5 shrink-0 text-ink-300" />
                )}
                <span className={cn("truncate", step.done && "line-through decoration-ink-300")}>{step.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
