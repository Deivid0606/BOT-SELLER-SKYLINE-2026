import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Send, Pause, Trash2, Bot, Image, Smile, FileText, X, Filter, CalendarDays, Tag } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

const availableTemplates = [
  { name: "BIENVENIDA", preview: "¡Hola! 👋 Bienvenido a Skyline Store. ¿En qué podemos ayudarte hoy?" },
  { name: "CATALOGO", preview: "📱 Nuestro catálogo actualizado está disponible. ¿Qué producto te interesa?" },
  { name: "SEGUIMIENTO", preview: "Hola! Quería saber si pudiste revisar nuestra propuesta. Quedamos atentos 😊" },
  { name: "CONFIRMACION", preview: "✅ Tu pedido ha sido confirmado. Te avisaremos cuando esté en camino." },
  { name: "PAGO", preview: "💳 Para realizar el pago podés transferir a:\nBanco: ...\nCuenta: ...\nTitular: ..." },
];

const allTags = ["venta", "confirmado", "prospecto", "consulta", "venta web"];

const mockChats = [
  { number: "+595 981 234 567", lastMsg: "Hola, quiero saber precio del iPhone 15", time: "14:32", date: "2026-04-15", unread: 3 },
  { number: "+595 972 345 678", lastMsg: "Ya transferí el pago", time: "14:15", date: "2026-04-15", unread: 0, tag: "venta" },
  { number: "+595 961 456 789", lastMsg: "Tienen en color azul?", time: "13:50", date: "2026-04-14", unread: 1 },
  { number: "+595 983 567 890", lastMsg: "Cuánto sale el envío a Encarnación?", time: "12:22", date: "2026-04-13", unread: 0, tag: "consulta" },
  { number: "+595 974 678 901", lastMsg: "Perfecto, confirmo el pedido", time: "11:45", date: "2026-04-12", unread: 0, tag: "confirmado" },
];

const mockMessages = [
  { id: 1, from: "in", text: "Hola! Me interesa el iPhone 15 Pro Max. Tienen disponible?", time: "14:20", date: "2026-04-15" },
  { id: 2, from: "out", text: "¡Hola! 👋 Sí, tenemos disponible el iPhone 15 Pro Max.\n\n📱 *iPhone 15 Pro Max*\n💰 Precio: Gs. 6.500.000\n📦 Envío gratis a todo el país\n\n¿Te gustaría hacer el pedido?", time: "14:20", date: "2026-04-15", badge: "IA" },
  { id: 3, from: "in", text: "Cuanto sale el de 256GB?", time: "14:25", date: "2026-04-15" },
  { id: 4, from: "out", text: "El iPhone 15 Pro Max de 256GB está a Gs. 6.500.000 💰\n\nTambién tenemos:\n• 512GB: Gs. 7.800.000\n• 1TB: Gs. 9.200.000\n\n¿Cuál te interesa? 😊", time: "14:25", date: "2026-04-15", badge: "IA" },
  { id: 5, from: "in", text: "El de 256 está bien. Cómo hago para pagar?", time: "14:30", date: "2026-04-15" },
];

