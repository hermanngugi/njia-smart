import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { IctRequests } from "@/components/ict/ict-requests";
import { IctEquipment } from "@/components/ict/ict-equipment";
import { IctPasswordVault } from "@/components/ict/ict-password-vault";

export const Route = createFileRoute("/_authed/ict")({
  head: () => ({ meta: [{ title: "ICT | G.K Nahashon & Company" }, { name: "description", content: "IT requests, equipment and passwords." }] }),
  component: IctPage,
});

const TABS = [["requests", "Requests"], ["equipment", "Equipment"], ["passwords", "Passwords"]] as const;

function IctPage() {
  const { access } = useAuth();
  // Equipment and passwords stay with Director, Admin and ICT Officer (also enforced in the database).
  const manager = access("ict_service_desk") === "full";
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("requests");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">ICT</h1>
      {manager && (
        <div className="flex gap-1.5">
          {TABS.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`text-sm px-3 py-1.5 rounded-full border ${tab === k ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}>{label}</button>
          ))}
        </div>
      )}
      {tab === "requests" && <IctRequests />}
      {manager && tab === "equipment" && <IctEquipment />}
      {manager && tab === "passwords" && <IctPasswordVault />}
    </div>
  );
}
