import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: any }> = {
  confirmado: {
    label: "Confirmado",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    icon: Check,
  },
  confirmed: {
    label: "Confirmado",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    icon: Check,
  },
  pendiente: {
    label: "Pendiente",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    icon: RefreshCw,
  },
  pending: {
    label: "Pendiente",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    icon: RefreshCw,
  },
  cargado: {
    label: "Cargado",
    className: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    icon: Package,
  },
  cancelado: {
    label: "Cancelado",
    className: "border-red-500/30 bg-red-500/10 text-red-400",
    icon: XCircle,
  },
  droppx: {
    label: "Droppx",
    className: "border-purple-500/30 bg-purple-500/10 text-purple-400",
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

function cleanMoney(value: string | null) {
  if (!value) return "—";
  return `${value} Gs`;
}

function cleanText(value: string | number | null | undefined) {
  return value || "—";
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
        throw new Error(`Etiqueta "${labelName}" no encontrada. Creala en la pestaña Etiquetas.`);
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
      <div className="space-y-5">
        <div className="flex flex-col gap-4 border-b border-border/60 pb-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Pedidos</h1>
            <p className="text-sm text-muted-foreground">
              Gestión operativa de pedidos, cobros y despacho.
            </p>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative w-full xl:w-[380px]">
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
                  className="h-9 rounded-md"
                >
                  {item.label}
                </Button>
              ))}

              <Button
                size="sm"
                variant="outline"
                onClick={load}
                disabled={loading}
                className="h-9 rounded-md"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refrescar
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card shadow-sm">
          <div className="grid grid-cols-[70px_190px_150px_140px_160px_1fr_90px_130px_120px_130px_260px] border-b border-border/70 bg-muted/25 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <div>Pedido</div>
            <div>Compra desde</div>
            <div>Cliente</div>
            <div>Celular</div>
            <div>Ciudad</div>
            <div>Calle / ubicación</div>
            <div>Cant.</div>
            <div>Monto</div>
            <div>Pago</div>
            <div>Estado</div>
            <div>Acciones</div>
          </div>

          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Cargando pedidos...
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No hay pedidos para mostrar.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {filtered.map((o, index) => {
                const cfg =
                  STATUS_CONFIG[o.status] || {
                    label: o.status,
                    className: "border-gray-500/30 bg-gray-500/10 text-gray-400",
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
                  <div
                    key={o.id}
                    className="grid grid-cols-[70px_190px_150px_140px_160px_1fr_90px_130px_120px_130px_260px] items-center px-4 py-4 text-sm transition hover:bg-muted/20"
                  >
                    <div>
                      <div className="font-semibold">#{index + 1}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">{fecha}</div>
                    </div>

                    <div>
                      <div className="font-semibold">{cleanText(compraDesde)}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">Origen WhatsApp</div>
                    </div>

                    <div className="font-medium">{cleanText(o.customer_name)}</div>

                    <div>{cleanText(telefonoCliente)}</div>

                    <div>{cleanText(o.city)}</div>

                    <div>
                      <div className="line-clamp-2 text-sm">{cleanText(o.address)}</div>
                      <div className="mt-1 line-clamp-1 text-xs font-medium text-foreground">
                        {cleanText(o.product)}
                      </div>
                    </div>

                    <div className="font-semibold">{o.quantity || 1}</div>

                    <div className="font-bold">{cleanMoney(o.total_amount)}</div>

                    <div className="capitalize">{cleanText(o.metodo_pago)}</div>

                    <div>
                      <Badge className={`${cfg.className} gap-1 rounded-md border px-2 py-1`}>
                        <Icon className="h-3.5 w-3.5" />
                        {cfg.label}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2"
                        onClick={() => irAlChat(telefonoCliente)}
                      >
                        <MessageSquare className="h-4 w-4" />
                      </Button>

                      {o.comprobante_url && (
                        <a
                          href={o.comprobante_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-2 hover:bg-muted"
                        >
                          <ReceiptText className="h-4 w-4" />
                        </a>
                      )}

                      {o.status !== "cargado" && (
                        <Button
                          size="sm"
                          className="h-8 bg-blue-600 px-2 hover:bg-blue-700"
                          onClick={() => setOrderStatus(o, "cargado")}
                        >
                          <Package className="h-4 w-4" />
                        </Button>
                      )}

                      {o.status !== "droppx" && (
                        <Button
                          size="sm"
                          className="h-8 bg-purple-600 px-2 hover:bg-purple-700"
                          onClick={() => setOrderStatus(o, "droppx")}
                        >
                          <Truck className="h-4 w-4" />
                        </Button>
                      )}

                      {o.status !== "cancelado" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-red-500/40 px-2 text-red-400 hover:bg-red-500/10"
                          onClick={() => setOrderStatus(o, "cancelado")}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-8 px-2"
                        onClick={() => remove(o.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
