import { useEffect, useState, useCallback, useRef } from "react";
import {
  QrCode, RefreshCw, LogOut, CheckCircle2, AlertCircle, Loader2,
} from "lucide-react";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

type SessionStatus = "disconnected" | "starting" | "pending_qr" | "connected" | "failed";
type Provider = "meta" | "waha";

interface QRSession {
  status: SessionStatus;
  last_qr: string | null;
  connected_phone: string | null;
}

export default function WhatsAppQRConnection() {
  const { user } = useAuth();
  const [provider, setProvider] = useState<Provider>("meta");
  const [session, setSession] = useState<QRSession>({
    status: "disconnected", last_qr: null, connected_phone: null,
  });
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Cargar provider actual + sesión QR
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data: cfg } = await supabase
        .from("whatsapp_config")
        .select("provider")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cfg?.provider) setProvider(cfg.provider as Provider);

      const { data: qrSess } = await supabase
        .from("whatsapp_qr_sessions")
        .select("status, last_qr, connected_phone")
        .eq("user_id", user.id)
        .maybeSingle();
      if (qrSess) setSession(qrSess as QRSession);
    })();
  }, [user?.id]);

  // Renderizar QR a imagen cuando cambia last_qr
  useEffect(() => {
    if (!session.last_qr) { setQrDataUrl(null); return; }
    QRCode.toDataURL(session.last_qr, { width: 320, margin: 2 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [session.last_qr]);

  // Polling cuando estamos esperando QR o conectándonos
  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      if (!user?.id) return;
      try {
        // Refrescar QR
        const qrRes = await fetch("/api/waha-qr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get-qr", user_id: user.id }),
        }).then((r) => r.json());

        // Refrescar status
        const stRes = await fetch("/api/waha-qr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", user_id: user.id }),
        }).then((r) => r.json());

        setSession((prev) => ({
          ...prev,
          last_qr: qrRes?.qr || prev.last_qr,
          status: (stRes?.status as SessionStatus) || prev.status,
          connected_phone: stRes?.phone || prev.connected_phone,
        }));

        if (stRes?.status === "connected") {
          if (pollRef.current) clearInterval(pollRef.current);
          toast({ title: "✅ WhatsApp conectado", description: stRes.phone || "" });
        }
      } catch (e) {
        console.error("polling error", e);
      }
    }, 3000);
  }, [user?.id]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const handleProviderChange = async (newProv: Provider) => {
    if (!user?.id) return;
    setSavingProvider(true);
    const { error } = await supabase
      .from("whatsapp_config")
      .upsert({ user_id: user.id, provider: newProv }, { onConflict: "user_id" });
    setSavingProvider(false);
    if (error) {
      toast({ title: "Error guardando provider", description: error.message, variant: "destructive" });
      return;
    }
    setProvider(newProv);
    toast({ title: `Proveedor cambiado a ${newProv === "meta" ? "Meta API" : "QR"}` });
  };

  const handleGenerateQR = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const r = await fetch("/api/waha-qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", user_id: user.id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error");
      setSession((p) => ({ ...p, status: "starting" }));
      startPolling();
      toast({ title: "Iniciando sesión...", description: "El QR aparecerá en unos segundos" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      await fetch("/api/waha-qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout", user_id: user.id }),
      });
      setSession({ status: "disconnected", last_qr: null, connected_phone: null });
      setQrDataUrl(null);
      if (pollRef.current) clearInterval(pollRef.current);
      toast({ title: "Sesión cerrada" });
    } finally {
      setLoading(false);
    }
  };

  const StatusBadge = () => {
    if (session.status === "connected")
      return <Badge className="bg-green-600"><CheckCircle2 className="w-3 h-3 mr-1" />Conectado</Badge>;
    if (session.status === "pending_qr")
      return <Badge variant="outline"><QrCode className="w-3 h-3 mr-1" />Escaneá el QR</Badge>;
    if (session.status === "starting")
      return <Badge variant="outline"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Iniciando...</Badge>;
    if (session.status === "failed")
      return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />Error</Badge>;
    return <Badge variant="secondary">Desconectado</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Conexión de WhatsApp</span>
          <StatusBadge />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Selector de provider */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Proveedor</Label>
          <RadioGroup
            value={provider}
            onValueChange={(v) => handleProviderChange(v as Provider)}
            disabled={savingProvider}
            className="grid grid-cols-2 gap-3"
          >
            <label className={`flex items-start gap-2 p-3 border rounded-lg cursor-pointer ${provider === "meta" ? "border-primary bg-primary/5" : ""}`}>
              <RadioGroupItem value="meta" id="meta" />
              <div className="flex-1">
                <div className="font-medium text-sm">Meta API (oficial)</div>
                <div className="text-xs text-muted-foreground">Requiere número verificado y cuenta business</div>
              </div>
            </label>
            <label className={`flex items-start gap-2 p-3 border rounded-lg cursor-pointer ${provider === "waha" ? "border-primary bg-primary/5" : ""}`}>
              <RadioGroupItem value="waha" id="waha" />
              <div className="flex-1">
                <div className="font-medium text-sm">QR (WhatsApp Web)</div>
                <div className="text-xs text-muted-foreground">Escaneá el QR desde tu celular</div>
              </div>
            </label>
          </RadioGroup>
        </div>

        {/* Solo muestro QR UI si provider === waha */}
        {provider === "waha" && (
          <div className="space-y-4 pt-4 border-t">
            {session.status === "connected" ? (
              <div className="text-center space-y-3">
                <CheckCircle2 className="w-16 h-16 text-green-600 mx-auto" />
                <div>
                  <p className="font-medium">WhatsApp conectado</p>
                  {session.connected_phone && (
                    <p className="text-sm text-muted-foreground">+{session.connected_phone}</p>
                  )}
                </div>
                <Button variant="outline" onClick={handleLogout} disabled={loading}>
                  <LogOut className="w-4 h-4 mr-2" />Cerrar sesión
                </Button>
              </div>
            ) : qrDataUrl ? (
              <div className="text-center space-y-3">
                <img src={qrDataUrl} alt="QR" className="mx-auto rounded-lg border" />
                <p className="text-sm text-muted-foreground">
                  Abrí WhatsApp → Dispositivos vinculados → Vincular dispositivo
                </p>
                <Button variant="outline" size="sm" onClick={handleGenerateQR} disabled={loading}>
                  <RefreshCw className="w-3 h-3 mr-1" />Refrescar
                </Button>
              </div>
            ) : (
              <div className="text-center space-y-3 py-6">
                <QrCode className="w-16 h-16 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">
                  Hacé clic para generar el QR y vincular tu WhatsApp
                </p>
                <Button onClick={handleGenerateQR} disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <QrCode className="w-4 h-4 mr-2" />}
                  Generar QR
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
