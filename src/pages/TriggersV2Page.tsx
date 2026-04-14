import { motion } from "framer-motion";
import { Rocket, Plus, Trash2, Clock, MessageSquare } from "lucide-react";

export default function TriggersV2Page() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading text-gradient">Disparadores V2</h1>
        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">Avanzado</span>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground">Nombre</label>
            <input className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="Nombre del disparador" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Tipo de trigger</label>
            <select className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm text-muted-foreground focus:outline-none focus:border-primary/50">
              <option>Palabra clave</option>
              <option>Tiempo sin respuesta</option>
              <option>Primera interacción</option>
              <option>Etiqueta aplicada</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Condición</label>
          <input className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="Condición…" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Acción / Respuesta</label>
          <textarea className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm min-h-[100px] resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="Mensaje o acción…" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-muted-foreground">Delay (minutos)</label>
            <input type="number" className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="0" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Límite de envíos</label>
            <input type="number" className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="∞" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Plantilla</label>
            <select className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm text-muted-foreground focus:outline-none focus:border-primary/50">
              <option>Ninguna</option>
              <option>BIENVENIDA</option>
              <option>CATALOGO</option>
            </select>
          </div>
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
    </div>
  );
}
