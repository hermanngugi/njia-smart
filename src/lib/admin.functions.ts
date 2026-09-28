import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ROLES = [
  "director","admin","audit_manager","tax_consultant",
  "advisory_officer","accountant","accounts_assistant","intern",
  "marketing","tax_assistant","audit_assistant","internal_admin",
] as const;

export const createStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      email: z.string().email().max(255),
      password: z.string().min(8).max(72),
      full_name: z.string().min(1).max(120),
      department: z.string().max(120).optional().nullable(),
      phone: z.string().max(40).optional().nullable(),
      role: z.enum(ROLES),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    // Verify caller is admin/director
    const { data: callerRoles } = await context.supabase
      .from("user_roles").select("role").eq("user_id", context.userId);
    const isAdmin = (callerRoles ?? []).some((r: any) => r.role === "admin" || r.role === "director");
    if (!isAdmin) throw new Error("Only Directors or Admins can create staff");

    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (created.error || !created.data.user) throw new Error(created.error?.message || "Failed to create user");
    const uid = created.data.user.id;

    // Profile may have been auto-created by trigger; upsert extra fields
    await supabaseAdmin.from("profiles").upsert({
      id: uid,
      full_name: data.full_name,
      department: data.department ?? null,
      phone: data.phone ?? null,
    });

    // The signup trigger gives every new user a default staff role; replace
    // it with the role chosen here so they end up with exactly that one.
    await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
    await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: data.role as any });
    return { ok: true, user_id: uid };
  });

export const getStaffMember = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ user_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles").select("*").eq("id", data.user_id).maybeSingle();
    const { data: roles } = await context.supabase
      .from("user_roles").select("role").eq("user_id", data.user_id);
    const u = await supabaseAdmin.auth.admin.getUserById(data.user_id);
    const banned_until = (u.data.user as any)?.banned_until ?? null;
    const is_paused = !!(banned_until && new Date(banned_until) > new Date());
    return {
      profile,
      roles: (roles ?? []).map((r: any) => r.role as string),
      email: u.data.user?.email ?? null,
      is_paused,
      banned_until,
    };
  });

async function assertAdmin(context: any) {
  const { data: callerRoles } = await context.supabase
    .from("user_roles").select("role").eq("user_id", context.userId);
  const isAdmin = (callerRoles ?? []).some((r: any) => r.role === "admin" || r.role === "director");
  if (!isAdmin) throw new Error("Only Directors or Admins can perform this action");
}

export const adminUpdateStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      user_id: z.string().uuid(),
      full_name: z.string().min(1).max(120).optional(),
      job_title: z.string().max(120).optional().nullable(),
      department: z.string().max(120).optional().nullable(),
      phone: z.string().max(40).optional().nullable(),
      email: z.string().email().max(255).optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { user_id, email, ...profileFields } = data;
    const cleaned: any = {};
    for (const [k, v] of Object.entries(profileFields)) if (v !== undefined) cleaned[k] = v;
    if (Object.keys(cleaned).length) {
      const { error } = await supabaseAdmin.from("profiles").update(cleaned).eq("id", user_id);
      if (error) throw new Error(error.message);
    }
    if (email) {
      const r = await supabaseAdmin.auth.admin.updateUserById(user_id, { email, email_confirm: true });
      if (r.error) throw new Error(r.error.message);
    }
    return { ok: true };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ user_id: z.string().uuid(), password: z.string().min(8).max(72) }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const r = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { password: data.password });
    if (r.error) throw new Error(r.error.message);
    return { ok: true };
  });

export const adminSetPaused = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ user_id: z.string().uuid(), paused: z.boolean() }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.user_id === context.userId) throw new Error("You cannot pause your own account");
    const r = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      ban_duration: data.paused ? "876000h" : "none",
    } as any);
    if (r.error) throw new Error(r.error.message);
    return { ok: true };
  });

export const adminDeleteStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ user_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.user_id === context.userId) throw new Error("You cannot delete your own account");
    const r = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (r.error) throw new Error(r.error.message);
    return { ok: true };
  });
