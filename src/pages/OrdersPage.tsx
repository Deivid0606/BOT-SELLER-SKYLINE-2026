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
  Phone,
  ShoppingCart,
  DollarSign,
  Calendar,
  TrendingUp,
  Clock,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

const ECOMMERCE_URL = "https://www.el-ecommercedcanpgroup.com";

const HIDDEN_STATUSES = [
  "collecting_name",
  "collecting_city",
  "collecting_address",
  "collecting_phone",
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  confirmado: {
    label: "Confirmado",
    color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    icon: Check,
  },
  confirmed: {
    label: "Confirmado",
    color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    icon: Check,
  },
  pendiente: {
    label: "Pendiente",
    color: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    icon: RefreshCw,
  },
  pending: {
    label: "Pendiente",
    color: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    icon: RefreshCw,
  },
  cargado: {
    label: "Cargado",
    color: "border-emerald-500/50 bg-emerald-500/10 text-emerald-400",
    icon: Package,
  },
  cancelado: {
    label: "Cancelado",
    color: "border-red-500/40 bg-red-500/10 text-red-400",
    icon: XCircle,
  },
  droppx: {
    label: "Droppx",
    color: "border-blue-500/40 bg-blue-500/10 text-blue-400",
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

function valueOrDash(value: string | number | null | undefined) {
  return value || "—";
}

function normalizeStatus(status: string) {
  if (status === "confirmed") return "confirmado";
  if (status === "pending") return "pendiente";
  return status;
}

function DetailLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string | number | null | undefined;
  strong?: boolean;
}) {
  return (
    <p className="text-sm leading-relaxed text-foreground">
      <span className="font-bold">{label}: </span>
      <span className={strong ? "font-extrabold" : "font-medium"}>
        {valueOrDash(value)}
      </span>
    </p>
  );
}

