import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Tags, Plus, Trash2, Pencil, Smile } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

const PRESET_COLORS = [
  "#22C55E", "#4F46E5", "#F59E0B", "#06B6D4", "#EF4444",
  "#EC4899", "#8B5CF6", "#F97316", "#14B8A6", "#6366F1",
  "#D946EF", "#0EA5E9", "#84CC16", "#A855F7", "#F43F5E",
  "#10B981", "#3B82F6", "#FBBF24", "#E11D48", "#64748B",
];

const POPULAR_EMOJIS = [
  "🔥", "⭐", "💎", "🎯", "🚀", "💰", "📦", "🛒", "❤️", "✅",
  "⚡", "🏷️", "📌", "🔔", "💬", "👤", "🎁", "📊", "🔴", "🟢",
  "🟡", "🔵", "⚪", "🟣", "🟠", "💜", "💚", "💙", "🤝", "📞",
];

interface Tag {
  id: string;
  name: string;
  color: string;
  count: number;
}

export default function TagsPage() {
  const { user } = useAuth();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);

  const [newName, setNewName] = useState("");
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  const inputClass = "w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors";

  // ─────────────────────────────────────────────
  // Cargar etiquetas reales desde DB + contador de uso
  // ─────────────────────────────────────────────
  const loadTags = async () => {
    if (!user) return;
    setLoading(true);
    const { data: tagsData, error } = await supabase
      .from("tags")
      .select("id, name, color")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Error cargando etiquetas", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    // Contar cuántos contactos tienen cada etiqueta
    const { data: counts } = await supabase
      .from("contact_tags")
      .select("tag_id")
      .eq("user_id", user.id);

    const countMap = new Map<string, number>();
    (counts || []).forEach((c: any) => {
      countMap.set(c.tag_id, (countMap.get(c.tag_id) || 0) + 1);
    });

    setTags(
      (tagsData || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        color: t.color || "#22C55E",
        count: countMap.get(t.id) || 0,
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    loadTags();
  }, [user]);

  const addTag = async () => {
    if (!newName.trim() || !user) return;
    const { error } = await supabase.from("tags").insert({
      user_id: user.id,
      name: newName.trim(),
      color: selectedColor,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "✅ Etiqueta creada" });
    setNewName("");
    setSelectedColor(PRESET_COLORS[0]);
    await loadTags();
  };

  const deleteTag = async (tag: Tag) => {
    if (!user) return;
    if (!window.confirm(`¿Eliminar la etiqueta "${tag.name}"?`)) return;
    // Borrar asignaciones primero (por si no hay ON DELETE CASCADE)
    await supabase.from("contact_tags").delete().eq("tag_id", tag.id);
    const { error } = await supabase.from("tags").delete().eq("id", tag.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    if (editingTag === tag.name) setEditingTag(null);
    toast({ title: "🗑️ Etiqueta eliminada" });
    await loadTags();
  };

  const startEdit = (tag: Tag) => {
    setEditingTag(tag.name);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  const saveEdit = async (tag: Tag) => {
    if (!user) return;
    const { error } = await supabase
      .from("tags")
      .update({ name: editName, color: editColor })
      .eq("id", tag.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setEditingTag(null);
    toast({ title: "✅ Etiqueta actualizada" });
    await loadTags();
  };

  const insertEmoji = (emoji: string, target: "new" | "edit") => {
    if (target === "new") {
      setNewName(prev => emoji + " " + prev.replace(/^[\p{Emoji}\s]+/u, ""));
    } else {
      setEditName(prev => emoji + " " + prev.replace(/^[\p{Emoji}\s]+/u, ""));
    }
    setShowEmojiPicker(false);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold font-heading text-gradient">Etiquetas</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Create tag */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Nombre de etiqueta</label>
            <div className="flex gap-2 mt-1">
              <input
                className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                placeholder="ej. 🎯 prospecto"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addTag()}
              />
              <div className="relative">
                <button
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className="h-full px-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/80 transition-colors text-muted-foreground hover:text-foreground"
                  title="Agregar emoji"
                >
                  <Smile className="h-4 w-4" />
                </button>
                <AnimatePresence>
                  {showEmojiPicker && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg p-3 shadow-xl w-[240px]"
                    >
                      <p className="text-[10px] text-muted-foreground mb-2 font-medium">Emojis y símbolos</p>
                      <div className="grid grid-cols-6 gap-1">
                        {POPULAR_EMOJIS.map(emoji => (
                          <button
                            key={emoji}
                            onClick={() => insertEmoji(emoji, "new")}
                            className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-secondary/80 transition-colors text-base"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2">También podés escribir emojis directamente con el teclado</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Color picker */}
          <div>
            <label className="text-xs text-muted-foreground">Color de la etiqueta</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {PRESET_COLORS.map(color => (
                <button
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  className={`h-7 w-7 rounded-full transition-all border-2 ${selectedColor === color ? "border-foreground scale-110 shadow-md" : "border-transparent hover:scale-105"}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: selectedColor }} />
              <input
                type="text"
                className="bg-secondary/50 border border-border rounded-md px-2 py-1 text-xs text-foreground w-24 font-mono focus:outline-none focus:border-primary/50"
                value={selectedColor}
                onChange={e => setSelectedColor(e.target.value)}
                placeholder="#hex"
              />
            </div>
          </div>

          {/* Preview */}
          {newName.trim() && (
            <div>
              <label className="text-xs text-muted-foreground">Vista previa</label>
              <div className="mt-1 flex items-center gap-2 bg-secondary/30 rounded-lg p-3 border border-border">
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedColor }} />
                <span className="text-sm font-medium">{newName}</span>
              </div>
            </div>
          )}

          <button onClick={addTag} disabled={!newName.trim()} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <Plus className="h-4 w-4" /> Crear etiqueta
          </button>
        </motion.div>

        {/* Existing tags */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-heading font-semibold text-sm">Etiquetas existentes</h3>
            <span className="text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{tags.length}</span>
          </div>
          <div className="divide-y divide-border">
            {loading && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">Cargando...</div>
            )}
            {!loading && tags.map((tag) => (
              <div key={tag.id}>
                <div className="px-4 py-3 hover:bg-secondary/30 transition-colors flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                  <span className="flex-1 text-sm font-medium">{tag.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">{tag.count}</span>
                  <button onClick={() => startEdit(tag)} className="text-muted-foreground hover:text-foreground transition-colors p-1">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => deleteTag(tag)} className="text-muted-foreground hover:text-destructive transition-colors p-1">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Inline edit */}
                <AnimatePresence>
                  {editingTag === tag.name && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="px-4 pb-3 space-y-3">
                        <div className="flex gap-2">
                          <input
                            className={`${inputClass} flex-1`}
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                          />
                          <div className="relative">
                            <button
                              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                              className="h-full px-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/80 transition-colors text-muted-foreground hover:text-foreground mt-1"
                            >
                              <Smile className="h-4 w-4" />
                            </button>
                            <AnimatePresence>
                              {showEmojiPicker && editingTag === tag.name && (
                                <motion.div
                                  initial={{ opacity: 0, scale: 0.95 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  exit={{ opacity: 0, scale: 0.95 }}
                                  className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg p-3 shadow-xl w-[240px]"
                                >
                                  <div className="grid grid-cols-6 gap-1">
                                    {POPULAR_EMOJIS.map(emoji => (
                                      <button
                                        key={emoji}
                                        onClick={() => insertEmoji(emoji, "edit")}
                                        className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-secondary/80 transition-colors text-base"
                                      >
                                        {emoji}
                                      </button>
                                    ))}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {PRESET_COLORS.map(color => (
                            <button
                              key={color}
                              onClick={() => setEditColor(color)}
                              className={`h-6 w-6 rounded-full transition-all border-2 ${editColor === color ? "border-foreground scale-110" : "border-transparent hover:scale-105"}`}
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => saveEdit(tag)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
                            Guardar
                          </button>
                          <button onClick={() => setEditingTag(null)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs border border-border hover:bg-secondary/80 transition-colors">
                            Cancelar
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
            {!loading && tags.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No hay etiquetas creadas
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
