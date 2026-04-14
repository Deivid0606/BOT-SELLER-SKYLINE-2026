import { motion } from "framer-motion";
import { Tags, Plus, Trash2 } from "lucide-react";

const mockTags = [
  { name: "venta normal cargada", color: "#22C55E", count: 45 },
  { name: "venta web cargada", color: "#4F46E5", count: 23 },
  { name: "prospecto", color: "#F59E0B", count: 67 },
  { name: "consulta", color: "#06B6D4", count: 89 },
  { name: "cancelado", color: "#EF4444", count: 12 },
];

export default function TagsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold font-heading text-gradient">Etiquetas</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Nombre de etiqueta</label>
            <input className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="ej. prospecto" />
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
            <h3 className="font-heading font-semibold text-sm">Etiquetas existentes</h3>
          </div>
          <div className="divide-y divide-border">
            {mockTags.map((tag) => (
              <div key={tag.name} className="px-4 py-3 hover:bg-secondary/30 transition-colors flex items-center gap-3">
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
                <span className="flex-1 text-sm font-medium">{tag.name}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">{tag.count}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
