import { createFileRoute, Link } from "@tanstack/react-router";
import { Droplets, ShieldCheck, Waves, Users, BarChart3, LockKeyhole } from "lucide-react";
import { MizanFooter } from "@/components/MizanFooter";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl brand-gradient text-white shadow-lg">
              <Droplets className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg font-bold">ميزان</div>
              <div className="text-xs text-muted-foreground">Mizan Water Governance</div>
            </div>
          </div>
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-xl brand-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:opacity-95"
          >
            <LockKeyhole className="h-4 w-4" /> تسجيل الدخول
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 -z-10 brand-gradient opacity-10" />
          <div className="mx-auto grid max-w-[1400px] items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
                <ShieldCheck className="h-3.5 w-3.5" /> منصة حوكمة متعددة المستأجرين — Real-time
              </div>
              <h1 className="mt-4 text-4xl font-extrabold leading-tight sm:text-5xl">
                ميزان — نظام حوكمة المياه <br />
                <span className="bg-gradient-to-l from-brand-600 to-aqua-500 bg-clip-text text-transparent">
                  الشفاف واللحظي
                </span>
              </h1>
              <p className="mt-4 max-w-xl text-base text-muted-foreground">
                إدارة القراءات الميدانية، الفواتير، والذكاء الاصطناعي الحوكمي — بمزامنة فورية بين
                القارئين الميدانيين ومديري المشاريع، مع عزل صارم للبيانات على مستوى المشروع.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to="/auth"
                  className="rounded-xl brand-gradient px-6 py-3 text-sm font-bold text-white shadow-lg hover:opacity-95"
                >
                  ابدأ الآن
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: Waves, title: "مزامنة فورية", body: "WebSocket real-time" },
                { icon: Users, title: "متعدد المستأجرين", body: "Row-Level Security" },
                { icon: BarChart3, title: "ذكاء حوكمي", body: "AI-powered insights" },
                { icon: ShieldCheck, title: "إيصالات مؤمّنة", body: "Immutable & signed" },
              ].map((f) => (
                <div key={f.title} className="glass rounded-2xl p-5">
                  <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl brand-gradient text-white">
                    <f.icon className="h-5 w-5" />
                  </div>
                  <div className="font-bold">{f.title}</div>
                  <div className="text-xs text-muted-foreground">{f.body}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <MizanFooter />
    </div>
  );
}
