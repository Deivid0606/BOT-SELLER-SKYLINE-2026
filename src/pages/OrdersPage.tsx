// ORDERS PAGE - DASHBOARD OSCURO CORPORATIVO
// CON FECHA DE PEDIDO VISIBLE EN CADA TARJETA

import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

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
  PieChart as PieChartIcon,
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
  observation?: string | null;
  observacion?: string | null;
  preferred_delivery_date?: string | null;
  preferred_delivery_time?: string | null;
  payment_note?: string | null;
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
    borderColor: string;
    glowColor: string;
  }
> = {
  confirmado: {
    label: "Confirmado",
    color: "#10b981",
    bgColor: "bg-emerald-500/10",
    icon: Check,
    borderColor: "border-emerald-500/30",
    glowColor: "shadow-emerald-500/20",
  },
  confirmed: {
    label: "Confirmado",
    color: "#10b981",
    bgColor: "bg-emerald-500/10",
    icon: Check,
    borderColor: "border-emerald-500/30",
    glowColor: "shadow-emerald-500/20",
  },
  pendiente: {
    label: "Pendiente",
    color: "#f59e0b",
    bgColor: "bg-amber-500/10",
    icon: Clock,
    borderColor: "border-amber-500/30",
    glowColor: "shadow-amber-500/20",
  },
  pending: {
    label: "Pendiente",
    color: "#f59e0b",
    bgColor: "bg-amber-500/10",
    icon: Clock,
    borderColor: "border-amber-500/30",
    glowColor: "shadow-amber-500/20",
  },
  cargado: {
    label: "Cargado",
    color: "#3b82f6",
    bgColor: "bg-violet-500/10",
    icon: Package,
    borderColor: "border-blue-500/30",
    glowColor: "shadow-blue-500/20",
  },
  cancelado: {
    label: "Cancelado",
    color: "#ef4444",
    bgColor: "bg-red-500/10",
    icon: XCircle,
    borderColor: "border-red-500/30",
    glowColor: "shadow-red-500/20",
  },
  droppx: {
    label: "Droppx",
    color: "#8b5cf6",
    bgColor: "bg-purple-500/10",
    icon: Truck,
    borderColor: "border-purple-500/30",
    glowColor: "shadow-purple-500/20",
  },
};

const FILTERS = [
  { id: "all", label: "Todos", icon: Package, count: "total" },
  { id: "confirmados", label: "Confirmados", icon: Check, count: "confirmados" },
  { id: "cargados", label: "Cargados", icon: Package, count: "cargados" },
  { id: "droppx", label: "Droppx", icon: Truck, count: "droppx" },
  { id: "cancelados", label: "Cancelados", icon: XCircle, count: "cancelados" },
];

const CHART_COLORS = ["#10b981", "#3b82f6", "#8b5cf6", "#ef4444", "#f59e0b", "#ec4899"];

// Ciudades para el top
const TOP_CITIES = ["Asunción", "Ciudad del Este", "Pedro Juan Caballero", "Luque", "San Lorenzo"];

