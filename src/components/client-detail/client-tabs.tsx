import { Trash2, Eye, Download } from "lucide-react";
import { formatDate } from "@/lib/format";
import { ClientAssignments } from "@/components/client-assignments";
import { ObligationContacts } from "@/components/obligation-contacts";
import { TaxObligations } from "@/components/tax-obligations-panel";
import { Button } from "@/components/ui/button";
import { TABS } from "./constants";
import { TabSection, Card, Empty, RelatedList, TaxList } from "./helpers";
import type { ClientDetailCtx } from "./use-client-detail";

export function ClientTabs({ ctx }: { ctx: ClientDetailCtx }) {
  const { isAdmin, canEditTax, tab, setTab, related, taxPolicies, obligations, openDocument, deleteClientDocument, deleteFilingRecord, openAdd, id, search } = ctx;
  const visibleTabs = TABS;
  return (
    <>
      <div className="flex flex-wrap gap-1 border-b">
        {visibleTabs.map(t => (
          <button key={t} onClick={()=>setTab(t)} className={`px-3 py-2 text-sm border-b-2 transition-colors ${tab===t ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t}</button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid md:grid-cols-2 gap-4">
          <ClientAssignments clientId={id} />
          <Card title="Contacts">
            {related.contacts.length === 0 ? <Empty msg="No contacts" /> :
              related.contacts.map((c:any) => (
                <div key={c.id} className="py-2 border-b last:border-0 text-sm">
                  <div className="font-medium">{c.name} <span className="text-xs text-muted-foreground">{c.role}</span></div>
                  <div className="text-xs text-muted-foreground">{c.email} · {c.phone}</div>
                </div>
              ))
            }
          </Card>
          <Card title="Upcoming filings">
            {related.tax.slice(0,5).map((t:any) => (
              <div key={t.id} className="flex justify-between text-sm py-1">
                <span className="uppercase">{t.return_type}</span>
                <span className="text-muted-foreground">{formatDate(t.due_date)}</span>
              </div>
            ))}
            {related.tax.length === 0 && <Empty msg="No tax returns yet" />}
          </Card>
        </div>
      )}
      {tab === "Tax" && (
        <div className="space-y-3">
          <div className="rounded-md border bg-card px-3 py-2 text-sm">
            <span className="text-muted-foreground">Tax obligations: </span>
            {obligations.length === 0
              ? <span className="text-muted-foreground">none yet</span>
              : obligations.map(o => taxPolicies.find(p => p.tax_type === o.tax_type)?.label ?? o.tax_type).join(" · ")}
            {!canEditTax && <div className="text-xs text-muted-foreground mt-0.5">View only — only users with full Tax access can add or stop obligations.</div>}
          </div>
          <TabSection label="tax obligation" canAdd={canEditTax} onAdd={() => openAdd("tax")}><TaxObligations clientId={id} hideAdd reloadKey={related.tax} focusType={search.obligation} /></TabSection>
          {obligations.length > 0 && (
            <div className="space-y-2">
              {obligations.map(o => {
                const pol = taxPolicies.find(p => p.tax_type === o.tax_type);
                return <ObligationContacts key={o.tax_type} clientId={id} taxType={o.tax_type} label={pol?.label ?? o.tax_type} />;
              })}
            </div>
          )}
          <div className="space-y-2">
            <div>
              <h3 className="font-semibold">Filing history</h3>
              <p className="text-sm text-muted-foreground">Past and current filing records for this client.</p>
            </div>
            <TaxList rows={related.tax} onDelete={deleteFilingRecord} empty="No filing history for this client." canDelete={isAdmin} />
          </div>
        </div>
      )}
      {tab === "Audit" && <TabSection label="audit engagement" onAdd={() => openAdd("audit")}><RelatedList rows={related.engagements.filter((e:any)=>e.type==="audit")} cols={["title","status","due_date"]} empty="No audit engagements" /></TabSection>}
      {tab === "Advisory" && <TabSection label="advisory project" onAdd={() => openAdd("advisory")}><RelatedList rows={related.advisory} cols={["title","status","due_date"]} empty="No advisory projects" /></TabSection>}
      {tab === "Documents" && (
        <TabSection label="document" onAdd={() => openAdd("document")}>
          {related.docs.length === 0 ? <Empty msg="No documents" /> : (
            <div className="bg-card border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 px-3">Document</th>
                    <th className="py-2 px-3">Version</th>
                    <th className="py-2 px-3">Added</th>
                    <th className="py-2 px-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {related.docs.map((doc: any) => (
                    <tr key={doc.id} className="border-b last:border-0">
                      <td className="py-2 px-3 font-medium">{doc.title || "Untitled document"}</td>
                      <td className="py-2 px-3">{doc.version ?? "—"}</td>
                      <td className="py-2 px-3">{formatDate(doc.created_at)}</td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1">
                          <Button type="button" variant="outline" size="sm" onClick={() => openDocument(doc)} disabled={!doc.file_path} title="View document">
                            <Eye className="h-3.5 w-3.5 mr-1" />View
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => openDocument(doc, true)} disabled={!doc.file_path} title="Download document">
                            <Download className="h-3.5 w-3.5 mr-1" />Download
                          </Button>
                          {isAdmin && (
                            <Button type="button" variant="ghost" size="sm" onClick={() => deleteClientDocument(doc)} title="Delete document" aria-label={`Delete ${doc.title || "document"}`}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabSection>
      )}
      {tab === "Tasks" && <TabSection label="task" onAdd={() => openAdd("task")}><RelatedList rows={related.tasks} cols={["title","priority","status","due_date"]} empty="No tasks" /></TabSection>}
    </>
  );
}
