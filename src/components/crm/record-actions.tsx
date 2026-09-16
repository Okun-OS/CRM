"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem } from "@/components/ui/misc";
import { ConfirmDialog, Drawer } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";

/**
 * Edit and delete actions shared by all record detail pages. Deletion always
 * goes through a confirmation, and both actions respect server permissions.
 */
export function RecordActions({
  recordId,
  endpoint,
  listHref,
  editTitle,
  deleteTitle,
  deleteDescription,
  canEdit,
  canDelete,
  renderForm,
  extraActions,
}: {
  recordId: string;
  endpoint: string;
  listHref: string;
  editTitle: string;
  deleteTitle: string;
  deleteDescription: string;
  canEdit: boolean;
  canDelete: boolean;
  renderForm: (close: (changed: boolean) => void) => React.ReactNode;
  extraActions?: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`${endpoint}/${recordId}`);
      toast.success("Datensatz gelöscht.");
      router.push(listHref);
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Der Datensatz konnte nicht gelöscht werden.");
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {extraActions}

      {canEdit ? (
        <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
          Bearbeiten
        </Button>
      ) : null}

      {canDelete ? (
        <Dropdown
          trigger={
            <Button variant="ghost" size="icon" aria-label="Weitere Aktionen">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          }
        >
          <DropdownItem danger icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirming(true)}>
            Löschen
          </DropdownItem>
        </Dropdown>
      ) : null}

      <Drawer open={editing} onClose={() => setEditing(false)} title={editTitle} width="lg">
        {renderForm((changed) => {
          setEditing(false);
          if (changed) router.refresh();
        })}
      </Drawer>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={remove}
        loading={busy}
        title={deleteTitle}
        description={deleteDescription}
      />
    </div>
  );
}
