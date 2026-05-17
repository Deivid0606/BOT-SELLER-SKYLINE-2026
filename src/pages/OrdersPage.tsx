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
  ArrowUpRight,
  Filter,
  MoreHorizontal,
  Eye,
  Edit,
  AlertCircle,
  CreditCard,
  MapPin,
  User,
  Hash,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";

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
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10 border-emerald-500/20",
    icon: Check,
  },
  confirmed: {
    label: "Confirmado",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10 border-emerald-500/20",
    icon: Check,
  },
  pendiente: {
    label: "Pendiente",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10 border-amber-500/20",
    icon: Clock,
  },
  pending: {
    label: "Pendiente",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10 border-amber-500/20",
    icon: Clock,
  },
  cargado: {
    label: "Cargado",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10 border-emerald-500/20",
    icon: Package,
  },
  cancelado: {
    label: "Cancelado",
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-500/20",
    icon: XCircle,
  },
  droppx: {
    label: "Droppx",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10 border-blue-500/20",
    icon: Truck,
  },
};

const QUICK_FILTERS = [
  { key: "todos", label: "Todos", icon: Package },
  { key: "confirmados", label: "Confirmados", icon: Check },
  { key: "pendientes", label: "Pendientes", icon: Clock },
  { key: "cargados", label: "Cargados", icon: Package },
  { key: "cancelados", label: "Cancelados", icon: XCircle },
  { key: "droppx", label: "Droppx", icon: Truck },
] as const;

function formatNumber(value: string | number | null | undefined) {
  if (!value) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  return num.toLocaleString("es-PY");
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return `Hoy, ${date.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}`;
  } else if (diffDays === 1) {
    return `Ayer, ${date.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}`;
  } else if (diffDays < 7) {
    return `Hace ${diffDays} días`;
  } else {
    return date.toLocaleDateString("es-PY", { day: "numeric", month: "short", year: "numeric" });
  }
}

function normalizeStatus(status: string) {
  if (status === "confirmed") return "confirmado";
  if (status === "pending") return "pendiente";
  return status;
}

