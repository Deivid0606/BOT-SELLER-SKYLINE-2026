import { motion } from "framer-motion";
import { GraduationCap, Plus, Trash2, BookOpen } from "lucide-react";

type TrainingTopic = { topic: string; entries: number };
const mockTraining: TrainingTopic[] = [];

export default function TrainingPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold font-heading text-gradient">Entrenamiento IA</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Tema / Categoría</label>
            <input className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="ej. Productos disponibles" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Información de entrenamiento</label>
            <textarea className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm min-h-[200px] resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="Escribe la información que la IA debe conocer…" />
          </div>
          <div className="flex gap-2">
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
              <Plus className="h-4 w-4" /> Guardar
            </button>
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20 hover:bg-destructive/20 transition-colors">
              <Trash2 className="h-4 w-4" /> Eliminar
            </button>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="font-heading font-semibold text-sm">Datos de Entrenamiento</h3>
          </div>
          {mockTraining.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <BookOpen className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Aún no hay datos de entrenamiento</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {mockTraining.map((t) => (
                <div key={t.topic} className="px-4 py-3 hover:bg-secondary/30 transition-colors cursor-pointer flex items-center gap-3">
                  <BookOpen className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t.topic}</p>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">{t.entries} entradas</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
