import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Send, Upload, FileText, ChevronDown, X } from "lucide-react";

const mockTemplates = [
  { name: "BIENVENIDA", preview: "¡Hola! 👋 Bienvenido a Skyline..." },
  { name: "CATALOGO", preview: "📱 Nuestro catálogo actualizado..." },
  { name: "SEGUIMIENTO", preview: "Hola! Quería saber si..." },
  { name: "CONFIRMACION", preview: "✅ Tu pedido ha sido confirmado..." },
  { name: "PAGO", preview: "💳 Para realizar el pago..." },
];

export default function ChatPage() {
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<typeof mockTemplates[0] | null>(null);
  const [message, setMessage] = useState("");

  const handleSelectTemplate = (tpl: typeof mockTemplates[0]) => {
    setSelectedTemplate(tpl);
    setMessage(tpl.preview);
    setShowTemplates(false);
  };

  const clearTemplate = () => {
    setSelectedTemplate(null);
    setMessage("");
  };

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
          {/* Selected template indicator */}
          <AnimatePresence>
            {selectedTemplate && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 text-xs"
              >
                <FileText className="h-3.5 w-3.5 text-primary" />
                <span className="text-primary font-medium">Plantilla: {selectedTemplate.name}</span>
                <button onClick={clearTemplate} className="ml-auto text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <textarea
            className="w-full bg-secondary/50 border border-border rounded-lg px-4 py-3 text-sm min-h-[120px] resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
            placeholder="Escribe tu mensaje…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary border border-border text-xs text-muted-foreground cursor-pointer hover:bg-secondary/80 transition-colors">
                <Upload className="h-3.5 w-3.5" />
                Adjunto
                <input type="file" className="hidden" />
              </label>

              {/* Template selector */}
              <div className="relative">
                <button
                  onClick={() => setShowTemplates(!showTemplates)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:bg-secondary/80 transition-colors"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Plantillas
                  <ChevronDown className={`h-3 w-3 transition-transform ${showTemplates ? "rotate-180" : ""}`} />
                </button>

                <AnimatePresence>
                  {showTemplates && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      className="absolute bottom-full mb-2 left-0 w-64 bg-card border border-border rounded-lg shadow-lg overflow-hidden z-50"
                    >
                      <div className="px-3 py-2 border-b border-border">
                        <p className="text-xs font-semibold">Enviar plantilla</p>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {mockTemplates.map((tpl) => (
                          <button
                            key={tpl.name}
                            onClick={() => handleSelectTemplate(tpl)}
                            className="w-full text-left px-3 py-2.5 hover:bg-secondary/50 transition-colors flex items-center gap-2"
                          >
                            <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-bold">{tpl.name}</p>
                              <p className="text-[10px] text-muted-foreground truncate">{tpl.preview}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

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
