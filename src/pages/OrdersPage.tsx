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
  Phone,
  MapPin,
  CalendarDays,
  CreditCard,
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
    color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    icon: Check,
  },
  confirmed: {
    label: "Confirmado",
    color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    icon: Check,
  },
  pendiente: {
    label: "Pendiente",
    color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    icon: RefreshCw,
  },
  pending: {
    label: "Pendiente",
    color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    icon: RefreshCw,
  },
  cargado: {
    label: "Cargado",
    color: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    icon: Package,
  },
  cancelado: {
    label: "Cancelado",
    color: "bg-red-500/15 text-red-400 border-red-500/30",
    icon: XCircle,
  },
  droppx: {
    label: "A Droppx",
    color: "bg-purple-500/15 text-purple-400 border-purple-500/30",
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

  const totalPedidos = filtered.length;
  const totalConfirmados = orders.filter((o) => o.status === "confirmado" || o.status === "confirmed").length;
  const totalCargados = orders.filter((o) => o.status === "cargado").length;
  const totalPendientes = orders.filter((o) => o.status === "pendiente" || o.status === "pending").length;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Pedidos</h1>
            <p className="text-sm text-muted-foreground">
              Gestión ordenada de pedidos, pagos, estados y envíos.
            </p>
          </div>

          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refrescar
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-border/60 bg-card/70">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Mostrando</p>
              <p className="text-2xl font-bold">{totalPedidos}</p>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/70">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Confirmados</p>
              <p className="text-2xl font-bold text-emerald-400">{totalConfirmados}</p>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/70">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Pendientes</p>
              <p className="text-2xl font-bold text-yellow-400">{totalPendientes}</p>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/70">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Cargados</p>
              <p className="text-2xl font-bold text-blue-400">{totalCargados}</p>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/60 bg-card/70">
          <CardContent className="p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative w-full xl:max-w-md">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por cliente, teléfono, producto o ciudad..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {FILTERS.map((item) => (
                  <Button
                    key={item.key}
                    size="sm"
                    variant={filter === item.key ? "default" : "outline"}
                    onClick={() => setFilter(item.key)}
                    className="rounded-full"
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <Card className="border-border/60 bg-card/70">
            <CardContent className="p-8 text-center text-muted-foreground">
              Cargando pedidos...
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="border-border/60 bg-card/70">
            <CardContent className="p-8 text-center text-muted-foreground">
              No hay pedidos para mostrar.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filtered.map((o) => {
              const cfg =
                STATUS_CONFIG[o.status] || {
                  label: o.status,
                  color: "bg-gray-500/15 text-gray-400 border-gray-500/30",
                  icon: Check,
                };

              const Icon = cfg.icon;
              const compraDesde = o.from_number || o.phone || null;
              const telefonoCliente = o.phone || o.from_number || null;

              return (
                <Card
                  key={o.id}
                  className="overflow-hidden border-border/60 bg-card/80 shadow-sm transition hover:border-primary/30 hover:shadow-md"
                >
                  <CardContent className="p-0">
                    <div className="grid gap-0 lg:grid-cols-[1fr_260px]">
                      <div className="space-y-4 p-5">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-lg font-bold">
                                {o.customer_name || "Cliente sin nombre"}
                              </h2>

                              {o.detected_by_ai && (
                                <Badge variant="outline" className="gap-1 rounded-full text-xs">
                                  <Bot className="h-3 w-3" />
                                  AUTO
                                </Badge>
                              )}
                            </div>

                            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                              {compraDesde && (
                                <span className="inline-flex items-center gap-1">
                                  <Phone className="h-3.5 w-3.5" />
                                  Compra desde: <strong className="text-foreground">{compraDesde}</strong>
                                </span>
                              )}

                              <span className="inline-flex items-center gap-1">
                                <CalendarDays className="h-3.5 w-3.5" />
                                {new Date(o.created_at).toLocaleString()}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={`${cfg.color} gap-1 rounded-full border px-3 py-1`}>
                              <Icon className="h-3.5 w-3.5" />
                              {cfg.label}
                            </Badge>

                            {o.metodo_pago && (
                              <Badge variant="outline" className="gap-1 rounded-full capitalize">
                                <CreditCard className="h-3.5 w-3.5" />
                                {o.metodo_pago}
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="rounded-xl border border-border/50 bg-background/40 p-3 md:col-span-2">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              Producto
                            </p>
                            <p className="mt-1 font-semibold leading-snug">
                              {o.product || "Producto no especificado"}
                              {o.quantity ? (
                                <span className="ml-2 text-sm text-muted-foreground">
                                  x{o.quantity}
                                </span>
                              ) : null}
                            </p>
                          </div>

                          <div className="rounded-xl border border-border/50 bg-background/40 p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              Total
                            </p>
                            <p className="mt-1 text-xl font-bold">
                              {o.total_amount ? `${o.total_amount} Gs` : "—"}
                            </p>
                          </div>
                        </div>

                        <div className="rounded-xl border border-border/50 bg-background/40 p-3">
                          <p className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
                            <MapPin className="h-3.5 w-3.5" />
                            Ubicación
                          </p>
                          <p className="mt-1 text-sm">
                            {o.city || "Ciudad no especificada"}
                            {o.address ? ` — ${o.address}` : ""}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between gap-3 border-t border-border/60 bg-background/30 p-5 lg:border-l lg:border-t-0">
                        <div className="space-y-2">
                          {o.comprobante_url && (
                            <a
                              href={o.comprobante_url}
                              target="_blank"
                              rel="noreferrer"
                              className="block rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-center text-sm font-medium text-blue-400 hover:bg-blue-500/15"
                            >
                              Ver comprobante ↗
                            </a>
                          )}

                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full justify-center"
                            onClick={() => irAlChat(telefonoCliente)}
                          >
                            <MessageSquare className="mr-2 h-4 w-4" />
                            Ver chat
                          </Button>
                        </div>

                        <div className="grid gap-2">
                          {o.status !== "cargado" && (
                            <Button
                              size="sm"
                              className="w-full bg-blue-600 hover:bg-blue-700"
                              onClick={() => setOrderStatus(o, "cargado")}
                            >
                              <Package className="mr-2 h-4 w-4" />
                              Cargado
                            </Button>
                          )}

                          {o.status !== "droppx" && (
                            <Button
                              size="sm"
                              className="w-full bg-purple-600 hover:bg-purple-700"
                              onClick={() => setOrderStatus(o, "droppx")}
                            >
                              <Truck className="mr-2 h-4 w-4" />
                              A Droppx
                            </Button>
                          )}

                          {o.status !== "cancelado" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                              onClick={() => setOrderStatus(o, "cancelado")}
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              Cancelar
                            </Button>
                          )}

                          <Button
                            size="sm"
                            variant="destructive"
                            className="w-full"
                            onClick={() => remove(o.id)}
                          >
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
