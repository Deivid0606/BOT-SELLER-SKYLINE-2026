import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Send,
  Pause,
  Trash2,
  Bot,
  Image,
  Smile,
  FileText,
  X,
  Filter,
  CalendarDays,
  Tag,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

const availableTemplates = [
  { name: "BIENVENIDA", preview: "¡Hola! 👋 Bienvenido a Skyline Store. ¿En qué podemos ayudarte hoy?" },
  { name: "CATALOGO", preview: "📱 Nuestro catálogo actualizado está disponible. ¿Qué producto te interesa?" },
  { name: "SEGUIMIENTO", preview: "Hola! Quería saber si pudiste revisar nuestra propuesta. Quedamos atentos 😊" },
  { name: "CONFIRMACION", preview: "✅ Tu pedido ha sido confirmado. Te avisaremos cuando esté en camino." },
  { name: "PAGO", preview: "💳 Para realizar el pago podés transferir a:\nBanco: ...\nCuenta: ...\nTitular: ..." },
];

const allTags = ["venta", "confirmado", "prospecto", "consulta", "venta web"];

type DbMessage = {
  id: string;
  user_id: string | null;
  platform: string | null;
  from_number: string | null;
  message: string | null;
  message_type: string | null;
  media_url: string | null;
  is_processed: boolean | null;
};

type WhatsAppConfig = {
  phone_number_id: string | null;
  permanent_token: string | null;
};

type Chat = {
  number: string;
  lastMsg: string;
  time: string;
  date: string;
  unread: number;
  tag?: string;
};

type Message = {
  id: string;
  from: "in" | "out";
  text: string;
  time: string;
  date: string;
  badge?: string;
};

function isOutgoingType(type?: string | null) {
  return !!type && type.startsWith("out_");
}

function getDisplayType(type?: string | null) {
  if (!type) return undefined;
  if (type.startsWith("out_")) return type.replace("out_", "");
  return type;
}

