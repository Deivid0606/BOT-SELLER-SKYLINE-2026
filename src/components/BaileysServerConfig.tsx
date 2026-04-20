import { useEffect, useState } from "react";
import { Server, Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export function BaileysServerConfig() {
  const [cfg, setCfg] = useState({ server_url: "", server_api_key: "", id: null as string | null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("baileys_server_config" as any)
        .select("id, server_url, server_api_key")
        .limit(1)
        .maybeSingle();
      if (data) setCfg(data as any);
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      if (cfg.id) {
        const { error } = await supabase
          .from("baileys_server_config" as any)
          .update({ server_url: cfg.server_url, server_api_key: cfg.server_api_key })
          .eq("id", cfg.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("baileys_server_config" as any)
          .insert({ server_url: cfg.server_url, server_api_key: cfg.server_api_key })
          .select("id")
          .single();
        if (error) throw error;
        setCfg({ ...cfg, id: (data as any).id });
      }
      toast({ title: "✅ Guardado", description: "Configuración del servidor Baileys actualizada." });
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Server className="h-4 w-4 text-primary" />
        <h3 className="font-heading font-semibold text-sm">Servidor Baileys (compartido)</h3>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Solo administradores. Esta configuración se aplica a todos los vendedores que usen conexión por QR.
      </p>

      <div>
        <label className="text-xs text-muted-foreground">URL del servidor</label>
        <input
          type="url"
          value={cfg.server_url}
          onChange={(e) => setCfg({ ...cfg, server_url: e.target.value })}
          placeholder="https://baileys.tu-dominio.com"
          className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50"
        />
      </div>

      <div>
        <label className="text-xs text-muted-foreground">API Key</label>
        <input
          type="password"
          value={cfg.server_api_key}
          onChange={(e) => setCfg({ ...cfg, server_api_key: e.target.value })}
          placeholder="••••••••••••••••"
          className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50"
        />
      </div>

      <button
        onClick={save}
        disabled={saving || !cfg.server_url || !cfg.server_api_key}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Guardar configuración
      </button>
    </div>
  );
}
