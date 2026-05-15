import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Check,
  RefreshCw,
  Search,
  Trash2,
  Package,
  XCircle,
  Truck,
  MessageSquare,
  ReceiptText,
  Bot,
} from "lucide-react";

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

const HIDDEN_STATUSES = [
  "collecting_name",
  "collecting_city",
  "collecting_address",
  "collecting_phone",
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  confirmado: {
    label: "Confirmado",
    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
    icon: Check,
  },
  confirmed: {
    label: "Confirmado",
    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
    icon: Check,
  },
  pendiente: {
    label: "Pendiente",
    color: "bg-amber-500/10 text-amber-400 border-amber-500/25",
    icon: RefreshCw,
  },
  pending: {
    label: "Pendiente",
    color: "bg-amber-500/10 text-amber-400 border-amber-500/25",
    icon: RefreshCw,
  },
  cargado: {
    label: "Cargado",
    color: "bg-blue-500/10 text-blue-400 border-blue-500/25",
    icon: Package,
  },
  cancelado: {
    label: "Cancelado",
    color: "bg-red-500/10 text-red-400 border-red-500/25",
    icon: XCircle,
  },
  droppx: {
    label: "Droppx",
    color: "bg-purple-500/10 text-purple-400 border-purple-500/25",
    icon: Truck,
  },
};

const FILTERS = [
  { key: "todos", label: "Todos" },
  { key: "confirmados", label: "Confirmados" },
  { key: "pendientes", label: "Pendientes" },
  { key: "cargados", label: "Cargados" },
  { key: "cancelados", label: "Cancelados" },
  { key: "droppx", label: "Droppx" },
] as const;

