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
          <div className="h-8 w-1 rounded-full bg-success" />
          <h1 className="text-xl font-bold font-heading">Inbox Profesional</h1>
          <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20 font-medium">
            {filteredChats.length} chats activos
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 h-[calc(100vh-180px)]">
        {/* Chat Area */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-card border border-border rounded-lg flex flex-col overflow-hidden">
          {/* Chat Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/80">
            <div className="flex items-center gap-3">
              <span className="font-heading font-bold text-sm">{filteredChats[selectedChat]?.number}</span>
              {filteredChats[selectedChat]?.tag && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20">
                  {filteredChats[selectedChat].tag}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Pausar IA">
                <Pause className="h-4 w-4" />
              </button>
              <button className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary" title="Forzar IA">
                <Bot className="h-4 w-4" />
              </button>
              <button className="p-2 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive" title="Eliminar">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-secondary/30">
            <button className="text-xs px-3 py-1.5 rounded-md bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-colors font-medium">
              ✏️ Venta Normal
            </button>
            <button className="text-xs px-3 py-1.5 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors font-medium">
              🌐 Venta Web
            </button>
            <button className="text-xs px-3 py-1.5 rounded-md bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 transition-colors font-medium">
              🧹 Limpiar
            </button>
            <select className="ml-auto text-xs bg-secondary border border-border rounded-md px-2 py-1.5 text-muted-foreground">
              <option>Etiquetar...</option>
              <option>venta normal cargada</option>
              <option>venta web cargada</option>
              <option>prospecto</option>
              <option>consulta</option>
            </select>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='hsl(230,50%25,5%25)'/%3E%3Cg stroke='hsl(232,30%25,16%25)' stroke-opacity='0.3'%3E%3Cpath d='M0 20h40M20 0v40'/%3E%3C/g%3E%3C/svg%3E")`,
          }}>
            {mockMessages.map((msg, idx) => {
              const showDateSeparator = idx === 0 || msg.date !== mockMessages[idx - 1].date;
              return (
                <div key={msg.id}>
                  {showDateSeparator && (
                    <div className="flex items-center justify-center my-2">
                      <span className="text-[10px] px-3 py-1 rounded-full bg-secondary/80 text-muted-foreground border border-border">
                        {format(new Date(msg.date), "EEEE, d 'de' MMMM yyyy", { locale: es })}
                      </span>
                    </div>
                  )}
                  <div className={`flex ${msg.from === "out" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm whitespace-pre-line ${
                        msg.from === "out"
                          ? "bg-gradient-to-br from-[hsl(160,100%,18%)] to-[hsl(164,100%,25%)] border border-[hsl(160,80%,28%)] rounded-br-sm"
                          : "bg-secondary/80 border border-border rounded-bl-sm"
                      }`}
                    >
                      <div>{msg.text}</div>
                      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground/70">
                        <span>{msg.date} {msg.time}</span>
                        {msg.badge && (
                          <span className="px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[9px] font-medium">
                            {msg.badge}
                          </span>
                        )}
                        {msg.from === "out" && <span>✓✓</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Input */}
          <div className="border-t border-border p-3 bg-card/80 space-y-2 relative">
            <AnimatePresence>
              {showTemplates && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute bottom-full left-0 right-0 mx-3 mb-2 bg-card border border-border rounded-lg shadow-lg overflow-hidden z-10"
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/30">
                    <span className="text-xs font-heading font-bold">📋 Plantillas</span>
                    <button onClick={() => setShowTemplates(false)} className="p-1 rounded hover:bg-secondary text-muted-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="max-h-[200px] overflow-y-auto">
                    {availableTemplates.map((tpl) => (
                      <button
                        key={tpl.name}
                        onClick={() => handleSelectTemplate(tpl)}
                        className="w-full text-left px-3 py-2.5 hover:bg-primary/5 border-b border-border/50 last:border-0 transition-colors"
                      >
                        <span className="text-[10px] font-bold text-primary">{tpl.name}</span>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{tpl.preview}</p>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center gap-2">
              <button className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground">
                <Smile className="h-4 w-4" />
              </button>
              <button className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground">
                <Image className="h-4 w-4" />
              </button>
              <button
                onClick={() => setShowTemplates(!showTemplates)}
                className={`p-2 rounded-lg transition-colors ${showTemplates ? "bg-primary/10 text-primary" : "hover:bg-secondary text-muted-foreground"}`}
                title="Plantillas"
              >
                <FileText className="h-4 w-4" />
              </button>
              <input
                className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                placeholder="Escribe tu mensaje aquí..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
              />
              <button className="p-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>

        {/* Sidebar - Chats */}
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-card border border-border rounded-lg flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="font-heading font-bold text-sm">Chats Recientes</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`p-1.5 rounded-md transition-colors relative ${showFilters || hasActiveFilters ? "bg-primary/10 text-primary" : "hover:bg-secondary text-muted-foreground"}`}
                  title="Filtros"
                >
                  <Filter className="h-3.5 w-3.5" />
                  {hasActiveFilters && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary" />
                  )}
                </button>
                <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
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
                  <div className="space-y-2 pb-2">
                    {/* Tag Filter */}
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium flex items-center gap-1 mb-1">
                        <Tag className="h-3 w-3" /> Etiqueta
                      </label>
                      <div className="flex flex-wrap gap-1">
                        {allTags.map((tag) => (
                          <button
                            key={tag}
                            onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                            className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                              filterTag === tag
                                ? "bg-primary/20 text-primary border-primary/30"
                                : "bg-secondary/50 text-muted-foreground border-border hover:bg-secondary"
                            }`}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Date Filter */}
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium flex items-center gap-1 mb-1">
                        <CalendarDays className="h-3 w-3" /> Fecha
                      </label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className={cn(
                            "w-full text-left text-xs px-3 py-1.5 rounded-md border transition-colors",
                            filterDate
                              ? "bg-primary/10 text-primary border-primary/30"
                              : "bg-secondary/50 text-muted-foreground border-border hover:bg-secondary"
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
                        className="text-[10px] text-destructive hover:underline"
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
                className="w-full bg-secondary/50 border border-border rounded-lg pl-8 pr-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
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
                className={`w-full text-left px-4 py-3 border-b border-border/50 transition-all hover:bg-secondary/50 ${
                  selectedChat === i ? "bg-primary/5 border-l-2 border-l-primary" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold">{chat.number}</span>
                  <div className="flex items-center gap-1.5">
                    {chat.tag && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/20">
                        {chat.tag}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-muted-foreground truncate max-w-[180px]">{chat.lastMsg}</span>
                  {chat.unread > 0 && (
                    <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                      {chat.unread}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                  {chat.date} · {chat.time}
                </div>
              </button>
            ))}
            {filteredChats.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No se encontraron chats con los filtros aplicados
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
