import { ShieldCheck, Droplets } from "lucide-react";

export function MizanFooter() {
  return (
    <footer className="border-t border-border bg-card/40 mt-auto">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="grid h-8 w-8 place-items-center rounded-lg brand-gradient text-white">
            <Droplets className="h-4 w-4" />
          </div>
          <span>
            <span className="font-bold text-foreground">ميزان</span> — منصة حوكمة المياه وبناء السلام
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-brand-500" />
          <span dir="rtl">
            جميع الحقوق محفوظة © 2026 لـ انديكيتورز للإستشارات | Indicatorz Consulting
          </span>
        </div>
      </div>
    </footer>
  );
}