export default function InboxPage() {
  const { user } = useAuth();

  const [selectedChat, setSelectedChat] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterDate, setFilterDate] = useState<Date | undefined>(undefined);
  const [showFilters, setShowFilters] = useState(false);

  const [dbMessages, setDbMessages] = useState<DbMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [waConfig, setWaConfig] = useState<WhatsAppConfig>({
    phone_number_id: null,
    permanent_token: null,
  });

  const handleSelectTemplate = (template: (typeof availableTemplates)[0]) => {
    setMessageInput(template.preview);
    setShowTemplates(false);
  };

  const loadMessages = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("received_messages")
      .select("*")
      .order("id", { ascending: false });

    if (error) {
      console.error("Error cargando mensajes:", error);
      setDbMessages([]);
      setLoading(false);
      return;
    }

    setDbMessages((data || []) as DbMessage[]);
    setLoading(false);
  };

  const loadWhatsAppConfig = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from("whatsapp_config")
      .select("phone_number_id, permanent_token")
      .eq("user_id", user.id)
      .single();

    if (error) {
      console.error("Error cargando config WhatsApp:", error);
      return;
    }

    if (data) {
      setWaConfig({
        phone_number_id: data.phone_number_id,
        permanent_token: data.permanent_token,
      });
    }
  };

  useEffect(() => {
    loadMessages();
    loadWhatsAppConfig();

    const channel = supabase
      .channel("received_messages_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "received_messages" },
        () => {
          loadMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const chats = useMemo<Chat[]>(() => {
    const grouped = new Map<string, DbMessage[]>();

    for (const msg of dbMessages) {
      const number = msg.from_number || "Sin número";
      if (!grouped.has(number)) grouped.set(number, []);
      grouped.get(number)!.push(msg);
    }

    return Array.from(grouped.entries()).map(([number, messages]) => {
      const ordered = [...messages].reverse();
      const last = ordered[ordered.length - 1];

      return {
        number,
        lastMsg: last?.message || "",
        time: "Ahora",
        date: new Date().toISOString().slice(0, 10),
        unread: messages.filter((m) => !m.is_processed && !isOutgoingType(m.message_type)).length,
      };
    });
  }, [dbMessages]);

  const filteredChats = useMemo(() => {
    return chats.filter((chat) => {
      if (
        searchQuery &&
        !chat.number.includes(searchQuery) &&
        !chat.lastMsg.toLowerCase().includes(searchQuery.toLowerCase())
      ) return false;

      if (filterTag && chat.tag !== filterTag) return false;
      if (filterDate && chat.date !== format(filterDate, "yyyy-MM-dd")) return false;

      return true;
    });
  }, [chats, searchQuery, filterTag, filterDate]);

  const selectedNumber = filteredChats[selectedChat]?.number;

  const currentMessages = useMemo<Message[]>(() => {
    if (!selectedNumber) return [];

    return dbMessages
      .filter((msg) => msg.from_number === selectedNumber)
      .slice()
      .reverse()
      .map((msg) => ({
        id: msg.id,
        from: isOutgoingType(msg.message_type) ? "out" : "in",
        text: msg.message || "",
        time: "Ahora",
        date: new Date().toISOString(),
        badge: getDisplayType(msg.message_type),
      }));
  }, [dbMessages, selectedNumber]);

  useEffect(() => {
    if (selectedChat >= filteredChats.length) {
      setSelectedChat(0);
    }
  }, [filteredChats.length, selectedChat]);

  useEffect(() => {
    const markAsProcessed = async () => {
      if (!selectedNumber) return;

      const idsToUpdate = dbMessages
        .filter(
          (msg) =>
            msg.from_number === selectedNumber &&
            !msg.is_processed &&
            !isOutgoingType(msg.message_type)
        )
        .map((msg) => msg.id);

      if (idsToUpdate.length === 0) return;

      const { error } = await supabase
        .from("received_messages")
        .update({ is_processed: true })
        .in("id", idsToUpdate);

      if (error) {
        console.error("Error marcando mensajes como leídos:", error);
      } else {
        setDbMessages((prev) =>
          prev.map((msg) =>
            idsToUpdate.includes(msg.id) ? { ...msg, is_processed: true } : msg
          )
        );
      }
    };

    markAsProcessed();
  }, [selectedNumber, dbMessages]);

  const clearFilters = () => {
    setFilterTag(null);
    setFilterDate(undefined);
  };

  const hasActiveFilters = !!(filterTag || filterDate);

  const handleSendMessage = async () => {
    if (!selectedNumber) {
      toast({
        title: "Selecciona un chat",
        description: "Primero selecciona un chat para responder.",
        variant: "destructive",
      });
      return;
    }

    if (!messageInput.trim()) {
      toast({
        title: "Mensaje vacío",
        description: "Escribe un mensaje antes de enviar.",
        variant: "destructive",
      });
      return;
    }

    if (!waConfig.phone_number_id || !waConfig.permanent_token) {
      toast({
        title: "Falta configuración",
        description: "Revisa phone_number_id y permanent_token en Ajustes.",
        variant: "destructive",
      });
      return;
    }

    try {
      setSending(true);

      const response = await fetch(
        `https://graph.facebook.com/v25.0/${waConfig.phone_number_id}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${waConfig.permanent_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: selectedNumber,
            type: "text",
            text: {
              body: messageInput.trim(),
            },
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        console.error("Error enviando a Meta:", result);
        throw new Error(result?.error?.message || "No se pudo enviar el mensaje");
      }

      const textToSave = messageInput.trim();

      const { error: insertError } = await supabase.from("received_messages").insert({
        user_id: user?.id ?? null,
        platform: "whatsapp",
        from_number: selectedNumber,
        message: textToSave,
        message_type: "out_text",
        media_url: null,
        is_processed: true,
      });

      if (insertError) {
        console.error("Error guardando mensaje saliente:", insertError);
      }

      setMessageInput("");
      await loadMessages();

      toast({
        title: "✅ Mensaje enviado",
        description: "La respuesta se envió correctamente por WhatsApp.",
      });
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Error al enviar",
        description: error?.message || "No se pudo enviar el mensaje.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-1 rounded-full bg-gradient-to-b from-primary to-accent" />
          <div>
            <h1 className="text-xl font-bold font-heading">Inbox Profesional</h1>
            <p className="text-[11px] text-muted-foreground">WhatsApp Business integrado</p>
          </div>
          <span className="text-[11px] px-2.5 py-1 rounded-full bg-success/10 text-success border border-success/20 font-medium font-mono">
            {filteredChats.length} activos
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 h-[calc(100vh-180px)]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass glass-border rounded-xl flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 bg-secondary/20">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary font-mono">
                {selectedNumber?.slice(-2) || "--"}
              </div>
              <div>
                <span className="font-heading font-bold text-sm">
                  {selectedNumber || "Sin chat seleccionado"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button className="p-2 rounded-lg hover:bg-secondary/60 transition-all duration-200 text-muted-foreground hover:text-foreground">
                <Pause className="h-4 w-4" />
              </button>
              <button className="p-2 rounded-lg hover:bg-primary/10 transition-all duration-200 text-muted-foreground hover:text-primary">
                <Bot className="h-4 w-4" />
              </button>
              <button className="p-2 rounded-lg hover:bg-destructive/10 transition-all duration-200 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border/30 bg-secondary/10">
            <button className="text-[11px] px-3 py-1.5 rounded-lg bg-success/8 text-success border border-success/15 hover:bg-success/15 transition-all duration-200 font-medium">
              ✏️ Venta Normal
            </button>
            <button className="text-[11px] px-3 py-1.5 rounded-lg bg-primary/8 text-primary border border-primary/15 hover:bg-primary/15 transition-all duration-200 font-medium">
              🌐 Venta Web
            </button>
            <button className="text-[11px] px-3 py-1.5 rounded-lg bg-destructive/8 text-destructive border border-destructive/15 hover:bg-destructive/15 transition-all duration-200 font-medium">
              🧹 Limpiar
            </button>
            <select className="ml-auto text-[11px] bg-secondary/40 border border-border/40 rounded-lg px-2.5 py-1.5 text-muted-foreground focus:outline-none focus:border-primary/30 transition-colors">
              <option>Etiquetar...</option>
              <option>venta normal cargada</option>
              <option>venta web cargada</option>
              <option>prospecto</option>
              <option>consulta</option>
            </select>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-[hsl(198,19%,18%)]">
            {loading ? (
              <div className="text-sm text-muted-foreground">Cargando mensajes...</div>
            ) : currentMessages.length === 0 ? (
              <div className="text-sm text-muted-foreground">No hay mensajes para este chat.</div>
            ) : (
              currentMessages.map((msg, idx) => {
                const showDateSeparator =
                  idx === 0 ||
                  format(new Date(msg.date), "yyyy-MM-dd") !==
                    format(new Date(currentMessages[idx - 1].date), "yyyy-MM-dd");

                return (
                  <div key={msg.id}>
                    {showDateSeparator && (
                      <div className="flex items-center justify-center my-3">
                        <span className="text-[10px] px-4 py-1.5 rounded-full glass glass-border text-muted-foreground font-medium">
                          {format(new Date(msg.date), "EEEE, d 'de' MMMM yyyy", { locale: es })}
                        </span>
                      </div>
                    )}

                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.03 }}
                      className={`flex ${msg.from === "out" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] px-4 py-3 text-sm whitespace-pre-line ${
                          msg.from === "out"
                            ? "bg-gradient-to-br from-[hsl(160,80%,16%)] to-[hsl(165,70%,22%)] border border-[hsl(160,60%,26%/0.4)] rounded-2xl rounded-br-md shadow-lg shadow-[hsl(160,80%,16%/0.15)]"
                            : "glass glass-border rounded-2xl rounded-bl-md"
                        }`}
                      >
                        <div className="leading-relaxed">{msg.text}</div>
                        <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground/60">
                          <span>{msg.time}</span>
                          {msg.badge && (
                            <span className="px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[9px] font-semibold font-mono">
                              {msg.badge}
                            </span>
                          )}
                          {msg.from === "out" && <span className="text-success/60">✓</span>}
                        </div>
                      </div>
                    </motion.div>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-border/30 p-4 bg-secondary/10 space-y-2 relative">
            <AnimatePresence>
              {showTemplates && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute bottom-full left-0 right-0 mx-4 mb-2 glass glass-border rounded-xl shadow-pro overflow-hidden z-10"
                >
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30 bg-secondary/20">
                    <span className="text-xs font-heading font-bold">📋 Plantillas</span>
                    <button
                      onClick={() => setShowTemplates(false)}
                      className="p-1 rounded-lg hover:bg-secondary/60 text-muted-foreground transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="max-h-[200px] overflow-y-auto">
                    {availableTemplates.map((tpl) => (
                      <button
                        key={tpl.name}
                        onClick={() => handleSelectTemplate(tpl)}
                        className="w-full text-left px-4 py-3 hover:bg-primary/5 border-b border-border/20 last:border-0 transition-colors"
                      >
                        <span className="text-[10px] font-bold text-primary font-mono tracking-wider">
                          {tpl.name}
                        </span>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {tpl.preview}
                        </p>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center gap-2">
              <button className="p-2.5 rounded-xl hover:bg-secondary/50 transition-all duration-200 text-muted-foreground hover:text-foreground">
                <Smile className="h-4 w-4" />
              </button>
              <button className="p-2.5 rounded-xl hover:bg-secondary/50 transition-all duration-200 text-muted-foreground hover:text-foreground">
                <Image className="h-4 w-4" />
              </button>
              <button
                onClick={() => setShowTemplates(!showTemplates)}
                className={`p-2.5 rounded-xl transition-all duration-200 ${
                  showTemplates
                    ? "bg-primary/10 text-primary shadow-sm"
                    : "hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                }`}
                title="Plantillas"
              >
                <FileText className="h-4 w-4" />
              </button>
              <input
                className="flex-1 bg-secondary/30 border border-border/40 rounded-xl px-4 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 focus:bg-secondary/50 transition-all duration-200"
                placeholder="Escribe tu mensaje aquí..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !sending) {
                    handleSendMessage();
                  }
                }}
              />
              <button
                onClick={handleSendMessage}
                disabled={sending}
                className="p-2.5 rounded-xl bg-gradient-to-r from-primary to-accent text-primary-foreground hover:shadow-[0_0_16px_hsl(239,84%,67%,0.3)] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="glass glass-border rounded-xl flex flex-col overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-border/30">
            <div className="flex items-center justify-between mb-2.5">
              <span className="font-heading font-bold text-sm">Chats Recientes</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`p-1.5 rounded-lg transition-all duration-200 relative ${
                    showFilters || hasActiveFilters
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-secondary/60 text-muted-foreground"
                  }`}
                  title="Filtros"
                >
                  <Filter className="h-3.5 w-3.5" />
                  {hasActiveFilters && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary shadow-[0_0_6px_hsl(239,84%,67%,0.5)]" />
                  )}
                </button>
                <span className="text-[11px] px-2 py-0.5 rounded-lg bg-secondary/60 text-muted-foreground border border-border/30 font-mono">
                  {filteredChats.length}
                </span>
              </div>
            </div>

            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-2.5 pb-2.5">
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium flex items-center gap-1 mb-1.5 uppercase tracking-wider">
                        <Tag className="h-3 w-3" /> Etiqueta
                      </label>
                      <div className="flex flex-wrap gap-1">
                        {allTags.map((tag) => (
                          <button
                            key={tag}
                            onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                            className={`text-[10px] px-2.5 py-1 rounded-lg border transition-all duration-200 ${
                              filterTag === tag
                                ? "bg-primary/15 text-primary border-primary/25 shadow-sm"
                                : "bg-secondary/30 text-muted-foreground border-border/30 hover:bg-secondary/50"
                            }`}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium flex items-center gap-1 mb-1.5 uppercase tracking-wider">
                        <CalendarDays className="h-3 w-3" /> Fecha
                      </label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            className={cn(
                              "w-full text-left text-xs px-3 py-2 rounded-lg border transition-all duration-200",
                              filterDate
                                ? "bg-primary/10 text-primary border-primary/25"
                                : "bg-secondary/30 text-muted-foreground border-border/30 hover:bg-secondary/50"
                            )}
                          >
                            {filterDate
                              ? format(filterDate, "d 'de' MMMM yyyy", { locale: es })
                              : "Seleccionar fecha..."}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                          <Calendar
                            mode="single"
                            selected={filterDate}
                            onSelect={setFilterDate}
                            initialFocus
                            className="p-3 pointer-events-auto"
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    {hasActiveFilters && (
                      <button
                        onClick={clearFilters}
                        className="text-[10px] text-destructive hover:underline font-medium"
                      >
                        ✕ Limpiar filtros
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                className="w-full bg-secondary/30 border border-border/30 rounded-xl pl-8 pr-3 py-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 transition-all duration-200"
                placeholder="Buscar chat..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredChats.map((chat, i) => (
              <button
                key={chat.number}
                onClick={() => setSelectedChat(i)}
                className={`w-full text-left px-4 py-3.5 border-b border-border/20 transition-all duration-200 hover:bg-secondary/30 ${
                  selectedChat === i ? "bg-primary/5 border-l-2 border-l-primary" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-secondary/60 border border-border/30 flex items-center justify-center text-[10px] font-bold text-muted-foreground font-mono">
                      {chat.number.slice(-2)}
                    </div>
                    <span className="font-mono text-xs font-bold">{chat.number}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {chat.tag && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/15 font-medium">
                        {chat.tag}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-1.5 ml-9.5">
                  <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                    {chat.lastMsg}
                  </span>
                  {chat.unread > 0 && (
                    <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground text-[10px] font-bold shadow-[0_0_8px_hsl(239,84%,67%,0.3)]">
                      {chat.unread}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground/40 mt-1 ml-9.5 font-mono">
                  {chat.date} · {chat.time}
                </div>
              </button>
            ))}

            {!loading && filteredChats.length === 0 && (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No se encontraron chats con los filtros aplicados
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
