import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { Droplets, LogOut, LayoutDashboard, Gauge, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MizanFooter } from "@/components/MizanFooter";
import { useAuthSession, useMizanRoles } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const navigate = useNavigate();
  const { user } = useAuthSession();
  const { profile, roles } = useMizanRoles(user?.id);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/70 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl brand-gradient text-white">
              <Droplets className="h-4 w-4" />
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-bold">ميزان</div>
              <div className="text-[10px] text-muted-foreground">
                {profile?.full_name || user?.email}
              </div>
            </div>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <NavLink to="/dashboard" icon={LayoutDashboard} label="اللوحة" />
            <NavLink to="/reader" icon={Gauge} label="القراءات" />
            <NavLink to="/collector" icon={Wallet} label="التحصيل" />
          </nav>
          <div className="flex items-center gap-2">
            <div className="hidden text-xs text-muted-foreground sm:block">
              {roles.length ? roles.join(" · ") : "لا توجد صلاحيات"}
            </div>
            <button
              onClick={signOut}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted"
            >
              <LogOut className="h-3.5 w-3.5" /> خروج
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
          <Outlet />
        </div>
      </main>
      <MizanFooter />
    </div>
  );
}

function NavLink({ to, icon: Icon, label }: { to: string; icon: typeof Droplets; label: string }) {
  return (
    <Link
      to={to}
      activeProps={{ className: "brand-gradient text-white" }}
      inactiveProps={{ className: "text-muted-foreground hover:text-foreground hover:bg-muted" }}
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition"
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </Link>
  );
}
