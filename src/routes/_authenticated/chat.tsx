import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [{ title: "المساعد الذكي — ميزان" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: r } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
    const ok = r?.some((x) => ["super_admin", "project_manager", "central_admin"].includes(x.role));
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: ChatPage,
});

interface UiOption { id: string; label: string; hint?: string }
interface UiPayload { kind: "choice" | "filters"; question: string; options: UiOption[] }
interface Message {
  role: "user" | "assistant";
  content: string;
  ui?: UiPayload | null;
}

const SUGGESTIONS = [
  "من هم المشتركون الذين لم يدفعوا هذا الشهر؟",
  "ما هو مؤشر الحوكمة لمشروعي؟",
  "كم إجمالي الإيرادات المحصّلة؟",
];

function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message || data.error || "فشل الطلب");
        setMessages((m) => [...m, { role: "assistant", content: data.message || data.error || "حدث خطأ." }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: data.text ?? "", ui: data.ui ?? null }]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل الاتصال");
    } finally {
      setBusy(false);
    }
  };

  const pickOption = (opt: UiOption) => send(opt.label);

  return (
    <div className="flex h-[calc(100vh-180px)] flex-col gap-4">
      <div className="glass rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl brand-gradient text-white">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold">المساعد الذكي</h1>
            <p className="text-xs text-muted-foreground">مقيّد بمشروعك — لا تُشارك البيانات عبر المشاريع.</p>
          </div>
        </div>
      </div>

      <div ref={scroller} className="glass flex-1 overflow-y-auto rounded-2xl p-4">
        {messages.length === 0 && (
          <div className="grid h-full place-items-center">
            <div className="text-center">
              <p className="mb-3 text-sm text-muted-foreground">ابدأ باقتراح:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)}
                    className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                m.role === "user" ? "brand-gradient text-white" : "bg-muted"
              }`}>
                {m.content && <div className="whitespace-pre-wrap">{m.content}</div>}
                {m.ui && (
                  <div className="mt-3 space-y-1.5">
                    {m.ui.options.map((o) => (
                      <button key={o.id} onClick={() => pickOption(o)}
                        className="block w-full rounded-lg border border-border bg-card px-3 py-2 text-right text-xs font-semibold text-foreground hover:bg-brand-50">
                        {o.label}
                        {o.hint && <span className="mr-2 text-[10px] font-normal text-muted-foreground">— {o.hint}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-muted px-4 py-2.5 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="glass flex items-center gap-2 rounded-2xl p-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="اكتب سؤالك…"
          className="flex-1 bg-transparent px-3 py-2 text-sm outline-none"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl brand-gradient px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          <Send className="h-4 w-4" /> إرسال
        </button>
      </form>
    </div>
  );
}
