import { useEffect, useState } from "react";
import { QrCode, RefreshCw, LogOut, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

type SessionStatus = "disconnected" | "pending_qr" | "connected";

interface QRSession {
  status: SessionStatus;
  last_qr: string | null;
  connected_phone: string | null;
  connected_at: string | null;
}

export function WhatsAppQRConnection() {
  const { user } = useAuth();
  const [session, setSession] = useState<QRSession>({
    status: "disconnected", last_qr: null, connected_phone: null, connected_at: null,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [serverConfig, setServerConfig] = useState<{ url: string; apiKey: string } | null>(null);

  // Cargar configuración del servidor Baileys desde Supabase
  useEffect(() => {
    const loadConfig = async () => {
      const { data } = await supabase
        .from("baileys_server_config")
        .select("server_url, server_api_key")
        .limit(1)
        .single();
      
      if (data) {
        setServerConfig({
          url: (data as any).server_url,
          apiKey: (data as any).server_api_key
        });
      }
    };
    loadConfig();
  }, []);

  // Initial load + realtime subscription
  useEffect(() => {
    if (!user) return;
    let mounted = true;

    const load = async () => {
      const { data } = await supabase
        .from("whatsapp_qr_sessions")
        .select("status, last_qr, connected_phone, connected_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (mounted && data) setSession(data as any);
      if (mounted) setLoading(false);
    };
    load();

    const channel = supabase
      .channel(`qr-session-${user.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_qr_sessions", filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (payload.new) setSession(payload.new as any);
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Poll status every 8s while waiting for QR scan
  useEffect(() => {
    if (session.status !== "pending_qr") return;
    const id = setInterval(() => { void refreshStatus(); }, 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status]);

  const generateQR = async () => {
    if (!serverConfig) {
      toast({ title: "Error", description: "Configuración del servidor no encontrada", variant: "destructive" });
      return;
    }
    if (!user) {
      toast({ title: "Error", description: "Usuario no autenticado", variant: "destructive" });
      return;
    }

    setBusy(true);
    try {
      // Llamada DIRECTA a Railway (sin Edge Functions)
      const response = await fetch(`${serverConfig.url}/qr/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': serverConfig.apiKey,
        },
        body: JSON.stringify({ userId: user.id }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Error ${response.status}`);
      }

      const data = await response.json();
      
      // Actualizar la sesión en Supabase con el QR recibido
      if (data.qr) {
        await supabase
          .from("whatsapp_qr_sessions")
          .upsert({
            user_id: user.id,
            status: "pending_qr",
            last_qr: data.qr,
            updated_at: new Date().toISOString(),
          });
        
        setSession(prev => ({ ...prev, status: "pending_qr", last_qr: data.qr }));
        toast({ title: "QR generado", description: "Escanealo desde WhatsApp en tu celular." });
      } else {
        throw new Error("No se recibió el código QR");
      }
    } catch (e) {
      console.error("Error al generar QR:", e);
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const refreshStatus = async () => {
    if (!serverConfig || !user) return;
    
    try {
      // Llamada DIRECTA a Railway para verificar estado
      const response = await fetch(`${serverConfig.url}/qr/status?userId=${user.id}`, {
        headers: {
          'x-api-key': serverConfig.apiKey,
        },
      });

      if (response.ok) {
        const data = await response.json();
        
        // Actualizar estado en Supabase según respuesta de Railway
        const newStatus = data.connected ? "connected" : session.status;
        const phone = data.phone || null;
        
        if (data.connected && session.status !== "connected") {
          await supabase
            .from("whatsapp_qr_sessions")
            .upsert({
              user_id: user.id,
              status: "connected",
              connected_phone: phone,
              connected_at: new Date().toISOString(),
              last_qr: null,
            });
          
          setSession(prev => ({ 
            ...prev, 
            status: "connected", 
            connected_phone: phone,
            connected_at: new Date().toISOString(),
            last_qr: null 
          }));
          
          toast({ title: "¡Conectado!", description: `WhatsApp conectado como ${phone}` });
        }
      }
    } catch (e) {
      console.error("Error al refrescar estado:", e);
    }
  };

  const disconnect = async () => {
    if (!confirm("¿Seguro que querés desconectar la sesión QR?")) return;
    if (!serverConfig || !user) return;
    
    setBusy(true);
    try {
      // Llamada DIRECTA a Railway para desconectar
      await fetch(`${serverConfig.url}/qr/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': serverConfig.apiKey,
        },
        body: JSON.stringify({ userId: user.id }),
      });

      // Actualizar estado en Supabase
      await supabase
        .from("whatsapp_qr_sessions")
        .upsert({
          user_id: user.id,
          status: "disconnected",
          last_qr: null,
          connected_phone: null,
        });

      setSession({ status: "disconnected", last_qr: null, connected_phone: null, connected_at: null });
      toast({ title: "Desconectado", description: "La sesión QR fue cerrada." });
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const statusBadge = {
    disconnected: { label: "Desconectado", color: "bg-muted text-muted-foreground", icon: AlertCircle },
    pending_qr: { label: "Esperando escaneo de QR", color: "bg-amber-500/15 text-amber-500", icon: Loader2 },
    connected: { label: "Conectado", color: "bg-emerald-500/15 text-emerald-500", icon: CheckCircle2 },
  }[session.status];

  const StatusIcon = statusBadge.icon;

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QrCode className="h-4 w-4 text-primary" />
            <h3 className="font-heading font-semibold text-sm">Conexión por QR (Baileys)</h3>
          </div>
          <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${statusBadge.color}`}>
            <StatusIcon className={`h-3 w-3 ${session.status === "pending_qr" ? "animate-spin" : ""}`} />
            {statusBadge.label}
          </span>
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Conectá tu número de WhatsApp escaneando un código QR (igual que WhatsApp Web). Esta conexión funciona en paralelo con la API oficial de Meta.
        </p>

        {session.status === "connected" && session.connected_phone && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-xs">
            <span className="text-muted-foreground">Número conectado: </span>
            <span className="font-mono font-semibold text-emerald-500">{session.connected_phone}</span>
            {session.connected_at && (
              <div className="text-[10px] text-muted-foreground mt-1">
                Desde {new Date(session.connected_at).toLocaleString()}
              </div>
            )}
          </div>
        )}

        {session.status === "pending_qr" && session.last_qr && (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="bg-background p-3 rounded-lg border border-border">
              <img src={session.last_qr} alt="QR de WhatsApp" className="w-56 h-56" />
            </div>
            <p className="text-[11px] text-muted-foreground text-center max-w-xs">
              Abrí WhatsApp en tu celular → <strong className="text-foreground">Configuración → Dispositivos vinculados → Vincular un dispositivo</strong> y escaneá este QR.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          {session.status !== "connected" && (
            <button
              onClick={generateQR}
              disabled={busy || !serverConfig}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
              {session.status === "pending_qr" ? "Regenerar QR" : "Generar QR"}
            </button>
          )}
          {session.status === "pending_qr" && (
            <button
              onClick={refreshStatus}
              disabled={busy}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-sm border border-border hover:bg-secondary/80 transition-colors"
              title="Refrescar estado"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
          {session.status === "connected" && (
            <button
              onClick={disconnect}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 text-destructive border border-destructive/30 text-sm font-medium hover:bg-destructive/20 transition-colors disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Desconectar
            </button>
          )}
        </div>
      </div>

      <div className="bg-secondary/30 border border-border rounded-lg p-4 space-y-2">
        <p className="text-xs font-semibold text-foreground">⚙️ ¿Cómo funciona?</p>
        <ol className="text-[11px] text-muted-foreground space-y-1.5 list-decimal list-inside leading-relaxed">
          <li>El administrador configura una sola vez el servidor Baileys (URL + API Key).</li>
          <li>Hacés clic en <strong className="text-foreground">Generar QR</strong> y aparece el código.</li>
          <li>Lo escaneás desde tu WhatsApp y queda vinculado a tu cuenta.</li>
          <li>Los mensajes entrantes se procesan igual que con la API de Meta.</li>
          <li>Si cerrás sesión desde el celular, el estado pasa a desconectado automáticamente.</li>
        </ol>
      </div>
    </div>
  );
}