function parseCurrencyValue(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  let raw = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/gs\.?/gi, "")
    .replace(/[^0-9,.-]/g, "");

  if (!raw) return 0;

  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");

  if (lastDot >= 0 && lastComma >= 0) {
    // El último separador es decimal; el otro es de miles.
    if (lastComma > lastDot) {
      raw = raw.replace(/\./g, "").replace(",", ".");
    } else {
      raw = raw.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    const decimals = raw.length - lastComma - 1;
    raw = decimals > 0 && decimals <= 2 ? raw.replace(",", ".") : raw.replace(/,/g, "");
  } else if (lastDot >= 0) {
    const dotCount = (raw.match(/\./g) || []).length;
    const decimals = raw.length - lastDot - 1;
    // 129000.00 es decimal; 129.000 es separador de miles.
    if (dotCount > 1 || decimals === 3) raw = raw.replace(/\./g, "");
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: string | number | null | undefined) {
  return Math.round(parseCurrencyValue(value)).toLocaleString("es-PY", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateBoundary(dateValue: string, endOfDay = false) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return date.toISOString();
}

// Función mejorada para formatear fecha con hora
function formatDateTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Si es hoy, mostrar "Hoy a las HH:MM"
  if (diffDays === 0) {
    return `Hoy a las ${date.toLocaleTimeString("es-PY", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  // Si es ayer
  if (diffDays === 1) {
    return `Ayer a las ${date.toLocaleTimeString("es-PY", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  // Si es dentro de los últimos 7 días
  if (diffDays < 7) {
    return `Hace ${diffDays} días a las ${date.toLocaleTimeString("es-PY", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  // Si es más de 7 días, mostrar fecha completa
  return date.toLocaleDateString("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Función corta para mostrar en la tarjeta
function formatDateShort(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return `Hoy ${date.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (diffDays === 1) {
    return `Ayer ${date.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (diffDays < 7) {
    return `Hace ${diffDays} días`;
  }
  return date.toLocaleDateString("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
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

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function isGenericProductLabel(value: string | null | undefined): boolean {
  const n = cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return /^(oferta hoy|oferta|promo|promocion|producto|productos|articulo|item|sin producto)$/.test(n);
}

function getResolvedOrderItems(order: Order): OrderItem[] {
  const items = getOrderItems(order)
    .map((item) => ({
      ...item,
      product: cleanText(item.product || item.name),
      quantity: Number(item.quantity || 1),
      amount: Number(item.amount || item.price || 0),
    }))
    .filter((item) => item.product && !isGenericProductLabel(item.product));

  if (items.length > 0) return items;

  const product = cleanText(order.product);
  if (product && !isGenericProductLabel(product)) {
    return [{
      product,
      quantity: Number(order.quantity || 1),
      amount: Number(order.total_amount || 0),
    }];
  }

  return [];
}

function getPrimaryProductName(order: Order): string {
  const items = getResolvedOrderItems(order);
  if (items.length === 1) return cleanText(items[0].product || items[0].name);
  if (items.length > 1) return items.map((item) => cleanText(item.product || item.name)).filter(Boolean).join(" + ");
  return "Producto sin identificar";
}

function getOrderObservation(order: Order): string {
  const values = [
    order.observation,
    order.observacion,
    order.payment_note,
    order.preferred_delivery_date,
    order.preferred_delivery_time,
  ]
    .map(cleanText)
    .filter(Boolean);

  const unique: string[] = [];
  for (const value of values) {
    for (const part of value.split(/\s*\|\s*/g).map(cleanText).filter(Boolean)) {
      const normalized = part.toLowerCase();
      if (!unique.some((item) => item.toLowerCase() === normalized)) unique.push(part);
    }
  }
  return unique.join(" | ");
}

// Función para limpiar y formatear número de teléfono
function formatPhoneNumber(phone: string | null): string {
  if (!phone) return "";
  // Eliminar espacios, guiones, puntos y paréntesis
  let clean = phone.replace(/[\s\-\.\(\)]/g, "");
  // Si empieza con 0, lo quitamos
  if (clean.startsWith("0")) {
    clean = clean.substring(1);
  }
  // Si empieza con 595, lo mantenemos, si no, lo agregamos
  if (!clean.startsWith("595")) {
    clean = "595" + clean;
  }
  return clean;
}

async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

function orderMatchesDateFilter(
  order: Order,
  dateFilter: string,
  dateFrom: string,
  dateTo: string
): boolean {
  if (dateFilter === "all") return true;

  const createdAt = new Date(order.created_at).getTime();
  if (!Number.isFinite(createdAt)) return false;

  if (dateFilter === "today") {
    const today = localDateInputValue();
    return createdAt >= new Date(localDateBoundary(today)).getTime() &&
      createdAt <= new Date(localDateBoundary(today, true)).getTime();
  }

  if (dateFilter === "yesterday") {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const value = localDateInputValue(yesterday);
    return createdAt >= new Date(localDateBoundary(value)).getTime() &&
      createdAt <= new Date(localDateBoundary(value, true)).getTime();
  }

  if (dateFilter === "week") {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 6);
    return createdAt >= new Date(localDateBoundary(localDateInputValue(weekAgo))).getTime();
  }

  if (dateFilter === "month") {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    return createdAt >= new Date(localDateBoundary(localDateInputValue(monthAgo))).getTime();
  }

  if (dateFilter === "custom" && dateFrom && dateTo) {
    return createdAt >= new Date(localDateBoundary(dateFrom)).getTime() &&
      createdAt <= new Date(localDateBoundary(dateTo, true)).getTime();
  }

  return true;
}

export default function OrdersPage() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // FILTRO POR DEFECTO EN CONFIRMADOS
  const [activeFilter, setActiveFilter] = useState("confirmados");
  const [dateFilter, setDateFilter] = useState("today");
  const [dateFrom, setDateFrom] = useState(() => localDateInputValue());
  const [dateTo, setDateTo] = useState(() => localDateInputValue());
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string>("all");

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

    if (userId) {
      query = query.eq("user_id", userId);
    }


    const { data, error } = await query;

    if (error) {
      toast.error("Error cargando pedidos");
      console.error("Error loading orders:", error);
    } else {
      const filtered = (data || []).filter(
        (o: Order) => !HIDDEN_STATUSES.includes(o.status)
      );
      
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
  }, [userId]);

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

  // Función mejorada para abrir el chat con el número correcto
  function openChat(phone: string | null) {
    if (!phone) {
      toast.error("No hay número de teléfono");
      return;
    }

    // Limpiar y formatear el número
    const formattedPhone = formatPhoneNumber(phone);
    
    if (!formattedPhone || formattedPhone.length < 10) {
      toast.error("Número de teléfono inválido");
      return;
    }

    // Navegar al chat con el número formateado
    navigate(`/inbox?phone=${encodeURIComponent(formattedPhone)}`);
  }

  function openEcommerce(order: Order) {
    const realChatNumber = order.from_number || order.phone || "";
    const params = new URLSearchParams({
      view: "create-order",
      nombre: order.customer_name || "",
      telefono: realChatNumber,
      ciudad: order.city || "",
      calle: order.address || "",
      producto: getPrimaryProductName(order),
      cantidad: String(getResolvedOrderItems(order).reduce((sum, item) => sum + Number(item.quantity || 1), 0) || order.quantity || 1),
      total: order.total_amount || "",
      pago: order.metodo_pago || "",
      observacion: getOrderObservation(order),
      origen: "seller-skyline",
    });
    window.open(`${ECOMMERCE_URL}/?${params.toString()}`, "_blank");
  }

  // El dashboard respeta la fecha seleccionada.
  // La pestaña Confirmados usa siempre el histórico completo.
  const periodOrders = orders.filter((order) =>
    orderMatchesDateFilter(order, dateFilter, dateFrom, dateTo)
  );
  const allConfirmedOrders = orders.filter(
    (order) => normalizeStatus(order.status) === "confirmado"
  );

  // Estadísticas del período seleccionado
  const stats = {
    total: periodOrders.length,
    confirmados: periodOrders.filter((o) => normalizeStatus(o.status) === "confirmado").length,
    cargados: periodOrders.filter((o) => normalizeStatus(o.status) === "cargado").length,
    cancelados: periodOrders.filter((o) => normalizeStatus(o.status) === "cancelado").length,
    droppx: periodOrders.filter((o) => normalizeStatus(o.status) === "droppx").length,
    ingresos: periodOrders.reduce((sum, o) => {
      const total = parseCurrencyValue(o.total_amount);
      return sum + total;
    }, 0),
    ingresosCargados: periodOrders
      .filter((o) => normalizeStatus(o.status) === "cargado")
      .reduce((sum, o) => {
        const total = parseCurrencyValue(o.total_amount);
        return sum + total;
      }, 0),
  };

  const filterCounts = {
    total: periodOrders.length,
    confirmados: allConfirmedOrders.length,
    cargados: stats.cargados,
    cancelados: stats.cancelados,
    droppx: stats.droppx,
  };

  // Calcular comisión (ejemplo: 20% de los ingresos cargados)
  const comision = stats.ingresosCargados * 0.2;
  const ticketPromedio = stats.cargados > 0 ? stats.ingresosCargados / stats.cargados : 0;

  // Datos para el gráfico de torta
  const pieData = [
    { name: "Confirmados", value: stats.confirmados, color: CHART_COLORS[0] },
    { name: "Cargados", value: stats.cargados, color: CHART_COLORS[1] },
    { name: "Droppx", value: stats.droppx, color: CHART_COLORS[2] },
    { name: "Cancelados", value: stats.cancelados, color: CHART_COLORS[3] },
  ].filter(item => item.value > 0);

  // Datos de ciudades
  const cityData = TOP_CITIES.map(city => ({
    name: city,
    value: periodOrders.filter(o => o.city?.toLowerCase().includes(city.toLowerCase())).length,
  }));

  // Top productos
  const productCount: Record<string, number> = {};
  periodOrders.forEach(order => {
    const productName = getPrimaryProductName(order);
    productCount[productName] = (productCount[productName] || 0) + 1;
  });
  const topProducts = Object.entries(productCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Tasa de cobertura
  const tasaCobertura = stats.total > 0 ? Math.round((stats.cargados / stats.total) * 100) : 0;

  const listBaseOrders = activeFilter === "confirmados" ? allConfirmedOrders : periodOrders;

  const filteredOrders = listBaseOrders.filter((order) => {
    const searchTerm = search.toLowerCase();
    const status = normalizeStatus(order.status);

    const matchesSearch =
      !search ||
      order.customer_name?.toLowerCase().includes(searchTerm) ||
      order.phone?.toLowerCase().includes(searchTerm) ||
      order.from_number?.toLowerCase().includes(searchTerm) ||
      getPrimaryProductName(order).toLowerCase().includes(searchTerm) ||
      getOrderObservation(order).toLowerCase().includes(searchTerm) ||
      order.city?.toLowerCase().includes(searchTerm);

    const matchesFilter =
      activeFilter === "all" ||
      (activeFilter === "confirmados" && status === "confirmado") ||
      (activeFilter === "cargados" && status === "cargado") ||
      (activeFilter === "cancelados" && status === "cancelado") ||
      (activeFilter === "droppx" && status === "droppx");

    const matchesCity =
      selectedCity === "all" ||
      order.city?.toLowerCase().includes(selectedCity.toLowerCase());

    return matchesSearch && matchesFilter && matchesCity;
  });

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#241038_0%,_#0d0714_34%,_#07060b_72%)] text-zinc-100">
      <div className="mx-auto flex max-w-[1600px] flex-col px-4 py-6 sm:px-6 lg:px-8">
        
        {/* HEADER */}
        <div className="mb-6 rounded-2xl border border-violet-500/20 bg-[#120a1d]/85 p-5 shadow-[0_20px_70px_rgba(88,28,135,0.18)] backdrop-blur-xl">
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Panel de Pedidos</h1>
              <p className="text-sm text-zinc-400">Gestión operativa de pedidos, pagos y despacho · métricas según el período seleccionado</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="border-violet-400/20 bg-violet-500/10 text-violet-100">
                <Clock className="mr-1 h-3 w-3" />
                Actualizado: {new Date().toLocaleTimeString()}
              </Badge>
            </div>
          </div>
        </div>

        {/* MÉTRICAS PRINCIPALES - SIN DECIMALES */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard
            title="VENTAS"
            value={`${formatCurrency(stats.ingresosCargados)} Gs`}
            subtitle={dateFilter === "today" ? "Ventas cargadas de hoy" : "Ventas cargadas del período"}
            color="#c084fc"
            bgColor="bg-violet-500/10"
            borderColor="border-violet-400/25"
          />
          <MetricCard
            title="PEDIDOS"
            value={stats.total}
            subtitle={`${stats.cargados} cargados en el período`}
            color="#a855f7"
            bgColor="bg-purple-500/10"
            borderColor="border-purple-400/25"
          />
          <MetricCard
            title="CONFIRMADOS"
            value={stats.confirmados}
            subtitle={`${stats.total > 0 ? Math.round((stats.confirmados / stats.total) * 100) : 0}% del total`}
            color="#34d399"
            bgColor="bg-emerald-500/10"
            borderColor="border-emerald-400/20"
          />
          <MetricCard
            title="COMISIÓN"
            value={`${formatCurrency(comision)} Gs`}
            subtitle={`Ticket promedio ${formatCurrency(ticketPromedio)} Gs`}
            color="#f0abfc"
            bgColor="bg-fuchsia-500/10"
            borderColor="border-fuchsia-400/25"
          />
          <MetricCard
            title="CANCELADOS"
            value={stats.cancelados}
            subtitle={`Tasa ${stats.total > 0 ? Math.round((stats.cancelados / stats.total) * 100) : 0}%`}
            color="#ef4444"
            bgColor="bg-red-500/10"
            borderColor="border-red-500/20"
          />
        </div>

        {/* GRÁFICOS Y DISTRIBUCIÓN */}
        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          {/* Gráfico de torta */}
          <Card className="border-violet-500/15 bg-[#120d19]/88 backdrop-blur-xl shadow-[0_18px_45px_rgba(0,0,0,0.28)]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                <PieChartIcon className="h-4 w-4 text-zinc-500" />
                Distribución de estados
              </CardTitle>
              <p className="text-xs text-zinc-500">Vista general del flujo.</p>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
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
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-zinc-500">Sin datos</div>
                )}
              </div>
              <div className="mt-2 flex flex-wrap justify-center gap-4">
                {pieData.map((item) => (
                  <div key={item.name} className="flex items-center gap-1.5">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-xs text-zinc-400">{item.name}</span>
                    <span className="text-xs font-semibold text-white">{item.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top Ciudades */}
          <Card className="border-violet-500/15 bg-[#120d19]/88 backdrop-blur-xl shadow-[0_18px_45px_rgba(0,0,0,0.28)]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                <MapPin className="h-4 w-4 text-zinc-500" />
                Top ciudades
              </CardTitle>
              <p className="text-xs text-zinc-500">Mayor volumen de pedidos.</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {cityData.map((city, index) => (
                  <div key={city.name} className="flex items-center gap-3">
                    <span className="w-32 text-sm text-zinc-400">{city.name}</span>
                    <div className="flex-1">
                      <div 
                        className="h-2 rounded-full bg-violet-500/10"
                        style={{ 
                          width: `${Math.max((city.value / Math.max(...cityData.map(c => c.value), 1)) * 100, 5)}%` 
                        }}
                      >
                        <div 
                          className="h-2 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400 transition-all"
                          style={{ 
                            width: `${(city.value / Math.max(...cityData.map(c => c.value), 1)) * 100}%` 
                          }}
                        />
                      </div>
                    </div>
                    <span className="w-8 text-right text-sm font-semibold text-white">{city.value}</span>
                  </div>
                ))}
              </div>
              <Separator className="my-3 bg-zinc-800" />
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-400">Tasa de cobertura</span>
                <span className="text-sm font-bold text-white">{tasaCobertura}%</span>
              </div>
            </CardContent>
          </Card>

          {/* Top Productos */}
          <Card className="border-violet-500/15 bg-[#120d19]/88 backdrop-blur-xl shadow-[0_18px_45px_rgba(0,0,0,0.28)]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                <Package className="h-4 w-4 text-zinc-500" />
                Top productos
              </CardTitle>
              <p className="text-xs text-zinc-500">Más repetidos en el sheet.</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {topProducts.length > 0 ? (
                  topProducts.map(([product, count], index) => (
                    <div key={product} className="flex items-center gap-3">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-xs font-medium text-zinc-400">
                        {index + 1}
                      </span>
                      <span className="flex-1 truncate text-sm text-zinc-300">{product}</span>
                      <span className="text-sm font-semibold text-white">{count}</span>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center text-zinc-500">Sin productos registrados</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* FILTROS RÁPIDOS */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-zinc-300">Todos ({filterCounts.total})</span>
          <span className="text-sm text-zinc-600">•</span>
          {FILTERS.map((filter) => {
            const count = filterCounts[filter.count as keyof typeof filterCounts] || 0;
            return (
              <Button
                key={filter.id}
                variant={activeFilter === filter.id ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveFilter(filter.id)}
                className={`text-sm ${
                  activeFilter === filter.id
                    ? "bg-violet-600 text-white shadow-lg shadow-violet-950/40 hover:bg-violet-500"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
                }`}
              >
                {filter.label} ({count})
              </Button>
            );
          })}
        </div>

        <p className="mb-4 text-xs text-zinc-500">
          Confirmados muestra todo el historial. Los demás filtros y el dashboard respetan el período seleccionado.
        </p>

        {/* FILTROS AVANZADOS */}
        <Card className="mb-4 border-violet-500/15 bg-[#120d19]/88 backdrop-blur-xl shadow-[0_18px_45px_rgba(0,0,0,0.28)]">
          <CardContent className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-1 flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                  <Input
                    placeholder="Buscar producto..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="border-violet-400/20 bg-violet-950/25 pl-9 text-sm text-white placeholder:text-zinc-500 focus:border-violet-400 focus:ring-violet-500/30"
                  />
                </div>
                <Select value={selectedCity} onValueChange={setSelectedCity}>
                  <SelectTrigger className="w-[140px] border-violet-400/20 bg-violet-950/25 text-sm text-white">
                    <MapPin className="mr-2 h-4 w-4 text-zinc-500" />
                    <SelectValue placeholder="Ciudad" />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-700 bg-zinc-900">
                    <SelectItem value="all">Todas</SelectItem>
                    {TOP_CITIES.map(city => (
                      <SelectItem key={city} value={city}>{city}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={dateFilter} onValueChange={setDateFilter}>
                  <SelectTrigger className="w-[155px] border-violet-400/20 bg-violet-950/25 text-sm text-white">
                    <Calendar className="mr-2 h-4 w-4 text-violet-300" />
                    <SelectValue placeholder="Período" />
                  </SelectTrigger>
                  <SelectContent className="border-violet-500/20 bg-[#140b20] text-zinc-100">
                    <SelectItem value="today">Hoy</SelectItem>
                    <SelectItem value="yesterday">Ayer</SelectItem>
                    <SelectItem value="week">Últimos 7 días</SelectItem>
                    <SelectItem value="month">Último mes</SelectItem>
                    <SelectItem value="custom">Rango personalizado</SelectItem>
                    <SelectItem value="all">Todo el tiempo</SelectItem>
                  </SelectContent>
                </Select>
                {dateFilter === "custom" && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-500/15 bg-violet-950/20 p-2">
                    <Input
                      type="date"
                      aria-label="Fecha inicial"
                      value={dateFrom}
                      max={dateTo || undefined}
                      onChange={(event) => setDateFrom(event.target.value)}
                      className="h-9 w-[145px] border-violet-400/20 bg-[#100918] text-xs text-white [color-scheme:dark]"
                    />
                    <span className="text-xs text-zinc-500">hasta</span>
                    <Input
                      type="date"
                      aria-label="Fecha final"
                      value={dateTo}
                      min={dateFrom || undefined}
                      onChange={(event) => setDateTo(event.target.value)}
                      className="h-9 w-[145px] border-violet-400/20 bg-[#100918] text-xs text-white [color-scheme:dark]"
                    />
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={loadOrders}
                disabled={loading}
                className="border-violet-400/20 bg-violet-950/25 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* CONTADOR DE PEDIDOS */}
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-zinc-500">
            Mostrando <span className="font-semibold text-white">{filteredOrders.length}</span> de{" "}
            <span className="font-semibold text-white">{listBaseOrders.length}</span> filas
          </p>
        </div>

        {/* LISTA DE PEDIDOS */}
        {loading ? (
          <div className="flex h-64 items-center justify-center text-zinc-400">
            <RefreshCw className="mr-3 h-5 w-5 animate-spin" />
            Cargando pedidos...
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/30">
            <AlertCircle className="mb-4 h-12 w-12 text-zinc-600" />
            <p className="text-lg text-zinc-400">No hay pedidos que coincidan con los filtros</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredOrders.map((order) => {
              const status = normalizeStatus(order.status);
              const config = STATUS_CONFIG[status] || STATUS_CONFIG.pendiente;
              const Icon = config.icon;
              const chatNumber = order.from_number || order.phone || "";
              const items = getResolvedOrderItems(order);
              const observation = getOrderObservation(order);
              const primaryProductName = getPrimaryProductName(order);
              const fechaPedido = formatDateTime(order.created_at);
              const fechaCorta = formatDateShort(order.created_at);

              return (
                <Card
                  key={order.id}
                  className={`group overflow-hidden border-violet-500/15 bg-[#120d19]/88 backdrop-blur-xl shadow-[0_18px_45px_rgba(0,0,0,0.28)] transition-all hover:border-zinc-700 hover:shadow-2xl ${config.borderColor}`}
                >
                  <CardContent className="p-4">
                    {/* Header con fecha de pedido */}
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-zinc-500">Desde</p>
                          <span className="text-xs text-zinc-600">•</span>
                          <div className="flex items-center gap-1 text-xs text-zinc-500">
                            <Calendar className="h-3 w-3" />
                            <span title={fechaPedido}>{fechaCorta}</span>
                          </div>
                        </div>
                        <p className="max-w-[180px] break-all font-mono text-sm font-semibold text-white" title={chatNumber}>
                          {chatNumber || "—"}
                        </p>
                      </div>
                      <Badge className={`${config.bgColor} border-0 text-xs shrink-0`} style={{ color: config.color }}>
                        <Icon className="mr-1 h-3 w-3" />
                        {config.label}
                      </Badge>
                    </div>

                    {/* Productos */}
                    <div className="mb-3">
                      <p className="mb-1.5 text-xs text-zinc-500">Productos</p>
                      {items.length > 0 ? (
                        <div className="space-y-1.5">
                          {items.slice(0, 2).map((item, index) => (
                            <div key={index} className="rounded-lg bg-zinc-800/50 p-2.5">
                              <p className="truncate text-sm font-medium text-white">
                                {item.product || item.name || "Producto"}
                              </p>
                              <div className="mt-0.5 flex items-center gap-3 text-xs text-zinc-400">
                                <span>Cant: {item.quantity || 1}</span>
                                <span className="font-medium text-emerald-400">
                                  {formatCurrency(item.amount || item.price || 0)} Gs
                                </span>
                              </div>
                            </div>
                          ))}
                          {items.length > 2 && (
                            <p className="text-xs text-zinc-500">+{items.length - 2} más</p>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-lg bg-zinc-800/50 p-2.5">
                          <p className={`truncate text-sm font-medium ${primaryProductName === "Producto sin identificar" ? "text-amber-300" : "text-white"}`}>
                            {primaryProductName}
                          </p>
                          {primaryProductName === "Producto sin identificar" && (
                            <p className="mt-1 text-[11px] text-amber-400">Revisar nombre guardado por el bot</p>
                          )}
                          <div className="mt-0.5 flex items-center gap-3 text-xs text-zinc-400">
                            <span>Cant: {order.quantity || 1}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Cliente y total */}
                    <div className="mb-2 flex items-center justify-between gap-2 text-sm">
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        <User className="h-3.5 w-3.5" />
                        <span className="truncate">{order.customer_name || "Sin nombre"}</span>
                      </div>
                      <span className="font-semibold text-emerald-400">
                        {formatCurrency(order.total_amount)} Gs
                      </span>
                    </div>

                    {order.city && (
                      <div className="mb-2 flex items-center gap-1.5 text-xs text-zinc-500">
                        <MapPin className="h-3 w-3" />
                        <span>{order.city}</span>
                      </div>
                    )}

                    {order.address && (
                      <div className="mb-3 rounded-lg bg-zinc-800/30 p-2">
                        <p className="text-xs text-zinc-500">Dirección</p>
                        <p className="text-xs text-zinc-300">{order.address}</p>
                      </div>
                    )}

                    {observation && (
                      <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
                        <div className="mb-1 flex items-center gap-1.5">
                          <ReceiptText className="h-3.5 w-3.5 text-amber-400" />
                          <p className="text-xs font-medium text-amber-300">Observaciones</p>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-300">
                          {observation}
                        </p>
                      </div>
                    )}

                    {/* Acciones */}
                    <div className="mt-3 flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-zinc-700 bg-zinc-800/30 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white"
                        onClick={() => openEcommerce(order)}
                      >
                        <ShoppingCart className="mr-1 h-3 w-3" />
                        Ecommerce
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-zinc-700 bg-zinc-800/30 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white"
                        onClick={() => openChat(chatNumber)}
                      >
                        <MessageSquare className="mr-1 h-3 w-3" />
                        Chat
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="px-2.5 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                        onClick={() => deleteOrder(order.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Estado rápido */}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {status !== "cargado" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-violet-300 hover:bg-violet-500/10"
                          onClick={() => updateStatus(order, "cargado")}
                        >
                          Cargar
                        </Button>
                      )}
                      {status !== "droppx" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-purple-400 hover:bg-purple-500/10"
                          onClick={() => updateStatus(order, "droppx")}
                        >
                          Droppx
                        </Button>
                      )}
                      {status !== "cancelado" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-red-400 hover:bg-red-500/10"
                          onClick={() => updateStatus(order, "cancelado")}
                        >
                          Cancelar
                        </Button>
                      )}
                    </div>

                    {order.comprobante_url && (
                      <a
                        href={order.comprobante_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline"
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

// Componente MetricCard con diseño oscuro corporativo
function MetricCard({
  title,
  value,
  subtitle,
  color,
  bgColor,
  borderColor,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  color: string;
  bgColor: string;
  borderColor: string;
}) {
  return (
    <Card className={`border ${borderColor} ${bgColor} bg-zinc-900/30 backdrop-blur-sm shadow-xl`}>
      <CardContent className="p-3">
        <p className="text-xs font-medium text-zinc-400">{title}</p>
        <p className="mt-1 break-words text-xl font-bold leading-tight tracking-tight" style={{ color }}>
          {value}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">{subtitle}</p>
      </CardContent>
    </Card>
  );
}
