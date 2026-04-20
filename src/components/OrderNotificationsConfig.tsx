import { useEffect, useState } from "react";
import { Bell, Plus, Trash2, MessageSquare, QrCode } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

export function OrderNotificationsConfig() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [channel, setChannel] = useState<"api" | "qr">("api");
  const [phones, setPhones] = useState<string[]>([""]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("whatsapp_config")
      .select("notify_enabled, notify_channel, notify_phones")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setEnabled((data as any).notify_enabled ?? false);
          setChannel(((data as any).notify_channel ?? "api") as "api" | "qr");
          const p = ((data as any).notify_phones as string[]) ?? [];
          setPhones(p.length > 0 ? p : [""]);
        }
        setLoading(false);
      });
  }, [user]);

  const addPhone = () => {
    if (phones.length >= 3) return;
    setPhones([...phones, ""]);
  };

  const removePhone = (idx: number) => {
    setPhones(phones.filter((_, i) => i !== idx));
  };

  const updatePhone = (idx: number, val: string) => {
    const next = [...phones];
    next[idx] = val;
    setPhones(next);
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const cleanPhones = phones.map(p => p.trim()).filter(p => p.length > 0).slice(0, 3);

    const { error } = await supabase
      .from("whatsapp_config")
      .update({
        notify_enabled: enabled,
        notify_channel: channel,
        notify_phones: cleanPhones,
      } as any)
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "✅ Guardado", description: "Notificaciones de pedidos actualizadas" });
    }
    setSaving(false);
  };

  if (loading) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          <h3 className="font-heading font-semibold text-sm">Notificación de pedidos confirmados</h3>
        </div>
        <button
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? "bg-primary" : "bg-secondary"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Recibí un mensaje de WhatsApp cada vez que se cree un pedido nuevo en la base. Podés configurar hasta 3 números (ej: dueño, encargado, repartidor).
      </p>

      {enabled && (
        <>
          {/* Canal */}
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Canal de envío</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setChannel("api")}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium transition-colors ${
                  channel === "api"
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-secondary/30 border-border text-muted-foreground hover:bg-secondary/50"
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                API Meta
              </button>
              <button
                onClick={() => setChannel("qr")}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium transition-colors ${
                  channel === "qr"
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-secondary/30 border-border text-muted-foreground hover:bg-secondary/50"
                }`}
              >
                <QrCode className="h-3.5 w-3.5" />
                QR (Baileys)
              </button>
            </div>
          </div>

          {/* Phones */}
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">
              Números de WhatsApp ({phones.filter(p => p.trim()).length}/3)
            </label>
            <p className="text-[10px] text-muted-foreground">
              Formato internacional sin "+" ni espacios. Ej: <code className="font-mono">595981234567</code>
            </p>
            {phones.map((phone, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => updatePhone(i, e.target.value)}
                  placeholder="595981234567"
                  className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50"
                />
                {phones.length > 1 && (
                  <button
                    onClick={() => removePhone(i)}
                    className="p-2 rounded-lg bg-secondary border border-border hover:bg-destructive/10 hover:border-destructive/30 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
            ))}
            {phones.length < 3 && (
              <button
                onClick={addPhone}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:bg-secondary/30 hover:border-primary/30 hover:text-primary transition-colors w-full justify-center"
              >
                <Plus className="h-3.5 w-3.5" />
                Agregar otro número
              </button>
            )}
          </div>

          {/* Preview */}
          <div className="bg-secondary/30 border border-border rounded-lg p-3 space-y-1">
            <p className="text-[10px] text-muted-foreground font-semibold mb-1">Vista previa del mensaje:</p>
            <pre className="text-[10px] font-mono text-foreground whitespace-pre-wrap leading-relaxed">{`🎉 *Nuevo pedido confirmado*

👤 Cliente: Juan Pérez
📱 Tel: 595981234567
📦 Producto: iPhone 15 (x1)
💰 Monto: Gs. 6.500.000
📍 Dirección: Av. España 1234, Asunción
💳 Pago: transfer
📅 Fecha: 2024-01-15`}</pre>
          </div>
        </>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {saving ? "Guardando..." : "Guardar notificaciones"}
      </button>
    </div>
  );
}
