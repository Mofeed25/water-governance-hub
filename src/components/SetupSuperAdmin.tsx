import { useEffect, useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export function SetupSuperAdmin({ onDone }: { onDone: () => void }) {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.rpc("super_admin_exists").then(({ data }) => setAvailable(data === false));
  }, []);

  if (!available) return null;

  const claim = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("bootstrap_super_admin");
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (data === false) { toast.error("يوجد مشرف أعلى بالفعل"); setAvailable(false); return; }
    toast.success("تم تفعيل حسابك كمشرف أعلى");
    setAvailable(false);
    onDone();
  };

  return (
    <div className="glass rounded-2xl border border-amber-200 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl brand-gradient text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="font-bold">تهيئة النظام لأول مرة</div>
            <div className="text-xs text-muted-foreground">
              لا يوجد مشرف أعلى بعد. يمكنك تفعيل حسابك الحالي كمشرف أعلى لإدارة المشاريع والمستخدمين.
            </div>
          </div>
        </div>
        <button
          onClick={claim}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg brand-gradient px-4 py-2 text-sm font-bold text-white"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} تفعيل كمشرف أعلى
        </button>
      </div>
    </div>
  );
}
