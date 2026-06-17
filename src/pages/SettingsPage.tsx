import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Globe, Bot, Users, Key, Copy, Check, MessageSquare, Sheet, Timer, QrCode, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
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
  
  // Estado para QR
  const [qrStatus, setQrStatus] = useState<string>("disconnected");
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [connectedPhone, setConnectedPhone] = useState<string | null>(null);
  const [qrMessage, setQrMessage] = useState<string>("");
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const [showManualQrInput, setShowManualQrInput] = useState(false);
  const [manualQrText, setManualQrText] = useState("");

  useEffect(() => {
    if (!user) return;

    const loadConfigs = async () => {
      setLoading(true);
      
      try {
        // Cargar configuración de WhatsApp
        const { data: whatsappData, error: whatsappError } = await supabase
          .from("whatsapp_config")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();

        if (whatsappError) {
          console.error("Error cargando whatsapp_config:", whatsappError);
        } else if (whatsappData) {
          setConfig({
            phone_number_id: whatsappData.phone_number_id || "",
            business_account_id: whatsappData.business_account_id || "",
            meta_app_id: whatsappData.meta_app_id || "",
            permanent_token: whatsappData.permanent_token || "",
            webhook_url: whatsappData.webhook_url || "",
            webhook_token: whatsappData.webhook_token || "",
            google_sheets_url: (whatsappData as any).google_sheets_url || "",
            bot_response_delay_seconds: (whatsappData as any).bot_response_delay_seconds ?? 30,
          });
        }

        // Cargar configuración de IA
        const { data: iaData, error: iaError } = await supabase
          .from("chat_ia_gemini")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();

        if (iaError) {
          console.error("Error cargando IA:", iaError);
        } else if (iaData) {
          setIaConfig({
            api_key: iaData.api_key || "",
            model: iaData.model || "auto",
            system_instruction: iaData.system_instruction || "",
            is_active: iaData.is_active ?? false,
            temperature: iaData.temperature ?? 0.7,
            max_tokens: iaData.max_tokens ?? 2048,
          });
        }
      } catch (error) {
        console.error("Error loading configs:", error);
      } finally {
        setLoading(false);
      }
    };

    loadConfigs();
  }, [user]);

  // Verificar estado del QR al montar y cuando cambia la pestaña
  useEffect(() => {
    if (activeTab === "qr" && user) {
      checkQrStatus();
      startPolling();
    } else {
      stopPolling();
    }
    
    return () => stopPolling();
  }, [activeTab, user]);

  const startPolling = () => {
    if (pollingInterval) clearInterval(pollingInterval);
    const interval = setInterval(() => {
      checkQrStatus();
    }, 5000);
    setPollingInterval(interval);
  };

  const stopPolling = () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
  };

  const checkQrStatus = async () => {
    if (!user) return;
    
    try {
      const response = await fetch('/api/waha-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', user_id: user.id })
      });
      const data = await response.json();
      setQrStatus(data.status);
      setConnectedPhone(data.phone);
      
      if (data.status === 'connected') {
        setQrImageUrl(null);
        setQrMessage('');
        if (pollingInterval) stopPolling();
      }
    } catch (err) {
      console.error('Error checking QR status:', err);
    }
  };

  const handleStartQr = async () => {
    if (!user) return;
    setQrLoading(true);
    setQrImageUrl(null);
    setQrMessage('');
    setShowManualQrInput(false);
    
    try {
      const startRes = await fetch('/api/waha-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', user_id: user.id })
      });
      
      if (!startRes.ok) {
        throw new Error('Error al iniciar sesión');
      }
      
      setTimeout(async () => {
        try {
          const qrRes = await fetch('/api/waha-qr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'get-qr', user_id: user.id })
          });
          const qrData = await qrRes.json();
          
          if (qrData.alreadyConnected) {
            setQrStatus('connected');
            setConnectedPhone(qrData.phone);
            setQrMessage(qrData.message || 'WhatsApp ya está conectado');
            toast({ title: "✅ Conectado", description: `WhatsApp conectado: ${qrData.phone}` });
          } else if (qrData.qrImageUrl) {
            setQrImageUrl(qrData.qrImageUrl);
            setQrStatus('pending_qr');
            setQrMessage(qrData.message || 'Escanea el QR con WhatsApp');
            toast({ title: "QR Generado", description: "Escanea el código QR con tu WhatsApp" });
          } else if (qrData.qr) {
            const fallbackUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qrData.qr)}`;
            setQrImageUrl(fallbackUrl);
            setQrStatus('pending_qr');
          } else {
            setQrMessage(qrData.message || 'No se pudo obtener el QR automáticamente. Podés ingresarlo manualmente desde los logs de Railway.');
            setShowManualQrInput(true);
            toast({ title: "⚠️ QR no disponible", description: "Revisa los logs de Railway para obtener el QR manualmente", variant: "destructive" });
          }
        } catch (err) {
          console.error('Error getting QR:', err);
          setQrMessage('Error al obtener el QR. Revisa los logs de Railway.');
          setShowManualQrInput(true);
        }
        setQrLoading(false);
      }, 2000);
      
    } catch (err) {
      console.error('Error starting QR:', err);
      setQrMessage('Error al iniciar la conexión');
      toast({ title: "Error", description: "No se pudo iniciar la conexión", variant: "destructive" });
      setQrLoading(false);
    }
  };

  const handleManualQrSubmit = () => {
    if (manualQrText.trim()) {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(manualQrText)}`;
      setQrImageUrl(qrUrl);
      setQrStatus('pending_qr');
      setShowManualQrInput(false);
      setManualQrText('');
      toast({ title: "✅ QR Manual", description: "QR generado manualmente. Escanéalo con WhatsApp." });
    } else {
      toast({ title: "Error", description: "Pega el texto del QR", variant: "destructive" });
    }
  };

  const handleLogoutQr = async () => {
    if (!user) return;
    setQrLoading(true);
    
    try {
      const response = await fetch('/api/waha-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout', user_id: user.id })
      });
      
      if (response.ok) {
        setQrStatus('disconnected');
        setQrImageUrl(null);
        setConnectedPhone(null);
        setQrMessage('');
        setShowManualQrInput(false);
        toast({ title: "✅ Desconectado", description: "Sesión cerrada correctamente" });
        startPolling();
      } else {
        throw new Error('Error al cerrar sesión');
      }
    } catch (err) {
      console.error('Error logging out:', err);
      toast({ title: "Error", description: "No se pudo cerrar la sesión", variant: "destructive" });
    }
    setQrLoading(false);
  };

  const handleSave = async () => {
    if (!user) {
      toast({ 
        title: "Error", 
        description: "No hay usuario autenticado", 
        variant: "destructive" 
      });
      return;
    }
    
    setSaving(true);
    
    try {
      // Guardar los datos actuales del estado
      const configData = {
        phone_number_id: config.phone_number_id || "",
        business_account_id: config.business_account_id || "",
        meta_app_id: config.meta_app_id || "",
        permanent_token: config.permanent_token || "",
        google_sheets_url: config.google_sheets_url || "",
        bot_response_delay_seconds: config.bot_response_delay_seconds || 30,
        updated_at: new Date().toISOString(),
      };

      console.log("Guardando configuración:", configData);

      // Usar upsert con los datos actuales
      const { error } = await supabase
        .from("whatsapp_config")
        .upsert(
          {
            user_id: user.id,
            ...configData,
          },
          { 
            onConflict: 'user_id',
            ignoreDuplicates: false 
          }
        );

      if (error) {
        console.error("Supabase error:", error);
        toast({ 
          title: "Error", 
          description: error.message || "Error al guardar la configuración", 
          variant: "destructive" 
        });
      } else {
        toast({ 
          title: "✅ Guardado", 
          description: "Configuración actualizada correctamente" 
        });
        
        // NO recargar los datos para evitar que se borren
        // Solo mantenemos el estado actual
      }
    } catch (error: any) {
      console.error("Unexpected error:", error);
      toast({ 
        title: "Error", 
        description: error.message || "Error inesperado al guardar", 
        variant: "destructive" 
      });
    }
    
    setSaving(false);
  };

  const handleSaveIA = async () => {
    if (!user) {
      toast({ 
        title: "Error", 
        description: "No hay usuario autenticado", 
        variant: "destructive" 
      });
      return;
    }
    
    setSavingIA(true);

    try {
      const modelToSave = iaConfig.model === "auto" ? "gemini-1.0-pro" : iaConfig.model;

      const iaData = {
        api_key: iaConfig.api_key || "",
        model: modelToSave,
        system_instruction: iaConfig.system_instruction || "",
        is_active: iaConfig.is_active || false,
        temperature: iaConfig.temperature || 0.7,
        max_tokens: iaConfig.max_tokens || 2048,
        updated_at: new Date().toISOString(),
      };

      console.log("Guardando configuración IA:", iaData);

      const { error } = await supabase
        .from("chat_ia_gemini")
        .upsert(
          {
            user_id: user.id,
            ...iaData,
          },
          { 
            onConflict: 'user_id',
            ignoreDuplicates: false 
          }
        );

      if (error) {
        console.error("Error saving IA config:", error);
        toast({ 
          title: "Error", 
          description: error.message || "Error al guardar la configuración de IA", 
          variant: "destructive" 
        });
      } else {
        toast({ 
          title: "✅ IA Guardada", 
          description: "Configuración de IA actualizada correctamente" 
        });
        
        // NO recargar los datos para evitar que se borren
      }
    } catch (error: any) {
      console.error("Unexpected error saving IA:", error);
      toast({ 
        title: "Error", 
        description: error.message || "Error inesperado al guardar IA", 
        variant: "destructive" 
      });
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
    { id: "qr" as const, label: "QR WhatsApp", icon: QrCode },
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
        {activeTab !== "qr" && (
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
        )}
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

        {activeTab === "qr" && (
          <div className="bg-card border border-border rounded-lg p-6 space-y-6">
            <div className="text-center space-y-3">
              <h3 className="font-heading font-semibold text-lg">Conexión WhatsApp con QR</h3>
              <p className="text-sm text-muted-foreground">
                Escanea el código QR con tu WhatsApp para conectar el número
              </p>
            </div>

            <div className="flex items-center justify-center gap-2">
              <div className={`w-2 h-2 rounded-full animate-pulse ${
                qrStatus === 'connected' ? 'bg-emerald-500' : 
                qrStatus === 'pending_qr' ? 'bg-yellow-500' : 
                qrStatus === 'starting' ? 'bg-blue-500' : 'bg-red-500'
              }`} />
              <span className="text-sm font-medium">
                {qrStatus === 'connected' ? `✅ Conectado - ${connectedPhone || 'WhatsApp'}` :
                 qrStatus === 'pending_qr' ? '📱 Esperando escaneo...' :
                 qrStatus === 'starting' ? '🔄 Iniciando conexión...' :
                 qrStatus === 'failed' ? '❌ Error de conexión' :
                 '⚫ Desconectado'}
              </span>
            </div>

            {qrImageUrl && (
              <div className="flex flex-col items-center gap-4">
                <div className="bg-white p-4 rounded-xl shadow-lg">
                  <img 
                    src={qrImageUrl} 
                    alt="WhatsApp QR Code" 
                    className="w-64 h-64 object-contain"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Abrí WhatsApp → Menú → WhatsApp Web → Escanear código
                </p>
              </div>
            )}

            {showManualQrInput && !qrImageUrl && qrStatus !== 'connected' && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">
                  📋 Copia el QR de los logs de Railway y pégalo aquí:
                </p>
                <div className="flex gap-2">
                  <textarea
                    value={manualQrText}
                    onChange={(e) => setManualQrText(e.target.value)}
                    placeholder="Pega aquí el texto del QR (el bloque de caracteres especiales de los logs de Railway)"
                    className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm font-mono resize-y min-h-[100px]"
                  />
                </div>
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={handleManualQrSubmit}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
                  >
                    <Download className="h-4 w-4" />
                    Generar QR Manual
                  </button>
                </div>
              </div>
            )}

            {qrMessage && !qrImageUrl && qrStatus !== 'connected' && !showManualQrInput && (
              <div className="bg-secondary/30 border border-border rounded-lg p-4 text-center">
                <p className="text-sm text-muted-foreground">{qrMessage}</p>
              </div>
            )}

            <div className="flex gap-3 justify-center">
              {(qrStatus === 'disconnected' || qrStatus === 'failed') && (
                <button
                  onClick={handleStartQr}
                  disabled={qrLoading}
                  className="flex items-center gap-2 px-6 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {qrLoading ? (
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <QrCode className="h-4 w-4" />
                  )}
                  {qrLoading ? "Generando..." : "Generar QR"}
                </button>
              )}
              
              {(qrStatus === 'connected' || qrStatus === 'pending_qr') && (
                <button
                  onClick={handleLogoutQr}
                  disabled={qrLoading}
                  className="flex items-center gap-2 px-6 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors"
                >
                  Desconectar
                </button>
              )}
            </div>

            {qrStatus !== 'connected' && (
              <div className="bg-secondary/20 border border-border rounded-lg p-4 space-y-2">
                <p className="text-xs text-muted-foreground">
                  💡 <span className="font-medium">Consejo:</span> Si el QR no aparece automáticamente:
                </p>
                <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1 ml-2">
                  <li>Ve a Railway → tu despliegue de WAHA → <span className="font-mono">Deploy Logs</span></li>
                  <li>Busca un bloque grande de texto con caracteres especiales (es el QR)</li>
                  <li>Copia TODO ese bloque (incluyendo los █████)</li>
                  <li>Pégalo en el campo de arriba y haz clic en "Generar QR Manual"</li>
                </ol>
              </div>
            )}
          </div>
        )}

        {activeTab === "ia" && (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <Timer className="h-4 w-4 text-primary" />
                <h3 className="font-heading font-semibold text-sm">Tiempo de respuesta del bot</h3>
              </div>
              <div className="flex items-center gap-4">
                <input 
                  type="range" 
                  min={5} 
                  max={600} 
                  step={5} 
                  value={config.bot_response_delay_seconds} 
                  onChange={(e) => setConfig({ ...config, bot_response_delay_seconds: Number(e.target.value) })} 
                  className="flex-1 accent-primary" 
                />
                <div className="flex items-center gap-2">
                  <input 
                    type="number" 
                    min={5} 
                    max={600} 
                    value={config.bot_response_delay_seconds} 
                    onChange={(e) => setConfig({ ...config, bot_response_delay_seconds: Math.max(5, Math.min(600, Number(e.target.value) || 5)) })} 
                    className="w-20 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" 
                  />
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
                  <div className="text-[11px] text-emerald-400 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>IA activa y configurada correctamente</span>
                  </div>
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
          <input 
            type={type} 
            value={value} 
            onChange={(e) => onChange(e.target.value)} 
            className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" 
          />
          <button onClick={onCopy} className="p-2 rounded-lg bg-secondary border border-border">
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
