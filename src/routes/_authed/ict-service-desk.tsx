import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import {
  Ticket, HardDrive, Wrench, AlertTriangle, Plus, X, Pencil, Trash2,
  ChevronRight, ChevronDown, ListChecks, ShieldCheck, CheckCircle2, BookOpen, Search, Wifi, Printer, Mail, ShieldAlert, KeyRound, AppWindow,
} from "lucide-react";

export const Route = createFileRoute("/_authed/ict-service-desk")({
  head: () => ({
    meta: [
      { title: "ICT Service Desk | G.K Nahashon & Company" },
      { name: "description", content: "Internal IT support, assets and maintenance." },
    ],
  }),
  component: IctServiceDesk,
});

const CATEGORIES = ["Hardware", "Software", "Network", "Access/Account", "Other"];
const PRIORITIES = ["Low", "Medium", "High", "Critical"];
const STATUSES = ["New", "In Progress", "On Hold", "Resolved", "Closed"];
const EMPTY_FORM = { title: "", description: "", category: CATEGORIES[0], priority: "Medium", assigned_to: "", service_type: "general" };
const EMPTY_ASSET_FORM = { id: "", name: "", description: "", quantity: "1", unit_cost: "", purchase_date: "", assigned_to: "" };

const KNOWLEDGE_ARTICLES = [
  {
    id: "wifi-network",
    title: "Cannot connect to the office network or Wi-Fi",
    category: "Network",
    summary: "Troubleshoot a lost or unstable network connection.",
    tags: "internet wifi network connection browser",
    steps: [
      "Check that Wi-Fi is enabled and airplane mode is off, or reconnect the network cable securely.",
      "Confirm whether other websites or approved applications can connect. If possible, check whether a colleague has the same issue.",
      "Disconnect from the office Wi-Fi and reconnect using the approved network. Do not share the network password with unauthorised people.",
      "Restart your computer if it is safe to do so. Do not reset routers or network equipment yourself.",
      "If the issue continues, raise an ICT ticket and include the error message, location, time it started, and whether other users are affected.",
    ],
  },
  {
    id: "printer",
    title: "Printer is not printing",
    category: "Hardware",
    summary: "Check printer status, paper, queue and connection before requesting support.",
    tags: "printer print paper toner queue scan",
    steps: [
      "Check that the printer is powered on and shows no paper, toner, or jam warning.",
      "Confirm that the correct office printer is selected in the print window.",
      "Check whether the printer is paused or showing jobs stuck in the queue. Cancel only your own stuck job if possible.",
      "Check that the computer and printer are connected to the approved office network, where applicable.",
      "If it still fails, raise a ticket with the printer name, your computer, and any displayed error. Do not force paper out or open service panels if you are unsure.",
    ],
  },
  {
    id: "email",
    title: "Email is not sending or receiving",
    category: "Software",
    summary: "Check connectivity, mailbox status and delivery errors.",
    tags: "email outlook mailbox send receive attachment",
    steps: [
      "Confirm that your internet connection is working and reopen the approved email application or webmail.",
      "Check the Outbox, Sent Items, Junk/Spam and mailbox storage warning, if shown.",
      "Verify the recipient address and check whether the message includes an attachment that may be too large.",
      "If you receive a delivery failure, keep the error text and note when the issue started.",
      "Raise an ICT ticket if the problem persists. Never send your password or multi-factor authentication code in the ticket.",
    ],
  },
  {
    id: "password-access",
    title: "Password, sign-in or account access problem",
    category: "Access/Account",
    summary: "Use approved account recovery and report unexpected access prompts.",
    tags: "password login sign in account mfa authentication access",
    steps: [
      "Check that the username or email address is correct and that Caps Lock is not enabled.",
      "Use only the organisation's approved password-reset or account-recovery process, if available.",
      "If multi-factor authentication is requested, approve only a sign-in you initiated yourself.",
      "Never share passwords, recovery codes, or one-time verification codes with anyone, including someone claiming to be ICT.",
      "If your account may be compromised or you are unexpectedly locked out, raise an urgent ICT ticket and notify ICT through an approved channel.",
    ],
  },
  {
    id: "software-install",
    title: "Need software installed or updated",
    category: "Software",
    summary: "Request approved software instead of installing unknown applications yourself.",
    tags: "software install update application license admin rights",
    steps: [
      "Check whether the software is already available on your computer or through an approved company portal.",
      "Raise an ICT ticket with the software name, business purpose, device name, and deadline.",
      "Include the vendor's official website or the exact error message if relevant.",
      "Do not bypass administrator controls, use unlicensed software, or download installers from unknown websites.",
      "ICT will confirm compatibility, security and licensing before installation where required.",
    ],
  },
  {
    id: "phishing",
    title: "Suspicious email, link or security warning",
    category: "Security",
    summary: "Safely report suspected phishing or unusual sign-in activity.",
    tags: "phishing scam suspicious email malware security virus link",
    steps: [
      "Do not click links, open unexpected attachments, reply, or enter your password on a page opened from the message.",
      "Do not forward the suspicious message to other colleagues. Use the organisation's approved reporting method if one is available.",
      "Raise an ICT ticket and provide the sender, subject, time received, and a screenshot if safe to capture.",
      "If you already clicked a link, entered credentials, or opened a suspicious file, contact ICT immediately and explain what happened.",
      "Do not delete relevant evidence unless ICT instructs you to do so.",
    ],
  },
  {
    id: "slow-computer",
    title: "Computer is slow or frequently freezes",
    category: "Hardware",
    summary: "Try safe checks and record the symptoms before escalating.",
    tags: "slow computer laptop frozen performance restart",
    steps: [
      "Save your work and close applications and browser tabs you are not using.",
      "Check whether the issue affects one application or the whole computer, and note any error messages.",
      "Restart the computer when you have saved your work and no critical task is running.",
      "Do not install cleaner tools, disable security software, or delete business files to free space.",
      "Raise a ticket if the issue continues, including the device name, when it began, and which applications are affected.",
    ],
  },
  {
    id: "video-meetings",
    title: "Camera or microphone not working in a meeting",
    category: "Hardware",
    summary: "Check device selection, permissions and physical connections.",
    tags: "camera microphone headset audio video meeting teams zoom",
    steps: [
      "Check that the headset or camera is connected and not physically muted or covered.",
      "In the meeting application's settings, select the intended microphone, speaker and camera.",
      "Check the operating system's camera and microphone permissions for the approved meeting application.",
      "Close other applications that may be using the device and rejoin the meeting if appropriate.",
      "If it still fails, raise a ticket with the application name, device model and any error shown.",
    ],
  },
];