// Modern Stat Card Component
function StatCard({ title, value, icon: Icon, trend, color }: { 
  title: string; 
  value: string | number; 
  icon: any; 
  trend?: { value: number; label: string };
  color: string;
}) {
  return (
    <Card className="group relative overflow-hidden border-border/50 bg-gradient-to-br from-background to-background/80 transition-all duration-300 hover:border-primary/20 hover:shadow-lg">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {trend && (
              <div className="flex items-center gap-1 text-xs">
                <span className={trend.value >= 0 ? "text-emerald-500" : "text-red-500"}>
                  {trend.value >= 0 ? "+" : ""}{trend.value}%
                </span>
                <span className="text-muted-foreground">{trend.label}</span>
              </div>
            )}
          </div>
          <div className={`rounded-xl p-2.5 ${color} transition-all duration-300 group-hover:scale-110`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <Progress value={65} className="mt-4 h-1" />
      </CardContent>
    </Card>
  );
}

// Modern Order Card Component
function OrderCard({ order, onStatusChange, onDelete, onChat, onEcommerce }: any) {
  const status = normalizeStatus(order.status);
  const cfg = STATUS_CONFIG[status] || {
    label: status,
    color: "text-gray-400",
    bgColor: "bg-gray-500/10 border-gray-500/20",
    icon: Package,
  };
  const Icon = cfg.icon;
  const phoneNumber = order.phone || order.from_number;
  const totalAmount = parseFloat(order.total_amount || "0");
  const isHighValue = totalAmount > 500000;

  return (
    <Card className="group relative overflow-hidden border-border/50 bg-gradient-to-br from-background to-background/80 transition-all duration-300 hover:border-primary/20 hover:shadow-xl">
      {/* Status bar */}
      <div className={`absolute left-0 top-0 h-1 w-full ${cfg.bgColor.split(' ')[0]}`} />
      
      <CardContent className="p-5">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Phone className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Número de compra</p>
              <p className="font-mono text-sm font-semibold">{phoneNumber || "—"}</p>
            </div>
          </div>
          <Badge className={`${cfg.bgColor} border px-3 py-1 font-medium`}>
            <Icon className="mr-1.5 h-3 w-3" />
            {cfg.label}
          </Badge>
        </div>

        {/* Product info */}
        <div className="mb-4">
          <h3 className="text-lg font-bold leading-tight line-clamp-2">
            {order.product || "Producto sin especificar"}
          </h3>
          <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Hash className="h-3.5 w-3.5" />
            <span>Cantidad: {order.quantity || 1}</span>
            {isHighValue && (
              <Badge variant="secondary" className="text-xs">
                Alto valor
              </Badge>
            )}
          </div>
        </div>

        {/* Details grid */}
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg bg-muted/30 p-3">
          <div className="flex items-center gap-2">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Cliente</p>
              <p className="text-sm font-medium">{order.customer_name || "—"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Ubicación</p>
              <p className="text-sm font-medium">{order.city || "—"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Pago</p>
              <p className="text-sm font-medium">{order.metodo_pago || "—"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-sm font-bold text-emerald-400">
                {formatNumber(order.total_amount)} Gs
              </p>
            </div>
          </div>
        </div>

        {/* Address */}
        {order.address && (
          <div className="mb-4 rounded-lg bg-muted/20 p-2">
            <p className="text-xs text-muted-foreground">Dirección de entrega</p>
            <p className="text-sm">{order.address}</p>
          </div>
        )}

        {/* Timestamp */}
        <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          <span>{formatDate(order.created_at)}</span>
          {order.comprobante_url && (
            <a
              href={order.comprobante_url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto flex items-center gap-1 text-primary hover:underline"
            >
              <ReceiptText className="h-3 w-3" />
              <span>Comprobante</span>
            </a>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 flex-1 border-primary/20 bg-primary/5 hover:bg-primary/10"
                  onClick={() => onEcommerce(order)}
                >
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  Ecommerce
                </Button>
              </TooltipTrigger>
              <TooltipContent>Ver en e-commerce</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 flex-1"
                  onClick={() => onChat(phoneNumber)}
                >
                  <MessageSquare className="mr-2 h-4 w-4" />
                  Chat
                </Button>
              </TooltipTrigger>
              <TooltipContent>Abrir conversación</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-9 px-3">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {status !== "pendiente" && (
                <DropdownMenuItem onClick={() => onStatusChange(order, "pendiente")}>
                  <Clock className="mr-2 h-4 w-4 text-amber-400" />
                  Marcar como pendiente
                </DropdownMenuItem>
              )}
              {status !== "cargado" && (
                <DropdownMenuItem onClick={() => onStatusChange(order, "cargado")}>
                  <Package className="mr-2 h-4 w-4 text-emerald-400" />
                  Marcar como cargado
                </DropdownMenuItem>
              )}
              {status !== "droppx" && (
                <DropdownMenuItem onClick={() => onStatusChange(order, "droppx")}>
                  <Truck className="mr-2 h-4 w-4 text-blue-400" />
                  Enviar a Droppx
                </DropdownMenuItem>
              )}
              {status !== "cancelado" && (
                <DropdownMenuItem onClick={() => onStatusChange(order, "cancelado")}>
                  <XCircle className="mr-2 h-4 w-4 text-red-400" />
                  Cancelar pedido
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => onDelete(order.id)}
                className="text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
  const [activeFilter, setActiveFilter] = useState<"todos" | "confirmados" | "pendientes" | "cargados" | "cancelados" | "droppx">("todos");
  const [dateRange, setDateRange] = useState<"today" | "week" | "month" | "all">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const loadOrders = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    // Date filtering
    if (dateRange !== "all") {
      const now = new Date();
      let fromDate: Date | null = null;
      
      switch (dateRange) {
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
      }
      
      if (fromDate) {
        query = query.gte("created_at", fromDate.toISOString());
      }
    }

    if (startDate && endDate) {
      const fromDate = new Date(startDate);
      const toDate = new Date(endDate);
      toDate.setHours(23, 59, 59, 999);
      query = query.gte("created_at", fromDate.toISOString()).lte("created_at", toDate.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      toast.error("Error cargando pedidos: " + error.message);
    } else {
      setOrders((data || []).filter((o: Order) => !HIDDEN_STATUSES.includes(o.status)));
    }

    setLoading(false);
  }, [dateRange, startDate, endDate]);

  useEffect(() => {
    loadOrders();

    const channel = supabase
      .channel("orders-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => loadOrders())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadOrders]);

  async function updateOrderStatus(order: Order, newStatus: "pendiente" | "cargado" | "cancelado" | "droppx") {
    const statusLabels = {
      pendiente: "PEDIDO PENDIENTE",
      cargado: "PEDIDO CARGADO",
      cancelado: "PEDIDO CANCELADO",
      droppx: "PEDIDO A DROPPX",
    };

    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", order.id);

      if (error) throw error;

      // Update contact tags
      const phone = order.phone || order.from_number;
      if (phone) {
        const { data: tags } = await supabase
          .from("tags")
          .select("id, name")
          .eq("user_id", order.user_id)
          .in("name", Object.values(statusLabels));

        const newTag = tags?.find((t) => t.name === statusLabels[newStatus]);
        
        if (newTag) {
          const oldTags = tags?.filter(t => t.name !== statusLabels[newStatus]) || [];
          await supabase
            .from("contact_tags")
            .delete()
            .eq("contact_id", phone)
            .in("tag_id", oldTags.map(t => t.id));
          
          await supabase.from("contact_tags").insert({
            contact_id: phone,
            tag_id: newTag.id,
            user_id: order.user_id,
          });
        }
      }

      toast.success(`Pedido marcado como ${statusLabels[newStatus]}`);
      loadOrders();
    } catch (err: any) {
      toast.error("Error: " + err.message);
    }
  }

  async function deleteOrder(id: string) {
    if (!confirm("¿Eliminar este pedido permanentemente?")) return;

    const { error } = await supabase.from("orders").delete().eq("id", id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Pedido eliminado");
      loadOrders();
    }
  }

  function openChat(phone: string | null) {
    if (!phone) {
      toast.error("Este pedido no tiene número de teléfono");
      return;
    }
    navigate(`/inbox?phone=${encodeURIComponent(phone)}`);
  }

  function openEcommerce(order: Order) {
    const phoneNumber = order.from_number || order.phone || "";
    const observations = `Producto: ${order.product || "Sin producto"} | Pago: ${order.metodo_pago || "efectivo"}`;

    const params = new URLSearchParams({
      view: "create-order",
      nombre: order.customer_name || "",
      telefono: phoneNumber,
      ciudad: order.city || "",
      calle: order.address || "",
      producto: order.product || "",
      cantidad: String(order.quantity || 1),
      total: order.total_amount || "",
      pago: order.metodo_pago || "",
      observacion: observations,
      origen: "seller-skyline",
    });

    window.open(`${ECOMMERCE_URL}/?${params.toString()}`, "_blank");
  }

  // Calculate statistics
  const stats = {
    total: orders.length,
    confirmados: orders.filter(o => normalizeStatus(o.status) === "confirmado").length,
    pendientes: orders.filter(o => normalizeStatus(o.status) === "pendiente").length,
    cargados: orders.filter(o => normalizeStatus(o.status) === "cargado").length,
    cancelados: orders.filter(o => normalizeStatus(o.status) === "cancelado").length,
    droppx: orders.filter(o => normalizeStatus(o.status) === "droppx").length,
    totalSales: orders.reduce((sum, o) => {
      const total = parseFloat(o.total_amount || "0");
      return sum + (isNaN(total) ? 0 : total);
    }, 0),
    averageOrder: orders.reduce((sum, o) => {
      const total = parseFloat(o.total_amount || "0");
      return sum + (isNaN(total) ? 0 : total);
    }, 0) / (orders.length || 1),
  };

  // Filter orders
  const filteredOrders = orders.filter((order) => {
    const phoneNumber = order.phone || order.from_number || "";
    const searchMatch = !search ||
      order.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      phoneNumber.includes(search) ||
      order.product?.toLowerCase().includes(search.toLowerCase()) ||
      order.city?.toLowerCase().includes(search.toLowerCase());

    const status = normalizeStatus(order.status);
    const filterMatch = activeFilter === "todos" ||
      (activeFilter === "confirmados" && status === "confirmado") ||
      (activeFilter === "pendientes" && status === "pendiente") ||
      (activeFilter === "cargados" && status === "cargado") ||
      (activeFilter === "cancelados" && status === "cancelado") ||
      (activeFilter === "droppx" && status === "droppx");

    return searchMatch && filterMatch;
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-background/95">
      <div className="container mx-auto px-4 py-6 md:px-6 lg:px-8">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                Panel de Pedidos
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Gestiona y monitorea todos los pedidos en tiempo real
              </p>
            </div>
            <Button
              onClick={loadOrders}
              disabled={loading}
              variant="outline"
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
          </div>

          {/* Stats Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard
              title="Total Pedidos"
              value={stats.total}
              icon={Package}
              trend={{ value: 12, label: "vs mes anterior" }}
              color="bg-blue-500/10 text-blue-500"
            />
            <StatCard
              title="Confirmados"
              value={stats.confirmados}
              icon={Check}
              color="bg-emerald-500/10 text-emerald-500"
            />
            <StatCard
              title="Pendientes"
              value={stats.pendientes}
              icon={Clock}
              color="bg-amber-500/10 text-amber-500"
            />
            <StatCard
              title="Cargados"
              value={stats.cargados}
              icon={Package}
              color="bg-emerald-500/10 text-emerald-500"
            />
            <StatCard
              title="Droppx"
              value={stats.droppx}
              icon={Truck}
              color="bg-blue-500/10 text-blue-500"
            />
            <StatCard
              title="Volumen Ventas"
              value={`${formatNumber(stats.totalSales)} Gs`}
              icon={DollarSign}
              trend={{ value: 8, label: "vs mes anterior" }}
              color="bg-purple-500/10 text-purple-500"
            />
          </div>

          {/* Search and Filters */}
          <Card className="border-border/50">
            <CardContent className="p-4">
              <div className="flex flex-col gap-4">
                {/* Search Bar */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por cliente, teléfono, producto o ciudad..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>

                {/* Quick Filters */}
                <Tabs defaultValue="todos" className="w-full">
                  <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6">
                    {QUICK_FILTERS.map((filter) => (
                      <TabsTrigger
                        key={filter.key}
                        value={filter.key}
                        onClick={() => setActiveFilter(filter.key)}
                        className="gap-2"
                      >
                        <filter.icon className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{filter.label}</span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>

                {/* Date Filters */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <Select value={dateRange} onValueChange={(v: any) => setDateRange(v)}>
                      <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder="Rango de fechas" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas las fechas</SelectItem>
                        <SelectItem value="today">Hoy</SelectItem>
                        <SelectItem value="week">Últimos 7 días</SelectItem>
                        <SelectItem value="month">Último mes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

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
                    {(startDate || endDate) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setStartDate("");
                          setEndDate("");
                          setDateRange("all");
                        }}
                        className="h-9 px-3"
                      >
                        Limpiar
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Results Summary */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Mostrando <span className="font-semibold text-foreground">{filteredOrders.length}</span> de{" "}
              <span className="font-semibold text-foreground">{orders.length}</span> pedidos
            </p>
            <Badge variant="outline" className="gap-1">
              <TrendingUp className="h-3 w-3" />
              Promedio: {formatNumber(stats.averageOrder)} Gs
            </Badge>
          </div>

          {/* Orders Grid */}
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="p-5">
                    <div className="space-y-3">
                      <div className="h-20 rounded-lg bg-muted" />
                      <div className="h-4 w-3/4 rounded bg-muted" />
                      <div className="h-4 w-1/2 rounded bg-muted" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : filteredOrders.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Package className="mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="text-lg font-semibold">No hay pedidos</h3>
                <p className="text-sm text-muted-foreground">
                  No se encontraron pedidos con los filtros seleccionados
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onStatusChange={updateOrderStatus}
                  onDelete={deleteOrder}
                  onChat={openChat}
                  onEcommerce={openEcommerce}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
