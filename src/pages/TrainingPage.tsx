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

  // Función mejorada para procesar ejemplos
  const processExamples = (text: string): string[] => {
    if (!text.trim()) return [];
    
    // Dividir por saltos de línea
    let lines = text.split('\n').filter(line => line.trim());
    
    // Si hay líneas, procesar cada una
    if (lines.length > 0) {
      let allExamples: string[] = [];
      
      lines.forEach(line => {
        const trimmed = line.trim();
        
        // Si la línea contiene comas, dividir por comas
        if (trimmed.includes(',')) {
          const parts = trimmed.split(',').map(p => p.trim()).filter(p => p);
          allExamples.push(...parts);
        } 
        // Si la línea contiene punto y coma, dividir por punto y coma
        else if (trimmed.includes(';')) {
          const parts = trimmed.split(';').map(p => p.trim()).filter(p => p);
          allExamples.push(...parts);
        }
        // Si la línea contiene múltiples espacios (más de 2), dividir por espacios
        else if (trimmed.includes('  ')) {
          const parts = trimmed.split(/\s+/).filter(p => p.trim());
          allExamples.push(...parts);
        }
        // Si es una sola frase, agregarla completa
        else {
          allExamples.push(trimmed);
        }
      });
      
      return allExamples.filter(ex => ex.length > 0);
    }
    
    // Si no hay saltos de línea, procesar el texto completo
    let cleanText = text.trim();
    
    // Intentar dividir por comas
    if (cleanText.includes(',')) {
      return cleanText.split(',').map(p => p.trim()).filter(p => p);
    }
    
    // Intentar dividir por punto y coma
    if (cleanText.includes(';')) {
      return cleanText.split(';').map(p => p.trim()).filter(p => p);
    }
    
    // Si hay múltiples espacios, dividir por espacios
    if (cleanText.includes('  ')) {
      return cleanText.split(/\s+/).filter(p => p.trim());
    }
    
    // Si es una sola frase, devolverla como único elemento
    return [cleanText];
  };

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

    // Procesar ejemplos con la función mejorada
    const examplesArray = processExamples(examples);
    
    if (examplesArray.length === 0) {
      alert("Por favor agrega al menos un ejemplo o frase de entrenamiento");
      return;
    }

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
        alert(`✅ Datos actualizados correctamente (${examplesArray.length} ejemplos)`);
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
        alert(`✅ Datos guardados correctamente (${examplesArray.length} ejemplos)`);
        resetForm();
        loadTrainingData();
      }
    }
    setSaving(false);
  };

  const handleEdit = (item: TrainingItem) => {
    setIntent(item.intent);
    setResponse(item.response);
    // Mostrar los ejemplos como texto plano, uno por línea
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
        <motion.div 
          initial={{ opacity: 0, y: 12 }} 
          animate={{ opacity: 1, y: 0 }} 
          className="bg-card border border-border rounded-lg p-5 space-y-4"
        >
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
            <label className="text-xs text-muted-foreground">
              Frases de ejemplo 
              <span className="text-[10px] text-muted-foreground ml-2">
                (una por línea o separadas por comas)
              </span>
            </label>
            <textarea
              value={examples}
              onChange={(e) => setExamples(e.target.value)}
              placeholder="cuánto cuesta?&#10;precio del producto&#10;valor final&#10;o también: cuánto es, cuál es el precio"
              rows={5}
              className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm font-mono resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
            <div className="flex justify-between mt-1">
              <p className="text-[10px] text-muted-foreground">
                El bot usará estas frases para identificar la intención
              </p>
              <p className="text-[10px] text-muted-foreground">
                {examples ? `${processExamples(examples).length} ejemplos` : '0 ejemplos'}
              </p>
            </div>
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

          <div className="flex gap-2 flex-wrap">
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

        <motion.div 
          initial={{ opacity: 0, y: 12 }} 
          animate={{ opacity: 1, y: 0 }} 
          transition={{ delay: 0.1 }} 
          className="bg-card border border-border rounded-lg overflow-hidden"
        >
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
            <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
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
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.examples.slice(0, 3).map((ex, idx) => (
                          <span key={idx} className="text-[9px] bg-secondary/50 px-1.5 py-0.5 rounded">
                            "{ex}"
                          </span>
                        ))}
                        {item.examples.length > 3 && (
                          <span className="text-[9px] text-muted-foreground">
                            +{item.examples.length - 3} más
                          </span>
                        )}
                      </div>
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