const KNOWLEDGE_CATEGORIES = ["All topics", "Network", "Hardware", "Software", "Access/Account", "Security", "Other"];
const KNOWLEDGE_EDIT_CATEGORIES = KNOWLEDGE_CATEGORIES.filter((category) => category !== "All topics");
const EMPTY_KNOWLEDGE_FORM = { id: "", title: "", category: "Hardware", summary: "", tags: "", stepsText: "" };
type KnowledgeArticle = { id: string; slug?: string; title: string; category: string; summary: string; tags: string; steps: string[]; created_at?: string; updated_at?: string };


const PRIORITY_COLORS: Record<string, string> = {
  Low: "bg-muted text-muted-foreground",
  Medium: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  High: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  Critical: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

const STATUS_COLORS: Record<string, string> = {
  New: "bg-muted text-muted-foreground",
  "In Progress": "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  "On Hold": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  Resolved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  Closed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
};

type Ticket = {
  id: string;
  ticket_number: string | null;
  title: string;
  description: string | null;
  category: string | null;
  priority: string | null;
  status: string;
  reported_by: string;
  assigned_to: string | null;
  created_at: string;
  service_type?: string | null;
};

// Service templates + per-ticket checklist (see 20261009120000_ict_service_templates.sql).
// The database enforces every rule below; this page only reflects it.
type ServiceTemplate = { service_type: string; title: string; description: string | null; sort_order: number };
type StepStatus = "not_started" | "in_progress" | "blocked" | "done" | "verified" | "not_applicable";
type Control = {
  id: string;
  ticket_id: string;
  template_control_id: string | null;
  control_key: string;
  category: string;
  title: string;
  guidance: string | null;
  evidence_hint: string | null;
  mandatory: boolean;
  requires_evidence: boolean;
  requires_verification: boolean;
  sort_order: number;
  status: StepStatus;
  evidence_note: string | null;
  assigned_to: string | null;
  due_date: string | null;
  completed_by: string | null;
  completed_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
};

const STEP_LABEL: Record<StepStatus, string> = {
  not_started: "Not started", in_progress: "In progress", blocked: "Blocked",
  done: "Done", verified: "Verified", not_applicable: "Not applicable",
};
const STEP_COLORS: Record<StepStatus, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  blocked: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  verified: "bg-emerald-200 text-emerald-900 dark:bg-emerald-800/50 dark:text-emerald-100",
  not_applicable: "bg-muted text-muted-foreground",
};

// A step counts as finished when it is verified, not applicable, or done and
// does not need a second person to verify it.
const isStepComplete = (c: Control) =>
  c.status === "verified" || c.status === "not_applicable" || (c.status === "done" && !c.requires_verification);

function progressOf(cs: Control[]) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    total: cs.length,
    complete: cs.filter(isStepComplete).length,
    awaiting: cs.filter((c) => c.status === "done" && c.requires_verification).length,
    blocked: cs.filter((c) => c.status === "blocked").length,
    overdue: cs.filter((c) => c.due_date && c.due_date < today && !isStepComplete(c)).length,
    mandatoryOpen: cs.filter((c) => c.mandatory && !isStepComplete(c)).length,
  };
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });

type Asset = {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unit_cost: number | null;
  purchase_date: string | null;
  assigned_to: string | null;
  created_at: string;
};

type PersonLookup = (id: string | null | undefined) => string;

