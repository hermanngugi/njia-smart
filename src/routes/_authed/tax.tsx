import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { todayNairobi } from "@/lib/tax-period";
import { Overview } from "@/components/tax/overview";
import { Annual } from "@/components/tax/annual";
import { FilingPanel } from "@/components/tax/filing-panel";
import { useTaxData } from "@/components/tax/use-tax-data";
import type { TaxFilters } from "@/components/tax/tax-model";

const STATUSES = ["open", "overdue", "due_soon", "in_progress", "no_owner"] as const;
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const Route = createFileRoute("/_authed/tax")({
  validateSearch: (s: Record<string, unknown>) => ({
    view: s.view === "annual" ? ("annual" as const) : undefined,
    type: str(s.type),
    status: STATUSES.find(x => x === s.status),
    owner: str(s.owner),
    client: str(s.client),
    filing: str(s.filing),
    year: typeof s.year === "string" && /^\d{4}$/.test(s.year) ? s.year : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Tax | G.K Nahashon & Company" },
      { name: "description", content: "Client tax obligations, filing checklist, receipts, invoicing and annual records." },
    ],
  }),
  component: TaxPage,
});

// Two views of the same data. Everything about one filing (owner, checklist,
// receipt, invoice) lives in the side panel that opens from either view.
function TaxPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { user, isAdmin, canUse } = useAuth();
  const data = useTaxData();
  const [version, setVersion] = useState(0);

  const view = search.view ?? "overview";
  const year = search.year ?? todayNairobi().slice(0, 4);
  const filters: TaxFilters = { type: search.type, status: search.status, owner: search.owner, client: search.client };
  const canEdit = canUse("tax");

  const setSearch = (patch: Record<string, unknown>) =>
    void navigate({ search: ((prev: Record<string, unknown>) => ({ ...prev, ...patch })) as any, replace: true });
  const setFilters = (patch: Partial<TaxFilters>) => setSearch(patch);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tax</h1>
          <p className="text-sm text-muted-foreground">Every client's obligations, who is on each filing, and how far along it is.</p>
        </div>
        <div className="inline-flex rounded-md border p-0.5 bg-muted/40" role="tablist">
          {([["overview", "Overview"], ["annual", "Annual records"]] as const).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={view === key}
              onClick={() => setSearch({ view: key === "overview" ? undefined : key })}
              className={`px-3 py-1.5 text-sm rounded ${view === key ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >{label}</button>
          ))}
        </div>
      </div>

      {view === "overview" ? (
        <Overview
          data={data}
          filters={filters}
          setFilters={setFilters}
          userId={user?.id}
          canEdit={canEdit}
          onOpen={id => setSearch({ filing: id })}
          onAnnual={() => setSearch({ view: "annual" })}
        />
      ) : (
        <Annual
          data={data}
          filters={filters}
          setFilters={setFilters}
          year={year}
          setYear={y => setSearch({ year: y })}
          version={version}
          onOpen={id => setSearch({ filing: id })}
        />
      )}

      <FilingPanel
        filingId={search.filing ?? null}
        onClose={() => setSearch({ filing: undefined })}
        onChanged={() => { setVersion(v => v + 1); void data.reload(); }}
        staff={data.staff}
        canEdit={canEdit}
        isAdmin={isAdmin}
      />
    </div>
  );
}
