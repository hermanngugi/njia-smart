import { createFileRoute, redirect } from "@tanstack/react-router";

// The per-type page was folded into the single Tax screen. Old links (dashboard,
// bookmarks) land on the same view, filtered to that tax type.
export const Route = createFileRoute("/_authed/tax/$type")({
  validateSearch: (s: Record<string, unknown>) => ({
    client: typeof s.client === "string" ? s.client : undefined,
    status: typeof s.status === "string" ? s.status : undefined,
  }),
  beforeLoad: ({ params, search }) => {
    const status = ["overdue", "in_progress"].includes(String(search.status)) ? (search.status as "overdue" | "in_progress") : undefined;
    throw redirect({ to: "/tax", search: { type: params.type, client: search.client, status }, replace: true });
  },
});
