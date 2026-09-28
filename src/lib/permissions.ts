/**
 * Central RBAC config.
 *
 * Rules encoded here:
 * 1. Visibility follows rights: if a role has "none" on a module, it is not
 *    just blocked from acting on it, it should not be rendered/listed either.
 * 2. Ownership gates deletion: a user may only delete a record they created.
 *    Full-access roles can still USE/VIEW everything, but delete requires
 *    either ownership of the record or an admin override.
 * 3. "assigned" access means the user only sees/uses records assigned to
 *    them (not the whole module), on top of whatever "full" modules they have.
 *
 * This file is the single source of truth — UI nav, route guards, and
 * component-level checks should all read from here instead of hardcoding
 * role checks, so access rules stay consistent everywhere.
 */
import type { AppRole } from "@/lib/auth";

export type AccessLevel = "full" | "view" | "assigned" | "none";

export type ModuleKey =
  | "dashboard"
  | "clients"
  | "audit"
  | "tax"
  | "advisory"
  | "outsourced_accounting"
  | "payroll_management"
  | "financial_business_management"
  | "ict"
  | "ict_service_desk"
  | "tasks"
  | "accounts"
  | "documents"
  | "calendar"
  | "announcements"
  | "hr"
  | "team"
  | "activity"
  | "settings"
  | "notifications"
  | "chat";

// Rank used to resolve a user's effective access when they hold multiple
// roles: the highest-ranked level across all their roles wins.
const RANK: Record<AccessLevel, number> = { none: 0, assigned: 1, view: 2, full: 3 };

const ALL_MODULES: ModuleKey[] = [
  "dashboard", "clients", "audit", "tax", "advisory",
  "outsourced_accounting", "payroll_management", "financial_business_management",
  "ict", "ict_service_desk", "tasks", "accounts", "documents", "calendar", "announcements",
  "hr", "team", "activity", "settings", "notifications", "chat",
];

function levels(full: ModuleKey[] = [], view: ModuleKey[] = [], assigned: ModuleKey[] = []): Record<ModuleKey, AccessLevel> {
  const out = {} as Record<ModuleKey, AccessLevel>;
  for (const m of ALL_MODULES) out[m] = "none";
  for (const m of view) out[m] = "view";
  for (const m of assigned) out[m] = "assigned";
  for (const m of full) out[m] = "full"; // full overrides view/assigned if listed in both
  return out;
}

const EVERYONE_FULL: ModuleKey[] = ["announcements", "notifications", "chat"];

const ASSISTANT_FULL: ModuleKey[] = ["hr", "tasks", "settings", ...EVERYONE_FULL];
// Everything else for assistants/interns is "assigned": they only see what
// has been explicitly assigned to them.
const ASSISTANT_ASSIGNED: ModuleKey[] = ALL_MODULES.filter(
  (m) => m !== "dashboard" && !ASSISTANT_FULL.includes(m)
);

// role -> per-module access map
export const ROLE_ACCESS: Record<AppRole, Record<ModuleKey, AccessLevel>> = {
  // 1. Director / Admin — full access across board (ICT included; ICT is
  // administered automatically by this tier per policy).
  director: levels(ALL_MODULES),
  admin: levels(ALL_MODULES),

  // 2. Audit manager & Tax consultant
  audit_manager: levels(
    ["clients", "audit", "tax", "tasks", "documents", "calendar", "hr", "settings", ...EVERYONE_FULL],
    ["outsourced_accounting", "payroll_management", "financial_business_management", "advisory"]
  ),
  tax_consultant: levels(
    ["clients", "audit", "tax", "tasks", "documents", "calendar", "hr", "settings", ...EVERYONE_FULL],
    ["outsourced_accounting", "payroll_management", "financial_business_management", "advisory"]
  ),

  // 3. Advisory — view core modules, full on advisory-line-of-business modules
  advisory_officer: levels(
    ["advisory", "outsourced_accounting", "payroll_management", "financial_business_management", ...EVERYONE_FULL],
    ["clients", "audit", "tax", "tasks", "documents", "calendar", "hr", "settings"]
  ),

  // 4. Accountant — full across board except ICT (view only). Also the
  // primary leave approver (see LEAVE_APPROVAL below).
  accountant: levels(
    ALL_MODULES.filter((m) => m !== "ict"),
    ["ict"]
  ),

  // 5. Assistants & interns — assigned-only, plus full on the modules they
  // primarily operate in (HR, Tasks, Settings) and announcements.
  accounts_assistant: levels(ASSISTANT_FULL, [], ASSISTANT_ASSIGNED),
  tax_assistant: levels(ASSISTANT_FULL, [], ASSISTANT_ASSIGNED),
  audit_assistant: levels(ASSISTANT_FULL, [], ASSISTANT_ASSIGNED),
  intern: levels(ASSISTANT_FULL, [], ASSISTANT_ASSIGNED),

  // 7. Marketing — view only, narrow set of modules.
  marketing: levels(
    [...EVERYONE_FULL],
    ["clients", "documents", "tasks", "calendar", "settings", "advisory"]
  ),

  // 8. Internal admin — view only, narrower still.
  internal_admin: levels(
    [...EVERYONE_FULL],
    ["tasks", "calendar", "settings"]
  ),
};

// Dashboard is a landing surface, not a data module — always visible to any
// authenticated staff member.
for (const role of Object.keys(ROLE_ACCESS) as AppRole[]) {
  ROLE_ACCESS[role].dashboard = "full";
}

