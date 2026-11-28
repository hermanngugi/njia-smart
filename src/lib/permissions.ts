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
 *
 * Source of truth for the table below: new_njia-smart-role-permissions.xlsx.
 * The database mirrors this exactly in public.get_module_rank() — keep both
 * in sync whenever this file changes (see
 * supabase/migrations/20261002120000_update_role_module_matrix.sql).
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
  | "integrations"
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
  "ict", "ict_service_desk", "tasks", "accounts", "integrations", "documents", "calendar", "announcements",
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

// role -> per-module access map
export const ROLE_ACCESS: Record<AppRole, Record<ModuleKey, AccessLevel>> = {
  // 1. Director / Admin — full access across board.
  director: levels(ALL_MODULES),
  admin: levels(ALL_MODULES),

  // 2. ICT Officer — full on ICT (projects), ICT Service Desk, documents,
  // calendar, settings and activity; view on clients/audit/tax/advisory/the
  // other service lines/hr; no access to team.
  ict_officer: levels(
    ["ict", "documents", "calendar", "settings", "activity", ...EVERYONE_FULL],
    ["clients", "audit", "tax", "advisory", "outsourced_accounting", "payroll_management", "financial_business_management", "hr"]
  ),

  // 3. Audit manager & Tax consultant — full on audit/tax ops, view on
  // clients, the other service lines, advisory and hr.
  audit_manager: levels(
    ["audit", "tax", "documents", "calendar", "settings", ...EVERYONE_FULL],
    ["clients", "outsourced_accounting", "payroll_management", "financial_business_management", "advisory", "hr"]
  ),
  tax_consultant: levels(
    ["audit", "tax", "documents", "calendar", "settings", ...EVERYONE_FULL],
    ["clients", "outsourced_accounting", "payroll_management", "financial_business_management", "advisory", "hr"]
  ),

  // 4. Advisory — full only on advisory itself (+documents/calendar/
  // settings); view on clients/audit/tax/the other three service lines/hr.
  advisory_officer: levels(
    ["advisory", "documents", "calendar", "settings", ...EVERYONE_FULL],
    ["clients", "audit", "tax", "outsourced_accounting", "payroll_management", "financial_business_management", "hr"]
  ),

  // 5. Accountant — full on the three service lines it runs plus documents/
  // calendar/settings; view on clients/audit/tax/advisory/hr; no ICT access.
  accountant: levels(
    ["outsourced_accounting", "payroll_management", "financial_business_management", "documents", "calendar", "settings", ...EVERYONE_FULL],
    ["clients", "audit", "tax", "advisory", "hr"]
  ),

  // 6. Assistants & interns — full on calendar/settings (+announcements);
  // view on clients/audit/tax/documents/hr; nothing on the service lines,
  // advisory or ICT.
  accounts_assistant: levels(
    ["calendar", "settings", ...EVERYONE_FULL],
    ["clients", "audit", "tax", "documents", "hr"]
  ),
  tax_assistant: levels(
    ["calendar", "settings", ...EVERYONE_FULL],
    ["clients", "audit", "tax", "documents", "hr"]
  ),
  audit_assistant: levels(
    ["calendar", "settings", ...EVERYONE_FULL],
    ["clients", "audit", "tax", "documents", "hr"]
  ),
  intern: levels(
    ["calendar", "settings", ...EVERYONE_FULL],
    ["clients", "audit", "tax", "documents", "hr"]
  ),

  // 7. Marketing — full on calendar/settings; view on clients/documents/
  // advisory/hr.
  marketing: levels(
    ["calendar", "settings", ...EVERYONE_FULL],
    ["clients", "documents", "advisory", "hr"]
  ),

  // 8. Internal admin — full on calendar/settings; view on hr only.
  internal_admin: levels(
    ["calendar", "settings", ...EVERYONE_FULL],
    ["hr"]
  ),
};

// Integration access is limited to clients the user is assigned to.
// The database enforces action-level distinctions: Accountants can connect
// and synchronise; Audit Managers and Tax Consultants are view-only.
// Directors/Admins receive full access through ALL_MODULES above.
for (const role of ["accountant", "audit_manager", "tax_consultant"] as AppRole[]) {
  ROLE_ACCESS[role].integrations = "assigned";
}

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

// ICT Service Desk is a separate module from ICT (projects): Director, Admin
// and ICT Officer get full oversight (every ticket, asset detail, delete).
// Everyone else only raises/sees their own tickets ("assigned" — same "own
// records only" semantics Tasks already uses).
for (const role of Object.keys(ROLE_ACCESS) as AppRole[]) {
  ROLE_ACCESS[role].ict_service_desk =
    role === "admin" || role === "director" || role === "ict_officer" ? "full" : "assigned";
}

// Accounts (financial records): Director and Admin have full rights and see
// the whole book (balances, total collected, every invoice). Internal Admin
// has no access to this module at all. Every other role is "assigned": they
// only see the invoices raised on clients assigned to them, can record/
// update payments on those, and never see firm-wide totals.
// Enforced in the database by get_module_rank + the invoices/payments
// policies (migration 20261002090000_accounts_own_invoices_only.sql).
for (const role of Object.keys(ROLE_ACCESS) as AppRole[]) {
  ROLE_ACCESS[role].accounts =
    role === "director" || role === "admin" ? "full" : role === "internal_admin" ? "none" : "assigned";
}

// Team (staff management) — Director and Admin only.
for (const role of Object.keys(ROLE_ACCESS) as AppRole[]) {
  ROLE_ACCESS[role].team = role === "admin" || role === "director" ? "full" : "none";
}

// Activity (the audit trail) — Admin and ICT Officer only. Director is
// explicitly excluded here, unlike every other module.
for (const role of Object.keys(ROLE_ACCESS) as AppRole[]) {
  ROLE_ACCESS[role].activity = role === "admin" || role === "ict_officer" ? "full" : "none";
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
 * keep the two in sync. Accountant moved to HR "view-only" in the updated
 * matrix, so it's no longer an HR manager.
 */
export const HR_MANAGER_ROLES: AppRole[] = ["director", "admin"];

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
  "/ict": "ict_service_desk",
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
