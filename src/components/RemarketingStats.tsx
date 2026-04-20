import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CheckCircle2, XCircle, MessageCircle, Send, Loader2 } from "lucide-react";

interface CampaignStat {
  id: string;
  name: string;
  total: number;
  sent: number;
  delivered: number;
  failed: number;
  replied: number;
  pending: number;
}

export default function RemarketingStats() {
  const { user } = useAuth();
  const [stats, setStats] = useState<CampaignStat[]>([]);
  const [loading, setLoading] = useState(true);

  const loadStats = async () => {
    if (!user) return;
    const { data: campaigns } = await supabase
      .from("remarketing_campaigns" as any)
      .select("id, name")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (!campaigns) {
      setStats([]);
      setLoading(false);
      return;
    }

    const results: CampaignStat[] = [];
    for (const c of campaigns as any[]) {
      const { data: sends } = await supabase
        .from("remarketing_sends" as any)
        .select("status")
        .eq("campaign_id", c.id);

      const list = (sends as any[]) || [];
      results.push({
        id: c.id,
        name: c.name,
        total: list.length,
        sent: list.filter(s => s.status === "sent" || s.status === "delivered" || s.status === "replied").length,
        delivered: list.filter(s => s.status === "delivered" || s.status === "replied").length,
        failed: list.filter(s => s.status === "failed").length,
        replied: list.filter(s => s.status === "replied").length,
        pending: list.filter(s => s.status === "pending").length,
      });
    }
    setStats(results);
    setLoading(false);
  };

  useEffect(() => {
    loadStats();

    // Realtime: refresh on send updates
    const channel = supabase
      .channel("remarketing-sends-stats")
      .on("postgres_changes", { event: "*", schema: "public", table: "remarketing_sends" }, () => {
        loadStats();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Cargando estadísticas…
      </div>
    );
  }

  if (stats.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        Aún no hay envíos registrados. Las estadísticas aparecerán cuando se ejecuten campañas.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {stats.map((s) => {
        const processed = s.sent + s.failed;
        const progressPct = s.total > 0 ? Math.round((processed / s.total) * 100) : 0;
        const replyRate = s.sent > 0 ? Math.round((s.replied / s.sent) * 100) : 0;
        const isRunning = s.pending > 0;

        return (
          <div key={s.id} className="bg-card border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold font-heading truncate">{s.name}</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${
                isRunning
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              }`}>
                {isRunning ? "En progreso" : "Completado"}
              </span>
            </div>

            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                <span>{processed} de {s.total} procesados</span>
                <span className="font-mono">{progressPct}%</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Kpi icon={Send} label="Enviados" value={s.sent} color="text-foreground" />
              <Kpi icon={CheckCircle2} label="Entregados" value={s.delivered} color="text-emerald-400" />
              <Kpi icon={XCircle} label="Fallidos" value={s.failed} color="text-destructive" />
              <Kpi icon={MessageCircle} label={`Respondidos (${replyRate}%)`} value={s.replied} color="text-primary" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div className="bg-secondary/30 border border-border rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Icon className={`h-3 w-3 ${color}`} />
        <span className="truncate">{label}</span>
      </div>
      <p className={`text-lg font-bold font-mono mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}
