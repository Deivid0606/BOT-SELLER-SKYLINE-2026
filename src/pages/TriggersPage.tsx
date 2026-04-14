import { motion } from "framer-motion";
import { Zap, Plus, Trash2 } from "lucide-react";

const mockTriggers = [
  { name: "precio", keyword: "precio", response: "📱 Nuestros precios actualizados..." },
  { name: "horario", keyword: "horario", response: "🕐 Atendemos de lunes a sábado..." },
  { name: "envio", keyword: "envio", response: "🚚 Envíos a todo Paraguay..." },
];

export default function TriggersPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading text-gradient">Disparadores</h1>
        <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-sm border border-border hover:bg-secondary/80 transition-colors">
          Recargar
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Nombre del disparador</label>
            <input className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="ej. precio" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Palabra clave</label>
            <input className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="ej. precio, costo" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Respuesta automática</label>
            <textarea className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm min-h-[100px] resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="Respuesta…" />
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
            <h3 className="font-heading font-semibold text-sm">Lista de Disparadores</h3>
          </div>
          <div className="divide-y divide-border">
            {mockTriggers.map((t) => (
              <div key={t.name} className="px-4 py-3 hover:bg-secondary/30 transition-colors cursor-pointer flex items-center gap-3">
                <Zap className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{t.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">keyword: {t.keyword}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{t.response}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
