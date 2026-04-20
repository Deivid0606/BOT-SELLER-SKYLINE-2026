import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Globe, Bot, Users, Key, Copy, Check, MessageSquare, Sheet, Timer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

export default function SettingsPage() {
  const { user } = useAuth();
  const [config, setConfig] = useState({
    phone_number_id: "",
    business_account_id: "",
    meta_app_id: "",
    permanent_token: "",
    webhook_url: "",
    webhook_token: "",
    google_sheets_url: "",
    bot_response_delay_seconds: 30,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"whatsapp" | "ia" | "chat">("whatsapp");

  useEffect(() => {
    if (!user) return;
    supabase
      .from("whatsapp_config")
      .select("*")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setConfig({
            phone_number_id: data.phone_number_id || "",
            business_account_id: data.business_account_id || "",
            meta_app_id: data.meta_app_id || "",
            permanent_token: data.permanent_token || "",
            webhook_url: data.webhook_url || "",
            webhook_token: data.webhook_token || "",
            google_sheets_url: (data as any).google_sheets_url || "",
            bot_response_delay_seconds: (data as any).bot_response_delay_seconds ?? 30,
          });
        }
        setLoading(false);
      });
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("whatsapp_config")
      .update({
        phone_number_id: config.phone_number_id,
        business_account_id: config.business_account_id,
        meta_app_id: config.meta_app_id,
        permanent_token: config.permanent_token,
        google_sheets_url: config.google_sheets_url,
        bot_response_delay_seconds: config.bot_response_delay_seconds,
      } as any)
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "✅ Guardado", description: "Configuración actualizada correctamente" });
    }
    setSaving(false);
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const webhookFullUrl = `${window.location.origin}/api/webhook/${config.webhook_url}`;

  const tabs = [
    { id: "whatsapp" as const, label: "WhatsApp", icon: MessageSquare },
    { id: "ia" as const, label: "IA", icon: Bot },
    { id: "chat" as const, label: "Chat", icon: Globe },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading text-gradient">Ajustes</h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? (
            <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
          ) : (
            "Guardar"
          )}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        {activeTab === "whatsapp" && (
          <>
            {/* WhatsApp Config */}
            <div className="bg-card border border-border rounded-lg p-5 space-y-5">
              <FieldRow
                label="Id. Número de teléfono"
                description="Valor único asignado a cada número de teléfono registrado en la plataforma de WhatsApp Business API Cloud. Se utiliza para identificar y autenticar el número al enviar y recibir mensajes."
                value={config.phone_number_id}
                onChange={(v) => setConfig({ ...config, phone_number_id: v })}
                onCopy={() => copyToClipboard(config.phone_number_id, "phone")}
                copied={copiedField === "phone"}
              />

              <FieldRow
                label="Id. cuenta de WhatsApp Business (Opcional)"
                description="Identificador de la cuenta de WhatsApp Business. Permite que las plantillas de WhatsApp se puedan ver, crear, editar y eliminar desde Seller Skyline."
                value={config.business_account_id}
                onChange={(v) => setConfig({ ...config, business_account_id: v })}
                onCopy={() => copyToClipboard(config.business_account_id, "biz")}
                copied={copiedField === "biz"}
              />

              <FieldRow
                label="Id. de la aplicación de Meta (Opcional)"
                description="Identificador de la aplicación de Meta donde se encuentra alojado el número de WhatsApp. Permite crear, editar y eliminar plantillas de WhatsApp de Imagen, Video y Documento."
                value={config.meta_app_id}
                onChange={(v) => setConfig({ ...config, meta_app_id: v })}
                onCopy={() => copyToClipboard(config.meta_app_id, "app")}
                copied={copiedField === "app"}
              />

              <FieldRow
                label="Token permanente"
                description="Cadena de caracteres utilizado para permitir el acceso al uso de servicios de Meta. Debe ser el permanente ya que Meta utiliza otros Tokens con caducidad."
                value={config.permanent_token}
                onChange={(v) => setConfig({ ...config, permanent_token: v })}
                onCopy={() => copyToClipboard(config.permanent_token, "token")}
                copied={copiedField === "token"}
                type="password"
              />
            </div>

            {/* Webhook Config - Read only */}
            <div className="bg-card border border-border rounded-lg p-5 space-y-4">
              <h3 className="font-heading font-semibold text-sm">Configuración de Webhook</h3>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground mb-1 block">URL Webhook</label>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={webhookFullUrl}
                      className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground focus:outline-none"
                    />
                    <button
                      onClick={() => copyToClipboard(webhookFullUrl, "wh_url")}
                      className="p-2 rounded-lg bg-secondary border border-border hover:bg-secondary/80 transition-colors shrink-0"
                    >
                      {copiedField === "wh_url" ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
                <div className="w-48">
                  <label className="text-[10px] text-muted-foreground mb-1 block">Token Verificación</label>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={config.webhook_token}
                      className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground focus:outline-none"
                    />
                    <button
                      onClick={() => copyToClipboard(config.webhook_token, "wh_token")}
                      className="p-2 rounded-lg bg-secondary border border-border hover:bg-secondary/80 transition-colors shrink-0"
                    >
                      {copiedField === "wh_token" ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Los parámetros URL Webhook y Token son esenciales para establecer una conexión bidireccional con la plataforma de WhatsApp a través de la API de WhatsApp Business. 
                La URL del webhook es la dirección donde WhatsApp enviará notificaciones y eventos en tiempo real. 
                El Token es un texto de seguridad para validar que la URL proviene de tu plataforma. 
                <strong className="text-foreground"> Para configurar correctamente el Webhook, debes copiar estos valores y pegarlos en la página de Facebook Developer en la sección de Webhook.</strong>
              </p>
            </div>

            {/* Google Sheets Integration */}
            <div className="bg-card border border-border rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Sheet className="h-4 w-4 text-emerald-500" />
                <h3 className="font-heading font-semibold text-sm">Google Sheets</h3>
              </div>
              <FieldRow
                label="URL de Google Sheets"
                description="Pega aquí la URL de tu Apps Script Web App. Los pedidos confirmados se enviarán automáticamente a tu hoja de cálculo. Seguí las instrucciones para crear tu script en Google Sheets → Extensiones → Apps Script."
                value={config.google_sheets_url}
                onChange={(v) => setConfig({ ...config, google_sheets_url: v })}
                onCopy={() => copyToClipboard(config.google_sheets_url, "sheets")}
                copied={copiedField === "sheets"}
              />

              <div className="bg-secondary/30 border border-border rounded-lg p-4 space-y-3">
                <p className="text-xs font-semibold text-foreground">📋 Instrucciones para conectar Google Sheets</p>
                <ol className="text-[11px] text-muted-foreground space-y-2 list-decimal list-inside leading-relaxed">
                  <li>Abrí una <strong className="text-foreground">Google Sheet</strong> nueva o existente.</li>
                  <li>Andá a <strong className="text-foreground">Extensiones → Apps Script</strong>.</li>
                  <li>Borrá todo el código y pegá lo siguiente:</li>
                </ol>
                <pre className="bg-background border border-border rounded-lg p-3 text-[10px] font-mono text-muted-foreground overflow-x-auto whitespace-pre">{`function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);
  sheet.appendRow([
    new Date(),
    data.nombre,
    data.telefono,
    data.producto,
    data.cantidad,
    data.ciudad,
    data.calle,
    data.referencia,
    data.monto,
    data.payment_type,
    data.status
  ]);
  return ContentService.createTextOutput(
    JSON.stringify({result: "ok"})
  ).setMimeType(ContentService.MimeType.JSON);
}`}</pre>
                <ol start={4} className="text-[11px] text-muted-foreground space-y-2 list-decimal list-inside leading-relaxed">
                  <li>Guardá el proyecto (Ctrl+S).</li>
                  <li>Clic en <strong className="text-foreground">Implementar → Nueva implementación</strong>.</li>
                  <li>Tipo: <strong className="text-foreground">Aplicación web</strong>.</li>
                  <li>Ejecutar como: <strong className="text-foreground">Yo</strong> · Acceso: <strong className="text-foreground">Cualquier persona</strong>.</li>
                  <li>Clic en <strong className="text-foreground">Implementar</strong> y copiá la URL.</li>
                  <li>Pegá la URL arriba y hacé clic en <strong className="text-foreground">Guardar</strong>.</li>
                </ol>
              </div>
            </div>
          </>
        )}

        {activeTab === "ia" && (
          <div className="bg-card border border-border rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Bot className="h-4 w-4 text-primary" />
              <h3 className="font-heading font-semibold text-sm">IA (Gemini)</h3>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">API Key de Gemini</label>
              <input type="password" className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="AIzaxxxxxxx..." />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Modelo preferido</label>
              <select className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm text-muted-foreground focus:outline-none focus:border-primary/50">
                <option>gemini-1.5-pro</option>
                <option>gemini-1.5-flash</option>
                <option>gemini-1.0-pro</option>
              </select>
            </div>
          </div>
        )}

        {activeTab === "chat" && (
          <div className="bg-card border border-border rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-primary" />
              <h3 className="font-heading font-semibold text-sm">Gestión de Usuarios</h3>
            </div>
            <p className="text-xs text-muted-foreground">Administra los roles y permisos de los usuarios del panel.</p>
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-sm border border-border hover:bg-secondary/80 transition-colors">
              <Key className="h-4 w-4" /> Gestionar usuarios
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function FieldRow({
  label,
  description,
  value,
  onChange,
  onCopy,
  copied,
  type = "text",
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  onCopy: () => void;
  copied: boolean;
  type?: string;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-4 py-4 border-b border-border last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            placeholder="..."
          />
          <button
            onClick={onCopy}
            className="p-2 rounded-lg bg-secondary border border-border hover:bg-secondary/80 transition-colors shrink-0"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
