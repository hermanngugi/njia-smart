import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type ReasonKind = "done" | "cancelled" | "takeover";

const TEXT: Record<ReasonKind, { title: string; placeholder: string; action: string }> = {
  done: { title: "Complete task", placeholder: "What was the outcome? e.g. Return filed, receipt saved under Files", action: "Mark done" },
  cancelled: { title: "Cancel task", placeholder: "Why is it being cancelled?", action: "Cancel task" },
  takeover: { title: "Take over task", placeholder: "Why are you taking it over? e.g. Owner is on leave", action: "Take over" },
};

/** One short, required explanation, kept in the task history. */
export function ReasonDialog({ kind, taskTitle, onConfirm, onCancel }: {
  kind: ReasonKind | null;
  taskTitle: string;
  onConfirm: (text: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(""); setBusy(false); }, [kind, taskTitle]);
  const t = TEXT[kind ?? "done"];
  return (
    <Dialog open={!!kind} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="z-[60]" onClick={(e) => e.stopPropagation()}>
        <DialogHeader><DialogTitle>{t.title}: {taskTitle}</DialogTitle></DialogHeader>
        <form onSubmit={async (e) => { e.preventDefault(); if (!text.trim() || busy) return; setBusy(true); await onConfirm(text.trim()); setBusy(false); }} className="space-y-3">
          <textarea required autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.placeholder} className="w-full px-3 py-2 rounded-md border bg-background text-sm" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>Back</Button>
            <Button type="submit" disabled={busy || !text.trim()}>{t.action}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
