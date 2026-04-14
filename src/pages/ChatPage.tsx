import { motion } from "framer-motion";
import { Bot, Send, Upload } from "lucide-react";

export default function ChatPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold font-heading text-gradient">Chat con IA</h1>
        <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">Gemini</span>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-6 space-y-4">
        <div className="flex items-start gap-3 p-4 rounded-lg bg-secondary/30 border border-border">
          <Bot className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="text-sm text-muted-foreground">
            Soy tu asistente de ventas con IA. Puedo responder consultas, analizar datos y ayudarte con tu negocio. ¿En qué te puedo ayudar?
          </div>
        </div>

        <div className="space-y-3">
          <textarea className="w-full bg-secondary/50 border border-border rounded-lg px-4 py-3 text-sm min-h-[120px] resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20" placeholder="Escribe tu mensaje…" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary border border-border text-xs text-muted-foreground cursor-pointer hover:bg-secondary/80 transition-colors">
                <Upload className="h-3.5 w-3.5" />
                Adjunto
                <input type="file" className="hidden" />
              </label>
              <span className="text-[10px] text-muted-foreground">imagen/audio</span>
            </div>
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
              <Send className="h-4 w-4" /> Preguntar
            </button>
          </div>
        </div>

        <div className="font-mono text-xs text-muted-foreground bg-secondary/30 border border-border rounded-lg p-4 min-h-[80px]">
          La respuesta de la IA aparecerá aquí...
        </div>
      </motion.div>
    </div>
  );
}
