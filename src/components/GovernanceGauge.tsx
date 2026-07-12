import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Breakdown {
  score: number;
  collection_efficiency: number;
  reading_coverage: number;
  billing_activity: number;
}

export function GovernanceGauge({ tenantId }: { tenantId: string | null }) {
  const [data, setData] = useState<Breakdown | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) { setData(null); return; }
    let alive = true;
    setLoading(true);
    supabase.rpc("governance_score", { _tenant_id: tenantId }).then(({ data, error }) => {
      if (!alive) return;
      setLoading(false);
      if (error) { console.error(error); return; }
      setData(data as unknown as Breakdown);
    });
    return () => { alive = false; };
  }, [tenantId]);

  if (!tenantId) return null;

  const score = Math.max(0, Math.min(100, Math.round(data?.score ?? 0)));
  const stroke = score >= 75 ? "#0ea5a4" : score >= 50 ? "#f59e0b" : "#ef4444";
  const dash = (score / 100) * 282.7; // 2πr, r=45

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-muted-foreground">مؤشر الحوكمة</div>
          <div className="text-[10px] text-muted-foreground">Governance Score (0-100)</div>
        </div>
        {loading && <span className="text-[10px] text-muted-foreground">…</span>}
      </div>
      <div className="mt-3 flex items-center gap-5">
        <svg viewBox="0 0 120 120" className="h-32 w-32 -rotate-90">
          <circle cx="60" cy="60" r="45" fill="none" stroke="hsl(var(--muted))" strokeWidth="12" />
          <circle
            cx="60" cy="60" r="45" fill="none"
            stroke={stroke}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${dash} 282.7`}
            style={{ transition: "stroke-dasharray .6s ease" }}
          />
        </svg>
        <div className="flex-1 space-y-1.5 text-xs">
          <MetricRow label="كفاءة التحصيل" value={data?.collection_efficiency ?? 0} />
          <MetricRow label="تغطية القراءات" value={data?.reading_coverage ?? 0} />
          <MetricRow label="نشاط الفوترة" value={data?.billing_activity ?? 0} />
          <div className="pt-2 text-3xl font-extrabold" style={{ color: stroke }}>
            {score}<span className="text-sm text-muted-foreground"> / 100</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-bold">{v}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full brand-gradient" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}
