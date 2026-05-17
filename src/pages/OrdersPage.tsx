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
  Filter,
  ChevronRight,
  User,
  MapPin,
  CreditCard,
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

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: any }> = {
  confirmado: {
    label: "Confirmado",
    color: "#10b981",
    bgColor: "#10b98110",
    icon: Check,
  },
  confirmed: {
    label: "Confirmado",
    color: "#10b981",
    bgColor: "#10b98110",
    icon: Check,
  },
  pendiente: {
    label: "Pendiente",
    color: "#f59e0b",
    bgColor: "#f59e0b10",
    icon: Clock,
  },
  pending: {
    label: "Pendiente",
    color: "#f59e0b",
    bgColor: "#f59e0b10",
    icon: Clock,
  },
  cargado: {
    label: "Cargado",
    color: "#10b981",
    bgColor: "#10b98110",
    icon: Package,
  },
  cancelado: {
    label: "Cancelado",
    color: "#ef4444",
    bgColor: "#ef444410",
    icon: XCircle,
  },
  droppx: {
    label: "Droppx",
    color: "#3b82f6",
    bgColor: "#3b82f610",
    icon: Truck,
  },
};

const FILTERS = [
  { id: "all", label: "Todos", icon: Package },
  { id: "confirmados", label: "Confirmados", icon: Check, color: "#10b981" },
  { id: "pendientes", label: "Pendientes", icon: Clock, color: "#f59e0b" },
  { id: "cargados", label: "Cargados", icon: Package, color: "#10b981" },
  { id: "cancelados", label: "Cancelados", icon: XCircle, color: "#ef4444" },
  { id: "droppx", label: "Droppx", icon: Truck, color: "#3b82f6" },
];

function formatCurrency(value: string | number | null | undefined) {
  if (!value) return "0";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  return num.toLocaleString("es-PY");
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
    minute: "2-digit"
  });
}

function normalizeStatus(status: string) {
  if (status === "confirmed") return "confirmado";
  if (status === "pending") return "pendiente";
  return status;
}