function RowInfo({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string | number | null | undefined;
  highlight?: boolean;
}) {
  return (
    <div className="grid grid-cols-[135px_1fr] items-start gap-3 border-b border-border/40 py-2.5 last:border-b-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={
          highlight
            ? "text-sm font-black text-foreground"
            : "text-sm font-semibold leading-snug text-foreground"
        }
      >
        {value || "No especificado"}
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<
    "todos" | "confirmados" | "pendientes" | "cargados" | "cancelados" | "droppx"
  >("todos");

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

    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  async function setOrderStatus(order: Order, newStatus: "cargado" | "cancelado" | "droppx") {
    const labelMap: Record<string, string> = {
      cargado: "PEDIDO CARGADO",
      cancelado: "PEDIDO CANCELADO",
      droppx: "PEDIDO A DROPPX",
    };

    const labelName = labelMap[newStatus];
    const phone = order.phone || order.from_number;

    try {
      const { error: e1 } = await supabase
        .from("orders")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", order.id);

      if (e1) throw e1;

      const { data: pedidoTags } = await supabase
        .from("tags")
        .select("id, name")
        .eq("user_id", order.user_id)
        .in("name", ["PEDIDO CARGADO", "PEDIDO CANCELADO", "PEDIDO A DROPPX"]);

      const newTag = pedidoTags?.find((t) => t.name === labelName);

      if (!newTag) {
        throw new Error(`Etiqueta "${labelName}" no encontrada. Creala en Etiquetas.`);
      }

      if (phone) {
        const oldPedidoTagIds = pedidoTags?.map((t) => t.id) || [];

        if (oldPedidoTagIds.length > 0) {
          await supabase
            .from("contact_tags")
            .delete()
            .eq("contact_id", phone)
            .in("tag_id", oldPedidoTagIds);
        }

        await supabase.from("contact_tags").insert({
          contact_id: phone,
          tag_id: newTag.id,
          user_id: order.user_id,
        });
      }

      toast.success(`Marcado como ${labelName}`);
      load();
    } catch (err: any) {
      toast.error("Error: " + err.message);
    }
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar este pedido?")) return;

    const { error } = await supabase.from("orders").delete().eq("id", id);

    if (error) toast.error(error.message);
    else {
      toast.success("Pedido eliminado");
      load();
    }
  }

  function irAlChat(phone: string | null) {
    if (!phone) {
      toast.error("Este pedido no tiene teléfono");
      return;
    }

    navigate(`/inbox?phone=${encodeURIComponent(phone)}`);
  }

  const filtered = orders.filter((o) => {
    const tel = o.phone || o.from_number || "";

    const matchSearch =
      !search ||
      o.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      tel.includes(search) ||
      o.product?.toLowerCase().includes(search.toLowerCase()) ||
      o.city?.toLowerCase().includes(search.toLowerCase()) ||
      o.address?.toLowerCase().includes(search.toLowerCase());

    const matchFilter =
      filter === "todos" ||
      (filter === "confirmados" && (o.status === "confirmado" || o.status === "confirmed")) ||
      (filter === "pendientes" && (o.status === "pendiente" || o.status === "pending")) ||
      (filter === "cargados" && o.status === "cargado") ||
      (filter === "cancelados" && o.status === "cancelado") ||
      (filter === "droppx" && o.status === "droppx");

    return matchSearch && matchFilter;
  });

  return (
    <div className="min-h-screen bg-background px-6 py-5">
      <div className="w-full space-y-5">
        <div className="flex flex-col gap-4 border-b border-border/60 pb-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pedidos</h1>
            <p className="text-sm text-muted-foreground">
              Panel operativo de pedidos, pagos y despacho.
            </p>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative w-full xl:w-[390px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cliente, teléfono, producto o ciudad"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 pl-9"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {FILTERS.map((item) => (
                <Button
                  key={item.key}
                  size="sm"
                  variant={filter === item.key ? "default" : "outline"}
                  onClick={() => setFilter(item.key)}
                  className="h-9 rounded-full px-4"
                >
                  {item.label}
                </Button>
              ))}

              <Button
                size="sm"
                variant="outline"
                onClick={load}
                disabled={loading}
                className="h-9 rounded-full px-4"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refrescar
              </Button>
            </div>
          </div>
        </div>

        {loading ? (
          <Card className="border-border/60">
            <CardContent className="p-10 text-center text-muted-foreground">
              Cargando pedidos...
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="border-border/60">
            <CardContent className="p-10 text-center text-muted-foreground">
              No hay pedidos para mostrar.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {filtered.map((o, index) => {
              const cfg =
                STATUS_CONFIG[o.status] || {
                  label: o.status,
                  color: "bg-gray-500/10 text-gray-400 border-gray-500/25",
                  icon: Check,
                };

              const Icon = cfg.icon;
              const compraDesde = o.from_number || o.phone || null;
              const telefonoCliente = o.phone || o.from_number || null;

              const fecha = new Date(o.created_at).toLocaleString("es-PY", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <Card
                  key={o.id}
                  className="overflow-hidden rounded-2xl border-border/70 bg-card shadow-sm transition hover:border-primary/35 hover:shadow-md"
                >
                  <CardContent className="p-0">
                    <div className="flex items-start justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-black text-primary">
                          #{index + 1}
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-bold leading-tight">
                              {o.customer_name || "Cliente sin nombre"}
                            </p>

                            {o.detected_by_ai && (
                              <Badge variant="outline" className="h-5 gap-1 rounded-md px-1.5 text-[10px]">
                                <Bot className="h-3 w-3" />
                                AUTO
                              </Badge>
                            )}
                          </div>

                          <p className="mt-1 text-xs text-muted-foreground">
                            Pedido registrado
                          </p>
                        </div>
                      </div>

                      <Badge className={`${cfg.color} shrink-0 gap-1 rounded-md border px-2.5 py-1`}>
                        <Icon className="h-3.5 w-3.5" />
                        {cfg.label}
                      </Badge>
                    </div>

                    <div className="p-4">
                      <div className="rounded-2xl border border-border/60 bg-background/35 px-4 py-2">
                        <RowInfo label="Compra desde" value={compraDesde || "No disponible"} highlight />
                        <RowInfo label="Fecha y hora" value={fecha} />
                        <RowInfo label="Nombre y apellido" value={o.customer_name} />
                        <RowInfo label="Número de celular" value={telefonoCliente} />
                        <RowInfo label="Ciudad" value={o.city} />
                        <RowInfo label="Calle" value={o.address} />
                        <RowInfo label="Producto" value={o.product} />
                        <RowInfo label="Cantidad" value={o.quantity || 1} />
                        <RowInfo
                          label="Monto a pagar"
                          value={o.total_amount ? `${o.total_amount} Gs` : "No especificado"}
                          highlight
                        />
                        <RowInfo label="Calle o ubicación" value={o.address} />
                        <RowInfo label="Forma de pago" value={o.metodo_pago || "No especificado"} />
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4">
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => irAlChat(telefonoCliente)}>
                            <MessageSquare className="mr-2 h-4 w-4" />
                            Ver chat
                          </Button>

                          {o.comprobante_url && (
                            <a
                              href={o.comprobante_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
                            >
                              <ReceiptText className="mr-2 h-4 w-4" />
                              Comprobante
                            </a>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {o.status !== "cargado" && (
                            <Button
                              size="sm"
                              className="bg-blue-600 hover:bg-blue-700"
                              onClick={() => setOrderStatus(o, "cargado")}
                            >
                              <Package className="mr-2 h-4 w-4" />
                              Cargado
                            </Button>
                          )}

                          {o.status !== "droppx" && (
                            <Button
                              size="sm"
                              className="bg-purple-600 hover:bg-purple-700"
                              onClick={() => setOrderStatus(o, "droppx")}
                            >
                              <Truck className="mr-2 h-4 w-4" />
                              Droppx
                            </Button>
                          )}

                          {o.status !== "cancelado" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                              onClick={() => setOrderStatus(o, "cancelado")}
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              Cancelar
                            </Button>
                          )}

                          <Button size="sm" variant="destructive" onClick={() => remove(o.id)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Eliminar
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