function StepRow({ c, canEdit, isFull, userId, ictStaff, nameOf, onChanged }: {
  c: Control; canEdit: boolean; isFull: boolean; userId: string | undefined;
  ictStaff: { id: string; full_name: string | null }[]; nameOf: PersonLookup; onChanged: () => void;
}) {
  const [note, setNote] = useState(c.evidence_note ?? "");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!dirty) setNote(c.evidence_note ?? ""); }, [c.evidence_note, dirty]);

  // A verified step is locked for everyone except full-module roles (server-enforced too).
  const locked = !canEdit || (c.status === "verified" && !isFull);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = !!c.due_date && c.due_date < today && !isStepComplete(c);
  const tbl = () => supabase.from("ict_case_controls" as any) as any;

  async function run(patch: Record<string, unknown>, withNote: boolean, okMsg?: string) {
    setBusy(true);
    const { error } = await tbl().update(withNote ? { evidence_note: note.trim() || null, ...patch } : patch).eq("id", c.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (withNote) setDirty(false);
    if (okMsg) toast.success(okMsg);
    onChanged();
  }
  async function remove() {
    if (!confirm("Remove this step?")) return;
    const { error } = await tbl().delete().eq("id", c.id);
    if (error) toast.error(error.message); else onChanged();
  }

  const selfCompleted = c.status === "done" && c.requires_verification && c.completed_by === userId;
  const canVerify = !locked && c.status === "done" && c.requires_verification && !selfCompleted;

  return (
    <li className="border rounded-md p-3 bg-background space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{c.title}</span>
            {c.mandatory && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary uppercase tracking-wide">Required</span>}
            {c.requires_verification && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" />2nd-person check</span>}
            {overdue && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">Overdue</span>}
          </div>
          {c.guidance && <p className="text-xs text-muted-foreground mt-0.5">{c.guidance}</p>}
        </div>
        {locked ? (
          <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${STEP_COLORS[c.status]}`}>{STEP_LABEL[c.status]}</span>
        ) : (
          <select
            value={c.status === "verified" ? "done" : c.status}
            disabled={busy || c.status === "verified"}
            onChange={(e) => run({ status: e.target.value }, true)}
            className={`h-7 px-2 rounded text-xs border bg-background shrink-0 ${STEP_COLORS[c.status]}`}
          >
            {(["not_started", "in_progress", "blocked", "done", "not_applicable"] as StepStatus[]).map((st) => (
              <option key={st} value={st}>{STEP_LABEL[st]}</option>
            ))}
          </select>
        )}
      </div>

      {(c.requires_evidence || c.status !== "not_started" || note || !locked) && (
        locked ? (
          c.evidence_note ? <p className="text-xs whitespace-pre-wrap rounded bg-muted/40 px-2 py-1.5">{c.evidence_note}</p> : null
        ) : (
          <div className="space-y-1">
            <textarea
              rows={2}
              value={note}
              disabled={busy}
              onChange={(e) => { setNote(e.target.value); setDirty(true); }}
              placeholder={(c.requires_evidence ? "Evidence required — " : "Notes — ") + (c.evidence_hint ?? "what was done, reference, who confirmed")}
              className="w-full px-2 py-1.5 rounded-md border bg-background text-xs"
            />
            {dirty && (
              <button type="button" disabled={busy} onClick={() => run({}, true, "Note saved")} className="h-7 px-2 rounded-md border text-xs hover:border-primary/60 disabled:opacity-50">Save note</button>
            )}
          </div>
        )
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {locked ? (
          <>
            {c.assigned_to && <span>Owner: {nameOf(c.assigned_to)}</span>}
            {c.due_date && <span className={overdue ? "text-destructive" : ""}>Due {fmtDate(c.due_date)}</span>}
          </>
        ) : (
          <>
            <label className="inline-flex items-center gap-1.5">Owner
              <select
                value={c.assigned_to ?? ""}
                disabled={busy}
                onChange={(e) => run({ assigned_to: e.target.value || null }, false)}
                className="h-7 px-1.5 rounded border bg-background text-xs"
              >
                <option value="">Unassigned</option>
                {ictStaff.map((p) => <option key={p.id} value={p.id}>{p.full_name ?? "Unnamed"}</option>)}
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5">Due
              <input
                type="date"
                value={c.due_date ?? ""}
                disabled={busy}
                onChange={(e) => run({ due_date: e.target.value || null }, false)}
                className="h-7 px-1.5 rounded border bg-background text-xs"
              />
            </label>
          </>
        )}
        {c.completed_at && (c.status === "done" || c.status === "verified") && (
          <span>Done by {nameOf(c.completed_by)} · {fmtDate(c.completed_at)}</span>
        )}
        {c.status === "not_applicable" && c.completed_at && <span>Marked by {nameOf(c.completed_by)} · {fmtDate(c.completed_at)}</span>}
        {c.status === "verified" && c.verified_at && (
          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3 w-3" />Verified by {nameOf(c.verified_by)} · {fmtDate(c.verified_at)}</span>
        )}
        {selfCompleted && <span className="text-amber-700 dark:text-amber-300">Waiting for someone else to verify</span>}
        <span className="ml-auto inline-flex items-center gap-2">
          {canVerify && (
            <button type="button" disabled={busy} onClick={() => run({ status: "verified" }, true, "Step verified")} className="h-7 px-2 rounded-md bg-emerald-600 text-white text-xs inline-flex items-center gap-1 disabled:opacity-50">
              <ShieldCheck className="h-3 w-3" />Verify
            </button>
          )}
          {isFull && c.status === "verified" && (
            <button type="button" disabled={busy} onClick={() => run({ status: "in_progress" }, false, "Step reopened")} className="h-7 px-2 rounded-md border text-xs hover:border-primary/60 disabled:opacity-50">Reopen</button>
          )}
          {!locked && c.template_control_id === null && c.status === "not_started" && (
            <button type="button" onClick={remove} title="Remove step" className="p-1 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </span>
      </div>
    </li>
  );
}

function ChecklistPanel({ ticket, controls, templates, canWork, isFull, userId, ictStaff, nameOf, onChanged }: {
  ticket: Ticket; controls: Control[]; templates: ServiceTemplate[]; canWork: boolean; isFull: boolean;
  userId: string | undefined; ictStaff: { id: string; full_name: string | null }[]; nameOf: PersonLookup; onChanged: () => void;
}) {
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const sorted = useMemo(
    () => [...controls].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)),
    [controls],
  );
  const pr = progressOf(sorted);
  const ticketClosed = ticket.status === "Closed";
  const canEdit = canWork && (!ticketClosed || isFull);
  const type = ticket.service_type ?? "general";
  const typeTitle = templates.find((t) => t.service_type === type)?.title ?? type;
  const tbl = () => supabase.from("ict_case_controls" as any) as any;

  async function changeType(next: string) {
    const { error } = await supabase.from("ict_tickets").update({ service_type: next } as any).eq("id", ticket.id);
    if (error) toast.error(error.message); else { toast.success("Service type changed"); onChanged(); }
  }
  async function syncChecklist() {
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("sync_ict_ticket_checklist", { _ticket_id: ticket.id });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(data > 0 ? `${data} step${data === 1 ? "" : "s"} added` : "Checklist is already up to date");
    onChanged();
  }
  async function addCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!custom.trim() || !userId) return;
    setBusy(true);
    const next = (sorted[sorted.length - 1]?.sort_order ?? 0) + 10;
    const { error } = await tbl().insert({
      ticket_id: ticket.id,
      control_key: `custom_${Date.now().toString(36)}`,
      category: "custom",
      title: custom.trim(),
      mandatory: false,
      requires_evidence: false,
      requires_verification: false,
      sort_order: next,
      created_by: userId,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setCustom("");
    onChanged();
  }

  return (
    <div className="px-4 py-3 bg-muted/20 border-t space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ListChecks className="h-4 w-4 text-primary" />
          {typeTitle} checklist
          {pr.total > 0 && <span className="text-xs font-normal text-muted-foreground">{pr.complete} of {pr.total} complete</span>}
        </div>
        {canEdit && templates.length > 0 && (
          <label className="text-xs text-muted-foreground inline-flex items-center gap-1.5">Type
            <select value={type} onChange={(e) => changeType(e.target.value)} className="h-7 px-1.5 rounded border bg-background text-xs">
              {templates.map((t) => <option key={t.service_type} value={t.service_type}>{t.title}</option>)}
            </select>
          </label>
        )}
      </div>

      {pr.total > 0 && (
        <div className="space-y-1">
          <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round((pr.complete / pr.total) * 100)}%` }} /></div>
          {pr.mandatoryOpen > 0 && ticket.status !== "Resolved" && ticket.status !== "Closed" && (
            <p className="text-xs text-muted-foreground">
              {pr.mandatoryOpen} required step{pr.mandatoryOpen === 1 ? "" : "s"} must be finished before this ticket can be resolved or closed.
            </p>
          )}
          {ticketClosed && !isFull && <p className="text-xs text-muted-foreground">This ticket is closed — the checklist is read-only.</p>}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-3">
          <span>No checklist on this ticket.</span>
          {canEdit && (
            <button type="button" disabled={busy} onClick={syncChecklist} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50">Add {typeTitle} checklist</button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map((c) => (
            <StepRow key={c.id} c={c} canEdit={canEdit} isFull={isFull} userId={userId} ictStaff={ictStaff} nameOf={nameOf} onChanged={onChanged} />
          ))}
        </ul>
      )}

      {canEdit && sorted.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={addCustom} className="flex gap-2 flex-1 min-w-[16rem]">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Add an extra step for this ticket"
              className="flex-1 h-8 px-3 rounded-md border bg-background text-xs"
            />
            <button disabled={busy || !custom.trim()} className="h-8 px-3 rounded-md border text-xs hover:border-primary/60 disabled:opacity-50 inline-flex items-center gap-1"><Plus className="h-3 w-3" />Add</button>
          </form>
          <button type="button" disabled={busy} onClick={syncChecklist} title="Add any template steps this ticket doesn't have yet" className="h-8 px-3 rounded-md border text-xs text-muted-foreground hover:border-primary/60 disabled:opacity-50">Sync with template</button>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <div className="bg-card rounded-lg border p-4 h-full card-hover animate-fade-in-up">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}

function IctServiceDesk() {
  const { user, access, canCreate } = useAuth();
  const fullAccess = access("ict_service_desk") === "full";
  // ICT team members (Amos, Herman, ...) work the desk: they see and update
  // every ticket. Assets + deleting tickets stay Director/Admin only.
  const [isIctTeam, setIsIctTeam] = useState(false);
  const canManageTickets = fullAccess || isIctTeam;
  const canRaiseTicket = canCreate("ict_service_desk");

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string | null }[]>([]);
  const [allStaff, setAllStaff] = useState<{ id: string; full_name: string | null }[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [criticalCount, setCriticalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Service templates + checklists. If the migration hasn't been applied yet these
  // stay empty and the page behaves exactly as before.
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [controls, setControls] = useState<Control[]>([]);
  const [maintenanceCount, setMaintenanceCount] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState("");
  const [knowledgeArticles, setKnowledgeArticles] = useState<KnowledgeArticle[]>(KNOWLEDGE_ARTICLES as KnowledgeArticle[]);
  const [knowledgeSearch, setKnowledgeSearch] = useState("");
  const [knowledgeCategory, setKnowledgeCategory] = useState("All topics");
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null);
  const [knowledgeFormOpen, setKnowledgeFormOpen] = useState(false);
  const [knowledgeForm, setKnowledgeForm] = useState(EMPTY_KNOWLEDGE_FORM);
  const [knowledgeSaving, setKnowledgeSaving] = useState(false);
  const canManageKnowledge = fullAccess || isIctTeam;

  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetTotalQty, setAssetTotalQty] = useState(0);
  const [assetFormOpen, setAssetFormOpen] = useState(false);
  const [assetForm, setAssetForm] = useState(EMPTY_ASSET_FORM);
  const [assetSaving, setAssetSaving] = useState(false);

  // RLS already scopes this correctly: regular staff only see tickets they
  // reported, full-access roles (Director/Admin) see every ticket — so a
  // plain select gives each viewer exactly the counts/rows they should see.
  async function load() {
    setLoading(true);
    const [ticketsRes, openRes, criticalRes, staffRes, assetsRes, teamRes, tplRes, ctlRes, maintRes] = await Promise.all([
      supabase.from("ict_tickets").select("*").order("created_at", { ascending: false }),
      supabase.from("ict_tickets").select("id", { count: "exact", head: true }).not("status", "in", "(Resolved,Closed)"),
      supabase.from("ict_tickets").select("id", { count: "exact", head: true }).eq("priority", "Critical"),
      supabase.from("profiles").select("id, full_name").order("full_name"),
      // ict_assets is RLS-restricted to Director/Admin; this simply returns
      // nothing for everyone else instead of erroring.
      fullAccess ? supabase.from("ict_assets").select("*").order("name") : Promise.resolve({ data: [], error: null }),
      supabase.from("ict_service_desk_team").select("user_id"),
      (supabase.from("ict_service_templates" as any) as any).select("service_type, title, description, sort_order").eq("active", true).order("sort_order"),
      (supabase.from("ict_case_controls" as any) as any).select("*"),
      supabase.from("ict_tickets").select("id", { count: "exact", head: true }).eq("service_type", "maintenance").not("status", "in", "(Resolved,Closed)"),
    ]);
    if (ticketsRes.error) toast.error(ticketsRes.error.message);
    if (assetsRes.error) toast.error(assetsRes.error.message);
    setTickets((ticketsRes.data as Ticket[]) ?? []);
    setOpenCount(openRes.count ?? 0);
    setCriticalCount(criticalRes.count ?? 0);
    // Template/checklist queries fail harmlessly until the migration is applied.
    setTemplates(tplRes.error ? [] : ((tplRes.data as ServiceTemplate[]) ?? []));
    setControls(ctlRes.error ? [] : ((ctlRes.data as Control[]) ?? []));
    setMaintenanceCount(maintRes.error ? 0 : (maintRes.count ?? 0));
    const directory = (staffRes.data as any[]) ?? [];
    setAllStaff(directory);
    // Ticket assignees are the ICT service-desk team (ict_service_desk_team
    // table). Falls back to matching Amos/Herman by name if it's still empty.
    const teamIds = new Set(((teamRes.data as any[]) ?? []).map((t) => t.user_id));
    setIsIctTeam(!!user && teamIds.has(user.id));
    setStaff(
      teamIds.size > 0
        ? directory.filter((p) => teamIds.has(p.id))
        : directory.filter((p) => ["amos", "herman"].some((n) => (p.full_name ?? "").toLowerCase().includes(n))),
    );
    const assetRows = (assetsRes.data as Asset[]) ?? [];
    setAssets(assetRows);
    setAssetTotalQty(assetRows.reduce((sum, a) => sum + (a.quantity ?? 0), 0));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Knowledge articles are shared across staff and managed through Supabase.
  // If the migration has not been applied, the built-in guides remain available.
  async function loadKnowledgeArticles() {
    const { data, error } = await (supabase.from("ict_knowledge_articles" as any) as any)
      .select("id, slug, title, category, summary, tags, steps, created_at, updated_at")
      .eq("active", true)
      .order("category")
      .order("title");
    if (error) return;
    setKnowledgeArticles((data ?? []) as KnowledgeArticle[]);
  }
  useEffect(() => { loadKnowledgeArticles(); }, []);

  // Live refresh: a newly raised or updated ticket shows up without a reload.
  useEffect(() => {
    const ch = supabase
      .channel("ict-desk-tickets")
      .on("postgres_changes", { event: "*", schema: "public", table: "ict_tickets" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "ict_case_controls" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Only full-access roles (Director/Admin) hit this — the RLS "update"
  // policy on ict_tickets enforces the same rule server-side regardless.
  async function updateTicket(id: string, patch: Partial<Pick<Ticket, "status" | "assigned_to">>) {
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t))); // optimistic
    const { error } = await supabase.from("ict_tickets").update(patch).eq("id", id);
    if (error) { toast.error(error.message); load(); return; }
    toast.success("Ticket updated");
  }

  function openNewAsset() { setAssetForm(EMPTY_ASSET_FORM); setAssetFormOpen(true); }
  function openEditAsset(a: Asset) {
    setAssetForm({
      id: a.id,
      name: a.name,
      description: a.description ?? "",
      quantity: String(a.quantity ?? 1),
      unit_cost: a.unit_cost != null ? String(a.unit_cost) : "",
      purchase_date: a.purchase_date ?? "",
      assigned_to: a.assigned_to ?? "",
    });
    setAssetFormOpen(true);
  }

  // ict_assets RLS restricts insert/update/delete to Director/Admin ("full"
  // rank on ict_service_desk) regardless of what the UI shows.
  async function saveAsset(e: React.FormEvent) {
    e.preventDefault();
    if (!assetForm.name.trim() || !user) return;
    setAssetSaving(true);
    const payload = {
      name: assetForm.name.trim(),
      description: assetForm.description.trim() || null,
      quantity: Number(assetForm.quantity) || 1,
      unit_cost: assetForm.unit_cost ? Number(assetForm.unit_cost) : null,
      purchase_date: assetForm.purchase_date || null,
      assigned_to: assetForm.assigned_to || null,
    };
    const { error } = assetForm.id
      ? await supabase.from("ict_assets").update(payload).eq("id", assetForm.id)
      : await supabase.from("ict_assets").insert({ ...payload, created_by: user.id });
    setAssetSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(assetForm.id ? "Asset updated" : "Asset added");
    setAssetFormOpen(false);
    load();
  }

  async function deleteAsset(id: string) {
    if (!confirm("Delete this asset?")) return;
    const { error } = await supabase.from("ict_assets").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Asset deleted"); load(); }
  }

  async function deleteTicket(id: string) {
    if (!confirm("Delete this ticket?")) return;
    const { error } = await supabase.from("ict_tickets").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Ticket deleted"); load(); }
  }

  const controlsByTicket = useMemo(() => {
    const m = new Map<string, Control[]>();
    for (const c of controls) { const a = m.get(c.ticket_id); if (a) a.push(c); else m.set(c.ticket_id, [c]); }
    return m;
  }, [controls]);
  const nameOf: PersonLookup = (id) => (id ? allStaff.find((p) => p.id === id)?.full_name ?? "Unknown" : "—");
  const typeTitle = (key: string | null | undefined) => templates.find((t) => t.service_type === key)?.title ?? (key && key !== "general" ? key : "General");
  const visibleTickets = typeFilter ? tickets.filter((t) => (t.service_type ?? "general") === typeFilter) : tickets;
  const toggleExpanded = (id: string) => setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectedTemplate = templates.find((t) => t.service_type === form.service_type);

  async function submitTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !user) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("ict_tickets")
      .insert({
        title: form.title.trim(),
        description: form.description.trim() || null,
        category: form.category,
        priority: form.priority,
        assigned_to: form.assigned_to || null,
        reported_by: user.id,
        // only sent once the templates migration is in place
        ...(templates.length > 0 ? { service_type: form.service_type } : {}),
      } as any)
      .select("ticket_number")
      .single();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Ticket ${data?.ticket_number ?? ""} raised`.trim());
    setForm(EMPTY_FORM);
    setFormOpen(false);
    load();
  }

  const filteredKnowledgeArticles = knowledgeArticles.filter((article) => {
    const matchesCategory = knowledgeCategory === "All topics" || article.category === knowledgeCategory;
    const query = knowledgeSearch.trim().toLowerCase();
    const searchable = `${article.title} ${article.category} ${article.summary} ${article.tags} ${article.steps.join(" ")}`.toLowerCase();
    return matchesCategory && (!query || searchable.includes(query));
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">ICT Service Desk</h1>
          <p className="text-sm text-muted-foreground">Internal IT support, assets and maintenance.</p>
        </div>
        {canRaiseTicket && (
          <button
            onClick={() => setFormOpen(true)}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2 transition-transform active:scale-95"
          >
            <Plus className="h-4 w-4" /> Raise a ticket
          </button>
        )}
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Ticket} label="Open Tickets" value={openCount} />
        {fullAccess && <StatCard icon={HardDrive} label="Assets" value={assetTotalQty} />}
        <StatCard icon={Wrench} label="Active Maintenance" value={maintenanceCount} />
        <StatCard icon={AlertTriangle} label="Critical Issues" value={criticalCount} />
      </div>

      <section className="bg-card border rounded-lg overflow-hidden" aria-labelledby="ict-knowledge-title">
        <div className="px-4 py-4 border-b flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary"><BookOpen className="h-5 w-5" /></div>
            <div>
              <h2 id="ict-knowledge-title" className="font-semibold">ICT Knowledge Base</h2>
              <p className="text-sm text-muted-foreground mt-1">Quick self-help guides for common office IT issues. Try a guide before raising a request.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs rounded-full bg-muted px-2.5 py-1 text-muted-foreground">{knowledgeArticles.length} guides</span>
            {canManageKnowledge && <button type="button" onClick={() => { setKnowledgeForm(EMPTY_KNOWLEDGE_FORM); setKnowledgeFormOpen(true); }} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2"><Plus className="h-4 w-4" /> Add guide</button>}
          </div>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_190px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                aria-label="Search ICT help guides"
                value={knowledgeSearch}
                onChange={(e) => setKnowledgeSearch(e.target.value)}
                placeholder="Search printer, email, password, network…"
                className="w-full h-10 pl-9 pr-3 rounded-md border bg-background text-sm"
              />
            </div>
            <select aria-label="Filter ICT help by category" value={knowledgeCategory} onChange={(e) => setKnowledgeCategory(e.target.value)} className="h-10 px-3 rounded-md border bg-background text-sm">
              {KNOWLEDGE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {filteredKnowledgeArticles.map((article) => {
              const isExpanded = expandedArticle === article.id;
              const ArticleIcon = article.category === "Network" ? Wifi : article.category === "Software" ? AppWindow : article.category === "Access/Account" ? KeyRound : article.category === "Security" ? ShieldAlert : article.title.toLowerCase().includes("printer") ? Printer : article.title.toLowerCase().includes("email") ? Mail : BookOpen;
              return (
                <article key={article.id} className="rounded-lg border bg-background/50 overflow-hidden">
                  <button type="button" onClick={() => setExpandedArticle(isExpanded ? null : article.id)} aria-expanded={isExpanded} className="w-full p-3 text-left flex items-start gap-3 hover:bg-muted/40 transition-colors">
                    <span className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground"><ArticleIcon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">{article.title}</span>
                        <span className="text-[10px] rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{article.category}</span>
                      </span>
                      <span className="block text-xs text-muted-foreground mt-1">{article.summary}</span>
                    </span>
                    {isExpanded ? <ChevronDown className="h-4 w-4 mt-1 shrink-0" /> : <ChevronRight className="h-4 w-4 mt-1 shrink-0" />}
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t">
                      <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
                        {article.steps.map((step, index) => <li key={`${article.id}-${index}`} className="pl-1">{step}</li>)}
                      </ol>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {canRaiseTicket && (
                          <button type="button" onClick={() => { setForm({ ...EMPTY_FORM, category: article.category === "Network" || article.category === "Hardware" || article.category === "Software" || article.category === "Access/Account" ? article.category : "Other", title: `Help needed: ${article.title}` }); setFormOpen(true); }} className="h-9 px-3 rounded-md border text-sm inline-flex items-center gap-2 hover:bg-muted">
                            <Ticket className="h-4 w-4" /> Still need help? Raise a ticket
                          </button>
                        )}
                        {canManageKnowledge && <>
                          <button type="button" onClick={() => { setKnowledgeForm({ id: article.id, title: article.title, category: article.category, summary: article.summary, tags: article.tags ?? "", stepsText: article.steps.join("\n") }); setKnowledgeFormOpen(true); }} className="h-9 px-3 rounded-md border text-sm inline-flex items-center gap-2 hover:bg-muted"><Pencil className="h-4 w-4" /> Edit guide</button>
                          <button type="button" onClick={async () => { if (!confirm(`Delete the guide “${article.title}”? This cannot be undone.`)) return; const { error } = await (supabase.from("ict_knowledge_articles" as any) as any).delete().eq("id", article.id); if (error) { toast.error(error.message); return; } setKnowledgeArticles((prev) => prev.filter((item) => item.id !== article.id)); if (expandedArticle === article.id) setExpandedArticle(null); toast.success("Knowledge guide deleted"); }} className="h-9 px-3 rounded-md border border-destructive/40 text-destructive text-sm inline-flex items-center gap-2 hover:bg-destructive/5"><Trash2 className="h-4 w-4" /> Delete</button>
                        </>}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
            {filteredKnowledgeArticles.length === 0 && <div className="md:col-span-2 rounded-lg border border-dashed p-8 text-center"><BookOpen className="h-6 w-6 mx-auto text-muted-foreground" /><p className="mt-2 text-sm font-medium">No matching guides</p><p className="text-xs text-muted-foreground mt-1">Try another search term or choose All topics.</p></div>}
          </div>
          <p className="text-xs text-muted-foreground">For suspected account compromise, malware or a security incident, contact ICT immediately. Never share passwords or verification codes in a ticket.</p>
        </div>
      </section>

      {knowledgeFormOpen && canManageKnowledge && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="knowledge-form-title">
          <form onSubmit={async (e) => {
            e.preventDefault();
            const steps = knowledgeForm.stepsText.split("\n").map((step) => step.trim()).filter(Boolean);
            if (!knowledgeForm.title.trim() || !knowledgeForm.summary.trim() || steps.length === 0) { toast.error("Enter a title, summary and at least one troubleshooting step."); return; }
            setKnowledgeSaving(true);
            const payload = { title: knowledgeForm.title.trim(), category: knowledgeForm.category, summary: knowledgeForm.summary.trim(), tags: knowledgeForm.tags.trim(), steps, active: true, updated_at: new Date().toISOString(), ...(user ? { updated_by: user.id } : {}) };
            const query = knowledgeForm.id
              ? await (supabase.from("ict_knowledge_articles" as any) as any).update(payload).eq("id", knowledgeForm.id)
              : await (supabase.from("ict_knowledge_articles" as any) as any).insert({ ...payload, slug: `guide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, created_by: user?.id ?? null });
            setKnowledgeSaving(false);
            if (query.error) { toast.error(query.error.message); return; }
            toast.success(knowledgeForm.id ? "Knowledge guide updated" : "Knowledge guide added");
            setKnowledgeFormOpen(false); setKnowledgeForm(EMPTY_KNOWLEDGE_FORM); await loadKnowledgeArticles();
          }} className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border bg-card p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between gap-3"><h2 id="knowledge-form-title" className="text-lg font-semibold">{knowledgeForm.id ? "Edit knowledge guide" : "Add knowledge guide"}</h2><button type="button" onClick={() => setKnowledgeFormOpen(false)} className="p-2 rounded-md hover:bg-muted" aria-label="Close guide editor"><X className="h-4 w-4" /></button></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm space-y-1 sm:col-span-2">Guide title<input required maxLength={160} value={knowledgeForm.title} onChange={(e) => setKnowledgeForm((f) => ({ ...f, title: e.target.value }))} className="w-full h-10 px-3 rounded-md border bg-background" placeholder="e.g. How to connect to the office printer" /></label>
              <label className="text-sm space-y-1">Category<select value={knowledgeForm.category} onChange={(e) => setKnowledgeForm((f) => ({ ...f, category: e.target.value }))} className="w-full h-10 px-3 rounded-md border bg-background">{KNOWLEDGE_EDIT_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
              <label className="text-sm space-y-1">Search tags<input value={knowledgeForm.tags} onChange={(e) => setKnowledgeForm((f) => ({ ...f, tags: e.target.value }))} className="w-full h-10 px-3 rounded-md border bg-background" placeholder="printer, queue, paper" /></label>
              <label className="text-sm space-y-1 sm:col-span-2">Short summary<textarea required maxLength={400} rows={2} value={knowledgeForm.summary} onChange={(e) => setKnowledgeForm((f) => ({ ...f, summary: e.target.value }))} className="w-full px-3 py-2 rounded-md border bg-background" placeholder="What this guide helps the user solve" /></label>
              <label className="text-sm space-y-1 sm:col-span-2">Troubleshooting steps <span className="text-muted-foreground">(one step per line)</span><textarea required rows={8} value={knowledgeForm.stepsText} onChange={(e) => setKnowledgeForm((f) => ({ ...f, stepsText: e.target.value }))} className="w-full px-3 py-2 rounded-md border bg-background" placeholder={'1. Check the connection.\n2. Restart the approved application.\n3. Raise a ticket if it persists.'} /></label>
            </div>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setKnowledgeFormOpen(false)} className="h-9 px-4 rounded-md border text-sm">Cancel</button><button disabled={knowledgeSaving} type="submit" className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50">{knowledgeSaving ? "Saving…" : knowledgeForm.id ? "Save changes" : "Add guide"}</button></div>
          </form>
        </div>
      )}

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">{canManageTickets ? "All tickets" : "Your tickets"}</span>
          {templates.length > 0 && (
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-8 px-2 rounded-md border bg-background text-xs">
              <option value="">All request types</option>
              {templates.map((t) => <option key={t.service_type} value={t.service_type}>{t.title}</option>)}
            </select>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
              <tr>
                {templates.length > 0 && <th className="w-8"></th>}
                <th className="py-2 px-3">Ticket</th>
                {templates.length > 0 && <th>Type</th>}
                <th>Category</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>Raised</th>
                {fullAccess && <th></th>}
              </tr>
            </thead>
            <tbody>
              {!loading && tickets.length === 0 && (
                <tr><td colSpan={(fullAccess ? 7 : 6) + (templates.length > 0 ? 2 : 0)} className="py-10 text-center text-muted-foreground">{tickets.length === 0 ? "No tickets yet." : "No tickets of this type."}</td></tr>
              )}
              {visibleTickets.map((t) => {
                const cs = controlsByTicket.get(t.id) ?? [];
                const pr = progressOf(cs);
                const isOpen = expanded.has(t.id);
                const colCount = (fullAccess ? 7 : 6) + 2;
                return (
                <Fragment key={t.id}>
                <tr className="border-b last:border-0 hover:bg-muted/30">
                  {templates.length > 0 && (
                    <td className="pl-2">
                      <button onClick={() => toggleExpanded(t.id)} title={isOpen ? "Hide checklist" : "Show checklist"} className="p-1 text-muted-foreground hover:text-primary">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                  )}
                  <td className="py-2 px-3">
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-muted-foreground">{t.ticket_number}</div>
                  </td>
                  {templates.length > 0 && (
                    <td className="text-xs">
                      <div>{typeTitle(t.service_type)}</div>
                      {pr.total > 0 && (
                        <button onClick={() => toggleExpanded(t.id)} className="mt-0.5 inline-flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground hover:text-primary">
                          <span className="font-medium">{pr.complete}/{pr.total} steps</span>
                          {pr.blocked > 0 && <span className="px-1 rounded bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">{pr.blocked} blocked</span>}
                          {pr.awaiting > 0 && <span className="px-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{pr.awaiting} to verify</span>}
                          {pr.overdue > 0 && <span className="px-1 rounded bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">{pr.overdue} overdue</span>}
                        </button>
                      )}
                    </td>
                  )}
                  <td className="text-xs text-muted-foreground">{t.category ?? "—"}</td>
                  <td><span className={`text-xs px-2 py-0.5 rounded ${PRIORITY_COLORS[t.priority ?? ""] ?? "bg-muted text-muted-foreground"}`}>{t.priority ?? "—"}</span></td>
                  <td>
                    {canManageTickets ? (
                      <select
                        value={t.status}
                        onChange={(e) => updateTicket(t.id, { status: e.target.value })}
                        className={`h-7 px-2 rounded text-xs border bg-background ${STATUS_COLORS[t.status] ?? ""}`}
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[t.status] ?? "bg-muted text-muted-foreground"}`}>{t.status}</span>
                    )}
                  </td>
                  <td>
                    {canManageTickets ? (
                      <select
                        value={t.assigned_to ?? ""}
                        onChange={(e) => updateTicket(t.id, { assigned_to: e.target.value || null })}
                        className="h-7 px-2 rounded text-xs border bg-background"
                      >
                        <option value="">Unassigned</option>
                        {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? "Unnamed"}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs">{allStaff.find((p) => p.id === t.assigned_to)?.full_name ?? "Unassigned"}</span>
                    )}
                  </td>
                  <td className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  {fullAccess && (
                    <td className="pr-2 text-right">
                      <button onClick={() => deleteTicket(t.id)} title="Delete" className="p-1 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                  )}
                </tr>
                {templates.length > 0 && isOpen && (
                  <tr className="border-b last:border-0">
                    <td colSpan={colCount} className="p-0">
                      <ChecklistPanel
                        ticket={t}
                        controls={cs}
                        templates={templates}
                        canWork={canManageTickets}
                        isFull={fullAccess}
                        userId={user?.id}
                        ictStaff={staff}
                        nameOf={nameOf}
                        onChanged={load}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {fullAccess && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <span className="text-sm font-medium">IT Assets</span>
            <button
              onClick={openNewAsset}
              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs inline-flex items-center gap-1.5 transition-transform active:scale-95"
            >
              <Plus className="h-3.5 w-3.5" /> Add asset
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
                <tr>
                  <th className="py-2 px-3">Item</th>
                  <th>Qty</th>
                  <th>Unit cost</th>
                  <th>Total</th>
                  <th>Date bought</th>
                  <th>Assigned to</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {assets.length === 0 && (
                  <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">No assets recorded yet.</td></tr>
                )}
                {assets.map((a) => {
                  const assignee = allStaff.find((s) => s.id === a.assigned_to);
                  const total = a.unit_cost != null ? a.unit_cost * a.quantity : null;
                  return (
                    <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 px-3">
                        <div className="font-medium">{a.name}</div>
                        {a.description && <div className="text-xs text-muted-foreground">{a.description}</div>}
                      </td>
                      <td className="text-xs">{a.quantity}</td>
                      <td className="text-xs">{a.unit_cost != null ? a.unit_cost.toLocaleString("en-KE", { style: "currency", currency: "KES" }) : "—"}</td>
                      <td className="text-xs">{total != null ? total.toLocaleString("en-KE", { style: "currency", currency: "KES" }) : "—"}</td>
                      <td className="text-xs text-muted-foreground">{a.purchase_date ? new Date(a.purchase_date).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</td>
                      <td className="text-xs">{assignee?.full_name ?? "Office (shared)"}</td>
                      <td className="pr-2 text-right space-x-1 whitespace-nowrap">
                        <button onClick={() => openEditAsset(a)} title="Edit" className="p-1 hover:text-primary"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => deleteAsset(a.id)} title="Delete" className="p-1 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setFormOpen(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={submitTicket} className="bg-card w-full max-w-md rounded-lg p-6 space-y-3 animate-scale-in">
            <div className="flex justify-between">
              <h2 className="text-lg font-semibold">Raise a ticket</h2>
              <button type="button" onClick={() => setFormOpen(false)}><X className="h-4 w-4" /></button>
            </div>
            <input
              required
              placeholder="Title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full h-9 px-3 rounded-md border bg-background text-sm"
            />
            <textarea
              placeholder="Describe the issue"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
            />
            {templates.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground">What kind of request is this?</label>
                <select
                  value={form.service_type}
                  onChange={(e) => setForm({ ...form, service_type: e.target.value })}
                  className="w-full h-9 px-3 rounded-md border bg-background text-sm mt-1"
                >
                  {templates.map((t) => <option key={t.service_type} value={t.service_type}>{t.title}</option>)}
                </select>
                {selectedTemplate?.description && <p className="text-xs text-muted-foreground mt-1">{selectedTemplate.description}</p>}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="h-9 px-3 rounded-md border bg-background text-sm">
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="h-9 px-3 rounded-md border bg-background text-sm">
                {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Assign to (ICT)</label>
              <select
                value={form.assigned_to}
                onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
                className="w-full h-9 px-3 rounded-md border bg-background text-sm mt-1"
              >
                <option value="">Any ICT team member</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? "Unnamed"}</option>)}
              </select>
            </div>
            <button disabled={saving} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 transition-transform active:scale-[0.98]">
              {saving ? "Submitting…" : "Submit ticket"}
            </button>
          </form>
        </div>
      )}

      {assetFormOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setAssetFormOpen(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={saveAsset} className="bg-card w-full max-w-md rounded-lg p-6 space-y-3 animate-scale-in">
            <div className="flex justify-between">
              <h2 className="text-lg font-semibold">{assetForm.id ? "Edit asset" : "Add asset"}</h2>
              <button type="button" onClick={() => setAssetFormOpen(false)}><X className="h-4 w-4" /></button>
            </div>
            <input
              required
              placeholder="Item name (e.g. Dell Latitude laptop, HP LaserJet printer)"
              value={assetForm.name}
              onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })}
              className="w-full h-9 px-3 rounded-md border bg-background text-sm"
            />
            <textarea
              placeholder="Description"
              value={assetForm.description}
              onChange={(e) => setAssetForm({ ...assetForm, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number" min={1} required
                placeholder="Quantity"
                value={assetForm.quantity}
                onChange={(e) => setAssetForm({ ...assetForm, quantity: e.target.value })}
                className="h-9 px-3 rounded-md border bg-background text-sm"
              />
              <input
                type="number" min={0} step="0.01"
                placeholder="Unit cost (KES)"
                value={assetForm.unit_cost}
                onChange={(e) => setAssetForm({ ...assetForm, unit_cost: e.target.value })}
                className="h-9 px-3 rounded-md border bg-background text-sm"
              />
              <input
                type="date"
                value={assetForm.purchase_date}
                onChange={(e) => setAssetForm({ ...assetForm, purchase_date: e.target.value })}
                className="h-9 px-3 rounded-md border bg-background text-sm"
              />
              <select
                value={assetForm.assigned_to}
                onChange={(e) => setAssetForm({ ...assetForm, assigned_to: e.target.value })}
                className="h-9 px-3 rounded-md border bg-background text-sm"
              >
                <option value="">Office (shared)</option>
                {allStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? "Unnamed"}</option>)}
              </select>
            </div>
            <button disabled={assetSaving} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 transition-transform active:scale-[0.98]">
              {assetSaving ? "Saving…" : assetForm.id ? "Save changes" : "Add asset"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