// Dashboard Card Component
function DashboardCard({ title, value, icon: Icon, color }: { title: string; value: string | number; icon: any; color: string }) {
  return (
    <Card className="border-border/60 bg-gradient-to-br from-background to-background/80">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tracking-tight mt-1">{value}</p>
          </div>
          <div className={`rounded-full p-2 ${color}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
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
  
  // Nuevos estados para filtros de fecha
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dateFilterType, setDateFilterType] = useState<"today" | "week" | "month" | "custom" | "all">("all");

  const load = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    // Aplicar filtro de fecha si está seleccionado
    if (dateFilterType !== "all") {
      const now = new Date();
      let fromDate: Date | null = null;
      
      switch (dateFilterType) {
        case "today":
          fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case "week":
          fromDate = new Date(now);
          fromDate.setDate(now.getDate() - 7);
          break;
        case "month":
          fromDate = new Date(now);
          fromDate.setMonth(now.getMonth() - 1);
          break;
        case "custom":
          if (startDate) {
            fromDate = new Date(startDate);
          }
          break;
      }
      
      if (fromDate) {
        query = query.gte("created_at", fromDate.toISOString());
      }
      
      if (dateFilterType === "custom" && endDate) {
        const toDate = new Date(endDate);
        toDate.setHours(23, 59, 59, 999);
        query = query.lte("created_at", toDate.toISOString());
      }
    }

    const { data, error } = await query;

    if (error) {
      toast.error("Error cargando pedidos: " + error.message);
    } else {
      setOrders((data || []).filter((o: Order) => !HIDDEN_STATUSES.includes(o.status)));
    }

    setLoading(false);
  }, [dateFilterType, startDate, endDate]);

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

  async function setOrderStatus(
    order: Order,
    newStatus: "pendiente" | "cargado" | "cancelado" | "droppx"
  ) {
    const labelMap: Record<string, string> = {
      pendiente: "PEDIDO PENDIENTE",
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
        .in("name", [
          "PEDIDO PENDIENTE",
          "PEDIDO CARGADO",
          "PEDIDO CANCELADO",
          "PEDIDO A DROPPX",
        ]);

      const newTag = pedidoTags?.find((t) => t.name === labelName);

      if (newTag && phone) {
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

      toast.success(`Pedido marcado como ${labelName}`);
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

  function abrirEcommerce(o: Order) {
    const numeroCompra = o.from_number || o.phone || "";

    const observacion = `Producto: ${o.product || "Sin producto"} | Forma de pago: ${o.metodo_pago || "efectivo"}`;

    const params = new URLSearchParams({
      view: "create-order",
      nombre: o.customer_name || "",
      telefono: numeroCompra,
      ciudad: o.city || "",
      calle: o.address || "",
      producto: o.product || "",
      cantidad: String(o.quantity || 1),
      total: o.total_amount || "",
      pago: o.metodo_pago || "",
      observacion,
      origen: "seller-skyline",
    });

    window.open(
      `${ECOMMERCE_URL}/?${params.toString()}`,
      "_blank"
    );
  }

  // Calcular estadísticas para el dashboard
  const stats = {
    total: orders.length,
    confirmados: orders.filter(o => normalizeStatus(o.status) === "confirmado").length,
    pendientes: orders.filter(o => normalizeStatus(o.status) === "pendiente").length,
    cargados: orders.filter(o => normalizeStatus(o.status) === "cargado").length,
    cancelados: orders.filter(o => normalizeStatus(o.status) === "cancelado").length,
    droppx: orders.filter(o => normalizeStatus(o.status) === "droppx").length,
    totalVentas: orders.reduce((sum, o) => {
      const total = parseFloat(o.total_amount || "0");
      return sum + (isNaN(total) ? 0 : total);
    }, 0),
  };

  const filtered = orders.filter((o) => {
    const tel = o.phone || o.from_number || "";

    const matchSearch =
      !search ||
      o.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      tel.includes(search) ||
      o.product?.toLowerCase().includes(search.toLowerCase()) ||
      o.city?.toLowerCase().includes(search.toLowerCase()) ||
      o.address?.toLowerCase().includes(search.toLowerCase());

    const status = normalizeStatus(o.status);

    const matchFilter =
      filter === "todos" ||
      (filter === "confirmados" && status === "confirmado") ||
      (filter === "pendientes" && status === "pendiente") ||
      (filter === "cargados" && status === "cargado") ||
      (filter === "cancelados" && status === "cancelado") ||
      (filter === "droppx" && status === "droppx");

    return matchSearch && matchFilter;
  });

  return (
    <div className="min-h-screen bg-background px-5 py-5">
      <div className="w-full space-y-5">
        {/* Dashboard Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-500" />
            <h2 className="text-lg font-semibold tracking-tight">Dashboard</h2>
          </div>
          
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <DashboardCard
              title="Total Pedidos"
              value={stats.total}
              icon={Package}
              color="bg-blue-500/20 text-blue-400"
            />
            <DashboardCard
              title="Confirmados"
              value={stats.confirmados}
              icon={Check}
              color="bg-emerald-500/20 text-emerald-400"
            />
            <DashboardCard
              title="Pendientes"
              value={stats.pendientes}
              icon={Clock}
              color="bg-amber-500/20 text-amber-400"
            />
            <DashboardCard
              title="Cargados"
              value={stats.cargados}
              icon={Package}
              color="bg-emerald-500/20 text-emerald-400"
            />
            <DashboardCard
              title="Droppx"
              value={stats.droppx}
              icon={Truck}
              color="bg-blue-500/20 text-blue-400"
            />
            <DashboardCard
              title="Total Ventas"
              value={`${stats.totalVentas.toLocaleString()} Gs`}
              icon={DollarSign}
              color="bg-purple-500/20 text-purple-400"
            />
          </div>
        </div>

        {/* Header con filtros */}
        <div className="flex flex-col gap-4 border-b border-border/60 pb-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
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

          {/* Filtros de estado */}
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
          </div>

          {/* Filtros de fecha */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Select value={dateFilterType} onValueChange={(v: any) => setDateFilterType(v)}>
                <SelectTrigger className="h-9 w-[140px]">
                  <SelectValue placeholder="Filtrar por fecha" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las fechas</SelectItem>
                  <SelectItem value="today">Hoy</SelectItem>
                  <SelectItem value="week">Últimos 7 días</SelectItem>
                  <SelectItem value="month">Último mes</SelectItem>
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {dateFilterType === "custom" && (
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-9 w-auto"
                  placeholder="Desde"
                />
                <span className="text-muted-foreground">—</span>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-9 w-auto"
                  placeholder="Hasta"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setStartDate("");
                    setEndDate("");
                    setDateFilterType("all");
                  }}
                  className="h-9 px-3"
                >
                  Limpiar
                </Button>
              </div>
            )}
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
          <>
            {/* Result count */}
            <div className="text-sm text-muted-foreground">
              Mostrando {filtered.length} de {orders.length} pedidos
            </div>
            
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {filtered.map((o) => {
                const status = normalizeStatus(o.status);
                const cfg =
                  STATUS_CONFIG[status] || {
                    label: status,
                    color: "border-gray-500/40 bg-gray-500/10 text-gray-400",
                    icon: Check,
                  };

                const Icon = cfg.icon;
                const compraDesde = o.from_number || o.phone || null;
                const telefonoCliente = o.phone || o.from_number || null;

                const fecha = new Date(o.created_at).toLocaleString("es-PY", {
                  day: "numeric",
                  month: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                });

                return (
                  <Card
                    key={o.id}
                    className="overflow-hidden rounded-xl border border-slate-800 bg-[#0b1020] shadow-sm transition hover:border-emerald-500/40"
                  >
                    <div className="h-1 w-full bg-emerald-500" />

                    <CardContent className="p-4">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <Phone className="h-3.5 w-3.5 text-pink-400" />
                            <span>Desde</span>
                          </div>

                          <div className="mt-1 text-lg font-black leading-none text-white">
                            {valueOrDash(compraDesde)}
                          </div>
                        </div>

                        <Badge className={`${cfg.color} rounded-full border px-3 py-1`}>
                          <Icon className="mr-1 h-3.5 w-3.5" />
                          {cfg.label}
                        </Badge>
                      </div>

                      <div className="mb-3">
                        <h2 className="text-base font-black leading-snug text-white">
                          {valueOrDash(o.product)}
                        </h2>
                        <p className="mt-1 text-xs font-medium text-slate-400">{fecha}</p>
                      </div>

                      <div className="space-y-0.5">
                        <DetailLine label="Cliente" value={o.customer_name} />
                        <DetailLine label="Ciudad" value={o.city} />
                        <DetailLine label="Dirección" value={o.address} />
                        <DetailLine label="Tel" value={telefonoCliente} />
                        <DetailLine label="Cant" value={o.quantity || 1} />
                        <DetailLine
                          label="Total"
                          value={o.total_amount ? `${o.total_amount} Gs` : null}
                          strong
                        />
                        <DetailLine label="Pago" value={o.metodo_pago} />
                      </div>

                      {o.comprobante_url && (
                        <a
                          href={o.comprobante_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex h-8 items-center rounded-full border border-emerald-500/60 bg-emerald-500/10 px-3 text-xs font-bold text-emerald-300 hover:bg-emerald-500/15"
                        >
                          <ReceiptText className="mr-2 h-3.5 w-3.5" />
                          Comprobante
                        </a>
                      )}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          className="h-8 rounded-md bg-orange-500/20 px-3 text-xs text-orange-300 hover:bg-orange-500/30"
                          onClick={() => abrirEcommerce(o)}
                        >
                          <ShoppingCart className="mr-1.5 h-3.5 w-3.5" />
                          Ecommerce
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-md border-slate-700 bg-slate-900 px-3 text-xs text-white hover:bg-slate-800"
                          onClick={() => irAlChat(telefonoCliente)}
                        >
                          <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                          Chat
                        </Button>

                        {status !== "pendiente" && (
                          <Button
                            size="sm"
                            className="h-8 rounded-md bg-amber-500/20 px-3 text-xs text-amber-300 hover:bg-amber-500/30"
                            onClick={() => setOrderStatus(o, "pendiente")}
                          >
                            🟡 Pendiente
                          </Button>
                        )}

                        {status !== "cargado" && (
                          <Button
                            size="sm"
                            className="h-8 rounded-md bg-emerald-500/20 px-3 text-xs text-emerald-300 hover:bg-emerald-500/30"
                            onClick={() => setOrderStatus(o, "cargado")}
                          >
                            ✅ Cargado
                          </Button>
                        )}

                        {status !== "droppx" && (
                          <Button
                            size="sm"
                            className="h-8 rounded-md bg-blue-500/20 px-3 text-xs text-blue-300 hover:bg-blue-500/30"
                            onClick={() => setOrderStatus(o, "droppx")}
                          >
                            🚚 Droppx
                          </Button>
                        )}

                        {status !== "cancelado" && (
                          <Button
                            size="sm"
                            className="h-8 rounded-md bg-red-500/20 px-3 text-xs text-red-300 hover:bg-red-500/30"
                            onClick={() => setOrderStatus(o, "cancelado")}
                          >
                            ❌ Cancelado
                          </Button>
                        )}

                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-8 rounded-md px-3 text-xs"
                          onClick={() => remove(o.id)}
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          Eliminar
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
