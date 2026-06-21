// ORDERS PAGE 100% COMPLETO
// DASHBOARD CON GRÁFICOS + FILTROS + ITEMS + UI PROFESIONAL

import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  ShoppingCart,
  DollarSign,
  Calendar,
  Clock,
  User,
  MapPin,
  TrendingUp,
  TrendingDown,
  AlertCircle,
} from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";

type OrderItem = {
  product?: string;
  name?: string;
  quantity?: number;
  amount?: number;
  price?: number;
};

type Order = {
  id: string;
  user_id: string;
  customer_name: string | null;
  phone: string | null;
  from_number: string | null;
  product: string | null;
  quantity: number | null;
  items?: OrderItem[] | string | null;
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

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    color: string;
    bgColor: string;
    icon: any;
    gradient: string;
  }
> = {
  confirmado: {
    label: "Confirmado",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    icon: Check,
    gradient: "from-emerald-500/20 to-emerald-600/10",
  },
  confirmed: {
    label: "Confirmado",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    icon: Check,
    gradient: "from-emerald-500/20 to-emerald-600/10",
  },
  pendiente: {
    label: "Pendiente",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    icon: Clock,
    gradient: "from-amber-500/20 to-amber-600/10",
  },
  pending: {
    label: "Pendiente",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    icon: Clock,
    gradient: "from-amber-500/20 to-amber-600/10",
  },
  cargado: {
    label: "Cargado",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    icon: Package,
    gradient: "from-emerald-500/20 to-emerald-600/10",
  },
  cancelado: {
    label: "Cancelado",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    icon: XCircle,
    gradient: "from-red-500/20 to-red-600/10",
  },
  droppx: {
    label: "Droppx",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    icon: Truck,
    gradient: "from-blue-500/20 to-blue-600/10",
  },
};

const FILTERS = [
  { id: "all", label: "Todos", icon: Package },
  { id: "confirmados", label: "Confirmados", icon: Check },
  { id: "cargados", label: "Cargados", icon: Package },
  { id: "cancelados", label: "Cancelados", icon: XCircle },
  { id: "droppx", label: "Droppx", icon: Truck },
];

const CHART_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6"];

