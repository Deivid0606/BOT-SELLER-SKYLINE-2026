import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Pause, Play, Pin, PinOff, Tag, ShoppingCart, Globe, Eraser, Trash2, Send, RefreshCw } from "lucide-react";

type Conversation = {
  id: string;
  phone: string;
  contact_name: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number | null;
  ai_paused: boolean | null;
  pinned: boolean | null;
  tag: string | null;
  sale_type: string | null; // 'normal' | 'web' | null
};

type Message = {
  id: string;
  conversation_id: string;
  body: string | null;
  direction: "in" | "out";
  created_at: string;
  media_url?: string | null;
};

export default function InboxPage() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);

  const loadConvs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .order("pinned", { ascending: false })
      .order("last_message_at", { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    else setConvs((data ?? []) as Conversation[]);
    setLoading(false);
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) toast.error(error.message);
    else setMessages((data ?? []) as Message[]);
  }, []);

  useEffect(() => {
    loadConvs();
    const ch = supabase
      .channel("inbox-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => loadConvs())
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload: any) => {
        if (activeId && payload.new?.conversation_id === activeId) loadMessages(activeId);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadConvs, loadMessages, activeId]);

  useEffect(() => {
    if (activeId) loadMessages(activeId);
  }, [activeId, loadMessages]);

  const active = convs.find((c) => c.id === activeId) || null;

  const updateConv = async (patch: Partial<Conversation>) => {
    if (!active) return;
    const { error } = await supabase.from("conversations").update(patch).eq("id", active.id);
    if (error) return toast.error(error.message);
    loadConvs();
  };

  const togglePauseAI = () => {
    if (!active) return;
    updateConv({ ai_paused: !active.ai_paused });
    toast.success(active.ai_paused ? "IA reactivada" : "IA pausada");
  };

  const togglePin = () => {
    if (!active) return;
    updateConv({ pinned: !active.pinned });
    toast.success(active.pinned ? "Desfijado" : "Fijado");
  };

  const setTag = async () => {
    if (!active) return;
    const t = window.prompt("Etiqueta (vacío para quitar):", active.tag ?? "");
    if (t === null) return;
    updateConv({ tag: t || null });
    toast.success("Etiqueta actualizada");
  };

  const setSale = (sale_type: "normal" | "web") => {
    if (!active) return;
    updateConv({ sale_type });
    toast.success(`Marcado como venta ${sale_type}`);
  };

  const clearConv = async () => {
    if (!active) return;
    if (!window.confirm("¿Borrar todos los mensajes de esta conversación?")) return;
    const { error } = await supabase.from("messages").delete().eq("conversation_id", active.id);
    if (error) return toast.error(error.message);
    toast.success("Conversación limpiada");
    loadMessages(active.id);
  };

  const deleteConv = async () => {
    if (!active) return;
    if (!window.confirm("¿Eliminar la conversación completa?")) return;
    await supabase.from("messages").delete().eq("conversation_id", active.id);
    const { error } = await supabase.from("conversations").delete().eq("id", active.id);
    if (error) return toast.error(error.message);
    toast.success("Conversación eliminada");
    setActiveId(null);
    loadConvs();
  };

  const send = async () => {
    if (!active || !text.trim()) return;
    const body = text.trim();
    setText("");
    const res = await fetch("/api/send-whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: active.phone, message: body }),
    });
    if (!res.ok) {
      toast.error("Error enviando mensaje");
      return;
    }
    await supabase.from("messages").insert({
      conversation_id: active.id,
      body,
      direction: "out",
    });
    loadMessages(active.id);
  };

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Lista */}
      <aside className="w-80 border-r overflow-y-auto">
        <div className="p-3 flex items-center justify-between border-b">
          <h2 className="font-semibold">Inbox</h2>
          <Button variant="ghost" size="icon" onClick={loadConvs}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        {loading ? (
          <div className="p-4 text-muted-foreground">Cargando...</div>
        ) : (
          convs.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`w-full text-left p-3 border-b hover:bg-muted ${activeId === c.id ? "bg-muted" : ""}`}
            >
              <div className="flex justify-between items-center">
                <span className="font-medium truncate">{c.contact_name || c.phone}</span>
                {c.pinned && <Pin className="w-3 h-3" />}
              </div>
              <div className="text-xs text-muted-foreground truncate">{c.last_message ?? ""}</div>
              <div className="flex gap-1 mt-1">
                {c.ai_paused && <Badge variant="secondary" className="text-[10px]">IA pausada</Badge>}
                {c.tag && <Badge className="text-[10px]">{c.tag}</Badge>}
                {c.sale_type && <Badge variant="outline" className="text-[10px]">{c.sale_type}</Badge>}
              </div>
            </button>
          ))
        )}
      </aside>

      {/* Chat */}
      <section className="flex-1 flex flex-col">
        {!active ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Selecciona una conversación
          </div>
        ) : (
          <>
            <header className="border-b p-3 flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="font-semibold">{active.contact_name || active.phone}</div>
                <div className="text-xs text-muted-foreground">{active.phone}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={togglePauseAI}>
                  {active.ai_paused ? <Play className="w-4 h-4 mr-1" /> : <Pause className="w-4 h-4 mr-1" />}
                  {active.ai_paused ? "Reanudar IA" : "Pausar IA"}
                </Button>
                <Button size="sm" variant="outline" onClick={togglePin}>
                  {active.pinned ? <PinOff className="w-4 h-4 mr-1" /> : <Pin className="w-4 h-4 mr-1" />}
                  {active.pinned ? "Desfijar" : "Fijar"}
                </Button>
                <Button size="sm" variant="outline" onClick={setTag}>
                  <Tag className="w-4 h-4 mr-1" /> Etiqueta
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSale("normal")}>
                  <ShoppingCart className="w-4 h-4 mr-1" /> Venta Normal
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSale("web")}>
                  <Globe className="w-4 h-4 mr-1" /> Venta Web
                </Button>
                <Button size="sm" variant="outline" onClick={clearConv}>
                  <Eraser className="w-4 h-4 mr-1" /> Limpiar
                </Button>
                <Button size="sm" variant="destructive" onClick={deleteConv}>
                  <Trash2 className="w-4 h-4 mr-1" /> Eliminar
                </Button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/30">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[70%] p-2 rounded-lg ${
                    m.direction === "out" ? "bg-primary text-primary-foreground ml-auto" : "bg-card"
                  }`}
                >
                  {m.media_url && (
                    <img src={m.media_url} alt="" className="rounded mb-1 max-h-60" />
                  )}
                  <div className="whitespace-pre-wrap text-sm">{m.body}</div>
                  <div className="text-[10px] opacity-70 mt-1">
                    {new Date(m.created_at).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>

            <footer className="border-t p-3 flex gap-2">
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Escribe un mensaje..."
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
              <Button onClick={send}>
                <Send className="w-4 h-4 mr-1" /> Enviar
              </Button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
