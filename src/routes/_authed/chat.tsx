import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import {
  Hash, Users2, Plus, Send, Paperclip, X, Loader2, MessageSquare, Trash2,
} from "lucide-react";

export const Route = createFileRoute("/_authed/chat")({
  component: ChatPage,
  validateSearch: (s: Record<string, unknown>) => ({ channel: (s.channel as string) || undefined }),
});

type Channel = {
  id: string;
  kind: "team" | "dm" | "group";
  name: string | null;
  created_by: string | null;
  created_at: string;
};

type Message = {
  id: string;
  channel_id: string;
  sender_id: string;
  body: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  created_at: string;
};

type Profile = { id: string; full_name: string | null; avatar_url: string | null };

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

function ChatPage() {
  const { user } = useAuth();
  const search = useSearch({ from: "/_authed/chat" });

  const [channels, setChannels] = useState<Channel[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [profileById, setProfileById] = useState<Record<string, Profile>>({});
  const [activeId, setActiveId] = useState<string | null>(search.channel ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [unreadChannelIds, setUnreadChannelIds] = useState<Set<string>>(new Set());
  const [dmOtherUserId, setDmOtherUserId] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  // ---- load sidebar data --------------------------------------------------
  async function loadChannels() {
    const [chRes, memRes] = await Promise.all([
      supabase.from("chat_channels").select("*").order("created_at"),
      user
        ? supabase.from("chat_channel_members").select("channel_id").eq("user_id", user.id)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    // DMs/groups are private: show only team chat and channels I'm a member
    // of. (The DB policy enforces this too; this keeps the sidebar blank for
    // anyone who hasn't been messaged, even if a loose policy slips through.)
    const mine = new Set(((memRes.data as any[]) ?? []).map((m) => m.channel_id));
    const visible = ((chRes.data as Channel[]) ?? []).filter((c) => c.kind === "team" || mine.has(c.id));
    setChannels(visible);
  }
  async function loadDirectory() {
    const { data } = await supabase.from("profiles").select("id, full_name, avatar_url").order("full_name");
    const list = (data as Profile[]) ?? [];
    setStaff(list.filter((p) => p.id !== user?.id));
    setProfileById(Object.fromEntries(list.map((p) => [p.id, p])));
  }
  useEffect(() => { loadChannels(); loadDirectory(); }, [user?.id]);

  // ---- who's on the other side of each DM (so the sidebar can show a
  // real name instead of the generic "Direct message" label) -------------
  async function loadDmOtherUsers(dmIds: string[]) {
    if (!user || dmIds.length === 0) return;
    const { data } = await supabase
      .from("chat_channel_members")
      .select("channel_id, user_id")
      .in("channel_id", dmIds);
    const byChannel: Record<string, string> = {};
    (data ?? []).forEach((m: any) => {
      if (m.user_id !== user.id) byChannel[m.channel_id] = m.user_id;
    });
    setDmOtherUserId((prev) => ({ ...prev, ...byChannel }));
  }
  useEffect(() => {
    const dmIds = channels.filter((c) => c.kind === "dm").map((c) => c.id);
    if (dmIds.length) loadDmOtherUsers(dmIds);
  }, [channels, user?.id]);

  // ---- unread indicators (driven by the chat_message notifications the
  // db trigger already creates — no extra schema needed) -----------------
  async function loadUnread() {
    if (!user) return;
    const { data } = await supabase.from("notifications").select("link")
      .eq("user_id", user.id).eq("type", "chat_message").is("read_at", null);
    const ids = new Set<string>();
    (data ?? []).forEach((n: any) => {
      const m = n.link?.match(/channel=([0-9a-f-]+)/i);
      if (m) ids.add(m[1]);
    });
    setUnreadChannelIds(ids);
  }
  useEffect(() => { loadUnread(); }, [user?.id]);
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("chat-unread-list-" + user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, loadUnread)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  async function markChannelRead(channelId: string) {
    if (!user) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id).eq("type", "chat_message").is("read_at", null)
      .ilike("link", `%channel=${channelId}%`);
    setUnreadChannelIds((prev) => {
      if (!prev.has(channelId)) return prev;
      const next = new Set(prev);
      next.delete(channelId);
      return next;
    });
  }

  // pick a sensible default channel once loaded
  useEffect(() => {
    if (activeId || channels.length === 0) return;
    const team = channels.find((c) => c.kind === "team");
    setActiveId(team?.id ?? channels[0]?.id ?? null);
  }, [channels, activeId]);

  // ---- load + subscribe to messages for the active channel ---------------
  async function loadMessages(channelId: string) {
    const [msgRes, memRes, hideRes] = await Promise.all([
      supabase.from("chat_messages").select("*").eq("channel_id", channelId).order("created_at"),
      user
        ? supabase.from("chat_channel_members").select("cleared_at").eq("channel_id", channelId).eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null as any }),
      user
        ? supabase.from("chat_message_hides").select("message_id").eq("user_id", user.id)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    // Personal view only: hide what I cleared or deleted for myself.
    const clearedAt = (memRes.data as any)?.cleared_at as string | null | undefined;
    const hidden = new Set(((hideRes.data as any[]) ?? []).map((h) => h.message_id));
    const visible = ((msgRes.data as Message[]) ?? []).filter(
      (m) => !hidden.has(m.id) && (!clearedAt || m.created_at > clearedAt),
    );
    setMessages(visible);
  }

  async function deleteMessageForMe(id: string) {
    if (!confirm("Delete this message for you? The other person will still see it.")) return;
    const { error } = await supabase.rpc("hide_chat_message_for_me", { _message_id: id });
    if (error) { toast.error(error.message); return; }
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  async function clearChatForMe() {
    if (!activeId) return;
    if (!confirm("Clear this chat for you? The other person will still see the messages.")) return;
    const { error } = await supabase.rpc("clear_chat_for_me", { _channel_id: activeId });
    if (error) { toast.error(error.message); return; }
    setMessages([]);
    toast.success("Chat cleared");
  }

  useEffect(() => {
    if (!activeId) return;
    loadMessages(activeId);
    const ch = supabase
      .channel(`chat-${activeId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `channel_id=eq.${activeId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as Message]))
      .subscribe();
    // mark read
    if (user) {
      supabase.from("chat_channel_members").upsert(
        { channel_id: activeId, user_id: user.id, last_read_at: new Date().toISOString() },
        { onConflict: "channel_id,user_id" },
      );
      markChannelRead(activeId);
    }
    return () => { supabase.removeChannel(ch); };
  }, [activeId, user?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const active = useMemo(() => channels.find((c) => c.id === activeId) ?? null, [channels, activeId]);

  function channelLabel(c: Channel) {
    if (c.kind === "team") return "Team Chat";
    if (c.kind === "dm") {
      const otherId = dmOtherUserId[c.id];
      const name = otherId ? profileById[otherId]?.full_name : null;
      return name ?? c.name ?? "Direct message";
    }
    return c.name ?? "Group chat";
  }
  function channelIcon(c: Channel) {
    if (c.kind === "team") return <Hash className="h-4 w-4" />;
    return <Users2 className="h-4 w-4" />;
  }

  const teamChannel = channels.find((c) => c.kind === "team");
  const dmChannels = channels.filter((c) => c.kind === "dm" || c.kind === "group");

  // ---- actions -------------------------------------------------------------
  async function openOrCreateDm(otherUserId: string) {
    const { data: channelId, error } = await supabase.rpc("get_or_create_dm", { _other_user_id: otherUserId });
    if (error) { toast.error(error.message); return; }
    await loadChannels();
    setActiveId(channelId as string);
    setPickerOpen(false);
  }

  async function send() {
    if (!activeId || (!body.trim() && !file) || sending) return;
    setSending(true);
    try {
      let attachment_path: string | null = null;
      let attachment_name: string | null = null;
      if (file) {
        const path = `${activeId}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage.from("chat-attachments").upload(path, file);
        if (upErr) { toast.error(upErr.message); setSending(false); return; }
        attachment_path = path;
        attachment_name = file.name;
      }
      const { error } = await supabase.from("chat_messages").insert({
        channel_id: activeId, sender_id: user!.id,
        body: body.trim() || null, attachment_path, attachment_name,
      });
      if (error) { toast.error(error.message); return; }
      setBody(""); setFile(null);
    } finally {
      setSending(false);
    }
  }

  async function downloadAttachment(path: string) {
    const { data, error } = await supabase.storage.from("chat-attachments").createSignedUrl(path, 300);
    if (error) { toast.error(error.message); return; }
    window.open(data.signedUrl, "_blank");
  }

  return (
    <div className="flex h-[calc(100vh-2rem)] -m-6 lg:-m-8">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r bg-card flex flex-col">
        <div className="p-4 border-b flex items-center gap-2 font-semibold text-sm">
          <MessageSquare className="h-4 w-4" /> Chat
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {teamChannel && (
            <SidebarItem active={activeId === teamChannel.id} onClick={() => setActiveId(teamChannel.id)} icon={<Hash className="h-4 w-4" />} label="Team Chat" unread={unreadChannelIds.has(teamChannel.id)} />
          )}

          <SidebarSection label="Direct messages" onAdd={() => setPickerOpen(true)} unread={dmChannels.some((c) => unreadChannelIds.has(c.id))} />
          {dmChannels.map((c) => (
            <SidebarItem key={c.id} active={activeId === c.id} onClick={() => setActiveId(c.id)} icon={<Users2 className="h-4 w-4" />} label={channelLabel(c)} unread={unreadChannelIds.has(c.id)} />
          ))}
          {dmChannels.length === 0 && <div className="px-4 py-1 text-xs text-muted-foreground">No conversations yet</div>}
        </div>
      </aside>

      {/* Main pane */}
      <div className="flex-1 flex flex-col min-w-0">
        {active ? (
          <>
            <div className="h-14 border-b flex items-center gap-2 px-4 font-medium">
              {channelIcon(active)} {channelLabel(active)}
              <button onClick={clearChatForMe} className="ml-auto text-xs font-normal text-muted-foreground hover:text-destructive inline-flex items-center gap-1">
                <Trash2 className="h-3.5 w-3.5" /> Clear chat
              </button>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((m) => {
                const mine = m.sender_id === user?.id;
                const p = profileById[m.sender_id];
                return (
                  <div key={m.id} className={`group flex items-start gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                    {mine && (
                      <button onClick={() => deleteMessageForMe(m.id)} title="Delete for me" className="mt-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {!mine && (
                      <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                        {initials(p?.full_name)}
                      </div>
                    )}
                    <div className={`max-w-md rounded-lg px-3 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      {!mine && <div className="text-xs font-semibold mb-0.5 opacity-70">{p?.full_name ?? "Unknown"}</div>}
                      {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                      {m.attachment_path && (
                        <button onClick={() => downloadAttachment(m.attachment_path!)} className="mt-1 flex items-center gap-1 text-xs underline underline-offset-2">
                          <Paperclip className="h-3 w-3" /> {m.attachment_name ?? "Attachment"}
                        </button>
                      )}
                      <div className={`text-[10px] mt-1 ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {new Date(m.created_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    {!mine && (
                      <button onClick={() => deleteMessageForMe(m.id)} title="Delete for me" className="mt-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
              {messages.length === 0 && <div className="text-center text-sm text-muted-foreground pt-10">No messages yet — say hello.</div>}
            </div>
            <div className="border-t p-3">
              {file && (
                <div className="mb-2 flex items-center gap-2 text-xs bg-muted rounded px-2 py-1 w-fit">
                  <Paperclip className="h-3 w-3" /> {file.name}
                  <button onClick={() => setFile(null)}><X className="h-3 w-3" /></button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <label className="p-2 rounded-md hover:bg-muted cursor-pointer">
                  <Paperclip className="h-4 w-4" />
                  <input type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
                <input
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Message…"
                  className="flex-1 border rounded-md px-3 py-2 text-sm bg-background"
                />
                <button onClick={send} disabled={sending || (!body.trim() && !file)} className="p-2 rounded-md bg-primary text-primary-foreground disabled:opacity-50">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Select a channel to start chatting</div>
        )}
      </div>

      {/* DM picker */}
      {pickerOpen && (
        <Picker title="Message a colleague" onClose={() => setPickerOpen(false)}>
          {staff.map((p) => (
            <button key={p.id} onClick={() => openOrCreateDm(p.id)} className="w-full text-left px-3 py-2 rounded-md hover:bg-muted text-sm flex items-center gap-2">
              <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-semibold">{initials(p.full_name)}</div>
              {p.full_name ?? "Unnamed"}
            </button>
          ))}
        </Picker>
      )}
    </div>
  );
}

function SidebarItem({ active, onClick, icon, label, unread }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; unread?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left ${
        active
          ? "bg-primary/10 text-primary font-medium"
          : unread
            ? "bg-accent/10 text-foreground font-semibold hover:bg-accent/15"
            : "hover:bg-muted text-foreground/90"
      }`}
    >
      {icon} <span className="truncate flex-1">{label}</span>
      {unread && <span className="h-2 w-2 rounded-full bg-accent shrink-0" />}
    </button>
  );
}

function SidebarSection({ label, onAdd, unread }: { label: string; onAdd: () => void; unread?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-1">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        {unread && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
      </span>
      <button onClick={onAdd} className="p-0.5 rounded hover:bg-muted"><Plus className="h-3.5 w-3.5 text-muted-foreground" /></button>
    </div>
  );
}

function Picker({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border rounded-lg shadow-lg w-full max-w-sm max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b">
          <div className="font-semibold text-sm">{title}</div>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="p-2 space-y-0.5">{children}</div>
      </div>
    </div>
  );
}
