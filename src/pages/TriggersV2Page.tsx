import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Trash2,
  ShieldCheck,
  Power,
  Clock,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Megaphone,
  Tags,
  FileText,
  CalendarDays,
  Timer,
  GitBranch,
  MapPin,
  BarChart3,
  Settings2,
} from "lucide-react";
import RemarketingStats from "@/components/RemarketingStats";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const DAYS_OF_WEEK = [
  { key: "lun", label: "Lun" },
  { key: "mar", label: "Mar" },
  { key: "mie", label: "Mié" },
  { key: "jue", label: "Jue" },
  { key: "vie", label: "Vie" },
  { key: "sab", label: "Sáb" },
  { key: "dom", label: "Dom" },
] as const;

interface SecondaryTrigger {
  enabled: boolean;
  conditionType: "city" | "keyword";
  conditionValues: string[];
  response: string;
  template: string;
}

interface Trigger {
  id: string;
  name: string;
  type: string;
  condition: string;
  response: string;
  delay: number;
  send_limit: string;
  template: string | null;
  noRepeat: boolean;
  active: boolean;
  followUpEnabled: boolean;
  followUpMinutes: number;
  followUpMessage: string;
  secondary: SecondaryTrigger;
  autoTag: string;
}

interface RemarketingCampaign {
  id: string;
  name: string;
  active: boolean;
  tags: string[];
  messageType: "custom" | "template";
  customMessage: string;
  selectedTemplate: string;
  intervalDays: number;
  scheduleType: "always" | "days_hours";
  scheduleDays: string[];
  scheduleTimeFrom: string;
  scheduleTimeTo: string;
}

// Etiquetas reales cargadas desde la tabla `tags` de Supabase.
// Se mantiene el mismo shape { name, color } que usaba el mock anterior
// para no romper ninguna referencia de la UI.
type TagOption = { name: string; color: string };

const defaultSecondary: SecondaryTrigger = {
  enabled: false,
  conditionType: "city",
  conditionValues: [],
  response:
    "Lo sentimos, actualmente no tenemos cobertura en tu zona. Te avisaremos cuando estemos disponibles 📍",
  template: "Ninguna",
};

const defaultTrigger: Omit<Trigger, "id"> = {
  name: "",
  type: "Palabra clave",
  condition: "",
  response: "",
  delay: 0,
  send_limit: "",
  template: "Ninguna",
  noRepeat: false,
  active: true,
  followUpEnabled: false,
  followUpMinutes: 20,
  followUpMessage:
    "¡Hola! 👋 Vi que no pudiste responder. ¿Te gustaría aprovechar nuestra oferta? Estoy aquí para ayudarte 😊",
  secondary: { ...defaultSecondary },
  autoTag: "",
};

const defaultCampaign: Omit<RemarketingCampaign, "id"> = {
  name: "",
  active: false,
  tags: [],
  messageType: "custom",
  customMessage: "",
  selectedTemplate: "",
  intervalDays: 4,
  scheduleType: "always",
  scheduleDays: ["lun", "mar", "mie", "jue", "vie"],
  scheduleTimeFrom: "09:00",
  scheduleTimeTo: "18:00",
};

function safeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  return [];
}

function normalizeSecondary(raw: any): SecondaryTrigger {
  const secondary = raw?.secondary ?? {};

  return {
    enabled: Boolean(secondary?.enabled),
    conditionType:
      secondary?.conditionType === "keyword" ? "keyword" : "city",
    conditionValues: safeStringArray(secondary?.conditionValues),
    response:
      typeof secondary?.response === "string" && secondary.response.trim()
        ? secondary.response
        : defaultSecondary.response,
    template:
      typeof secondary?.template === "string" && secondary.template.trim()
        ? secondary.template
        : "Ninguna",
  };
}

function normalizeTrigger(raw: any): Trigger {
  return {
    id: String(raw?.id ?? Date.now()),
    name: typeof raw?.name === "string" ? raw.name : "",
    type: typeof raw?.type === "string" ? raw.type : "Palabra clave",
    condition: typeof raw?.condition === "string" ? raw.condition : "",
    response: typeof raw?.response === "string" ? raw.response : "",
    delay: Number(raw?.delay ?? 0) || 0,
    send_limit:
      raw?.send_limit === null || raw?.send_limit === undefined
        ? ""
        : String(raw.send_limit),
    template:
      typeof raw?.template === "string" && raw.template.trim()
        ? raw.template
        : "Ninguna",
    noRepeat: Boolean(raw?.no_repeat ?? raw?.noRepeat ?? false),
    active:
      raw?.active === null || raw?.active === undefined ? true : Boolean(raw.active),
    followUpEnabled: Boolean(
      raw?.follow_up_enabled ?? raw?.followUpEnabled ?? false
    ),
    followUpMinutes: Number(
      raw?.follow_up_minutes ?? raw?.followUpMinutes ?? 20
    ) || 20,
    followUpMessage:
      typeof raw?.follow_up_message === "string"
        ? raw.follow_up_message
        : typeof raw?.followUpMessage === "string"
        ? raw.followUpMessage
        : defaultTrigger.followUpMessage,
    secondary: normalizeSecondary(raw),
    autoTag:
      typeof raw?.auto_tag === "string"
        ? raw.auto_tag
        : typeof raw?.autoTag === "string"
        ? raw.autoTag
        : "",
  };
}

