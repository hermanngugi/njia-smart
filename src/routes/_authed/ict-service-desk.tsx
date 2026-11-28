import { createFileRoute, redirect } from "@tanstack/react-router";

// Old address, still used by existing notifications.
export const Route = createFileRoute("/_authed/ict-service-desk")({
  beforeLoad: () => { throw redirect({ to: "/ict" }); },
});
