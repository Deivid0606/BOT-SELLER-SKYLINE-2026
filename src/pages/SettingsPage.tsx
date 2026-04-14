import { motion } from "framer-motion";
import { Settings, Key, Globe, Bot, Users } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold font-heading text-gradient">Configuración</h1>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        {/* WhatsApp API */}
        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="h-4 w-4 text-primary" />
            <h3 className="font-heading font-semibold text-sm">WhatsApp Business API</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground">Token de API</label>
              <input type="password" className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="EAAxxxxxxx..." />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Phone Number ID</label>
              <input className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="123456789..." />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Verify Token (Webhook)</label>
            <input className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="mi_token_secreto" />
          </div>
        </div>

        {/* Gemini */}
        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Bot className="h-4 w-4 text-primary" />
            <h3 className="font-heading font-semibold text-sm">IA (Gemini)</h3>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">API Key de Gemini</label>
            <input type="password" className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="AIzaxxxxxxx..." />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Modelo preferido</label>
            <select className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm text-muted-foreground focus:outline-none focus:border-primary/50">
              <option>gemini-1.5-pro</option>
              <option>gemini-1.5-flash</option>
              <option>gemini-1.0-pro</option>
            </select>
          </div>
        </div>

        {/* Usuarios */}
        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-4 w-4 text-primary" />
            <h3 className="font-heading font-semibold text-sm">Gestión de Usuarios</h3>
          </div>
          <p className="text-xs text-muted-foreground">Administra los roles y permisos de los usuarios del panel.</p>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-sm border border-border hover:bg-secondary/80 transition-colors">
            <Key className="h-4 w-4" /> Gestionar usuarios
          </button>
        </div>

        <button className="w-full py-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          💾 Guardar Configuración
        </button>
      </motion.div>
    </div>
  );
}
