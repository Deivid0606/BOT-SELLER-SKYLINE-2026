import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, ShieldCheck, Power, Clock, MessageSquare, ChevronDown, ChevronUp } from "lucide-react";

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
  // Follow-up
  followUpEnabled: boolean;
  followUpMinutes: number;
  followUpMessage: string;
}

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

export default function TriggersV2Page() {
  const [triggers, setTriggers] = useState<Trigger[]>([
    { ...defaultTrigger, id: "1", name: "Bienvenida", type: "Primera interacción", active: true },
    { ...defaultTrigger, id: "2", name: "Seguimiento oferta", type: "Tiempo sin respuesta", active: false, followUpEnabled: true, followUpMinutes: 20 },
  ]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);

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

  const inputClass = "w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading text-gradient">Disparadores</h1>
          <p className="text-xs text-muted-foreground mt-1">Automatiza respuestas y seguimientos</p>
        </div>
        <button
          onClick={addNew}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" /> Nuevo disparador
        </button>
      </div>

      <div className="space-y-3">
        <AnimatePresence>
          {triggers.map((trigger) => (
            <motion.div
              key={trigger.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="bg-card border border-border rounded-lg overflow-hidden"
            >
              {/* Header row */}
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
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground shrink-0">
                      {trigger.type}
                    </span>
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

              {/* Expanded edit */}
              <AnimatePresence>
                {expandedId === trigger.id && editingTrigger && (
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
                            <option>BIENVENIDA</option>
                            <option>CATALOGO</option>
                          </select>
                        </div>
                      </div>

                      {/* No repeat toggle */}
                      <div
                        onClick={() => setEditingTrigger({ ...editingTrigger, noRepeat: !editingTrigger.noRepeat })}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${editingTrigger.noRepeat ? "bg-primary/10 border-primary/30" : "bg-secondary/30 border-border hover:bg-secondary/50"}`}
                      >
                        <ShieldCheck className={`h-5 w-5 shrink-0 ${editingTrigger.noRepeat ? "text-primary" : "text-muted-foreground"}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${editingTrigger.noRepeat ? "text-primary" : "text-foreground"}`}>No repetir plantilla</p>
                          <p className="text-[10px] text-muted-foreground">Evita enviar la misma plantilla dos veces al mismo contacto</p>
                        </div>
                        <div className={`w-10 h-5 rounded-full transition-colors relative ${editingTrigger.noRepeat ? "bg-primary" : "bg-muted"}`}>
                          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${editingTrigger.noRepeat ? "translate-x-5" : "translate-x-0.5"}`} />
                        </div>
                      </div>

                      {/* Follow-up on "seen" / no response */}
                      <div className={`rounded-lg border transition-all ${editingTrigger.followUpEnabled ? "bg-amber-500/5 border-amber-500/30" : "bg-secondary/30 border-border"}`}>
                        <div
                          onClick={() => setEditingTrigger({ ...editingTrigger, followUpEnabled: !editingTrigger.followUpEnabled })}
                          className="flex items-center gap-3 p-3 cursor-pointer"
                        >
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
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="px-3 pb-3 space-y-3">
                                <div>
                                  <label className="text-xs text-muted-foreground">Tiempo de espera (minutos)</label>
                                  <div className="flex items-center gap-2 mt-1">
                                    <Clock className="h-4 w-4 text-amber-400 shrink-0" />
                                    <input
                                      type="number"
                                      min={1}
                                      className={inputClass}
                                      value={editingTrigger.followUpMinutes}
                                      onChange={e => setEditingTrigger({ ...editingTrigger, followUpMinutes: Math.max(1, Number(e.target.value)) })}
                                    />
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">min</span>
                                  </div>
                                </div>
                                <div>
                                  <label className="text-xs text-muted-foreground">Mensaje de seguimiento</label>
                                  <textarea
                                    className={`${inputClass} min-h-[80px] resize-y`}
                                    placeholder="Escribe el mensaje que se enviará automáticamente…"
                                    value={editingTrigger.followUpMessage}
                                    onChange={e => setEditingTrigger({ ...editingTrigger, followUpMessage: e.target.value })}
                                  />
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
          <div className="text-center py-12 text-muted-foreground text-sm">
            No hay disparadores. Crea uno nuevo para empezar.
          </div>
        )}
      </div>
    </div>
  );
}