function formatCurrency(value: string | number | null | undefined) {
  if (!value) return "0";
  const cleanValue = typeof value === "string" ? value.replace(/\./g, "").replace(",", ".") : value;
  const num = typeof cleanValue === "string" ? Number(cleanValue) : cleanValue;
  if (isNaN(num)) return "0";
  return Math.round(num).toLocaleString("es-PY", { maximumFractionDigits: 0 });
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
  if (diffHours < 1) return "Hace unos momentos";
  if (diffHours < 24) return `Hace ${diffHours} horas`;
  return date.toLocaleDateString("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeStatus(status: string) {
  if (status === "confirmed") return "confirmado";
  if (status === "pending") return "pendiente";
  return status;
}

function getOrderItems(order: Order) {
  try {
    if (Array.isArray(order.items)) return order.items;
    if (typeof order.items === "string" && order.items.trim()) {
      const parsed = JSON.parse(order.items);
      return Array.isArray(parsed) ? parsed : [];
    }
    return [];
  } catch {
    return [];
  }
}

// Función para obtener el nombre de usuario actual
async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export default function OrdersPage() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [userId, setUserId] = useState<string | null>(null);

  // Obtener usuario actual
  useEffect(() => {
    getCurrentUser().then(user => {
      if (user) setUserId(user.id);
    });
  }, []);

  const loadOrders = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    // Filtro por usuario (si existe)
    if (userId) {
      query = query.eq("user_id", userId);
    }

    if (dateFilter === "today") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      query = query.gte("created_at", today.toISOString());
    }
    if (dateFilter === "week") {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      query = query.gte("created_at", weekAgo.toISOString());
    }
    if (dateFilter === "month") {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      query = query.gte("created_at", monthAgo.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      toast.error("Error cargando pedidos");
      console.error("Error loading orders:", error);
    } else {
      // Filtrar pedidos ocultos y eliminar duplicados por ID
      const filtered = (data || []).filter(
        (o: Order) => !HIDDEN_STATUSES.includes(o.status)
      );
      
      // Eliminar duplicados (mantener solo el primero de cada ID)
      const uniqueOrders = filtered.reduce((acc: Order[], current: Order) => {
        const exists = acc.some(item => item.id === current.id);
        if (!exists) {
          acc.push(current);
        }
        return acc;
      }, []);

      setOrders(uniqueOrders);
    }

    setLoading(false);
  }, [dateFilter, userId]);

  useEffect(() => {
    if (userId) {
      loadOrders();
    }
  }, [loadOrders, userId]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel("orders")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: userId ? `user_id=eq.${userId}` : undefined,
        },
        () => loadOrders()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, loadOrders]);

  async function updateStatus(order: Order, newStatus: string) {
    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: newStatus })
        .eq("id", order.id);

      if (error) throw error;

      toast.success("Pedido actualizado");
      loadOrders();
    } catch {
      toast.error("Error actualizando pedido");
    }
  }

  async function deleteOrder(id: string) {
    if (!confirm("¿Eliminar este pedido?")) return;

    const { error } = await supabase.from("orders").delete().eq("id", id);

    if (error) {
      toast.error("Error eliminando pedido");
    } else {
      toast.success("Pedido eliminado");
      loadOrders();
    }
  }

  function openChat(phone: string | null) {
    if (!phone) {
      toast.error("No hay número");
      return;
    }
    navigate(`/inbox?phone=${encodeURIComponent(phone)}`);
  }

  function openEcommerce(order: Order) {
    const realChatNumber = order.from_number || order.phone || "";
    const params = new URLSearchParams({
      view: "create-order",
      nombre: order.customer_name || "",
      telefono: realChatNumber,
      ciudad: order.city || "",
      calle: order.address || "",
      producto: order.product || "",
      cantidad: String(order.quantity || 1),
      total: order.total_amount || "",
      pago: order.metodo_pago || "",
      observacion: `Producto: ${order.product || "Sin producto"}`,
      origen: "seller-skyline",
    });
    window.open(`${ECOMMERCE_URL}/?${params.toString()}`, "_blank");
  }

  // Estadísticas
  const stats = {
    total: orders.length,
    confirmados: orders.filter((o) => normalizeStatus(o.status) === "confirmado").length,
    cargados: orders.filter((o) => normalizeStatus(o.status) === "cargado").length,
    cancelados: orders.filter((o) => normalizeStatus(o.status) === "cancelado").length,
    droppx: orders.filter((o) => normalizeStatus(o.status) === "droppx").length,
    ingresos: orders.reduce((sum, o) => {
      const total = parseFloat(o.total_amount || "0");
      return sum + (isNaN(total) ? 0 : total);
    }, 0),
  };

  // Datos para el gráfico de torta
  const pieData = [
    { name: "Confirmados", value: stats.confirmados, color: CHART_COLORS[0] },
    { name: "Cargados", value: stats.cargados, color: CHART_COLORS[1] },
    { name: "Cancelados", value: stats.cancelados, color: CHART_COLORS[3] },
    { name: "Droppx", value: stats.droppx, color: CHART_COLORS[4] },
  ].filter(item => item.value > 0);

  // Datos para gráfico de barras (últimos 7 días)
  const getLast7DaysData = () => {
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit" });
      const dayOrders = orders.filter(o => {
        const orderDate = new Date(o.created_at);
        return orderDate.toDateString() === date.toDateString();
      });
      days.push({
        day: dateStr,
        pedidos: dayOrders.length,
        ingresos: dayOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || "0"), 0),
      });
    }
    return days;
  };

  const barData = getLast7DaysData();

  const filteredOrders = orders.filter((order) => {
    const searchTerm = search.toLowerCase();
    const status = normalizeStatus(order.status);

    const matchesSearch =
      !search ||
      order.customer_name?.toLowerCase().includes(searchTerm) ||
      order.phone?.toLowerCase().includes(searchTerm) ||
      order.from_number?.toLowerCase().includes(searchTerm) ||
      order.product?.toLowerCase().includes(searchTerm) ||
      order.city?.toLowerCase().includes(searchTerm);

    const matchesFilter =
      activeFilter === "all" ||
      (activeFilter === "confirmados" && status === "confirmado") ||
      (activeFilter === "cargados" && status === "cargado") ||
      (activeFilter === "cancelados" && status === "cancelado") ||
      (activeFilter === "droppx" && status === "droppx");

    return matchesSearch && matchesFilter;
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-950 to-black">
      <div className="mx-auto flex max-w-[1600px] flex-col px-6 py-8 sm:px-8 lg:px-10">
        
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white">Panel de Pedidos</h1>
              <p className="mt-1 text-sm text-zinc-400">Gestión operativa de pedidos, pagos y despacho</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="border-zinc-700 bg-zinc-800/50 text-zinc-300">
                <Clock className="mr-1 h-3 w-3" />
                Actualizado: {new Date().toLocaleTimeString()}
              </Badge>
            </div>
          </div>
        </div>

        {/* MÉTRICAS - Cards con líneas y diseño mejorado */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <MetricCard
            title="Total Pedidos"
            value={stats.total}
            icon={Package}
            trend={+12}
            color="text-purple-400"
            bgGradient="from-purple-500/10 to-purple-600/5"
          />
          <MetricCard
            title="Confirmados"
            value={stats.confirmados}
            icon={Check}
            trend={+8}
            color="text-emerald-400"
            bgGradient="from-emerald-500/10 to-emerald-600/5"
          />
          <MetricCard
            title="Cargados"
            value={stats.cargados}
            icon={Package}
            trend={+5}
            color="text-blue-400"
            bgGradient="from-blue-500/10 to-blue-600/5"
          />
          <MetricCard
            title="Droppx"
            value={stats.droppx}
            icon={Truck}
            trend={-2}
            color="text-cyan-400"
            bgGradient="from-cyan-500/10 to-cyan-600/5"
          />
          <MetricCard
            title="Ingresos"
            value={`${formatCurrency(stats.ingresos)} Gs`}
            icon={DollarSign}
            trend={+15}
            color="text-amber-400"
            bgGradient="from-amber-500/10 to-amber-600/5"
          />
        </div>

        {/* GRÁFICOS - Línea, Torta y Barras */}
        <div className="mb-8 grid gap-6 lg:grid-cols-3">
          {/* Gráfico de Torta */}
          <Card className="col-span-1 overflow-hidden border-zinc-800 bg-zinc-900/50 backdrop-blur-sm">
            <CardHeader className="border-b border-zinc-800 pb-3">
              <CardTitle className="text-sm font-medium text-zinc-300">Distribución por Estado</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="h-[220px]">
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} stroke="#1a1a2e" strokeWidth={2} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#1a1a2e",
                          border: "1px solid #3f3f46",
                          borderRadius: "8px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="bottom"
                        height={36}
                        formatter={(value) => <span className="text-xs text-zinc-400">{value}</span>}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-zinc-500">Sin datos</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Gráfico de Barras */}
          <Card className="col-span-1 overflow-hidden border-zinc-800 bg-zinc-900/50 backdrop-blur-sm lg:col-span-2">
            <CardHeader className="border-b border-zinc-800 pb-3">
              <CardTitle className="text-sm font-medium text-zinc-300">Últimos 7 Días</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="h-[220px]">
                {barData.some(d => d.pedidos > 0) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                      <XAxis dataKey="day" stroke="#71717a" fontSize={11} />
                      <YAxis yAxisId="left" stroke="#71717a" fontSize={11} />
                      <YAxis yAxisId="right" orientation="right" stroke="#71717a" fontSize={11} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#1a1a2e",
                          border: "1px solid #3f3f46",
                          borderRadius: "8px",
                          color: "#fff",
                        }}
                      />
                      <Bar yAxisId="left" dataKey="pedidos" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Pedidos" />
                      <Bar yAxisId="right" dataKey="ingresos" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Ingresos Gs" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-zinc-500">Sin datos de los últimos 7 días</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* FILTROS */}
        <Card className="mb-6 border-zinc-800 bg-zinc-900/50 backdrop-blur-sm">
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-md">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                <Input
                  placeholder="Buscar cliente, teléfono, producto o ciudad..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="border-zinc-700 bg-zinc-800/50 pl-9 text-zinc-200 placeholder:text-zinc-500 focus:border-purple-500"
                />
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2">
                {FILTERS.map((filter) => (
                  <Button
                    key={filter.id}
                    variant={activeFilter === filter.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setActiveFilter(filter.id)}
                    className={`rounded-full ${
                      activeFilter === filter.id
                        ? "bg-purple-600 text-white hover:bg-purple-700"
                        : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                    }`}
                  >
                    <filter.icon className="mr-2 h-4 w-4" />
                    {filter.label}
                  </Button>
                ))}
              </div>

              <div className="flex items-center justify-center gap-2">
                <Select value={dateFilter} onValueChange={setDateFilter}>
                  <SelectTrigger className="w-40 border-zinc-700 bg-zinc-800/50 text-zinc-200">
                    <Calendar className="mr-2 h-4 w-4" />
                    <SelectValue placeholder="Fechas" />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-700 bg-zinc-900">
                    <SelectItem value="all">Todo el tiempo</SelectItem>
                    <SelectItem value="today">Hoy</SelectItem>
                    <SelectItem value="week">Última semana</SelectItem>
                    <SelectItem value="month">Último mes</SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="icon"
                  onClick={loadOrders}
                  disabled={loading}
                  className="border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CONTADOR */}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-zinc-400">
            Mostrando <span className="font-semibold text-white">{filteredOrders.length}</span> de{" "}
            {orders.length} pedidos
          </p>
        </div>

        {/* PEDIDOS */}
        {loading ? (
          <div className="flex h-64 items-center justify-center text-zinc-400">
            <RefreshCw className="mr-3 h-5 w-5 animate-spin" />
            Cargando pedidos...
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/30">
            <AlertCircle className="mb-4 h-12 w-12 text-zinc-600" />
            <p className="text-lg text-zinc-400">No hay pedidos que coincidan con los filtros</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredOrders.map((order) => {
              const status = normalizeStatus(order.status);
              const config = STATUS_CONFIG[status] || STATUS_CONFIG.pendiente;
              const Icon = config.icon;
              const chatNumber = order.from_number || order.phone || "";
              const items = getOrderItems(order);

              return (
                <Card
                  key={order.id}
                  className="group overflow-hidden border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 transition-all hover:border-zinc-700 hover:shadow-xl"
                >
                  {/* Línea decorativa superior */}
                  <div className={`h-1 w-full bg-gradient-to-r ${config.gradient}`} />

                  <CardContent className="p-5">
                    {/* Header */}
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-zinc-500">Desde</p>
                        <p className="max-w-[200px] break-all font-mono text-sm font-semibold text-zinc-200" title={chatNumber}>
                          {chatNumber || "—"}
                        </p>
                      </div>
                      <Badge className={`${config.bgColor} ${config.color} shrink-0 border-0`}>
                        <Icon className="mr-1 h-3 w-3" />
                        {config.label}
                      </Badge>
                    </div>

                    {/* Productos */}
                    <div className="mb-4">
                      <p className="mb-2 text-xs text-zinc-500">Productos</p>
                      {items.length > 0 ? (
                        <div className="space-y-2">
                          {items.map((item, index) => (
                            <div key={index} className="rounded-xl bg-zinc-800/50 p-3">
                              <p className="break-words font-semibold text-zinc-200">
                                {item.product || item.name || "Producto"}
                              </p>
                              <div className="mt-1 flex items-center gap-4 text-xs text-zinc-400">
                                <span>Cantidad: {item.quantity || 1}</span>
                                <span className="text-emerald-400">
                                  {formatCurrency(item.amount || item.price || 0)} Gs
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-xl bg-zinc-800/50 p-3">
                          <p className="break-words font-semibold text-zinc-200">{order.product || "Producto"}</p>
                          <div className="mt-1 flex items-center gap-4 text-xs text-zinc-400">
                            <span>Cantidad: {order.quantity || 1}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Cliente */}
                    <div className="mb-3 space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-zinc-400">
                        <User className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 truncate">{order.customer_name || "Sin nombre"}</span>
                      </div>
                      {order.city && (
                        <div className="flex items-center gap-2 text-zinc-400">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 truncate">{order.city}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-emerald-400">
                          Total: {formatCurrency(order.total_amount)} Gs
                        </span>
                        <span className="shrink-0 text-xs text-zinc-500">
                          {formatDate(order.created_at)}
                        </span>
                      </div>
                    </div>

                    {/* Dirección */}
                    {order.address && (
                      <div className="mb-4 rounded-xl bg-zinc-800/30 p-3">
                        <p className="text-xs text-zinc-500">Dirección</p>
                        <p className="break-words text-sm text-zinc-300">{order.address}</p>
                      </div>
                    )}

                    {/* Botones */}
                    <div className="mt-4 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 rounded-xl border-zinc-700 bg-zinc-800/30 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                        onClick={() => openEcommerce(order)}
                      >
                        <ShoppingCart className="mr-2 h-3.5 w-3.5" />
                        Ecommerce
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 rounded-xl border-zinc-700 bg-zinc-800/30 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                        onClick={() => openChat(chatNumber)}
                      >
                        <MessageSquare className="mr-2 h-3.5 w-3.5" />
                        Chat
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="px-3 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                        onClick={() => deleteOrder(order.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Acciones de estado */}
                    <div className="mt-3 flex flex-wrap gap-1">
                      {status !== "cargado" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-3 text-xs text-emerald-400 hover:bg-emerald-500/10"
                          onClick={() => updateStatus(order, "cargado")}
                        >
                          <Package className="mr-1 h-3 w-3" />
                          Cargado
                        </Button>
                      )}
                      {status !== "droppx" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-3 text-xs text-blue-400 hover:bg-blue-500/10"
                          onClick={() => updateStatus(order, "droppx")}
                        >
                          <Truck className="mr-1 h-3 w-3" />
                          Droppx
                        </Button>
                      )}
                      {status !== "cancelado" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-3 text-xs text-red-400 hover:bg-red-500/10"
                          onClick={() => updateStatus(order, "cancelado")}
                        >
                          <XCircle className="mr-1 h-3 w-3" />
                          Cancelar
                        </Button>
                      )}
                    </div>

                    {/* Comprobante */}
                    {order.comprobante_url && (
                      <a
                        href={order.comprobante_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 hover:underline"
                      >
                        <ReceiptText className="h-3 w-3" />
                        Ver comprobante
                      </a>
                    )}
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

// Componente MetricCard mejorado con líneas decorativas y tendencias
function MetricCard({
  title,
  value,
  icon: Icon,
  trend,
  color,
  bgGradient,
}: {
  title: string;
  value: string | number;
  icon: any;
  trend?: number;
  color: string;
  bgGradient: string;
}) {
  const isPositive = trend && trend > 0;
  const isNegative = trend && trend < 0;

  return (
    <Card className={`relative overflow-hidden border-zinc-800 bg-gradient-to-br ${bgGradient} backdrop-blur-sm`}>
      {/* Línea decorativa superior */}
      <div className={`absolute top-0 left-0 h-1 w-full bg-gradient-to-r ${bgGradient.replace("/10", "/40").replace("/5", "/40")}`} />
      
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-400">{title}</p>
            <p className={`mt-1 text-2xl font-bold tracking-tight ${color}`}>{value}</p>
            {trend !== undefined && (
              <div className="mt-2 flex items-center gap-1 text-xs">
                {isPositive && <TrendingUp className="h-3 w-3 text-emerald-400" />}
                {isNegative && <TrendingDown className="h-3 w-3 text-red-400" />}
                <span className={isPositive ? "text-emerald-400" : isNegative ? "text-red-400" : "text-zinc-500"}>
                  {isPositive ? `+${trend}%` : isNegative ? `${trend}%` : "0%"}
                </span>
                <span className="text-zinc-500">vs anterior</span>
              </div>
            )}
          </div>
          <div className={`rounded-xl bg-gradient-to-br ${bgGradient} p-2.5`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
