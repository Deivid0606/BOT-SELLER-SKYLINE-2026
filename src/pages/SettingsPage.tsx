import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Globe, Bot, Users, Key, Copy, Check, MessageSquare, Sheet, Timer, QrCode } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { WhatsAppQRConnection } from "@/components/WhatsAppQRConnection";
import { BaileysServerConfig } from "@/components/BaileysServerConfig";
import { OrderNotificationsConfig } from "@/components/OrderNotificationsConfig";

export default function SettingsPage() {
  const { user, role } = useAuth();
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
  const [iaConfig, setIaConfig] = useState({
    api_key: "",
    model: "auto",
    system_instruction: "",
    is_active: false,
    temperature: 0.7,
    max_tokens: 2048,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingIA, setSavingIA] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"whatsapp" | "qr" | "ia" | "chat">("whatsapp");
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (!user) return;
    
    // Cargar configuración de WhatsApp
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

    // Cargar configuración de IA
    const loadIAConfig = async () => {
      const { data, error } = await supabase
        .from("chat_ia_gemini")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      
      console.log("📦 Configuración IA cargada:", data ? "SÍ" : "NO");
      
      if (data) {
        setIaConfig({
          api_key: data.api_key || "",
          model: data.model || "auto",
          system_instruction: data.system_instruction || "",
          is_active: data.is_active ?? false,
          temperature: data.temperature ?? 0.7,
          max_tokens: data.max_tokens ?? 2048,
        });
      } else {
        // Si no existe, crear un registro vacío
        const { error: insertError } = await supabase
          .from("chat_ia_gemini")
          .insert({
            user_id: user.id,
            api_key: "",
            model: "auto",
            system_instruction: "Eres un asistente de ventas para una tienda online. Responde de manera amable y profesional.",
            is_active: false,
          });
        
        if (insertError) {
          console.error("Error creando configuración IA:", insertError);
        }
      }
    };
    
    loadIAConfig();
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

  const handleSaveIA = async () => {
    if (!user) return;
    setSavingIA(true);

    // Si el modelo es "auto", guardamos un valor por defecto (el sistema lo detectará)
    const modelToSave = iaConfig.model === "auto" ? "gemini-1.0-pro" : iaConfig.model;

    const { error } = await supabase
      .from("chat_ia_gemini")
      .upsert({
        user_id: user.id,
        api_key: iaConfig.api_key,
        model: modelToSave,
        system_instruction: iaConfig.system_instruction,
        is_active: iaConfig.is_active,
        temperature: iaConfig.temperature,
        max_tokens: iaConfig.max_tokens,
        updated_at: new Date().toISOString(),
      });

    if (error) {
      console.error("Error guardando IA:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "✅ IA Guardada", description: "Configuración de IA actualizada correctamente" });
      // Recargar para confirmar
      const { data } = await supabase
        .from("chat_ia_gemini")
        .select("*")
        .eq("user_id", user.id)
        .single();
      if (data) {
        setIaConfig({
          api_key: data.api_key || "",
          model: data.model || "auto",
          system_instruction: data.system_instruction || "",
          is_active: data.is_active ?? false,
          temperature: data.temperature ?? 0.7,
          max_tokens: data.max_tokens ?? 2048,
        });
      }
    }
    setSavingIA(false);
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const webhookFullUrl = `${window.location.origin}/api/webhook/${config.webhook_url}`;

  const tabs = [
    { id: "whatsapp" as const, label: "API Meta", icon: MessageSquare },
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
            <div className="bg-card border border-border rounded-lg p-5 space-y-5">
              <FieldRow
                label="Id. Número de teléfono"
                description="Valor único asignado a cada número de teléfono registrado en la plataforma de WhatsApp Business API Cloud."
                value={config.phone_number_id}
                onChange={(v) => setConfig({ ...config, phone_number_id: v })}
                onCopy={() => copyToClipboard(config.phone_number_id, "phone")}
                copied={copiedField === "phone"}
              />
              <FieldRow
                label="Id. cuenta de WhatsApp Business (Opcional)"
                description="Identificador de la cuenta de WhatsApp Business."
                value={config.business_account_id}
                onChange={(v) => setConfig({ ...config, business_account_id: v })}
                onCopy={() => copyToClipboard(config.business_account_id, "biz")}
                copied={copiedField === "biz"}
              />
              <FieldRow
                label="Id. de la aplicación de Meta (Opcional)"
                description="Identificador de la aplicación de Meta."
                value={config.meta_app_id}
                onChange={(v) => setConfig({ ...config, meta_app_id: v })}
                onCopy={() => copyToClipboard(config.meta_app_id, "app")}
                copied={copiedField === "app"}
              />
              <FieldRow
                label="Token permanente"
                description="Cadena de caracteres para acceder a servicios de Meta."
                value={config.permanent_token}
                onChange={(v) => setConfig({ ...config, permanent_token: v })}
                onCopy={() => copyToClipboard(config.permanent_token, "token")}
                copied={copiedField === "token"}
                type="password"
              />
            </div>

            <div className="bg-card border border-border rounded-lg p-5 space-y-4">
              <h3 className="font-heading font-semibold text-sm">Configuración de Webhook</h3>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground mb-1 block">URL Webhook</label>
                  <div className="flex items-center gap-2">
                    <input readOnly value={webhookFullUrl} className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground" />
                    <button onClick={() => copyToClipboard(webhookFullUrl, "wh_url")} className="p-2 rounded-lg bg-secondary border border-border">
                      {copiedField === "wh_url" ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
                <div className="w-48">
                  <label className="text-[10px] text-muted-foreground mb-1 block">Token Verificación</label>
                  <div className="flex items-center gap-2">
                    <input readOnly value={config.webhook_token} className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground" />
                    <button onClick={() => copyToClipboard(config.webhook_token, "wh_token")} className="p-2 rounded-lg bg-secondary border border-border">
                      {copiedField === "wh_token" ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Sheet className="h-4 w-4 text-emerald-500" />
                <h3 className="font-heading font-semibold text-sm">Google Sheets</h3>
              </div>
              <FieldRow
                label="URL de Google Sheets"
                description="Pega aquí la URL de tu Apps Script Web App."
                value={config.google_sheets_url}
                onChange={(v) => setConfig({ ...config, google_sheets_url: v })}
                onCopy={() => copyToClipboard(config.google_sheets_url, "sheets")}
                copied={copiedField === "sheets"}
              />
            </div>

            <OrderNotificationsConfig />
          </>
        )}

        {activeTab === "ia" && (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <Timer className="h-4 w-4 text-primary" />
                <h3 className="font-heading font-semibold text-sm">Tiempo de respuesta del bot</h3>
              </div>
              <div className="flex items-center gap-4">
                <input type="range" min={5} max={600} step={5} value={config.bot_response_delay_seconds} onChange={(e) => setConfig({ ...config, bot_response_delay_seconds: Number(e.target.value) })} className="flex-1 accent-primary" />
                <div className="flex items-center gap-2">
                  <input type="number" min={5} max={600} value={config.bot_response_delay_seconds} onChange={(e) => setConfig({ ...config, bot_response_delay_seconds: Math.max(5, Math.min(600, Number(e.target.value) || 5)) })} className="w-20 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                  <span className="text-xs text-muted-foreground">seg</span>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Bot className="h-4 w-4 text-primary" />
                <h3 className="font-heading font-semibold text-sm">IA (Gemini)</h3>
              </div>
              
              <div>
                <label className="text-xs text-muted-foreground">API Key de Gemini</label>
                <div className="flex gap-2 mt-1">
                  <input 
                    type={showApiKey ? "text" : "password"}
                    value={iaConfig.api_key}
                    onChange={(e) => setIaConfig({ ...iaConfig, api_key: e.target.value })}
                    className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm font-mono"
                    placeholder="AIzaSy..."
                  />
                  <button
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="px-3 py-2 rounded-lg bg-secondary border border-border text-xs"
                  >
                    {showApiKey ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {iaConfig.api_key ? "✅ API Key configurada" : "❌ No hay API Key configurada"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Obtené tu API Key en <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-primary underline">Google AI Studio</a>
                </p>
              </div>
              
              <div>
                <label className="text-xs text-muted-foreground">Modelo preferido</label>
                <select 
                  value={iaConfig.model}
                  onChange={(e) => setIaConfig({ ...iaConfig, model: e.target.value })}
                  className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="auto">🔍 Auto-detectar (recomendado)</option>
                  <option value="gemini-1.0-pro">gemini-1.0-pro</option>
                  <option value="gemini-1.0-pro-vision">gemini-1.0-pro-vision</option>
                  <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                  <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                </select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Seleccioná "Auto-detectar" para que el sistema encuentre el modelo disponible automáticamente.
                </p>
              </div>

              <div>
                <label className="text-xs text-muted-foreground">Instrucción del sistema</label>
                <textarea 
                  rows={4}
                  value={iaConfig.system_instruction}
                  onChange={(e) => setIaConfig({ ...iaConfig, system_instruction: e.target.value })}
                  className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm resize-y"
                  placeholder="Eres un asistente de ventas para una tienda online..."
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs text-muted-foreground">Activar IA</label>
                  <p className="text-[10px] text-muted-foreground">Responde automáticamente a los mensajes</p>
                </div>
                <button
                  onClick={() => setIaConfig({ ...iaConfig, is_active: !iaConfig.is_active })}
                  className={`relative w-12 h-6 rounded-full transition-colors ${iaConfig.is_active ? "bg-emerald-500" : "bg-muted"}`}
                >
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform ${iaConfig.is_active ? "translate-x-6" : "translate-x-0.5"}`} />
                </button>
              </div>

              <button
                onClick={handleSaveIA}
                disabled={savingIA}
                className="w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {savingIA ? "Guardando..." : "Guardar configuración de IA"}
              </button>

              {iaConfig.is_active && iaConfig.api_key && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                  <p className="text-[11px] text-emerald-400 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    IA activa y configurada correctamente
                  </p>
                </div>
              )}

              {iaConfig.is_active && !iaConfig.api_key && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                  <p className="text-[11px] text-destructive">
                    ⚠️ La IA está activa pero no hay API Key configurada. Agrega tu API Key de Gemini.
                  </p>
                </div>
              )}
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

function FieldRow({ label, description, value, onChange, onCopy, copied, type = "text" }: {
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
          <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
          <button onClick={onCopy} className="p-2 rounded-lg bg-secondary border border-border">
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
