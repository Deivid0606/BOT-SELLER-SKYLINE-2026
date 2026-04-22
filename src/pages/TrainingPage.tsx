import { motion } from "framer-motion";
import { GraduationCap, Plus, Trash2, BookOpen, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface TrainingItem {
  id: string;
  intent: string;
  examples: string[];
  response: string;
  is_active: boolean;
  created_at: string;
}

export default function TrainingPage() {
  const { user } = useAuth();
  const [trainingData, setTrainingData] = useState<TrainingItem[]>([]);
  const [intent, setIntent] = useState("");
  const [examples, setExamples] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadTrainingData = async () => {
    if (!user) return;
    
    setLoading(true);
    const { data, error } = await supabase
      .from("training_data")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error cargando:", error);
    } else {
      setTrainingData(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (user) {
      loadTrainingData();
    }
  }, [user]);

  const handleSave = async () => {
    if (!user) {
      alert("Debes iniciar sesión");
      return;
    }
    
    if (!intent.trim()) {
      alert("Por favor completa el Tema / Categoría");
      return;
    }
    if (!response.trim()) {
      alert("Por favor completa la información de entrenamiento");
      return;
    }

    const examplesArray = examples
      .split('\n')
      .filter(ex => ex.trim())
      .map(ex => ex.trim());

    setSaving(true);

    if (editingId) {
      const { error } = await supabase
        .from("training_data")
        .update({
          intent: intent.trim(),
          examples: examplesArray,
          response: response.trim(),
          updated_at: new Date().toISOString()
        })
        .eq("id", editingId)
        .eq("user_id", user.id);

      if (error) {
        console.error("Error al actualizar:", error);
        alert("Error al actualizar: " + error.message);
      } else {
        alert("✅ Datos actualizados correctamente");
        resetForm();
        loadTrainingData();
      }
    } else {
      const { error } = await supabase
        .from("training_data")
        .insert({
          user_id: user.id,
          intent: intent.trim(),
          examples: examplesArray,
          response: response.trim(),
          is_active: true
        });

      if (error) {
        console.error("Error al guardar:", error);
        alert("Error al guardar: " + error.message);
      } else {
        alert("✅ Datos guardados correctamente");
        resetForm();
        loadTrainingData();
      }
    }
    setSaving(false);
  };

  const handleEdit = (item: TrainingItem) => {
    setIntent(item.intent);
    setResponse(item.response);
    setExamples(item.examples.join('\n'));
    setEditingId(item.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este dato de entrenamiento?")) return;

    setLoading(true);
    const { error } = await supabase
      .from("training_data")
      .delete()
      .eq("id", id)
      .eq("user_id", user?.id);

    if (error) {
      console.error("Error al eliminar:", error);
      alert("Error al eliminar: " + error.message);
    } else {
      alert("✅ Dato eliminado");
      loadTrainingData();
    }
    setLoading(false);
  };

  const resetForm = () => {
    setIntent("");
    setExamples("");
    setResponse("");
    setEditingId(null);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold font-heading text-gradient">Entrenamiento IA</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Tema / Categoría</label>
            <input
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              placeholder="ej. Productos disponibles, Precios, Envíos"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Frases de ejemplo (una por línea)</label>
            <textarea
              value={examples}
              onChange={(e) => setExamples(e.target.value)}
              placeholder="cuánto cuesta?&#10;precio del producto&#10;valor final"
              rows={3}
              className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm font-mono resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              El bot usará estas frases para identificar la intención
            </p>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Información de entrenamiento</label>
            <textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm min-h-[150px] resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              placeholder="Escribe la información que la IA debe conocer…"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {saving ? "Guardando..." : (editingId ? "Actualizar" : "Guardar")}
            </button>
            {editingId && (
              <button
                onClick={resetForm}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-sm font-medium border border-border hover:bg-secondary/80 transition-colors"
              >
                Cancelar
              </button>
            )}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="font-heading font-semibold text-sm">Datos de Entrenamiento</h3>
          </div>
          {loading ? (
            <div className="px-4 py-12 text-center">
              <Loader2 className="h-8 w-8 text-muted-foreground/40 animate-spin mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Cargando...</p>
            </div>
          ) : trainingData.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <BookOpen className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Aún no hay datos de entrenamiento</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {trainingData.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleEdit(item)}
                  className="px-4 py-3 hover:bg-secondary/30 transition-colors cursor-pointer flex items-center gap-3 group"
                >
                  <GraduationCap className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.intent}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.response.substring(0, 60)}</p>
                    {item.examples.length > 0 && (
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                        {item.examples.length} ejemplo{item.examples.length !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(item.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-destructive/10 rounded"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
