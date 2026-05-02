import { useEffect, useState, useCallback, useRef } from "react";
import {
  QrCode,
  RefreshCw,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

type SessionStatus =
  | "disconnected"
  | "starting"
  | "pending_qr"
  | "connected"
  | "failed";
type Provider = "meta" | "waha";

interface QRSession {
  status: SessionStatus;
  last_qr: string | null;
  connected_phone: string | null;
}

export function WhatsAppQRConnection() {
  const { user } = useAuth();
  const [provider, setProvider] = useState<Provider>("meta");
  const [session, setSession] = useState<QRSession>({
    status: "disconnected",
    last_qr: null,
    connected_phone: null,
  });
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cargar provider actual + sesión QR
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data: cfg } = await supabase
        .from("whatsapp_config")
        .select("provider")
        .eq("user_id", user.id)
        .maybeSingle();
      if ((cfg as any)?.provider) setProvider((cfg as any).provider as Provider);

      const { data: qrSess } = await supabase
        .from("whatsapp_qr_sessions")
        .select("status, last_qr, connected_phone")
        .eq("user_id", user.id)
        .maybeSingle();
      if (qrSess) setSession(qrSess as unknown as QRSession);
    })();
  }, [user?.id]);

  // Renderizar QR a imagen cuando cambia last_qr
  useEffect(() => {
    if (!session.last_qr) {
      setQrDataUrl(null);
      return;
    }
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
        const qrRes = await fetch("/api/waha-qr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get-qr", user_id: user.id }),
        }).then((r) => r.json());

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
          toast({
            title: "✅ WhatsApp conectado",
            description: stRes.phone || "",
          });
        }
      } catch (e) {
        console.error("polling error", e);
      }
    }, 3000);
  }, [user?.id]);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    []
  );

  const handleProviderChange = async (newProv: Provider) => {
    if (!user?.id) return;
    setSavingProvider(true);
    const { error } = await supabase
      .from("whatsapp_config")
      .upsert(
        { user_id: user.id, provider: newProv } as any,
        { onConflict: "user_id" }
      );
    setSavingProvider(false);
    if (error) {
      toast({
        title: "Error guardando provider",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setProvider(newProv);
    toast({
      title: `Proveedor cambiado a ${newProv === "meta" ? "Meta API" : "QR"}`,
    });
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
      toast({
        title: "Iniciando sesión...",
        description: "El QR aparecerá en unos segundos",
      });
    } catch (e: any) {
      toast({
        title: "Error",
        description: e.message,
        variant: "destructive",
      });
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
      setSession({
        status: "disconnected",
        last_qr: null,
        connected_phone: null,
      });
      setQrDataUrl(null);
      if (pollRef.current) clearInterval(pollRef.current);
      toast({ title: "Sesión cerrada" });
    } finally {
      setLoading(false);
    }
  };

  const StatusBadge = () => {
    if (session.status === "connected")
      return (
        <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Conectado
        </Badge>
      );
    if (session.status === "pending_qr")
      return (
        <Badge variant="secondary">
          <QrCode className="h-3 w-3 mr-1" /> Escaneá el QR
        </Badge>
      );
    if (session.status === "starting")
      return (
        <Badge variant="secondary">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Iniciando...
        </Badge>
      );
    if (session.status === "failed")
      return (
        <Badge variant="destructive">
          <AlertCircle className="h-3 w-3 mr-1" /> Error
        </Badge>
      );
    return <Badge variant="outline">Desconectado</Badge>;
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
          <Label className="text-sm">Proveedor</Label>
          <RadioGroup
            value={provider}
            onValueChange={(v) => handleProviderChange(v as Provider)}
            disabled={savingProvider}
            className="grid grid-cols-1 md:grid-cols-2 gap-3"
          >
            <Label
              htmlFor="prov-meta"
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                provider === "meta"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-secondary/40"
              }`}
            >
              <RadioGroupItem value="meta" id="prov-meta" className="mt-1" />
              <div>
                <p className="text-sm font-medium">Meta API (oficial)</p>
                <p className="text-xs text-muted-foreground">
                  Requiere número verificado y cuenta business
                </p>
              </div>
            </Label>
            <Label
              htmlFor="prov-waha"
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                provider === "waha"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-secondary/40"
              }`}
            >
              <RadioGroupItem value="waha" id="prov-waha" className="mt-1" />
              <div>
                <p className="text-sm font-medium">QR (WhatsApp Web)</p>
                <p className="text-xs text-muted-foreground">
                  Escaneá el QR desde tu celular
                </p>
              </div>
            </Label>
          </RadioGroup>
        </div>

        {/* Solo muestro QR UI si provider === waha */}
        {provider === "waha" && (
          <div className="border-t border-border pt-6">
            {session.status === "connected" ? (
              <div className="flex flex-col items-center text-center gap-4 py-6">
                <CheckCircle2 className="h-14 w-14 text-emerald-500" />
                <div>
                  <p className="font-medium">WhatsApp conectado</p>
                  {session.connected_phone && (
                    <p className="text-sm text-muted-foreground">
                      +{session.connected_phone}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  onClick={handleLogout}
                  disabled={loading}
                >
                  <LogOut className="h-4 w-4 mr-2" /> Cerrar sesión
                </Button>
              </div>
            ) : qrDataUrl ? (
              <div className="flex flex-col items-center text-center gap-4 py-2">
                <img
                  src={qrDataUrl}
                  alt="QR WhatsApp"
                  className="rounded-lg border border-border"
                  width={280}
                  height={280}
                />
                <p className="text-xs text-muted-foreground max-w-xs">
                  Abrí WhatsApp → Dispositivos vinculados → Vincular dispositivo
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateQR}
                  disabled={loading}
                >
                  <RefreshCw
                    className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
                  />
                  Refrescar
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center text-center gap-4 py-6">
                <QrCode className="h-14 w-14 text-muted-foreground" />
                <p className="text-sm text-muted-foreground max-w-sm">
                  Hacé clic para generar el QR y vincular tu WhatsApp
                </p>
                <Button onClick={handleGenerateQR} disabled={loading}>
                  {loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <QrCode className="h-4 w-4 mr-2" />
                  )}
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

export default WhatsAppQRConnection;
