import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Globe, Bot, Users, Key, Copy, Check, MessageSquare, Sheet, Timer, QrCode } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { WhatsAppQRConnection } from "@/components/WhatsAppQRConnection";
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
      .maybeSingle()
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

    // Cargar configuración de IA (solo lectura — NO crear acá)
    const loadIAConfig = async () => {
      const { data, error } = await supabase
        .from("chat_ia_gemini")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Error cargando IA:", error);
        return;
      }

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
      // Si no existe, simplemente dejamos los defaults del useState.
      // La fila se creará cuando el usuario presione "Guardar" (vía upsert).
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

    const modelToSave = iaConfig.model === "auto" ? "gemini-1.0-pro" : iaConfig.model;

    // 🔑 upsert con onConflict en user_id → resuelve el duplicate key
    const { error } = await supabase
      .from("chat_ia_gemini")
      .upsert(
        {
          user_id: user.id,
          api_key: iaConfig.api_key,
          model: modelToSave,
          system_instruction: iaConfig.system_instruction,
          is_active: iaConfig.is_active,
          temperature: iaConfig.temperature,
          max_tokens: iaConfig.max_tokens,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (error) {
      console.error("Error guardando IA:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "✅ IA Guardada", description: "Configuración de IA actualizada correctamente" });

      const { data } = await supabase
        .from("chat_ia_gemini")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
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
    { id: "qr" as const, label: "QR WhatsApp", icon: QrCode },
    { id: "ia" as const, label: "IA", icon: Bot },
    { id: "chat" as const, label: "Chat", icon: Globe },
  ];

  // ⚠️ Acá iba tu JSX original. Lo dejo intacto desde el `if (loading)` en adelante:
  // Pegá tu mismo bloque JSX (return) sin cambios, ya que el bug NO estaba ahí.
  // Solo cambiaron: el useEffect (ya no inserta) y handleSaveIA (upsert con onConflict).

  // ... resto del JSX igual al tuyo ...
  return null; // ← reemplazá por tu JSX existente
}
