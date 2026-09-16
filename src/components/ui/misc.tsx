"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/** Initial-based avatar; falls back cleanly when there is no image. */
export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = { xs: "h-5 w-5 text-[9px]", sm: "h-7 w-7 text-2xs", md: "h-9 w-9 text-xs", lg: "h-12 w-12 text-sm" };
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} className={cn("rounded-full object-cover", sizes[size], className)} />;
  }

  return (
    <span
      title={name}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 font-semibold text-white",
        sizes[size],
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1 overflow-x-auto border-b border-ink-200 okun-scrollbar-none", className)} role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={cn(
              "relative whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "text-brand-600" : "text-ink-500 hover:text-ink-800",
            )}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span
                className={cn(
                  "ml-1.5 rounded-full px-1.5 py-0.5 text-2xs",
                  isActive ? "bg-brand-50 text-brand-600" : "bg-ink-100 text-ink-500",
                )}
              >
                {tab.count}
              </span>
            ) : null}
            {isActive ? <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Lightweight dropdown used by row actions and pickers. */
export function Dropdown({
  trigger,
  children,
  align = "right",
  className,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const close = React.useCallback(() => setOpen(false), []);

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((value) => !value)}>{trigger}</div>
      {open ? (
        <div
          className={cn(
            "absolute z-50 mt-1 min-w-[12rem] rounded-lg border border-ink-200 bg-white p-1 shadow-overlay animate-okun-rise",
            align === "right" ? "right-0" : "left-0",
            className,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

export function DropdownItem({
  children,
  onClick,
  danger,
  icon,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
        danger ? "text-danger-600 hover:bg-danger-50" : "text-ink-700 hover:bg-ink-100",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/** Page header used by every screen for a consistent information hierarchy. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-1 text-xs text-ink-500">{breadcrumb}</div> : null}
        <h1 className="truncate text-xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group/tooltip relative inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-okun-950 px-2 py-1 text-2xs text-white opacity-0 transition-opacity group-hover/tooltip:opacity-100">
        {label}
      </span>
    </span>
  );
}
