import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Send, Upload, FileText, ChevronDown, X, Loader2, User, Trash2, Image, Mic } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
};

type Template = {
  name: string;
  preview: string;
  content: string;
};

export default function ChatPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "¡Hola! 👋 Soy tu asistente de ventas con IA. Puedo ayudarte a:\n\n📊 Analizar tus ventas\n💬 Responder preguntas sobre productos\n📦 Gestionar pedidos\n🎯 Recomendar estrategias\n\n¿En qué puedo ayudarte hoy?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [iaActiva, setIaActiva] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Cargar plantillas reales desde Supabase
  useEffect(() => {
    const loadTemplates = async () => {
      if (!user) return;
      const { data, error } = await supabase
        .from("templates")
        .select("name, content")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(10);
      
      if (error) {
        console.error("Error cargando plantillas:", error);
        return;
      }
      
      if (data && data.length > 0) {
        setTemplates(data.map(t => ({
          name: t.name,
          preview: t.content?.substring(0, 50) + "...",
          content: t.content || "",
        })));
      }
    };
    loadTemplates();
  }, [user]);

  // Verificar si la IA está activa
  useEffect(() => {
    const checkIA = async () => {
      if (!user) return;
      const { data } = await supabase
        .from("chat_ia_gemini")
        .select("is_active, api_key")
        .eq("user_id", user.id)
        .single();
      
      if (data) {
        setIaActiva(data.is_active && !!data.api_key);
      }
    };
    checkIA();
  }, [user]);

  // Auto-scroll al final
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Ajustar altura del textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleSelectTemplate = (tpl: Template) => {
    setSelectedTemplate(tpl);
    setInput(tpl.content);
    setShowTemplates(false);
  };

  const clearTemplate = () => {
    setSelectedTemplate(null);
    setInput("");
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    
    if (!user) {
      toast({ title: "Error", description: "Debes iniciar sesión", variant: "destructive" });
      return;
    }

    if (!iaActiva) {
      toast({ 
        title: "IA no configurada", 
        description: "Ve a Ajustes → IA y configura tu API Key de Gemini", 
        variant: "destructive" 
      });
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setSelectedTemplate(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat-ia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          message: userMessage.content,
          from_number: "chat_web",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Error al obtener respuesta");
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error: any) {
      console.error("Error en chat:", error);
      toast({
        title: "Error",
        description: error.message || "No se pudo obtener respuesta de la IA",
        variant: "destructive",
      });
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Lo siento, hubo un error al procesar tu mensaje. Por favor, verifica que la API de Gemini esté configurada correctamente en Ajustes → IA.",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: "¡Hola! 👋 Soy tu asistente de ventas con IA. ¿En qué puedo ayudarte hoy?",
        timestamp: new Date(),
      },
    ]);
    toast({ title: "Chat limpiado", description: "El historial se ha reiniciado" });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold font-heading text-gradient">Chat con IA</h1>
          <p className="text-[11px] text-muted-foreground">Gemini - Asistente de ventas inteligente</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full border ${iaActiva ? "bg-emerald-500/10 border-emerald-500/20" : "bg-destructive/10 border-destructive/20"}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${iaActiva ? "bg-emerald-500 animate-pulse" : "bg-destructive"}`} />
            <span className={`text-[10px] font-medium ${iaActiva ? "text-emerald-400" : "text-destructive"}`}>
              {iaActiva ? "IA Activa" : "IA Inactiva"}
            </span>
          </div>
          <button
            onClick={clearChat}
            className="p-2 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground hover:text-destructive"
            title="Limpiar chat"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4 px-2">
        <AnimatePresence>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className={`flex gap-3 max-w-[80%] ${message.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  message.role === "user" 
                    ? "bg-primary/20" 
                    : "bg-gradient-to-br from-primary to-accent"
                }`}>
                  {message.role === "user" ? (
                    <User className="h-4 w-4 text-primary" />
                  ) : (
                    <Bot className="h-4 w-4 text-white" />
                  )}
                </div>
                <div className={`rounded-2xl px-4 py-3 ${
                  message.role === "user"
                    ? "bg-gradient-to-br from-primary to-accent text-primary-foreground rounded-tr-sm"
                    : "glass glass-border rounded-tl-sm"
                }`}>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
                  <p className={`text-[9px] mt-1.5 ${
                    message.role === "user" ? "text-primary-foreground/60" : "text-muted-foreground/50"
                  }`}>
                    {formatTime(message.timestamp)}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        
        {isLoading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div className="glass glass-border rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="flex items-center gap-1">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Escribiendo...</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border/30 pt-4 mt-2">
        {/* Selected template indicator */}
        <AnimatePresence>
          {selectedTemplate && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-primary/10 border border-primary/20 text-xs"
            >
              <FileText className="h-3.5 w-3.5 text-primary" />
              <span className="text-primary font-medium">Plantilla: {selectedTemplate.name}</span>
              <button onClick={clearTemplate} className="ml-auto text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-3 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={iaActiva ? "Escribe tu mensaje... (Enter para enviar)" : "IA no configurada. Ve a Ajustes → IA"}
              disabled={!iaActiva}
              className="w-full bg-secondary/30 border border-border/40 rounded-xl px-4 py-3 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 resize-none min-h-[44px] max-h-[120px] disabled:opacity-50"
              rows={1}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim() || !iaActiva}
            className="p-3 rounded-xl bg-gradient-to-r from-primary to-accent text-primary-foreground hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>

        {/* Botones de acciones */}
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/30 border border-border/30 text-[10px] text-muted-foreground cursor-pointer hover:bg-secondary/50 transition-colors">
              <Image className="h-3 w-3" />
              Imagen
              <input type="file" accept="image/*" className="hidden" />
            </label>
            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/30 border border-border/30 text-[10px] text-muted-foreground cursor-pointer hover:bg-secondary/50 transition-colors">
              <Mic className="h-3 w-3" />
              Audio
              <input type="file" accept="audio/*" className="hidden" />
            </label>
            
            {/* Template selector */}
            <div className="relative">
              <button
                onClick={() => setShowTemplates(!showTemplates)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/30 border border-border/30 text-[10px] text-muted-foreground hover:bg-secondary/50 transition-colors"
              >
                <FileText className="h-3 w-3" />
                Plantillas
                <ChevronDown className={`h-2.5 w-2.5 transition-transform ${showTemplates ? "rotate-180" : ""}`} />
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
                      <p className="text-xs font-semibold">Seleccionar plantilla</p>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {templates.length === 0 ? (
                        <div className="px-3 py-2 text-[10px] text-muted-foreground">
                          No hay plantillas. Crea una en Plantillas.
                        </div>
                      ) : (
                        templates.map((tpl) => (
                          <button
                            key={tpl.name}
                            onClick={() => handleSelectTemplate(tpl)}
                            className="w-full text-left px-3 py-2.5 hover:bg-secondary/50 transition-colors border-b border-border/30 last:border-0"
                          >
                            <p className="text-xs font-bold">{tpl.name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{tpl.preview}</p>
                          </button>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={() => setInput("¿Cuáles son los productos más vendidos?")}
              className="text-[10px] px-2 py-1 rounded-full bg-secondary/30 text-muted-foreground border border-border/30 hover:bg-secondary/50 transition-colors"
            >
              📊 Productos
            </button>
            <button 
              onClick={() => setInput("¿Cómo puedo mejorar mis ventas?")}
              className="text-[10px] px-2 py-1 rounded-full bg-secondary/30 text-muted-foreground border border-border/30 hover:bg-secondary/50 transition-colors"
            >
              💡 Ventas
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