export default function OrdersPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");

  const loadOrders = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (dateFilter === "today") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      query = query.gte("created_at", today.toISOString());
    } else if (dateFilter === "week") {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      query = query.gte("created_at", weekAgo.toISOString());
    } else if (dateFilter === "month") {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      query = query.gte("created_at", monthAgo.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      toast.error("Error cargando pedidos");
    } else {
      setOrders((data || []).filter((o: Order) => !HIDDEN_STATUSES.includes(o.status)));
    }

    setLoading(false);
  }, [dateFilter]);

  useEffect(() => {
    loadOrders();

    const channel = supabase
      .channel("orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => loadOrders())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadOrders]);

  async function updateStatus(order: Order, newStatus: string) {
    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: newStatus })
        .eq("id", order.id);

      if (error) throw error;
      
      toast.success(`Pedido actualizado a ${STATUS_CONFIG[newStatus]?.label || newStatus}`);
      loadOrders();
    } catch (err) {
      toast.error("Error al actualizar el pedido");
    }
  }

  async function deleteOrder(id: string) {
    if (!confirm("¿Eliminar este pedido?")) return;

    const { error } = await supabase.from("orders").delete().eq("id", id);
    
    if (error) {
      toast.error("Error al eliminar");
    } else {
      toast.success("Pedido eliminado");
      loadOrders();
    }
  }

  function openChat(phone: string | null) {
    if (!phone) {
      toast.error("No hay número de teléfono");
      return;
    }
    navigate(`/inbox?phone=${encodeURIComponent(phone)}`);
  }

  function openEcommerce(order: Order) {
    const params = new URLSearchParams({
      view: "create-order",
      nombre: order.customer_name || "",
      telefono: order.phone || order.from_number || "",
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
    confirmados: orders.filter(o => normalizeStatus(o.status) === "confirmado").length,
    pendientes: orders.filter(o => normalizeStatus(o.status) === "pendiente").length,
    cargados: orders.filter(o => normalizeStatus(o.status) === "cargado").length,
    cancelados: orders.filter(o => normalizeStatus(o.status) === "cancelado").length,
    droppx: orders.filter(o => normalizeStatus(o.status) === "droppx").length,
    ingresos: orders.reduce((sum, o) => {
      const total = parseFloat(o.total_amount || "0");
      return sum + (isNaN(total) ? 0 : total);
    }, 0),
  };

  // Filtrar pedidos
  const filteredOrders = orders.filter(order => {
    // Búsqueda
    const searchTerm = search.toLowerCase();
    const matchesSearch = !search || 
      order.customer_name?.toLowerCase().includes(searchTerm) ||
      order.phone?.toLowerCase().includes(searchTerm) ||
      order.from_number?.toLowerCase().includes(searchTerm) ||
      order.product?.toLowerCase().includes(searchTerm) ||
      order.city?.toLowerCase().includes(searchTerm);

    // Filtro de estado
    const status = normalizeStatus(order.status);
    const matchesFilter = activeFilter === "all" || 
      (activeFilter === "confirmados" && status === "confirmado") ||
      (activeFilter === "pendientes" && status === "pendiente") ||
      (activeFilter === "cargados" && status === "cargado") ||
      (activeFilter === "cancelados" && status === "cancelado") ||
      (activeFilter === "droppx" && status === "droppx");

    return matchesSearch && matchesFilter;
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
            Panel de Pedidos
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Gestión centralizada de tus ventas y envíos
          </p>
        </div>

        {/* Stats Grid */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Card className="border-0 bg-white shadow-sm dark:bg-slate-900">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Total</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</p>
                </div>
                <Package className="h-8 w-8 text-slate-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-white shadow-sm dark:bg-slate-900">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Confirmados</p>
                  <p className="text-2xl font-bold text-emerald-600">{stats.confirmados}</p>
                </div>
                <Check className="h-8 w-8 text-emerald-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-white shadow-sm dark:bg-slate-900">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Pendientes</p>
                  <p className="text-2xl font-bold text-amber-600">{stats.pendientes}</p>
                </div>
                <Clock className="h-8 w-8 text-amber-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-white shadow-sm dark:bg-slate-900">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Cargados</p>
                  <p className="text-2xl font-bold text-emerald-600">{stats.cargados}</p>
                </div>
                <Package className="h-8 w-8 text-emerald-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-white shadow-sm dark:bg-slate-900">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Droppx</p>
                  <p className="text-2xl font-bold text-blue-600">{stats.droppx}</p>
                </div>
                <Truck className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-white shadow-sm dark:bg-slate-900">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Ingresos</p>
                  <p className="text-lg font-bold text-purple-600">{formatCurrency(stats.ingresos)} Gs</p>
                </div>
                <DollarSign className="h-8 w-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters Bar */}
        <div className="mb-6 space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Buscar pedido..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 border-slate-200 dark:border-slate-800"
              />
            </div>

            <div className="flex items-center gap-3">
              {/* Date Filter */}
              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger className="w-36 border-slate-200 dark:border-slate-800">
                  <Calendar className="mr-2 h-4 w-4" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todo el tiempo</SelectItem>
                  <SelectItem value="today">Hoy</SelectItem>
                  <SelectItem value="week">Última semana</SelectItem>
                  <SelectItem value="month">Último mes</SelectItem>
                </SelectContent>
              </Select>

              {/* Refresh Button */}
              <Button
                variant="outline"
                size="icon"
                onClick={loadOrders}
                disabled={loading}
                className="border-slate-200 dark:border-slate-800"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {/* Status Filters */}
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((filter) => {
              const isActive = activeFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  onClick={() => setActiveFilter(filter.id)}
                  className={`
                    inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all
                    ${isActive 
                      ? "bg-slate-900 text-white shadow-md dark:bg-white dark:text-slate-900" 
                      : "bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                    }
                  `}
                >
                  <filter.icon className="h-4 w-4" />
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Results Count */}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Mostrando <span className="font-semibold text-slate-900 dark:text-white">{filteredOrders.length}</span> de {orders.length} pedidos
          </p>
        </div>

        {/* Orders Grid */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse border-0 shadow-sm">
                <CardContent className="p-6">
                  <div className="space-y-3">
                    <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
                    <div className="h-4 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
                    <div className="h-20 rounded bg-slate-200 dark:bg-slate-800" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredOrders.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-12 text-center">
              <Package className="mx-auto h-12 w-12 text-slate-400" />
              <h3 className="mt-2 text-sm font-medium text-slate-900 dark:text-white">No hay pedidos</h3>
              <p className="mt-1 text-sm text-slate-500">No se encontraron pedidos con los filtros actuales</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredOrders.map((order) => {
              const status = normalizeStatus(order.status);
              const config = STATUS_CONFIG[status] || STATUS_CONFIG.pendiente;
              const Icon = config.icon;
              const phoneNumber = order.phone || order.from_number;

              return (
                <Card key={order.id} className="group border-0 bg-white shadow-sm transition-all hover:shadow-md dark:bg-slate-900">
                  {/* Status Bar */}
                  <div 
                    className="h-1 rounded-t-lg" 
                    style={{ backgroundColor: config.color }}
                  />
                  
                  <CardContent className="p-5">
                    {/* Header */}
                    <div className="mb-4 flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div 
                          className="rounded-lg p-2"
                          style={{ backgroundColor: config.bgColor }}
                        >
                          <Icon className="h-4 w-4" style={{ color: config.color }} />
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Pedido</p>
                          <p className="text-sm font-mono font-medium text-slate-900 dark:text-white">
                            #{phoneNumber?.slice(-6) || "N/A"}
                          </p>
                        </div>
                      </div>
                      <Badge style={{ backgroundColor: config.bgColor, color: config.color, border: "none" }}>
                        {config.label}
                      </Badge>
                    </div>

                    {/* Product */}
                    <div className="mb-3">
                      <h3 className="font-semibold text-slate-900 dark:text-white line-clamp-2">
                        {order.product || "Producto sin especificar"}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Cantidad: {order.quantity || 1} unidades
                      </p>
                    </div>

                    {/* Customer Info */}
                    <div className="mb-3 space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                        <User className="h-3.5 w-3.5" />
                        <span>{order.customer_name || "Sin nombre"}</span>
                      </div>
                      {order.city && (
                        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                          <MapPin className="h-3.5 w-3.5" />
                          <span>{order.city}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                          <DollarSign className="h-3.5 w-3.5" />
                          <span className="font-semibold text-emerald-600 dark:text-emerald-500">
                            {formatCurrency(order.total_amount)} Gs
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-slate-500">
                          <Calendar className="h-3 w-3" />
                          <span>{formatDate(order.created_at)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="mt-4 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-slate-200 dark:border-slate-800"
                        onClick={() => openEcommerce(order)}
                      >
                        <ShoppingCart className="mr-2 h-3.5 w-3.5" />
                        Ecommerce
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-slate-200 dark:border-slate-800"
                        onClick={() => openChat(phoneNumber)}
                      >
                        <MessageSquare className="mr-2 h-3.5 w-3.5" />
                        Chat
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="px-3 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                        onClick={() => deleteOrder(order.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Status Actions */}
                    <div className="mt-3 flex flex-wrap gap-1">
                      {status !== "pendiente" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-amber-600"
                          onClick={() => updateStatus(order, "pendiente")}
                        >
                          <Clock className="mr-1 h-3 w-3" />
                          Pendiente
                        </Button>
                      )}
                      {status !== "cargado" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-emerald-600"
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
                          className="h-7 px-2 text-xs text-blue-600"
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
                          className="h-7 px-2 text-xs text-red-600"
                          onClick={() => updateStatus(order, "cancelado")}
                        >
                          <XCircle className="mr-1 h-3 w-3" />
                          Cancelar
                        </Button>
                      )}
                    </div>

                    {/* Comprobante Link */}
                    {order.comprobante_url && (
                      <a
                        href={order.comprobante_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
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
