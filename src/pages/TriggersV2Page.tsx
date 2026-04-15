import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, ShieldCheck, Power, Clock, MessageSquare, ChevronDown, ChevronUp, Megaphone, Tags, FileText, CalendarDays, Timer } from "lucide-react";

const DAYS_OF_WEEK = [
  { key: "lun", label: "Lun" },
  { key: "mar", label: "Mar" },
  { key: "mie", label: "Mié" },
  { key: "jue", label: "Jue" },
  { key: "vie", label: "Vie" },
  { key: "sab", label: "Sáb" },
  { key: "dom", label: "Dom" },
];

interface Trigger {
  id: string;
  name: string;
  type: string;
  condition: string;
  response: string;
  delay: number;
  limit: string;
  template: string;
  noRepeat: boolean;
  active: boolean;
  followUpEnabled: boolean;
  followUpMinutes: number;
  followUpMessage: string;
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

const mockTags = [
  { name: "venta normal cargada", color: "#22C55E" },
  { name: "venta web cargada", color: "#4F46E5" },
  { name: "prospecto", color: "#F59E0B" },
  { name: "consulta", color: "#06B6D4" },
  { name: "cancelado", color: "#EF4444" },
];

const mockTemplates = ["BIENVENIDA", "CATALOGO", "SEGUIMIENTO", "CONFIRMACION", "PAGO"];

const defaultTrigger: Omit<Trigger, "id"> = {
  name: "",
  type: "Palabra clave",
  condition: "",
  response: "",
  delay: 0,
  limit: "",
  template: "Ninguna",
  noRepeat: false,
  active: true,
  followUpEnabled: false,
  followUpMinutes: 20,
  followUpMessage: "¡Hola! 👋 Vi que no pudiste responder. ¿Te gustaría aprovechar nuestra oferta? Estoy aquí para ayudarte 😊",
};

const defaultCampaign: Omit<RemarketingCampaign, "id"> = {
  name: "",
  active: false,
  tags: [],
  messageType: "custom",
  customMessage: "",
  selectedTemplate: mockTemplates[0],
  intervalDays: 4,
  scheduleType: "always",
  scheduleDays: ["lun", "mar", "mie", "jue", "vie"],
  scheduleTimeFrom: "09:00",
  scheduleTimeTo: "18:00",
};

export default function TriggersV2Page() {
  const [triggers, setTriggers] = useState<Trigger[]>([
    { ...defaultTrigger, id: "1", name: "Bienvenida", type: "Primera interacción", active: true },
    { ...defaultTrigger, id: "2", name: "Seguimiento oferta", type: "Tiempo sin respuesta", active: false, followUpEnabled: true, followUpMinutes: 20 },
  ]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);

  // Remarketing state
  const [campaigns, setCampaigns] = useState<RemarketingCampaign[]>([
    { ...defaultCampaign, id: "r1", name: "Oferta Semanal", active: true, tags: ["prospecto", "consulta"], customMessage: "¡Hola! 🔥 No te pierdas nuestras ofertas exclusivas de esta semana. ¿Te interesa saber más?", intervalDays: 4, scheduleType: "days_hours", scheduleDays: ["lun", "mie", "vie"], scheduleTimeFrom: "10:00", scheduleTimeTo: "17:00" },
  ]);
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const [editingCampaign, setEditingCampaign] = useState<RemarketingCampaign | null>(null);

  // Active tab
  const [activeTab, setActiveTab] = useState<"triggers" | "remarketing">("triggers");

  const toggleActive = (id: string) => {
    setTriggers(prev => prev.map(t => t.id === id ? { ...t, active: !t.active } : t));
  };

  const deleteTrigger = (id: string) => {
    setTriggers(prev => prev.filter(t => t.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const addNew = () => {
    const newT: Trigger = { ...defaultTrigger, id: Date.now().toString() };
    setTriggers(prev => [...prev, newT]);
    setExpandedId(newT.id);
    setEditingTrigger(newT);
  };

  const startEdit = (t: Trigger) => {
    setExpandedId(expandedId === t.id ? null : t.id);
    setEditingTrigger({ ...t });
  };

  const saveEdit = () => {
    if (!editingTrigger) return;
    setTriggers(prev => prev.map(t => t.id === editingTrigger.id ? editingTrigger : t));
    setExpandedId(null);
    setEditingTrigger(null);
  };

  // Remarketing handlers
  const toggleCampaignActive = (id: string) => {
    setCampaigns(prev => prev.map(c => c.id === id ? { ...c, active: !c.active } : c));
  };

  const addCampaign = () => {
    const newC: RemarketingCampaign = { ...defaultCampaign, id: Date.now().toString() };
    setCampaigns(prev => [...prev, newC]);
    setExpandedCampaignId(newC.id);
    setEditingCampaign(newC);
  };

  const startEditCampaign = (c: RemarketingCampaign) => {
    setExpandedCampaignId(expandedCampaignId === c.id ? null : c.id);
    setEditingCampaign({ ...c });
  };

  const saveCampaign = () => {
    if (!editingCampaign) return;
    setCampaigns(prev => prev.map(c => c.id === editingCampaign.id ? editingCampaign : c));
    setExpandedCampaignId(null);
    setEditingCampaign(null);
  };

  const deleteCampaign = (id: string) => {
    setCampaigns(prev => prev.filter(c => c.id !== id));
    if (expandedCampaignId === id) setExpandedCampaignId(null);
  };

  const toggleCampaignTag = (tagName: string) => {
    if (!editingCampaign) return;
    const tags = editingCampaign.tags.includes(tagName)
      ? editingCampaign.tags.filter(t => t !== tagName)
      : [...editingCampaign.tags, tagName];
    setEditingCampaign({ ...editingCampaign, tags });
  };

  const inputClass = "w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading text-gradient">Disparadores</h1>
          <p className="text-xs text-muted-foreground mt-1">Automatiza respuestas, seguimientos y remarketing</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-secondary/30 p-1 rounded-lg border border-border w-fit">
        <button
          onClick={() => setActiveTab("triggers")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === "triggers" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"}`}
        >
          <Power className="h-4 w-4" /> Disparadores
        </button>
        <button
          onClick={() => setActiveTab("remarketing")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === "remarketing" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"}`}
        >
          <Megaphone className="h-4 w-4" /> Remarketing
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === "triggers" ? (
          <motion.div key="triggers" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-3">
            <div className="flex justify-end">
              <button onClick={addNew} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                <Plus className="h-4 w-4" /> Nuevo disparador
              </button>
            </div>

            <AnimatePresence>
              {triggers.map((trigger) => (
                <motion.div
                  key={trigger.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="bg-card border border-border rounded-lg overflow-hidden"
                >
                  <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => startEdit(trigger)}>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleActive(trigger.id); }}
                      className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${trigger.active ? "bg-emerald-500" : "bg-muted"}`}
                    >
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform ${trigger.active ? "translate-x-6" : "translate-x-0.5"}`} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium truncate ${trigger.active ? "text-foreground" : "text-muted-foreground"}`}>
                          {trigger.name || "Sin nombre"}
                        </p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground shrink-0">{trigger.type}</span>
                      </div>
                      {trigger.followUpEnabled && (
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" /> Seguimiento en {trigger.followUpMinutes} min
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${trigger.active ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-muted text-muted-foreground border border-border"}`}>
                        {trigger.active ? "Activo" : "Inactivo"}
                      </span>
                      {expandedId === trigger.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>

                  <AnimatePresence>
                    {expandedId === trigger.id && editingTrigger && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                        <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="text-xs text-muted-foreground">Nombre</label>
                              <input className={inputClass} placeholder="Nombre del disparador" value={editingTrigger.name} onChange={e => setEditingTrigger({ ...editingTrigger, name: e.target.value })} />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground">Tipo de trigger</label>
                              <select className={inputClass} value={editingTrigger.type} onChange={e => setEditingTrigger({ ...editingTrigger, type: e.target.value })}>
                                <option>Palabra clave</option>
                                <option>Tiempo sin respuesta</option>
                                <option>Primera interacción</option>
                                <option>Etiqueta aplicada</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Condición</label>
                            <input className={inputClass} placeholder="Condición…" value={editingTrigger.condition} onChange={e => setEditingTrigger({ ...editingTrigger, condition: e.target.value })} />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Acción / Respuesta</label>
                            <textarea className={`${inputClass} min-h-[80px] resize-y`} placeholder="Mensaje o acción…" value={editingTrigger.response} onChange={e => setEditingTrigger({ ...editingTrigger, response: e.target.value })} />
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <label className="text-xs text-muted-foreground">Delay (minutos)</label>
                              <input type="number" className={inputClass} placeholder="0" value={editingTrigger.delay} onChange={e => setEditingTrigger({ ...editingTrigger, delay: Number(e.target.value) })} />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground">Límite de envíos</label>
                              <input type="number" className={inputClass} placeholder="∞" value={editingTrigger.limit} onChange={e => setEditingTrigger({ ...editingTrigger, limit: e.target.value })} />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground">Plantilla</label>
                              <select className={inputClass} value={editingTrigger.template} onChange={e => setEditingTrigger({ ...editingTrigger, template: e.target.value })}>
                                <option>Ninguna</option>
                                {mockTemplates.map(t => <option key={t}>{t}</option>)}
                              </select>
                            </div>
                          </div>

                          <div onClick={() => setEditingTrigger({ ...editingTrigger, noRepeat: !editingTrigger.noRepeat })} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${editingTrigger.noRepeat ? "bg-primary/10 border-primary/30" : "bg-secondary/30 border-border hover:bg-secondary/50"}`}>
                            <ShieldCheck className={`h-5 w-5 shrink-0 ${editingTrigger.noRepeat ? "text-primary" : "text-muted-foreground"}`} />
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium ${editingTrigger.noRepeat ? "text-primary" : "text-foreground"}`}>No repetir plantilla</p>
                              <p className="text-[10px] text-muted-foreground">Evita enviar la misma plantilla dos veces al mismo contacto</p>
                            </div>
                            <div className={`w-10 h-5 rounded-full transition-colors relative ${editingTrigger.noRepeat ? "bg-primary" : "bg-muted"}`}>
                              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${editingTrigger.noRepeat ? "translate-x-5" : "translate-x-0.5"}`} />
                            </div>
                          </div>

                          <div className={`rounded-lg border transition-all ${editingTrigger.followUpEnabled ? "bg-amber-500/5 border-amber-500/30" : "bg-secondary/30 border-border"}`}>
                            <div onClick={() => setEditingTrigger({ ...editingTrigger, followUpEnabled: !editingTrigger.followUpEnabled })} className="flex items-center gap-3 p-3 cursor-pointer">
                              <MessageSquare className={`h-5 w-5 shrink-0 ${editingTrigger.followUpEnabled ? "text-amber-400" : "text-muted-foreground"}`} />
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium ${editingTrigger.followUpEnabled ? "text-amber-400" : "text-foreground"}`}>Seguimiento automático</p>
                                <p className="text-[10px] text-muted-foreground">Si el cliente no responde, enviar un mensaje de seguimiento</p>
                              </div>
                              <div className={`w-10 h-5 rounded-full transition-colors relative ${editingTrigger.followUpEnabled ? "bg-amber-500" : "bg-muted"}`}>
                                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${editingTrigger.followUpEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
                              </div>
                            </div>
                            <AnimatePresence>
                              {editingTrigger.followUpEnabled && (
                                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                  <div className="px-3 pb-3 space-y-3">
                                    <div>
                                      <label className="text-xs text-muted-foreground">Tiempo de espera (minutos)</label>
                                      <div className="flex items-center gap-2 mt-1">
                                        <Clock className="h-4 w-4 text-amber-400 shrink-0" />
                                        <input type="number" min={1} className={inputClass} value={editingTrigger.followUpMinutes} onChange={e => setEditingTrigger({ ...editingTrigger, followUpMinutes: Math.max(1, Number(e.target.value)) })} />
                                        <span className="text-xs text-muted-foreground whitespace-nowrap">min</span>
                                      </div>
                                    </div>
                                    <div>
                                      <label className="text-xs text-muted-foreground">Mensaje de seguimiento</label>
                                      <textarea className={`${inputClass} min-h-[80px] resize-y`} placeholder="Escribe el mensaje…" value={editingTrigger.followUpMessage} onChange={e => setEditingTrigger({ ...editingTrigger, followUpMessage: e.target.value })} />
                                      <p className="text-[10px] text-muted-foreground mt-1">Cada vendedor puede personalizar este mensaje</p>
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>

                          <div className="flex gap-2 pt-1">
                            <button onClick={saveEdit} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                              <Plus className="h-4 w-4" /> Guardar
                            </button>
                            <button onClick={() => deleteTrigger(trigger.id)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20 hover:bg-destructive/20 transition-colors">
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

            {triggers.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-sm">No hay disparadores. Crea uno nuevo para empezar.</div>
            )}
          </motion.div>
        ) : (
          /* ==================== REMARKETING TAB ==================== */
          <motion.div key="remarketing" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Envía mensajes masivos por etiqueta, 1 vez cada X días</p>
              <button onClick={addCampaign} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
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
                  {/* Header */}
                  <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => startEditCampaign(campaign)}>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleCampaignActive(campaign.id); }}
                      className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${campaign.active ? "bg-emerald-500" : "bg-muted"}`}
                    >
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform ${campaign.active ? "translate-x-6" : "translate-x-0.5"}`} />
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Megaphone className={`h-4 w-4 shrink-0 ${campaign.active ? "text-primary" : "text-muted-foreground"}`} />
                        <p className={`text-sm font-medium truncate ${campaign.active ? "text-foreground" : "text-muted-foreground"}`}>
                          {campaign.name || "Sin nombre"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {campaign.tags.map(tag => {
                          const found = mockTags.find(t => t.name === tag);
                          return (
                            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full border border-border flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: found?.color || "#888" }} />
                              {tag}
                            </span>
                          );
                        })}
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" /> cada {campaign.intervalDays} días
                        </span>
                        {campaign.scheduleType === "days_hours" && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Timer className="h-3 w-3" /> {campaign.scheduleDays.join(", ")} {campaign.scheduleTimeFrom}-{campaign.scheduleTimeTo}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${campaign.active ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-muted text-muted-foreground border border-border"}`}>
                        {campaign.active ? "Activo" : "Inactivo"}
                      </span>
                      {expandedCampaignId === campaign.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>

                  {/* Expanded editor */}
                  <AnimatePresence>
                    {expandedCampaignId === campaign.id && editingCampaign && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                        <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
                          {/* Name */}
                          <div>
                            <label className="text-xs text-muted-foreground">Nombre de la campaña</label>
                            <input className={inputClass} placeholder="ej. Oferta Semanal" value={editingCampaign.name} onChange={e => setEditingCampaign({ ...editingCampaign, name: e.target.value })} />
                          </div>

                          {/* Tags selector (multi) */}
                          <div>
                            <label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                              <Tags className="h-3 w-3" /> Etiquetas (selecciona una o más)
                            </label>
                            <div className="flex flex-wrap gap-2">
                              {mockTags.map(tag => {
                                const selected = editingCampaign.tags.includes(tag.name);
                                return (
                                  <button
                                    key={tag.name}
                                    onClick={() => toggleCampaignTag(tag.name)}
                                    className={`text-xs px-3 py-1.5 rounded-full border transition-all flex items-center gap-1.5 ${selected ? "border-primary bg-primary/10 text-primary font-medium" : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/50"}`}
                                  >
                                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                                    {tag.name}
                                  </button>
                                );
                              })}
                            </div>
                            {editingCampaign.tags.length === 0 && (
                              <p className="text-[10px] text-destructive mt-1">Selecciona al menos una etiqueta</p>
                            )}
                          </div>

                          {/* Interval */}
                          <div>
                            <label className="text-xs text-muted-foreground flex items-center gap-1">
                              <CalendarDays className="h-3 w-3" /> Enviar 1 vez cada
                            </label>
                            <div className="flex items-center gap-2 mt-1">
                              <input
                                type="number"
                                min={1}
                                className={`${inputClass} max-w-[100px]`}
                                value={editingCampaign.intervalDays}
                                onChange={e => setEditingCampaign({ ...editingCampaign, intervalDays: Math.max(1, Number(e.target.value)) })}
                              />
                              <span className="text-sm text-muted-foreground">días</span>
                            </div>
                          </div>

                          {/* Message type toggle */}
                          <div>
                            <label className="text-xs text-muted-foreground mb-2 block">Tipo de mensaje</label>
                            <div className="flex gap-1 bg-secondary/30 p-1 rounded-lg border border-border w-fit">
                              <button
                                onClick={() => setEditingCampaign({ ...editingCampaign, messageType: "custom" })}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${editingCampaign.messageType === "custom" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                              >
                                <MessageSquare className="h-3 w-3" /> Mensaje personalizado
                              </button>
                              <button
                                onClick={() => setEditingCampaign({ ...editingCampaign, messageType: "template" })}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${editingCampaign.messageType === "template" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                              >
                                <FileText className="h-3 w-3" /> Plantilla
                              </button>
                            </div>
                          </div>

                          {/* Custom message or template selector */}
                          <AnimatePresence mode="wait">
                            {editingCampaign.messageType === "custom" ? (
                              <motion.div key="custom" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                                <label className="text-xs text-muted-foreground">Mensaje de remarketing</label>
                                <textarea
                                  className={`${inputClass} min-h-[100px] resize-y`}
                                  placeholder="Escribe el mensaje que se enviará a todos los contactos con las etiquetas seleccionadas…"
                                  value={editingCampaign.customMessage}
                                  onChange={e => setEditingCampaign({ ...editingCampaign, customMessage: e.target.value })}
                                />
                                <p className="text-[10px] text-muted-foreground mt-1">Cada vendedor puede editar este mensaje</p>
                              </motion.div>
                            ) : (
                              <motion.div key="template" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                                <label className="text-xs text-muted-foreground">Seleccionar plantilla</label>
                                <select
                                  className={inputClass}
                                  value={editingCampaign.selectedTemplate}
                                  onChange={e => setEditingCampaign({ ...editingCampaign, selectedTemplate: e.target.value })}
                                >
                                  {mockTemplates.map(t => <option key={t}>{t}</option>)}
                                </select>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {/* Actions */}
                          <div className="flex gap-2 pt-1">
                            <button onClick={saveCampaign} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                              <Plus className="h-4 w-4" /> Guardar
                            </button>
                            <button onClick={() => deleteCampaign(campaign.id)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20 hover:bg-destructive/20 transition-colors">
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
              <div className="text-center py-12 text-muted-foreground text-sm">No hay campañas de remarketing. Crea una nueva para empezar.</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
