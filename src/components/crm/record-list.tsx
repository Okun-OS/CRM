"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  Columns3,
  Download,
  Filter as FilterIcon,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import type { CrmObjectType } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Input } from "@/components/ui/field";
import { DataTable, Pagination, Td, Th, Tr } from "@/components/ui/table";
import { Dropdown, DropdownItem } from "@/components/ui/misc";
import { ConfirmDialog, Drawer, Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { FilterBuilder } from "./filter-builder";
import { useReference } from "@/components/app/reference-provider";
import { api, ApiError, listQueryString } from "@/lib/api-client";
import { fieldsFor, defaultColumns, OBJECT_LABELS } from "@/lib/crm/fields";
import { EMPTY_FILTER, type FilterGroup } from "@/lib/filters";
import { cn } from "@/lib/cn";

/**
 * The list experience shared by contacts, companies, leads and deals.
 *
 * Columns, filters and sorting all come from the field registry, so each object
 * type only has to say how to render a cell. Saved views, bulk actions, export
 * and pagination behave identically everywhere.
 */
export type ListItem = { id: string } & Record<string, unknown>;

export type RecordListProps = {
  objectType: CrmObjectType;
  endpoint: string;
  rowHref: (item: ListItem) => string;
  renderCell: (item: ListItem, fieldKey: string) => React.ReactNode;
  createLabel: string;
  renderCreateForm: (close: (created?: { id: string }) => void) => React.ReactNode;
  canCreate: boolean;
  canDelete: boolean;
  canExport: boolean;
  emptyTitle: string;
  emptyDescription: string;
  extraActions?: React.ReactNode;
  summary?: (result: ListResult) => React.ReactNode;
};

type ListResult = {
  items: ListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  totalAmount?: number;
};

type SavedView = {
  id: string;
  name: string;
  filter: FilterGroup;
  columns: string[];
  sort: { field: string; direction: "asc" | "desc" } | null;
  isShared: boolean;
  isOwn: boolean;
};

export function RecordList(props: RecordListProps) {
  const {
    objectType,
    endpoint,
    rowHref,
    renderCell,
    createLabel,
    renderCreateForm,
    canCreate,
    canDelete,
    canExport,
    emptyTitle,
    emptyDescription,
    extraActions,
    summary,
  } = props;

  const router = useRouter();
  const toast = useToast();
  const { data: reference } = useReference();

  const fields = React.useMemo(() => fieldsFor(objectType), [objectType]);
  const [columns, setColumns] = React.useState<string[]>(() => defaultColumns(objectType));
  const [filter, setFilter] = React.useState<FilterGroup>(EMPTY_FILTER);
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [sort, setSort] = React.useState<{ field: string; direction: "asc" | "desc" }>({
    field: "createdAt",
    direction: "desc",
  });
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);

  const [result, setResult] = React.useState<ListResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const [views, setViews] = React.useState<SavedView[]>([]);
  const [activeView, setActiveView] = React.useState<string | null>(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [showSaveView, setShowSaveView] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = listQueryString({
        page,
        pageSize,
        search: debouncedSearch || undefined,
        sortField: sort.field,
        sortDirection: sort.direction,
        filter: filter.conditions.length > 0 ? filter : undefined,
      });
      setResult(await api.get<ListResult>(`${endpoint}${query}`));
      setSelected(new Set());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Die Liste konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [endpoint, page, pageSize, debouncedSearch, sort, filter]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const loadViews = React.useCallback(async () => {
    try {
      setViews(await api.get<SavedView[]>(`/api/v1/views?objectType=${objectType}`));
    } catch {
      /* saved views are optional for the list to work */
    }
  }, [objectType]);

  React.useEffect(() => {
    void loadViews();
  }, [loadViews]);

  const applyView = (view: SavedView | null) => {
    if (!view) {
      setActiveView(null);
      setFilter(EMPTY_FILTER);
      setColumns(defaultColumns(objectType));
      setSort({ field: "createdAt", direction: "desc" });
    } else {
      setActiveView(view.id);
      setFilter(view.filter ?? EMPTY_FILTER);
      setColumns(view.columns?.length ? view.columns : defaultColumns(objectType));
      if (view.sort) setSort(view.sort);
    }
    setPage(1);
  };

  async function saveView(name: string, isShared: boolean) {
    setBusy(true);
    try {
      await api.post("/api/v1/views", { objectType, name, filter, columns, sort, isShared });
      toast.success("Ansicht gespeichert.");
      setShowSaveView(false);
      await loadViews();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Ansicht konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    setBusy(true);
    let failed = 0;
    for (const id of selected) {
      try {
        await api.delete(`${endpoint}/${id}`);
      } catch {
        failed += 1;
      }
    }
    setBusy(false);
    setConfirmDelete(false);
    if (failed > 0) toast.error(`${failed} Datensätze konnten nicht gelöscht werden.`);
    else toast.success(`${selected.size} Datensätze gelöscht.`);
    await load();
    router.refresh();
  }

  function exportCsv() {
    const query = listQueryString({
      search: debouncedSearch || undefined,
      sortField: sort.field,
      sortDirection: sort.direction,
      filter: filter.conditions.length > 0 ? filter : undefined,
    });
    window.location.href = `/api/v1/exports/${objectType.toLowerCase()}${query}`;
  }

  const visibleFields = fields.filter((field) => columns.includes(field.key));
  const activeFilterCount = filter.conditions.length;
  const allSelected = result !== null && result.items.length > 0 && selected.size === result.items.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1" data-tour="list-search">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder={`${OBJECT_LABELS[objectType].plural} durchsuchen…`}
            className="pl-9"
            aria-label="Suche"
          />
        </div>

        <Dropdown
          align="left"
          trigger={
            <Button
              variant={activeFilterCount > 0 ? "outline" : "secondary"}
              icon={<FilterIcon className="h-4 w-4" />}
              data-tour="list-filter"
            >
              Filter
              {activeFilterCount > 0 ? (
                <span className="ml-1 rounded-full bg-brand-500 px-1.5 text-2xs text-white">{activeFilterCount}</span>
              ) : null}
            </Button>
          }
          className="p-0"
        >
          {(close) => (
            <FilterBuilder
              objectType={objectType}
              value={filter}
              onChange={(next) => {
                setFilter(next);
                setPage(1);
              }}
              onClose={close}
            />
          )}
        </Dropdown>

        <Dropdown
          trigger={
            <Button variant="secondary" icon={<Bookmark className="h-4 w-4" />} data-tour="list-views">
              {activeView ? views.find((view) => view.id === activeView)?.name ?? "Ansicht" : "Ansichten"}
            </Button>
          }
          align="left"
        >
          {(close) => (
            <>
              <DropdownItem
                onClick={() => {
                  applyView(null);
                  close();
                }}
              >
                Alle {OBJECT_LABELS[objectType].plural}
              </DropdownItem>
              {views.length > 0 ? <div className="my-1 border-t border-ink-200" /> : null}
              {views.map((view) => (
                <DropdownItem
                  key={view.id}
                  onClick={() => {
                    applyView(view);
                    close();
                  }}
                >
                  {view.name}
                  {view.isShared ? <span className="ml-auto text-2xs text-ink-400">geteilt</span> : null}
                </DropdownItem>
              ))}
              <div className="my-1 border-t border-ink-200" />
              <DropdownItem
                icon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  close();
                  setShowSaveView(true);
                }}
              >
                Aktuelle Ansicht speichern
              </DropdownItem>
            </>
          )}
        </Dropdown>

        <Dropdown
          trigger={
            <Button variant="secondary" size="icon" aria-label="Spalten konfigurieren">
              <Columns3 className="h-4 w-4" />
            </Button>
          }
        >
          <div className="max-h-72 w-56 overflow-y-auto p-1">
            <p className="px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-400">Spalten</p>
            {fields.map((field) => (
              <label
                key={field.key}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
              >
                <Checkbox
                  checked={columns.includes(field.key)}
                  onChange={(event) =>
                    setColumns((current) =>
                      event.target.checked ? [...current, field.key] : current.filter((key) => key !== field.key),
                    )
                  }
                />
                {field.label}
              </label>
            ))}
            {(reference?.properties[objectType] ?? []).map((definition) => (
              <label
                key={definition.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
              >
                <Checkbox
                  checked={columns.includes(`property:${definition.key}`)}
                  onChange={(event) =>
                    setColumns((current) =>
                      event.target.checked
                        ? [...current, `property:${definition.key}`]
                        : current.filter((key) => key !== `property:${definition.key}`),
                    )
                  }
                />
                {definition.label}
              </label>
            ))}
          </div>
        </Dropdown>

        <Button variant="ghost" size="icon" onClick={() => void load()} aria-label="Aktualisieren">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>

        {extraActions}

        {canExport ? (
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCsv} data-tour="list-export">
            <span className="hidden sm:inline">Export</span>
          </Button>
        ) : null}

        {canCreate ? (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)} data-tour="list-create">
            {createLabel}
          </Button>
        ) : null}
      </div>

      {selected.size > 0 ? (
        <div className="flex items-center justify-between rounded-md border border-brand-200 bg-brand-50 px-3 py-2">
          <p className="text-xs text-brand-800">{selected.size} ausgewählt</p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Auswahl aufheben
            </Button>
            {canDelete ? (
              <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmDelete(true)}>
                Löschen
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <Card className="overflow-hidden" data-tour="list-table">
        {loading && !result ? (
          <SkeletonTable />
        ) : error ? (
          <EmptyState
            title="Die Liste konnte nicht geladen werden"
            description={error}
            actions={<Button onClick={() => void load()}>Erneut versuchen</Button>}
          />
        ) : result && result.items.length === 0 ? (
          <EmptyState
            title={activeFilterCount > 0 || debouncedSearch ? "Keine Treffer" : emptyTitle}
            description={
              activeFilterCount > 0 || debouncedSearch
                ? "Für die aktuelle Suche oder den Filter gibt es keine Datensätze."
                : emptyDescription
            }
            actions={
              activeFilterCount > 0 || debouncedSearch ? (
                <Button
                  onClick={() => {
                    setSearch("");
                    setFilter(EMPTY_FILTER);
                  }}
                >
                  Filter zurücksetzen
                </Button>
              ) : canCreate ? (
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
                  {createLabel}
                </Button>
              ) : null
            }
          />
        ) : result ? (
          <>
            {summary ? <div className="border-b border-ink-200 px-4 py-2">{summary(result)}</div> : null}
            <DataTable>
              <thead>
                <tr>
                  <Th className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onChange={(event) =>
                        setSelected(event.target.checked ? new Set(result.items.map((item) => item.id)) : new Set())
                      }
                      aria-label="Alle auswählen"
                    />
                  </Th>
                  {visibleFields.map((field) => (
                    <Th
                      key={field.key}
                      sortable={field.sortable}
                      sorted={sort.field === field.key ? sort.direction : null}
                      onSort={() =>
                        setSort((current) => ({
                          field: field.key,
                          direction: current.field === field.key && current.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                      align={field.type === "currency" || field.type === "number" ? "right" : "left"}
                    >
                      {field.label}
                    </Th>
                  ))}
                  {columns
                    .filter((key) => key.startsWith("property:"))
                    .map((key) => (
                      <Th key={key}>
                        {reference?.properties[objectType].find((d) => `property:${d.key}` === key)?.label ?? key}
                      </Th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <Tr key={item.id} onClick={() => router.push(rowHref(item))}>
                    <Td className="w-10">
                      <span onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(item.id)}
                          onChange={(event) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(item.id);
                              else next.delete(item.id);
                              return next;
                            })
                          }
                          aria-label="Zeile auswählen"
                        />
                      </span>
                    </Td>
                    {visibleFields.map((field) => (
                      <Td
                        key={field.key}
                        align={field.type === "currency" || field.type === "number" ? "right" : "left"}
                      >
                        {renderCell(item, field.key)}
                      </Td>
                    ))}
                    {columns
                      .filter((key) => key.startsWith("property:"))
                      .map((key) => (
                        <Td key={key}>{renderPropertyCell(item, key)}</Td>
                      ))}
                  </Tr>
                ))}
              </tbody>
            </DataTable>
            <Pagination
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              totalPages={result.totalPages}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        ) : null}
      </Card>

      <Drawer open={showCreate} onClose={() => setShowCreate(false)} title={createLabel} width="lg">
        {renderCreateForm((created) => {
          setShowCreate(false);
          if (created) router.push(rowHref({ id: created.id }));
          else void load();
        })}
      </Drawer>

      <SaveViewModal open={showSaveView} onClose={() => setShowSaveView(false)} onSave={saveView} busy={busy} />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteSelected}
        loading={busy}
        title={`${selected.size} Datensätze löschen?`}
        description="Die Datensätze werden als gelöscht markiert und erscheinen nicht mehr in Listen. Verknüpfte Aktivitäten bleiben für die Nachvollziehbarkeit erhalten."
      />
    </div>
  );
}

function renderPropertyCell(item: ListItem, key: string): React.ReactNode {
  const properties = (item.properties ?? {}) as Record<string, unknown>;
  const value = properties[key.slice("property:".length)];
  if (value === null || value === undefined || value === "") return <span className="text-ink-400">—</span>;
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  return String(value);
}

function SaveViewModal({
  open,
  onClose,
  onSave,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, isShared: boolean) => void;
  busy: boolean;
}) {
  const [name, setName] = React.useState("");
  const [shared, setShared] = React.useState(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ansicht speichern"
      description="Filter, Spalten und Sortierung werden unter diesem Namen gespeichert."
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="primary" loading={busy} disabled={name.trim().length === 0} onClick={() => onSave(name, shared)}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="z. B. Meine offenen Leads"
          aria-label="Name der Ansicht"
        />
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <Checkbox checked={shared} onChange={(event) => setShared(event.target.checked)} />
          Mit dem Team teilen
        </label>
      </div>
    </Modal>
  );
}