function normalizeCampaign(raw: any): RemarketingCampaign {
  return {
    id: String(raw?.id ?? Date.now()),
    name: typeof raw?.name === "string" ? raw.name : "",
    active: Boolean(raw?.active),
    tags: safeStringArray(raw?.tags),
    messageType:
      raw?.message_type === "template" || raw?.messageType === "template"
        ? "template"
        : "custom",
    customMessage:
      typeof raw?.custom_message === "string"
        ? raw.custom_message
        : typeof raw?.customMessage === "string"
        ? raw.customMessage
        : "",
    selectedTemplate:
      typeof raw?.selected_template === "string"
        ? raw.selected_template
        : typeof raw?.selectedTemplate === "string"
        ? raw.selectedTemplate
        : "",
    intervalDays: Number(raw?.interval_days ?? raw?.intervalDays ?? 4) || 4,
    scheduleType:
      raw?.schedule_type === "days_hours" || raw?.scheduleType === "days_hours"
        ? "days_hours"
        : "always",
    scheduleDays: safeStringArray(raw?.schedule_days ?? raw?.scheduleDays).length
      ? safeStringArray(raw?.schedule_days ?? raw?.scheduleDays)
      : ["lun", "mar", "mie", "jue", "vie"],
    scheduleTimeFrom:
      typeof raw?.schedule_time_from === "string"
        ? raw.schedule_time_from
        : typeof raw?.scheduleTimeFrom === "string"
        ? raw.scheduleTimeFrom
        : "09:00",
    scheduleTimeTo:
      typeof raw?.schedule_time_to === "string"
        ? raw.schedule_time_to
        : typeof raw?.scheduleTimeTo === "string"
        ? raw.scheduleTimeTo
        : "18:00",
  };
}

