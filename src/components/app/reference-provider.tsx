"use client";

import * as React from "react";
import type { CrmObjectType } from "@/generated/prisma/enums";
import type { PropertyDefinitionDTO } from "@/lib/properties";
import { api } from "@/lib/api-client";

/**
 * Shared reference data for pickers and forms. Loaded once per session and
 * refreshable, so a newly created pipeline or property shows up without a full
 * page reload.
 */
export type ReferenceData = {
  members: { id: string; name: string; email: string; avatarUrl: string | null; role: string }[];
  pipelines: {
    id: string;
    name: string;
    isDefault: boolean;
    stages: { id: string; name: string; type: string; probability: number; position: number }[];
  }[];
  lifecycleStages: { key: string; label: string }[];
  leadStatuses: { key: string; label: string; isTerminal: boolean }[];
  tags: { id: string; name: string; color: string }[];
  properties: Record<CrmObjectType, PropertyDefinitionDTO[]>;
};

type ReferenceContextValue = {
  data: ReferenceData | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const ReferenceContext = React.createContext<ReferenceContextValue>({
  data: null,
  loading: true,
  refresh: async () => {},
});

export function ReferenceProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = React.useState<ReferenceData | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    try {
      setData(await api.get<ReferenceData>("/api/v1/reference"));
    } catch {
      // Pickers degrade to plain inputs rather than blocking the whole screen.
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = React.useMemo(() => ({ data, loading, refresh }), [data, loading, refresh]);
  return <ReferenceContext.Provider value={value}>{children}</ReferenceContext.Provider>;
}

export function useReference() {
  return React.useContext(ReferenceContext);
}

/** Company options are fetched on demand — there can be many. */
export function useCompanyOptions(search: string) {
  const [options, setOptions] = React.useState<{ id: string; name: string }[]>([]);

  React.useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const result = await api.get<{ items: { id: string; name: string }[] }>(
          `/api/v1/companies?pageSize=20&sortField=name&sortDirection=asc${search ? `&search=${encodeURIComponent(search)}` : ""}`,
          { signal: controller.signal },
        );
        setOptions(result.items.map((item) => ({ id: item.id, name: item.name })));
      } catch {
        /* aborted or unauthorised — leave the previous options in place */
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [search]);

  return options;
}

/** Contact options for pickers — fetched on demand, like companies. */
export function useContactOptions(search: string) {
  const [options, setOptions] = React.useState<{ id: string; name: string }[]>([]);

  React.useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const result = await api.get<{ items: { id: string; name: string }[] }>(
          `/api/v1/contacts?pageSize=20&sortField=lastName&sortDirection=asc${search ? `&search=${encodeURIComponent(search)}` : ""}`,
          { signal: controller.signal },
        );
        setOptions(result.items.map((item) => ({ id: item.id, name: item.name })));
      } catch {
        /* aborted or unauthorised — keep the previous options */
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [search]);

  return options;
}
