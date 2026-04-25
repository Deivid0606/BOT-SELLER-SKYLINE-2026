import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Check, RefreshCw, Search, Trash2, Package, XCircle, Truck, MessageSquare } from "lucide-react";

type Order = {
  id: string;
  user_id: string;
  customer_name: string | null;
  phone: string | null;
  from_number: string | null;
  product: string | null;
  quantity: number | null;
  total_amount: string | null;
  city: string | null;
  address: string | null;
  status: string;
  metodo_pago: string | null;
  comprobante_url: string | null;
  detected_by_ai: boolean | null;
  created_at: string;
};

const HIDDEN_STATUSES = ["collecting_name", "collecting_city", "collecting_address", "collecting_phone"];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  confirmado: { label: "Confirmado", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: Check },
  confirmed:  { label: "Confirmado", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: Check },
  pendiente:  { label: "Pendiente",  color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",   icon: RefreshCw },
  pending:    { label: "Pendiente",  color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",   icon: RefreshCw },
  cargado:    { label: "Cargado",    color: "bg-blue-500/15 text-blue-400 border-blue-500/30",         icon: Package },
  cancelado:  { label: "Cancelado",  color: "bg-red-500/15 text-red-400 border-red-500/30",            icon: XCircle },
  droppx:     { label: "A Droppx",   color: "bg-purple-500/15 text-purple-400 border-purple-500/30",   icon: Truck },
};

export default function OrdersPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"todos" | "confirmados" | "pendientes" | "cargados" | "cancelados" | "droppx">("todos");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Error cargando pedidos: " + error.message);
    } else {
      setOrders((data || []).filter((o: Order) => !HIDDEN_STATUSES.includes(o.status)));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("orders-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  // 🔥 Cambia status + REEMPLAZA etiquetas del contacto
  async function setOrderStatus(order: Order, newStatus: "cargado" | "cancelado" | "droppx") {
    const labelMap: Record<string, string> = {
      cargado:   "PEDIDO CARGADO",
      cancelado: "PEDIDO CANCELADO",
      droppx:    "PEDIDO A DROPPX",
    };
    const labelName = labelMap[newStatus];
    const phone = order.phone || order.from_number;

    try {
      // 1. Actualizar el pedido
      const { error: e1 } = await supabase
        .from("orders")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", order.id);
      if (e1) throw e1;

      // 2. Buscar las 3 etiquetas de pedido del usuario (para reemplazar)
      const { data: pedidoTags } = await supabase
        .from("tags")
        .select("id, name")
        .eq("user_id", order.user_id)
        .in("name", ["PEDIDO CARGADO", "PEDIDO CANCELADO", "PEDIDO A DROPPX"]);

      const newTag = pedidoTags?.find((t) => t.name === labelName);
      if (!newTag) throw new Error(`Etiqueta "${labelName}" no encontrada. Creala en la pestaña Etiquetas.`);

      // 3. Si hay teléfono → borrar SOLO etiquetas de pedido viejas y poner la nueva
      if (phone) {
        const oldPedidoTagIds = pedidoTags?.map((t) => t.id) || [];

        // Borrar etiquetas de pedido viejas del contacto
        if (oldPedidoTagIds.length > 0) {
          await supabase
            .from("contact_tags")
            .delete()
            .eq("contact_id", phone)
            .in("tag_id", oldPedidoTagIds);
        }

        // Insertar la nueva
        await supabase.from("contact_tags").insert({
          contact_id: phone,
          tag_id: newTag.id,
          user_id: order.user_id,
        });
      }

      toast.success(`Marcado como ${labelName} ✅`);
      load();
    } catch (err: any) {
      toast.error("Error: " + err.message);
    }
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar este pedido?")) return;
    const { error } = await supabase.from("orders").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Pedido eliminado"); load(); }
  }

  function irAlChat(phone: string | null) {
    if (!phone) { toast.error("Este pedido no tiene teléfono"); return; }
    navigate(`/inbox?phone=${encodeURIComponent(phone)}`);
  }

  const filtered = orders.filter((o) => {
    const tel = o.phone || o.from_number || "";
    const matchSearch =
      !search ||
      o.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      tel.includes(search) ||
      o.product?.toLowerCase().includes(search.toLowerCase());

    const matchFilter =
      filter === "todos" ||
      (filter === "confirmados" && (o.status === "confirmado" || o.status === "confirmed")) ||
      (filter === "pendientes"  && (o.status === "pendiente"  || o.status === "pending")) ||
      (filter === "cargados"    && o.status === "cargado") ||
      (filter === "cancelados"  && o.status === "cancelado") ||
      (filter === "droppx"      && o.status === "droppx");

    return matchSearch && matchFilter;
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Pedidos</h1>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 opacity-50" />
            <Input
              placeholder="Buscar tel/cliente/producto"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-64"
            />
          </div>
          <Button size="sm" variant={filter === "todos" ? "default" : "outline"} onClick={() => setFilter("todos")}>Todos</Button>
          <Button size="sm" variant={filter === "confirmados" ? "default" : "outline"} onClick={() => setFilter("confirmados")}>Confirmados</Button>
          <Button size="sm" variant={filter === "pendientes" ? "default" : "outline"} onClick={() => setFilter("pendientes")}>Pendientes</Button>
          <Button size="sm" variant={filter === "cargados" ? "default" : "outline"} onClick={() => setFilter("cargados")}>Cargados</Button>
          <Button size="sm" variant={filter === "cancelados" ? "default" : "outline"} onClick={() => setFilter("cancelados")}>Cancelados</Button>
          <Button size="sm" variant={filter === "droppx" ? "default" : "outline"} onClick={() => setFilter("droppx")}>Droppx</Button>
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />Refrescar</Button>
        </div>
      </div>

      {loading ? (
        <p className="opacity-60">Cargando...</p>
      ) : filtered.length === 0 ? (
        <p className="opacity-60">No hay pedidos.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => {
            const cfg = STATUS_CONFIG[o.status] || { label: o.status, color: "bg-gray-500/15 text-gray-400 border-gray-500/30", icon: Check };
            const Icon = cfg.icon;
            const tel = o.phone || o.from_number;
            return (
              <Card key={o.id} className="border-border/50">
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{o.customer_name || "Sin nombre"}</span>
                        {tel && <span className="text-sm opacity-70">· {tel}</span>}
                        {o.detected_by_ai && <Badge variant="outline" className="text-xs">AUTO</Badge>}
                      </div>
                      <div className="text-sm mt-1">
                        <span className="opacity-70">Producto:</span> {o.product || "—"} {o.quantity ? `(x${o.quantity})` : ""}
                      </div>
                      {o.total_amount && (
                        <div className="text-sm">
                          <span className="opacity-70">Total:</span> <strong>{o.total_amount} Gs</strong>
                        </div>
                      )}
                      {(o.city || o.address) && (
                        <div className="text-sm">
                          <span className="opacity-70">Ubicación:</span> {o.city}{o.address ? ` — ${o.address}` : ""}
                        </div>
                      )}
                      <div className="text-xs opacity-50 mt-1">
                        {new Date(o.created_at).toLocaleString()}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <Badge className={`${cfg.color} border`}>
                        <Icon className="h-3 w-3 mr-1" />
                        {cfg.label}
                      </Badge>
                      {o.metodo_pago && (
                        <Badge variant="outline" className="text-xs capitalize">
                          {o.metodo_pago}
                        </Badge>
                      )}
                      {o.comprobante_url && (
                        <a href={o.comprobante_url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">
                          Ver comprobante ↗
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2 border-t border-border/30">
                    <Button size="sm" variant="outline" onClick={() => irAlChat(tel)}>
                      <MessageSquare className="h-4 w-4 mr-1" /> Ver chat
                    </Button>

                    {o.status !== "cargado" && (
                      <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => setOrderStatus(o, "cargado")}>
                        <Package className="h-4 w-4 mr-1" /> Cargado
                      </Button>
                    )}
                    {o.status !== "droppx" && (
                      <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={() => setOrderStatus(o, "droppx")}>
                        <Truck className="h-4 w-4 mr-1" /> A Droppx
                      </Button>
                    )}
                    {o.status !== "cancelado" && (
                      <Button size="sm" variant="outline" className="border-red-500/40 text-red-400 hover:bg-red-500/10" onClick={() => setOrderStatus(o, "cancelado")}>
                        <XCircle className="h-4 w-4 mr-1" /> Cancelar
                      </Button>
                    )}

                    <Button size="sm" variant="destructive" onClick={() => remove(o.id)}>
                      <Trash2 className="h-4 w-4 mr-1" /> Eliminar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
