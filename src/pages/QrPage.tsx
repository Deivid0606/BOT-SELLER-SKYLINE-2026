import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { QrCode, Wifi, WifiOff, RefreshCw, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

export default function QrPage() {
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");

  const generateQr = useCallback(() => {
    setLoading(true);
    setStatus("connecting");
    // Simula generación de QR (en producción vendría del backend whatsapp-web.js)
    setTimeout(() => {
      const fakeSession = `wss://seller-skyline.app/session/${Date.now()}`;
      setQrValue(fakeSession);
      setLoading(false);
    }, 1500);
  }, []);

  const disconnect = useCallback(() => {
    setQrValue(null);
    setStatus("disconnected");
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold font-heading text-gradient">Conexión QR</h1>
        <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">WhatsApp</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-heading font-semibold">Conectá tu número de WhatsApp</h2>
          <p className="text-sm text-muted-foreground">Esta conexión permite que SELLER SKYLINE lea y envíe mensajes desde tu WhatsApp a través del bot.</p>

          <div className="border-t border-border my-4" />

          <div className="space-y-3 text-sm text-muted-foreground">
            <p><span className="font-bold text-foreground">Paso 1.</span> Abre WhatsApp en tu celular</p>
            <ul className="ml-4 space-y-1 text-xs">
              <li>• En Android: menú ⋮ → <span className="font-medium text-foreground">Dispositivos vinculados</span></li>
              <li>• En iPhone: Configuración → <span className="font-medium text-foreground">Dispositivos vinculados</span></li>
            </ul>
            <p><span className="font-bold text-foreground">Paso 2.</span> Toca en <span className="font-medium text-foreground">Vincular un dispositivo</span></p>
            <p><span className="font-bold text-foreground">Paso 3.</span> Escaneá el QR que aparece a la derecha.</p>
          </div>

          <div className="border-t border-border my-4" />

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={generateQr}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
              Generar nuevo QR
            </button>
            <button
              onClick={generateQr}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm border border-border hover:bg-secondary/80 transition-colors"
            >
              <RefreshCw className="h-4 w-4" /> Refrescar
            </button>
            <button
              onClick={disconnect}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20 hover:bg-destructive/20 transition-colors"
            >
              <WifiOff className="h-4 w-4" /> Desconectar
            </button>
          </div>

          <div className={`flex items-center gap-2 p-3 rounded-lg text-xs ${
            status === "connected" ? "bg-success/10 text-success" :
            status === "connecting" ? "bg-warning/10 text-warning" :
            "bg-secondary/30 text-muted-foreground"
          }`}>
            <Wifi className="h-3.5 w-3.5" />
            Estado: {status === "connected" ? "✅ Conectado" : status === "connecting" ? "⏳ Esperando escaneo…" : "Desconectado"}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-heading font-semibold mb-4">Código QR activo</h2>
          <div className="flex flex-col items-center justify-center">
            {loading ? (
              <div className="w-56 h-56 rounded-2xl border border-border bg-secondary/30 flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            ) : qrValue ? (
              <div className="p-4 bg-white rounded-2xl shadow-lg">
                <QRCodeSVG value={qrValue} size={200} level="M" />
              </div>
            ) : (
              <div className="w-56 h-56 rounded-2xl border border-dashed border-border bg-gradient-to-b from-primary/5 to-accent/5 flex items-center justify-center">
                <div className="text-center text-sm text-muted-foreground px-4">
                  <QrCode className="h-12 w-12 mx-auto mb-3 text-primary/30" />
                  Toca "Generar nuevo QR" para comenzar.
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-4 text-center max-w-xs">
              {qrValue ? "Escaneá este código con WhatsApp para vincular tu dispositivo." : "El QR aparecerá aquí al generar una nueva sesión."}
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