export default function InboxPage() {
  const [selectedChat, setSelectedChat] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterDate, setFilterDate] = useState<Date | undefined>(undefined);
  const [showFilters, setShowFilters] = useState(false);

  const handleSelectTemplate = (template: typeof availableTemplates[0]) => {
    setMessageInput(template.preview);
    setShowTemplates(false);
  };

  const filteredChats = useMemo(() => {
    return mockChats.filter((chat) => {
      if (searchQuery && !chat.number.includes(searchQuery) && !chat.lastMsg.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (filterTag && chat.tag !== filterTag) return false;
      if (filterDate && chat.date !== format(filterDate, "yyyy-MM-dd")) return false;
      return true;
    });
  }, [searchQuery, filterTag, filterDate]);

  const clearFilters = () => {
    setFilterTag(null);
    setFilterDate(undefined);
  };

  const hasActiveFilters = filterTag || filterDate;

  return (
    <div className="space-y-4">
      {/* Header */}
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
        {/* Chat Area */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass glass-border rounded-xl flex flex-col overflow-hidden">
          {/* Chat Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 bg-secondary/20">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary font-mono">
                {filteredChats[selectedChat]?.number?.slice(-2)}
              </div>
              <div>
                <span className="font-heading font-bold text-sm">{filteredChats[selectedChat]?.number}</span>
                {filteredChats[selectedChat]?.tag && (
                  <span className="ml-2 text-[9px] px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20 font-medium">
                    {filteredChats[selectedChat].tag}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button className="p-2 rounded-lg hover:bg-secondary/60 transition-all duration-200 text-muted-foreground hover:text-foreground" title="Pausar IA">
                <Pause className="h-4 w-4" />
              </button>
              <button className="p-2 rounded-lg hover:bg-primary/10 transition-all duration-200 text-muted-foreground hover:text-primary" title="Forzar IA">
                <Bot className="h-4 w-4" />
              </button>
              <button className="p-2 rounded-lg hover:bg-destructive/10 transition-all duration-200 text-muted-foreground hover:text-destructive" title="Eliminar">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Toolbar */}
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

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-5 space-y-3" style={{
            backgroundImage: `radial-gradient(circle at 50% 50%, hsl(230 35% 6%) 0%, hsl(228 40% 4%) 100%)`,
          }}>
            {mockMessages.map((msg, idx) => {
              const showDateSeparator = idx === 0 || msg.date !== mockMessages[idx - 1].date;
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
                    transition={{ delay: idx * 0.05 }}
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
                        {msg.from === "out" && <span className="text-success/60">✓✓</span>}
                      </div>
                    </div>
                  </motion.div>
                </div>
              );
            })}
          </div>

          {/* Input */}
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
                    <button onClick={() => setShowTemplates(false)} className="p-1 rounded-lg hover:bg-secondary/60 text-muted-foreground transition-colors">
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
                        <span className="text-[10px] font-bold text-primary font-mono tracking-wider">{tpl.name}</span>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{tpl.preview}</p>
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
                className={`p-2.5 rounded-xl transition-all duration-200 ${showTemplates ? "bg-primary/10 text-primary shadow-sm" : "hover:bg-secondary/50 text-muted-foreground hover:text-foreground"}`}
                title="Plantillas"
              >
                <FileText className="h-4 w-4" />
              </button>
              <input
                className="flex-1 bg-secondary/30 border border-border/40 rounded-xl px-4 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 focus:bg-secondary/50 transition-all duration-200"
                placeholder="Escribe tu mensaje aquí..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
              />
              <button className="p-2.5 rounded-xl bg-gradient-to-r from-primary to-accent text-primary-foreground hover:shadow-[0_0_16px_hsl(239,84%,67%,0.3)] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>

        {/* Sidebar - Chats */}
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="glass glass-border rounded-xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30">
            <div className="flex items-center justify-between mb-2.5">
              <span className="font-heading font-bold text-sm">Chats Recientes</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`p-1.5 rounded-lg transition-all duration-200 relative ${showFilters || hasActiveFilters ? "bg-primary/10 text-primary" : "hover:bg-secondary/60 text-muted-foreground"}`}
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

            {/* Filters Panel */}
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
                          <button className={cn(
                            "w-full text-left text-xs px-3 py-2 rounded-lg border transition-all duration-200",
                            filterDate
                              ? "bg-primary/10 text-primary border-primary/25"
                              : "bg-secondary/30 text-muted-foreground border-border/30 hover:bg-secondary/50"
                          )}>
                            {filterDate ? format(filterDate, "d 'de' MMMM yyyy", { locale: es }) : "Seleccionar fecha..."}
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
                  <span className="text-xs text-muted-foreground truncate max-w-[180px]">{chat.lastMsg}</span>
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
            {filteredChats.length === 0 && (
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