// Tasks are personal by default: only Director/Admin see every task across
// the org. Every other role — regardless of how much access they have
// elsewhere — only sees the tasks assigned to or created by them. This
// overrides whatever "full"/"view" the per-role tables above set for tasks.
for (const role of Object.keys(ROLE_ACCESS) as AppRole[]) {
  ROLE_ACCESS[role].tasks = role === "director" || role === "admin" ? "full" : "assigned";
}

// ICT Service Desk is a separate module from ICT (projects) and is open to
// everyone: every role can see the module and raise/see their own tickets
// ("assigned" — same "own records only" semantics tasks already use). Full
// oversight — every ticket, plus asset detail — is reserved for the Admin
// role ONLY. The Director gets no special access here (raises and sees their
// own tickets like any other staff member).
for (const role of Object.keys(ROLE_ACCESS) as AppRole[]) {
  ROLE_ACCESS[role].ict_service_desk = role === "admin" ? "full" : "assigned";
}

// Accounts (financial records) is restricted to Director, Admin and
// Accountant. Everyone else — including assistants/interns, who would
// otherwise inherit "assigned" access from ASSISTANT_ASSIGNED — gets none, so
// the sidebar entry is hidden for them.
const ACCOUNTS_ROLES: AppRole[] = ["director", "admin", "accountant"];
for (const role of Object.keys(ROLE_ACCESS) as AppRole[]) {
  ROLE_ACCESS[role].accounts = ACCOUNTS_ROLES.includes(role) ? "full" : "none";
}

// Activity & Team (staff management and the audit trail) is Admin only. The
// Director no longer gets these by virtue of "full access across the board".
for (const role of Object.keys(ROLE_ACCESS) as AppRole[]) {
  ROLE_ACCESS[role].team = role === "admin" ? "full" : "none";
  ROLE_ACCESS[role].activity = role === "admin" ? "full" : "none";
}

/** Highest access level a user has on a module, across all their roles. */
export function getModuleAccess(roles: AppRole[], moduleKey: ModuleKey): AccessLevel {
  let best: AccessLevel = "none";
  for (const role of roles) {
    const level = ROLE_ACCESS[role]?.[moduleKey] ?? "none";
    if (RANK[level] > RANK[best]) best = level;
  }
  return best;
}

/** Can the user see this module at all (nav, routes, listings)? */
export function canView(roles: AppRole[], moduleKey: ModuleKey): boolean {
  return getModuleAccess(roles, moduleKey) !== "none";
}

/** Can the user see/act on only records assigned to them (not the full module)? */
export function isAssignedOnly(roles: AppRole[], moduleKey: ModuleKey): boolean {
  return getModuleAccess(roles, moduleKey) === "assigned";
}

/** Can the user create new records in this module? */
export function canCreate(roles: AppRole[], moduleKey: ModuleKey): boolean {
  const level = getModuleAccess(roles, moduleKey);
  if (moduleKey === "tasks" || moduleKey === "ict_service_desk") return level === "full" || level === "assigned";
  return level === "full";
}

/** Can the user use/edit an existing record they have rights to view? */
export function canUse(roles: AppRole[], moduleKey: ModuleKey): boolean {
  const level = getModuleAccess(roles, moduleKey);
  return level === "full" || level === "assigned";
}

const ADMIN_OVERRIDE_ROLES: AppRole[] = ["director", "admin"];

/**
 * Can the user delete a specific record?
 * Rule: only the creator can delete what they created; director/admin can
 * always override. Everyone else may use/view but never delete another
 * person's record, even with "full" module access.
 */
export function canDelete(
  roles: AppRole[],
  moduleKey: ModuleKey,
  record: { createdBy?: string | null },
  currentUserId?: string | null
): boolean {
  if (roles.some((r) => ADMIN_OVERRIDE_ROLES.includes(r))) return true;
  if (!canUse(roles, moduleKey)) return false;
  if (!record.createdBy || !currentUserId) return false;
  return record.createdBy === currentUserId;
}

/**
 * HR managers can add/edit employee personal details, attach payslips and
 * other employee documents. Mirrors public.is_hr_manager() in the database —
 * keep the two in sync.
 */
export const HR_MANAGER_ROLES: AppRole[] = ["director", "admin", "accountant"];

export function isHrManager(roles: AppRole[]): boolean {
  return roles.some((r) => HR_MANAGER_ROLES.includes(r));
}

/** Accountant is the primary leave approver, assisted by the director. */
export const LEAVE_APPROVAL_ROLES: AppRole[] = ["accountant", "director"];

export function isLeaveApprover(roles: AppRole[]): boolean {
  return roles.some((r) => LEAVE_APPROVAL_ROLES.includes(r));
}

// Maps a sidebar route path to the module it's gated by.
export const NAV_MODULE_BY_PATH: Record<string, ModuleKey> = {
  "/dashboard": "dashboard",
  "/clients": "clients",
  "/audit": "audit",
  "/tax": "tax",
  "/advisory": "advisory",
  "/outsourced-accounting": "outsourced_accounting",
  "/payroll-management": "payroll_management",
  "/financial-business-management": "financial_business_management",
  "/ict": "ict",
  "/ict-service-desk": "ict_service_desk",
  "/tasks": "tasks",
  "/accounts": "accounts",
  "/documents": "documents",
  "/calendar": "calendar",
  "/announcements": "announcements",
  "/hr": "hr",
  "/team": "team",
  "/activity": "activity",
  "/settings": "settings",
  "/chat": "chat",
};