export default function TriggersV2Page() {
  const { user } = useAuth();

  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingTriggers, setLoadingTriggers] = useState(true);

  const [campaigns, setCampaigns] = useState<RemarketingCampaign[]>([]);
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const [editingCampaign, setEditingCampaign] =
    useState<RemarketingCampaign | null>(null);

  const [activeTab, setActiveTab] = useState<"triggers" | "remarketing">(
    "triggers"
  );
  const [remarketingSubTab, setRemarketingSubTab] = useState<
    "campaigns" | "stats"
  >("campaigns");

  const [realTemplates, setRealTemplates] = useState<string[]>([]);
  const [realTags, setRealTags] = useState<TagOption[]>([]);

  const inputClass =
    "w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors";

  const loadTriggers = async () => {
    if (!user) {
      setLoadingTriggers(false);
      return;
    }

    try {
      setLoadingTriggers(true);

      const { data, error } = await supabase
        .from("triggers")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error cargando triggers:", error);
        setTriggers([]);
        return;
      }

      const safeTriggers = Array.isArray(data)
        ? data.map(normalizeTrigger)
        : [];

      setTriggers(safeTriggers);
    } catch (err) {
      console.error("Error inesperado cargando triggers:", err);
      setTriggers([]);
    } finally {
      setLoadingTriggers(false);
    }
  };

  const loadCampaigns = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("remarketing_campaigns")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error cargando campañas:", error);
        setCampaigns([]);
        return;
      }

      const safeCampaigns = Array.isArray(data)
        ? data.map(normalizeCampaign)
        : [];

      setCampaigns(safeCampaigns);
    } catch (err) {
      console.error("Error inesperado cargando campañas:", err);
      setCampaigns([]);
    }
  };

  useEffect(() => {
    const loadTemplates = async () => {
      if (!user) return;

      try {
        const { data, error } = await supabase
          .from("templates")
          .select("name")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .order("created_at", { ascending: false });

        if (error) {
          console.error("Error cargando plantillas:", error);
          setRealTemplates([]);
          return;
        }

        setRealTemplates(
          Array.isArray(data)
            ? data
                .map((t: any) => t?.name)
                .filter((name: unknown): name is string => typeof name === "string")
            : []
        );
      } catch (err) {
        console.error("Error inesperado cargando plantillas:", err);
        setRealTemplates([]);
      }
    };

    loadTemplates();
    loadTriggers();
    loadCampaigns();
  }, [user]);

  // Carga las etiquetas reales del usuario desde la tabla `tags`
  // y las refresca cuando otra pestaña (Tags / Inbox) las modifique.
  useEffect(() => {
    if (!user) {
      setRealTags([]);
      return;
    }

    const loadTags = async () => {
      try {
        const { data, error } = await supabase
          .from("tags")
          .select("name, color")
          .eq("user_id", user.id)
          .order("name", { ascending: true });

        if (error) {
          console.error("Error cargando etiquetas:", error);
          setRealTags([]);
          return;
        }

        setRealTags(
          Array.isArray(data)
            ? data
                .filter(
                  (t: any) =>
                    typeof t?.name === "string" && typeof t?.color === "string"
                )
                .map((t: any) => ({ name: t.name, color: t.color }))
            : []
        );
      } catch (err) {
        console.error("Error inesperado cargando etiquetas:", err);
        setRealTags([]);
      }
    };

    loadTags();

    // Refrescar al volver a la pestaña (otra vista pudo crear/borrar etiquetas)
    const onFocus = () => loadTags();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [user]);

  const toggleActive = async (id: string) => {
    const trigger = triggers.find((t) => t.id === id);
    if (!trigger || !user) return;

    const nextActive = !trigger.active;

    const { error } = await supabase
      .from("triggers")
      .update({
        active: nextActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error actualizando trigger:", error);
      alert("Error al actualizar: " + error.message);
      return;
    }

    setTriggers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, active: nextActive } : t))
    );

    if (editingTrigger?.id === id) {
      setEditingTrigger({ ...editingTrigger, active: nextActive });
    }
  };

  const deleteTrigger = async (id: string) => {
    if (!user) return;
    if (!confirm("¿Eliminar este disparador?")) return;

    const { error } = await supabase
      .from("triggers")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error eliminando trigger:", error);
      alert("Error al eliminar: " + error.message);
      return;
    }

    setTriggers((prev) => prev.filter((t) => t.id !== id));
    if (expandedId === id) setExpandedId(null);
    if (editingTrigger?.id === id) setEditingTrigger(null);
  };

  const addNew = () => {
    const newTrigger: Trigger = {
      ...defaultTrigger,
      id: crypto.randomUUID(),
    };
    setTriggers((prev) => [newTrigger, ...prev]);
    setExpandedId(newTrigger.id);
    setEditingTrigger(newTrigger);
  };

  const startEdit = (trigger: Trigger) => {
    setExpandedId((prev) => (prev === trigger.id ? null : trigger.id));
    setEditingTrigger(normalizeTrigger(trigger));
  };

  const saveEdit = async () => {
    if (!editingTrigger || !user) {
      alert("No hay datos para guardar");
      return;
    }

    if (!editingTrigger.name.trim()) {
      alert("El nombre del disparador es obligatorio");
      return;
    }

    if (!editingTrigger.condition.trim()) {
      alert("La condición (palabra clave) es obligatoria");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        id: editingTrigger.id,
        user_id: user.id,
        name: editingTrigger.name.trim(),
        type: editingTrigger.type,
        condition: editingTrigger.condition.trim().toLowerCase(),
        response: editingTrigger.response ?? "",
        delay: Number(editingTrigger.delay) || 0,
        send_limit: editingTrigger.send_limit ?? "",
        template:
          !editingTrigger.template || editingTrigger.template === "Ninguna"
            ? null
            : editingTrigger.template,
        no_repeat: Boolean(editingTrigger.noRepeat),
        active: Boolean(editingTrigger.active),
        follow_up_enabled: Boolean(editingTrigger.followUpEnabled),
        follow_up_minutes: Number(editingTrigger.followUpMinutes) || 20,
        follow_up_message:
          editingTrigger.followUpMessage || defaultTrigger.followUpMessage,
        auto_tag: editingTrigger.autoTag || null,
        secondary: {
          enabled: Boolean(editingTrigger.secondary?.enabled),
          conditionType:
            editingTrigger.secondary?.conditionType === "keyword"
              ? "keyword"
              : "city",
          conditionValues: safeStringArray(
            editingTrigger.secondary?.conditionValues
          ),
          response:
            editingTrigger.secondary?.response || defaultSecondary.response,
          template:
            editingTrigger.secondary?.template || defaultSecondary.template,
        },
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("triggers").upsert(payload);

      if (error) {
        console.error("Error guardando trigger:", error);
        alert("Error al guardar: " + error.message);
        return;
      }

      await loadTriggers();
      setExpandedId(null);
      setEditingTrigger(null);
    } catch (err) {
      console.error("Error inesperado guardando trigger:", err);
      alert("Ocurrió un error inesperado al guardar");
    } finally {
      setSaving(false);
    }
  };

  const toggleCampaignActive = async (id: string) => {
    const campaign = campaigns.find((c) => c.id === id);
    if (!campaign || !user) return;

    const nextActive = !campaign.active;

    const { error } = await supabase
      .from("remarketing_campaigns")
      .update({
        active: nextActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error actualizando campaña:", error);
      alert("Error al actualizar: " + error.message);
      return;
    }

    setCampaigns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, active: nextActive } : c))
    );

    if (editingCampaign?.id === id) {
      setEditingCampaign({ ...editingCampaign, active: nextActive });
    }
  };

  const addCampaign = () => {
    const newCampaign: RemarketingCampaign = {
      ...defaultCampaign,
      id: crypto.randomUUID(),
    };
    setCampaigns((prev) => [newCampaign, ...prev]);
    setExpandedCampaignId(newCampaign.id);
    setEditingCampaign(newCampaign);
  };

  const startEditCampaign = (campaign: RemarketingCampaign) => {
    setExpandedCampaignId((prev) => (prev === campaign.id ? null : campaign.id));
    setEditingCampaign(normalizeCampaign(campaign));
  };

  const saveCampaign = async () => {
    if (!editingCampaign || !user) return;

    if (!editingCampaign.name.trim()) {
      alert("El nombre de la campaña es obligatorio");
      return;
    }

    if (editingCampaign.tags.length === 0) {
      alert("Debes seleccionar al menos una etiqueta");
      return;
    }

    try {
      const payload = {
        id: editingCampaign.id,
        user_id: user.id,
        name: editingCampaign.name.trim(),
        active: Boolean(editingCampaign.active),
        tags: editingCampaign.tags,
        message_type: editingCampaign.messageType,
        custom_message: editingCampaign.customMessage ?? "",
        selected_template: editingCampaign.selectedTemplate ?? "",
        interval_days: Number(editingCampaign.intervalDays) || 4,
        schedule_type: editingCampaign.scheduleType,
        schedule_days: editingCampaign.scheduleDays,
        schedule_time_from: editingCampaign.scheduleTimeFrom,
        schedule_time_to: editingCampaign.scheduleTimeTo,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("remarketing_campaigns")
        .upsert(payload);

      if (error) {
        console.error("Error guardando campaña:", error);
        alert("Error al guardar: " + error.message);
        return;
      }

      await loadCampaigns();
      setExpandedCampaignId(null);
      setEditingCampaign(null);
    } catch (err) {
      console.error("Error inesperado guardando campaña:", err);
      alert("Ocurrió un error inesperado al guardar");
    }
  };

  const deleteCampaign = async (id: string) => {
    if (!user) return;
    if (!confirm("¿Eliminar esta campaña?")) return;

    const { error } = await supabase
      .from("remarketing_campaigns")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error eliminando campaña:", error);
      alert("Error al eliminar: " + error.message);
      return;
    }

    setCampaigns((prev) => prev.filter((c) => c.id !== id));
    if (expandedCampaignId === id) setExpandedCampaignId(null);
    if (editingCampaign?.id === id) setEditingCampaign(null);
  };

  const toggleCampaignTag = (tagName: string) => {
    if (!editingCampaign) return;

    const tags = editingCampaign.tags.includes(tagName)
      ? editingCampaign.tags.filter((t) => t !== tagName)
      : [...editingCampaign.tags, tagName];

    setEditingCampaign({ ...editingCampaign, tags });
  };

  if (loadingTriggers) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading text-gradient">
            Disparadores
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Automatiza respuestas, seguimientos y remarketing
          </p>
        </div>
      </div>

      <div className="flex gap-1 bg-secondary/30 p-1 rounded-lg border border-border w-fit">
        <button
          onClick={() => setActiveTab("triggers")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === "triggers"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          }`}
        >
          <Power className="h-4 w-4" /> Disparadores
        </button>
        <button
          onClick={() => setActiveTab("remarketing")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === "remarketing"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          }`}
        >
          <Megaphone className="h-4 w-4" /> Remarketing
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === "triggers" ? (
          <motion.div
            key="triggers"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="space-y-3"
          >
            <div className="flex justify-end">
              <button
                onClick={addNew}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-4 w-4" /> Nuevo disparador
              </button>
            </div>

            {triggers.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm bg-card border border-border rounded-lg">
                No hay disparadores. Crea uno nuevo para empezar.
              </div>
            ) : (
              <AnimatePresence>
                {triggers.map((trigger) => (
                  <motion.div
                    key={trigger.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    className="bg-card border border-border rounded-lg overflow-hidden"
                  >
                    <div
                      className="flex items-center gap-3 p-4 cursor-pointer"
                      onClick={() => startEdit(trigger)}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleActive(trigger.id);
                        }}
                        className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${
                          trigger.active ? "bg-emerald-500" : "bg-muted"
                        }`}
                      >
                        <div
                          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform ${
                            trigger.active ? "translate-x-6" : "translate-x-0.5"
                          }`}
                        />
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p
                            className={`text-sm font-medium truncate ${
                              trigger.active
                                ? "text-foreground"
                                : "text-muted-foreground"
                            }`}
                          >
                            {trigger.name || "Sin nombre"}
                          </p>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground shrink-0">
                            {trigger.type}
                          </span>
                        </div>

                        {trigger.followUpEnabled && (
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Clock className="h-3 w-3" /> Seguimiento en{" "}
                            {trigger.followUpMinutes} min
                          </p>
                        )}

                        {trigger.secondary?.enabled && (
                          <p className="text-[10px] text-cyan-400 flex items-center gap-1 mt-0.5">
                            <GitBranch className="h-3 w-3" /> Secundario:{" "}
                            {trigger.secondary.conditionValues.join(", ") ||
                              "sin configurar"}
                          </p>
                        )}

                        {trigger.autoTag && (
                          <p className="text-[10px] text-emerald-400 flex items-center gap-1 mt-0.5">
                            <Tags className="h-3 w-3" /> Etiqueta:{" "}
                            {trigger.autoTag}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            trigger.active
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-muted text-muted-foreground border border-border"
                          }`}
                        >
                          {trigger.active ? "Activo" : "Inactivo"}
                        </span>
                        {expandedId === trigger.id ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    <AnimatePresence>
                      {expandedId === trigger.id &&
                        editingTrigger &&
                        editingTrigger.id === trigger.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="text-xs text-muted-foreground">
                                    Nombre
                                  </label>
                                  <input
                                    className={inputClass}
                                    placeholder="Nombre del disparador"
                                    value={editingTrigger.name}
                                    onChange={(e) =>
                                      setEditingTrigger({
                                        ...editingTrigger,
                                        name: e.target.value,
                                      })
                                    }
                                  />
                                </div>

                                <div>
                                  <label className="text-xs text-muted-foreground">
                                    Tipo de trigger
                                  </label>
                                  <select
                                    className={inputClass}
                                    value={editingTrigger.type}
                                    onChange={(e) =>
                                      setEditingTrigger({
                                        ...editingTrigger,
                                        type: e.target.value,
                                      })
                                    }
                                  >
                                    <option>Palabra clave</option>
                                    <option>Tiempo sin respuesta</option>
                                    <option>Primera interacción</option>
                                    <option>Etiqueta aplicada</option>
                                  </select>
                                </div>
                              </div>

                              <div>
                                <label className="text-xs text-muted-foreground">
                                  Condición (palabra clave)
                                </label>
                                <input
                                  className={inputClass}
                                  placeholder="ej. veneno, precio, envío"
                                  value={editingTrigger.condition}
                                  onChange={(e) =>
                                    setEditingTrigger({
                                      ...editingTrigger,
                                      condition: e.target.value,
                                    })
                                  }
                                />
                                <p className="text-[10px] text-muted-foreground mt-1">
                                  Cuando el cliente escriba esta palabra, se
                                  activará el disparador
                                </p>
                              </div>

                              <div>
                                <label className="text-xs text-muted-foreground">
                                  Acción / Respuesta
                                </label>
                                <textarea
                                  className={`${inputClass} min-h-[80px] resize-y`}
                                  placeholder="Mensaje que enviará el bot..."
                                  value={editingTrigger.response}
                                  onChange={(e) =>
                                    setEditingTrigger({
                                      ...editingTrigger,
                                      response: e.target.value,
                                    })
                                  }
                                />
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                  <label className="text-xs text-muted-foreground">
                                    Delay (minutos)
                                  </label>
                                  <input
                                    type="number"
                                    className={inputClass}
                                    placeholder="0"
                                    value={editingTrigger.delay}
                                    onChange={(e) =>
                                      setEditingTrigger({
                                        ...editingTrigger,
                                        delay: Number(e.target.value) || 0,
                                      })
                                    }
                                  />
                                </div>

                                <div>
                                  <label className="text-xs text-muted-foreground">
                                    Límite de envíos
                                  </label>
                                  <input
                                    type="number"
                                    className={inputClass}
                                    placeholder="∞"
                                    value={editingTrigger.send_limit}
                                    onChange={(e) =>
                                      setEditingTrigger({
                                        ...editingTrigger,
                                        send_limit: e.target.value,
                                      })
                                    }
                                  />
                                </div>

                                <div>
                                  <label className="text-xs text-muted-foreground">
                                    Plantilla
                                  </label>
                                  <select
                                    className={inputClass}
                                    value={editingTrigger.template || "Ninguna"}
                                    onChange={(e) =>
                                      setEditingTrigger({
                                        ...editingTrigger,
                                        template:
                                          e.target.value === "Ninguna"
                                            ? null
                                            : e.target.value,
                                      })
                                    }
                                  >
                                    <option value="Ninguna">Ninguna</option>
                                    {realTemplates.map((t) => (
                                      <option key={t} value={t}>
                                        {t}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              <div
                                onClick={() =>
                                  setEditingTrigger({
                                    ...editingTrigger,
                                    noRepeat: !editingTrigger.noRepeat,
                                  })
                                }
                                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                                  editingTrigger.noRepeat
                                    ? "bg-primary/10 border-primary/30"
                                    : "bg-secondary/30 border-border hover:bg-secondary/50"
                                }`}
                              >
                                <ShieldCheck
                                  className={`h-5 w-5 shrink-0 ${
                                    editingTrigger.noRepeat
                                      ? "text-primary"
                                      : "text-muted-foreground"
                                  }`}
                                />
                                <div className="flex-1 min-w-0">
                                  <p
                                    className={`text-sm font-medium ${
                                      editingTrigger.noRepeat
                                        ? "text-primary"
                                        : "text-foreground"
                                    }`}
                                  >
                                    No repetir plantilla
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    Evita enviar la misma plantilla dos veces al
                                    mismo contacto
                                  </p>
                                </div>
                                <div
                                  className={`w-10 h-5 rounded-full transition-colors relative ${
                                    editingTrigger.noRepeat
                                      ? "bg-primary"
                                      : "bg-muted"
                                  }`}
                                >
                                  <div
                                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                                      editingTrigger.noRepeat
                                        ? "translate-x-5"
                                        : "translate-x-0.5"
                                    }`}
                                  />
                                </div>
                              </div>

                              <div
                                className={`rounded-lg border transition-all ${
                                  editingTrigger.autoTag
                                    ? "bg-emerald-500/5 border-emerald-500/30"
                                    : "bg-secondary/30 border-border"
                                }`}
                              >
                                <div className="flex items-center gap-3 p-3">
                                  <Tags
                                    className={`h-5 w-5 shrink-0 ${
                                      editingTrigger.autoTag
                                        ? "text-emerald-400"
                                        : "text-muted-foreground"
                                    }`}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p
                                      className={`text-sm font-medium ${
                                        editingTrigger.autoTag
                                          ? "text-emerald-400"
                                          : "text-foreground"
                                      }`}
                                    >
                                      Etiquetar automáticamente
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                      Asigna una etiqueta al contacto cuando se
                                      activa este disparador
                                    </p>
                                  </div>
                                </div>
                                <div className="px-3 pb-3">
                                  <select
                                    className={inputClass}
                                    value={editingTrigger.autoTag}
                                    onChange={(e) =>
                                      setEditingTrigger({
                                        ...editingTrigger,
                                        autoTag: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="">Sin etiqueta</option>
                                    {realTags.map((tag) => (
                                      <option key={tag.name} value={tag.name}>
                                        {tag.name}
                                      </option>
                                    ))}
                                  </select>

                                  {editingTrigger.autoTag && (
                                    <div className="flex items-center gap-2 mt-2">
                                      <div
                                        className="h-3 w-3 rounded-full"
                                        style={{
                                          backgroundColor:
                                            realTags.find(
                                              (t) =>
                                                t.name === editingTrigger.autoTag
                                            )?.color || "#888",
                                        }}
                                      />
                                      <span className="text-xs text-emerald-400">
                                        {editingTrigger.autoTag}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div
                                className={`rounded-lg border transition-all ${
                                  editingTrigger.followUpEnabled
                                    ? "bg-amber-500/5 border-amber-500/30"
                                    : "bg-secondary/30 border-border"
                                }`}
                              >
                                <div
                                  onClick={() =>
                                    setEditingTrigger({
                                      ...editingTrigger,
                                      followUpEnabled:
                                        !editingTrigger.followUpEnabled,
                                    })
                                  }
                                  className="flex items-center gap-3 p-3 cursor-pointer"
                                >
                                  <MessageSquare
                                    className={`h-5 w-5 shrink-0 ${
                                      editingTrigger.followUpEnabled
                                        ? "text-amber-400"
                                        : "text-muted-foreground"
                                    }`}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p
                                      className={`text-sm font-medium ${
                                        editingTrigger.followUpEnabled
                                          ? "text-amber-400"
                                          : "text-foreground"
                                      }`}
                                    >
                                      Seguimiento automático
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                      Si el cliente no responde, enviar un
                                      mensaje de seguimiento
                                    </p>
                                  </div>
                                  <div
                                    className={`w-10 h-5 rounded-full transition-colors relative ${
                                      editingTrigger.followUpEnabled
                                        ? "bg-amber-500"
                                        : "bg-muted"
                                    }`}
                                  >
                                    <div
                                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                                        editingTrigger.followUpEnabled
                                          ? "translate-x-5"
                                          : "translate-x-0.5"
                                      }`}
                                    />
                                  </div>
                                </div>

                                <AnimatePresence>
                                  {editingTrigger.followUpEnabled && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: "auto", opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      className="overflow-hidden"
                                    >
                                      <div className="px-3 pb-3 space-y-3">
                                        <div>
                                          <label className="text-xs text-muted-foreground">
                                            Tiempo de espera (minutos)
                                          </label>
                                          <div className="flex items-center gap-2 mt-1">
                                            <Clock className="h-4 w-4 text-amber-400 shrink-0" />
                                            <input
                                              type="number"
                                              min={1}
                                              className={inputClass}
                                              value={
                                                editingTrigger.followUpMinutes
                                              }
                                              onChange={(e) =>
                                                setEditingTrigger({
                                                  ...editingTrigger,
                                                  followUpMinutes: Math.max(
                                                    1,
                                                    Number(e.target.value) || 1
                                                  ),
                                                })
                                              }
                                            />
                                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                                              min
                                            </span>
                                          </div>
                                        </div>

                                        <div>
                                          <label className="text-xs text-muted-foreground">
                                            Mensaje de seguimiento
                                          </label>
                                          <textarea
                                            className={`${inputClass} min-h-[80px] resize-y`}
                                            placeholder="Escribe el mensaje…"
                                            value={editingTrigger.followUpMessage}
                                            onChange={(e) =>
                                              setEditingTrigger({
                                                ...editingTrigger,
                                                followUpMessage: e.target.value,
                                              })
                                            }
                                          />
                                        </div>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>

                              <div
                                className={`rounded-lg border transition-all ${
                                  editingTrigger.secondary?.enabled
                                    ? "bg-cyan-500/5 border-cyan-500/30"
                                    : "bg-secondary/30 border-border"
                                }`}
                              >
                                <div
                                  onClick={() =>
                                    setEditingTrigger({
                                      ...editingTrigger,
                                      secondary: {
                                        ...editingTrigger.secondary,
                                        enabled:
                                          !editingTrigger.secondary.enabled,
                                      },
                                    })
                                  }
                                  className="flex items-center gap-3 p-3 cursor-pointer"
                                >
                                  <GitBranch
                                    className={`h-5 w-5 shrink-0 ${
                                      editingTrigger.secondary?.enabled
                                        ? "text-cyan-400"
                                        : "text-muted-foreground"
                                    }`}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p
                                      className={`text-sm font-medium ${
                                        editingTrigger.secondary?.enabled
                                          ? "text-cyan-400"
                                          : "text-foreground"
                                      }`}
                                    >
                                      Disparador secundario
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                      Si detecta una condición especial, envía
                                      una respuesta diferente
                                    </p>
                                  </div>
                                  <div
                                    className={`w-10 h-5 rounded-full transition-colors relative ${
                                      editingTrigger.secondary?.enabled
                                        ? "bg-cyan-500"
                                        : "bg-muted"
                                    }`}
                                  >
                                    <div
                                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                                        editingTrigger.secondary?.enabled
                                          ? "translate-x-5"
                                          : "translate-x-0.5"
                                      }`}
                                    />
                                  </div>
                                </div>

                                <AnimatePresence>
                                  {editingTrigger.secondary?.enabled && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: "auto", opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      className="overflow-hidden"
                                    >
                                      <div className="px-3 pb-3 space-y-3">
                                        <div>
                                          <label className="text-xs text-muted-foreground">
                                            Tipo de condición
                                          </label>
                                          <div className="flex gap-1 mt-1 bg-secondary/30 p-1 rounded-lg border border-border w-fit">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setEditingTrigger({
                                                  ...editingTrigger,
                                                  secondary: {
                                                    ...editingTrigger.secondary,
                                                    conditionType: "city",
                                                  },
                                                })
                                              }
                                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                                editingTrigger.secondary
                                                  .conditionType === "city"
                                                  ? "bg-cyan-500 text-white shadow-sm"
                                                  : "text-muted-foreground hover:text-foreground"
                                              }`}
                                            >
                                              <MapPin className="h-3 w-3" />{" "}
                                              Ciudades
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setEditingTrigger({
                                                  ...editingTrigger,
                                                  secondary: {
                                                    ...editingTrigger.secondary,
                                                    conditionType: "keyword",
                                                  },
                                                })
                                              }
                                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                                editingTrigger.secondary
                                                  .conditionType === "keyword"
                                                  ? "bg-cyan-500 text-white shadow-sm"
                                                  : "text-muted-foreground hover:text-foreground"
                                              }`}
                                            >
                                              <MessageSquare className="h-3 w-3" />{" "}
                                              Palabras clave
                                            </button>
                                          </div>
                                        </div>

                                        <div>
                                          <label className="text-xs text-muted-foreground flex items-center gap-1">
                                            {editingTrigger.secondary
                                              .conditionType === "city" ? (
                                              <>
                                                <MapPin className="h-3 w-3" />{" "}
                                                Ciudades sin cobertura (separar
                                                con coma)
                                              </>
                                            ) : (
                                              <>
                                                <MessageSquare className="h-3 w-3" />{" "}
                                                Palabras clave (separar con coma)
                                              </>
                                            )}
                                          </label>
                                          <input
                                            className={inputClass}
                                            placeholder={
                                              editingTrigger.secondary
                                                .conditionType === "city"
                                                ? "ej. Encarnación, Pedro Juan, Salto del Guairá"
                                                : "ej. no quiero, cancelar, no gracias"
                                            }
                                            value={editingTrigger.secondary.conditionValues.join(
                                              ", "
                                            )}
                                            onChange={(e) =>
                                              setEditingTrigger({
                                                ...editingTrigger,
                                                secondary: {
                                                  ...editingTrigger.secondary,
                                                  conditionValues: e.target.value
                                                    .split(",")
                                                    .map((v) => v.trim())
                                                    .filter(Boolean),
                                                },
                                              })
                                            }
                                          />
                                        </div>

                                        <div>
                                          <label className="text-xs text-muted-foreground">
                                            Respuesta del secundario
                                          </label>
                                          <textarea
                                            className={`${inputClass} min-h-[80px] resize-y`}
                                            placeholder="Mensaje alternativo..."
                                            value={editingTrigger.secondary.response}
                                            onChange={(e) =>
                                              setEditingTrigger({
                                                ...editingTrigger,
                                                secondary: {
                                                  ...editingTrigger.secondary,
                                                  response: e.target.value,
                                                },
                                              })
                                            }
                                          />
                                        </div>

                                        <div>
                                          <label className="text-xs text-muted-foreground">
                                            O usar plantilla
                                          </label>
                                          <select
                                            className={inputClass}
                                            value={editingTrigger.secondary.template}
                                            onChange={(e) =>
                                              setEditingTrigger({
                                                ...editingTrigger,
                                                secondary: {
                                                  ...editingTrigger.secondary,
                                                  template: e.target.value,
                                                },
                                              })
                                            }
                                          >
                                            <option>Ninguna</option>
                                            {realTemplates.map((t) => (
                                              <option key={t}>{t}</option>
                                            ))}
                                          </select>
                                        </div>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>

                              <div className="flex gap-2 pt-1">
                                <button
                                  onClick={saveEdit}
                                  disabled={saving}
                                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                                >
                                  <Plus className="h-4 w-4" />{" "}
                                  {saving ? "Guardando..." : "Guardar"}
                                </button>
                                <button
                                  onClick={() => deleteTrigger(trigger.id)}
                                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20 hover:bg-destructive/20 transition-colors"
                                >
                                  <Trash2 className="h-4 w-4" /> Eliminar
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="remarketing"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-4"
          >
            <div className="flex gap-1 bg-secondary/30 p-1 rounded-lg border border-border w-fit">
              <button
                onClick={() => setRemarketingSubTab("campaigns")}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  remarketingSubTab === "campaigns"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Settings2 className="h-3.5 w-3.5" /> Campañas
              </button>
              <button
                onClick={() => setRemarketingSubTab("stats")}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  remarketingSubTab === "stats"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <BarChart3 className="h-3.5 w-3.5" /> Estadísticas
              </button>
            </div>

            {remarketingSubTab === "stats" ? (
              <RemarketingStats />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Envía mensajes masivos por etiqueta, 1 vez cada X días
                  </p>
                  <button
                    onClick={addCampaign}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    <Plus className="h-4 w-4" /> Nueva campaña
                  </button>
                </div>

                <AnimatePresence>
                  {campaigns.map((campaign) => (
                    <motion.div
                      key={campaign.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      className="bg-card border border-border rounded-lg overflow-hidden"
                    >
                      <div
                        className="flex items-center gap-3 p-4 cursor-pointer"
                        onClick={() => startEditCampaign(campaign)}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCampaignActive(campaign.id);
                          }}
                          className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${
                            campaign.active ? "bg-emerald-500" : "bg-muted"
                          }`}
                        >
                          <div
                            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform ${
                              campaign.active ? "translate-x-6" : "translate-x-0.5"
                            }`}
                          />
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Megaphone
                              className={`h-4 w-4 shrink-0 ${
                                campaign.active
                                  ? "text-primary"
                                  : "text-muted-foreground"
                              }`}
                            />
                            <p
                              className={`text-sm font-medium truncate ${
                                campaign.active
                                  ? "text-foreground"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {campaign.name || "Sin nombre"}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {campaign.tags.map((tag) => {
                              const found = realTags.find((t) => t.name === tag);
                              return (
                                <span
                                  key={tag}
                                  className="text-[10px] px-1.5 py-0.5 rounded-full border border-border flex items-center gap-1"
                                >
                                  <span
                                    className="w-2 h-2 rounded-full shrink-0"
                                    style={{
                                      backgroundColor: found?.color || "#888",
                                    }}
                                  />
                                  {tag}
                                </span>
                              );
                            })}

                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <CalendarDays className="h-3 w-3" /> cada{" "}
                              {campaign.intervalDays} días
                            </span>

                            {campaign.scheduleType === "days_hours" && (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Timer className="h-3 w-3" />{" "}
                                {campaign.scheduleDays.join(", ")}{" "}
                                {campaign.scheduleTimeFrom}-{campaign.scheduleTimeTo}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              campaign.active
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : "bg-muted text-muted-foreground border border-border"
                            }`}
                          >
                            {campaign.active ? "Activo" : "Inactivo"}
                          </span>
                          {expandedCampaignId === campaign.id ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </div>

                      <AnimatePresence>
                        {expandedCampaignId === campaign.id &&
                          editingCampaign &&
                          editingCampaign.id === campaign.id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
                                <div>
                                  <label className="text-xs text-muted-foreground">
                                    Nombre de la campaña
                                  </label>
                                  <input
                                    className={inputClass}
                                    placeholder="ej. Oferta Semanal"
                                    value={editingCampaign.name}
                                    onChange={(e) =>
                                      setEditingCampaign({
                                        ...editingCampaign,
                                        name: e.target.value,
                                      })
                                    }
                                  />
                                </div>

                                <div>
                                  <label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                                    <Tags className="h-3 w-3" /> Etiquetas
                                    (selecciona una o más)
                                  </label>
                                  <div className="flex flex-wrap gap-2">
                                    {realTags.map((tag) => {
                                      const selected =
                                        editingCampaign.tags.includes(tag.name);

                                      return (
                                        <button
                                          key={tag.name}
                                          type="button"
                                          onClick={() =>
                                            toggleCampaignTag(tag.name)
                                          }
                                          className={`text-xs px-3 py-1.5 rounded-full border transition-all flex items-center gap-1.5 ${
                                            selected
                                              ? "border-primary bg-primary/10 text-primary font-medium"
                                              : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/50"
                                          }`}
                                        >
                                          <span
                                            className="w-2.5 h-2.5 rounded-full shrink-0"
                                            style={{
                                              backgroundColor: tag.color,
                                            }}
                                          />
                                          {tag.name}
                                        </button>
                                      );
                                    })}
                                  </div>

                                  {editingCampaign.tags.length === 0 && (
                                    <p className="text-[10px] text-destructive mt-1">
                                      Selecciona al menos una etiqueta
                                    </p>
                                  )}
                                </div>

                                <div>
                                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                                    <CalendarDays className="h-3 w-3" /> Enviar
                                    1 vez cada
                                  </label>
                                  <div className="flex items-center gap-2 mt-1">
                                    <input
                                      type="number"
                                      min={1}
                                      className={`${inputClass} max-w-[100px]`}
                                      value={editingCampaign.intervalDays}
                                      onChange={(e) =>
                                        setEditingCampaign({
                                          ...editingCampaign,
                                          intervalDays: Math.max(
                                            1,
                                            Number(e.target.value) || 1
                                          ),
                                        })
                                      }
                                    />
                                    <span className="text-sm text-muted-foreground">
                                      días
                                    </span>
                                  </div>
                                </div>

                                <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-3">
                                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Timer className="h-3 w-3" /> Programación
                                    horaria
                                  </label>

                                  <div className="flex gap-1 bg-secondary/30 p-1 rounded-lg border border-border w-fit">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEditingCampaign({
                                          ...editingCampaign,
                                          scheduleType: "always",
                                        })
                                      }
                                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                        editingCampaign.scheduleType === "always"
                                          ? "bg-primary text-primary-foreground shadow-sm"
                                          : "text-muted-foreground hover:text-foreground"
                                      }`}
                                    >
                                      Siempre
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEditingCampaign({
                                          ...editingCampaign,
                                          scheduleType: "days_hours",
                                        })
                                      }
                                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                        editingCampaign.scheduleType ===
                                        "days_hours"
                                          ? "bg-primary text-primary-foreground shadow-sm"
                                          : "text-muted-foreground hover:text-foreground"
                                      }`}
                                    >
                                      Días y horario
                                    </button>
                                  </div>

                                  <AnimatePresence>
                                    {editingCampaign.scheduleType ===
                                      "days_hours" && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden space-y-3"
                                      >
                                        <div>
                                          <label className="text-[10px] text-muted-foreground mb-1.5 block">
                                            Días de envío
                                          </label>
                                          <div className="flex gap-1.5 flex-wrap">
                                            {DAYS_OF_WEEK.map((day) => {
                                              const selected =
                                                editingCampaign.scheduleDays.includes(
                                                  day.key
                                                );
                                              return (
                                                <button
                                                  key={day.key}
                                                  type="button"
                                                  onClick={() => {
                                                    const days = selected
                                                      ? editingCampaign.scheduleDays.filter(
                                                          (d) => d !== day.key
                                                        )
                                                      : [
                                                          ...editingCampaign.scheduleDays,
                                                          day.key,
                                                        ];

                                                    setEditingCampaign({
                                                      ...editingCampaign,
                                                      scheduleDays: days,
                                                    });
                                                  }}
                                                  className={`w-10 h-10 rounded-lg text-xs font-medium transition-all border ${
                                                    selected
                                                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                                      : "bg-secondary/30 text-muted-foreground border-border hover:bg-secondary/50"
                                                  }`}
                                                >
                                                  {day.label}
                                                </button>
                                              );
                                            })}
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-3">
                                          <div>
                                            <label className="text-[10px] text-muted-foreground">
                                              Desde
                                            </label>
                                            <input
                                              type="time"
                                              className={`${inputClass} max-w-[130px]`}
                                              value={
                                                editingCampaign.scheduleTimeFrom
                                              }
                                              onChange={(e) =>
                                                setEditingCampaign({
                                                  ...editingCampaign,
                                                  scheduleTimeFrom:
                                                    e.target.value,
                                                })
                                              }
                                            />
                                          </div>

                                          <span className="text-muted-foreground text-sm mt-4">
                                            —
                                          </span>

                                          <div>
                                            <label className="text-[10px] text-muted-foreground">
                                              Hasta
                                            </label>
                                            <input
                                              type="time"
                                              className={`${inputClass} max-w-[130px]`}
                                              value={
                                                editingCampaign.scheduleTimeTo
                                              }
                                              onChange={(e) =>
                                                setEditingCampaign({
                                                  ...editingCampaign,
                                                  scheduleTimeTo: e.target.value,
                                                })
                                              }
                                            />
                                          </div>
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>

                                <div>
                                  <label className="text-xs text-muted-foreground mb-2 block">
                                    Tipo de mensaje
                                  </label>
                                  <div className="flex gap-1 bg-secondary/30 p-1 rounded-lg border border-border w-fit">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEditingCampaign({
                                          ...editingCampaign,
                                          messageType: "custom",
                                        })
                                      }
                                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                        editingCampaign.messageType === "custom"
                                          ? "bg-primary text-primary-foreground shadow-sm"
                                          : "text-muted-foreground hover:text-foreground"
                                      }`}
                                    >
                                      <MessageSquare className="h-3 w-3" />{" "}
                                      Mensaje personalizado
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEditingCampaign({
                                          ...editingCampaign,
                                          messageType: "template",
                                        })
                                      }
                                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                        editingCampaign.messageType === "template"
                                          ? "bg-primary text-primary-foreground shadow-sm"
                                          : "text-muted-foreground hover:text-foreground"
                                      }`}
                                    >
                                      <FileText className="h-3 w-3" /> Plantilla
                                    </button>
                                  </div>
                                </div>

                                <AnimatePresence mode="wait">
                                  {editingCampaign.messageType === "custom" ? (
                                    <motion.div
                                      key="custom"
                                      initial={{ opacity: 0, y: 8 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0, y: -8 }}
                                    >
                                      <label className="text-xs text-muted-foreground">
                                        Mensaje de remarketing
                                      </label>
                                      <textarea
                                        className={`${inputClass} min-h-[100px] resize-y`}
                                        placeholder="Escribe el mensaje que se enviará a todos los contactos..."
                                        value={editingCampaign.customMessage}
                                        onChange={(e) =>
                                          setEditingCampaign({
                                            ...editingCampaign,
                                            customMessage: e.target.value,
                                          })
                                        }
                                      />
                                    </motion.div>
                                  ) : (
                                    <motion.div
                                      key="template"
                                      initial={{ opacity: 0, y: 8 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0, y: -8 }}
                                    >
                                      <label className="text-xs text-muted-foreground">
                                        Seleccionar plantilla
                                      </label>
                                      <select
                                        className={inputClass}
                                        value={editingCampaign.selectedTemplate}
                                        onChange={(e) =>
                                          setEditingCampaign({
                                            ...editingCampaign,
                                            selectedTemplate: e.target.value,
                                          })
                                        }
                                      >
                                        <option value="">
                                          Seleccionar plantilla
                                        </option>
                                        {realTemplates.map((t) => (
                                          <option key={t}>{t}</option>
                                        ))}
                                      </select>
                                    </motion.div>
                                  )}
                                </AnimatePresence>

                                <div className="flex gap-2 pt-1">
                                  <button
                                    onClick={saveCampaign}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                                  >
                                    <Plus className="h-4 w-4" /> Guardar
                                  </button>
                                  <button
                                    onClick={() => deleteCampaign(campaign.id)}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20 hover:bg-destructive/20 transition-colors"
                                  >
                                    <Trash2 className="h-4 w-4" /> Eliminar
                                  </button>
                                </div>
                              </div>
                            </motion.div>
                          )}
                      </AnimatePresence>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {campaigns.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground text-sm">
                    No hay campañas de remarketing. Crea una nueva para empezar.
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
