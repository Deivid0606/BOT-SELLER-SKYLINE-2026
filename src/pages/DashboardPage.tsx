import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/KpiCard";
import {
  MessageSquare,
  Users,
  ShoppingCart,
  TrendingUp,
  MapPin,
  Package,
  CalendarIcon,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import {
  format,
  subDays,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isWithinInterval,
} from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";

type DbMessage = {
  id: string;
  from_number: string | null;
  message: string | null;
  is_processed: boolean | null;
  created_at?: string | null;
};

type DbOrder = {
  id: string;
  product: string | null;
  city: string | null;
  status: string | null;
  total_amount: string | null;
  created_at: string;
};

// ✅ Estados que cuentan como "venta cerrada"
const CLOSED_STATUSES = new Set(["cargado", "confirmado", "confirmed", "droppx"]);

type RangeKey = "hoy" | "7d" | "30d" | "mes" | "custom";

export default function DashboardPage() {
  const [messages, setMessages] = useState<DbMessage[]>([]);
  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const [rangeKey, setRangeKey] = useState<RangeKey>("hoy");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();

  // Calcular rango de fechas según el botón activo
  const { from, to, label } = useMemo(() => {
    const now = new Date();
    if (rangeKey === "hoy") {
      return { from: startOfDay(now), to: endOfDay(now), label: "Hoy" };
    }
    if (rangeKey === "7d") {
      return { from: startOfDay(subDays(now, 6)), to: endOfDay(now), label: "Últimos 7 días" };
    }
    if (rangeKey === "30d") {
      return { from: startOfDay(subDays(now, 29)), to: endOfDay(now), label: "Últimos 30 días" };
    }
    if (rangeKey === "mes") {
      return { from: startOfMonth(now), to: endOfMonth(now), label: "Este mes" };
    }
    if (customRange?.from) {
      const f = startOfDay(customRange.from);
      const t = endOfDay(customRange.to ?? customRange.from);
      return {
        from: f,
        to: t,
        label: `${format(f, "dd MMM", { locale: es })} → ${format(t, "dd MMM", { locale: es })}`,
      };
    }
    return { from: startOfDay(now), to: endOfDay(now), label: "Hoy" };
  }, [rangeKey, customRange]);

  const loadDashboardData = async () => {
    setLoading(true);
    const [messagesRes, ordersRes] = await Promise.all([
      supabase
        .from("received_messages")
        .select("id, from_number, message, is_processed, created_at")
        .order("id", { ascending: false }),
      supabase
        .from("orders")
        .select("id, product, city, status, total_amount, created_at")
        .order("created_at", { ascending: false }),
    ]);
    if (messagesRes.error) console.error("Error mensajes:", messagesRes.error);
    if (ordersRes.error) console.error("Error órdenes:", ordersRes.error);
    setMessages((messagesRes.data || []) as DbMessage[]);
    setOrders((ordersRes.data || []) as DbOrder[]);
    setLoading(false);
  };

  useEffect(() => {
    loadDashboardData();
    const m = supabase
      .channel("dashboard_messages_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "received_messages" },
        loadDashboardData
      )
      .subscribe();
    const o = supabase
      .channel("dashboard_orders_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        loadDashboardData
      )
      .subscribe();
    return () => {
      supabase.removeChannel(m);
      supabase.removeChannel(o);
    };
  }, []);

  // Pedidos cerrados dentro del rango seleccionado
  const ordersInRange = useMemo(
    () =>
      orders.filter((o) => {
        if (!o.status || !CLOSED_STATUSES.has(o.status)) return false;
        return isWithinInterval(new Date(o.created_at), { start: from, end: to });
      }),
    [orders, from, to]
  );

  // Mensajes dentro del rango
  const messagesInRange = useMemo(
    () =>
      messages.filter((m) => {
        if (!m.created_at) return false;
        return isWithinInterval(new Date(m.created_at), { start: from, end: to });
      }),
    [messages, from, to]
  );

  const totalMessages = messagesInRange.length;
  const activeChats = useMemo(
    () =>
      new Set(messagesInRange.map((m) => m.from_number).filter((v): v is string => !!v)).size,
    [messagesInRange]
  );
  const totalSales = ordersInRange.length;
  const conversionRate = activeChats > 0 ? Math.round((totalSales / activeChats) * 100) : 0;

  const msgData = useMemo(() => {
    const days = eachDayOfInterval({ start: from, end: to });
    return days.map((day) => ({
      day: format(day, days.length <= 7 ? "EEE" : "dd/MM", { locale: es }),
      msgs: messagesInRange.filter(
        (m) =>
          m.created_at &&
          isWithinInterval(new Date(m.created_at), {
            start: startOfDay(day),
            end: endOfDay(day),
          })
      ).length,
    }));
  }, [messagesInRange, from, to]);

  const salesData = useMemo(() => {
    const days = eachDayOfInterval({ start: from, end: to });
    return days.map((day) => ({
      day: format(day, days.length <= 7 ? "EEE" : "dd/MM", { locale: es }),
      ventas: ordersInRange.filter((o) =>
        isWithinInterval(new Date(o.created_at), {
          start: startOfDay(day),
          end: endOfDay(day),
        })
      ).length,
    }));
  }, [ordersInRange, from, to]);

  const topProducts = useMemo(() => {
    const c = new Map<string, number>();
    for (const o of ordersInRange) {
      const n = o.product?.trim();
      if (n) c.set(n, (c.get(n) || 0) + 1);
    }
    return Array.from(c.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [ordersInRange]);

  const topCities = useMemo(() => {
    const c = new Map<string, number>();
    for (const o of ordersInRange) {
      const n = o.city?.trim();
      if (n) c.set(n, (c.get(n) || 0) + 1);
    }
    return Array.from(c.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [ordersInRange]);

  const rangeButtons: { key: RangeKey; label: string }[] = [
    { key: "hoy", label: "Hoy" },
    { key: "7d", label: "7 días" },
    { key: "30d", label: "30 días" },
    { key: "mes", label: "Este mes" },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header con título y filtros de fecha */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
            Dashboard de Ventas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {label} · {loading ? "Cargando..." : `${totalSales} pedidos cerrados`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {rangeButtons.map((b) => (
            <Button
              key={b.key}
              variant={rangeKey === b.key ? "default" : "outline"}
              size="sm"
              onClick={() => setRangeKey(b.key)}
            >
              {b.label}
            </Button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={rangeKey === "custom" ? "default" : "outline"}
                size="sm"
                className="gap-2"
              >
                <CalendarIcon className="h-4 w-4" />
                {rangeKey === "custom" && customRange?.from
                  ? `${format(customRange.from, "dd/MM")}${
                      customRange.to ? ` - ${format(customRange.to, "dd/MM")}` : ""
                    }`
                  : "Personalizado"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={customRange}
                onSelect={(r) => {
                  setCustomRange(r);
                  if (r?.from) setRangeKey("custom");
                }}
                numberOfMonths={2}
                locale={es}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Mensajes" value={totalMessages.toString()} icon={MessageSquare} />
        <KpiCard title="Chats activos" value={activeChats.toString()} icon={Users} />
        <KpiCard title="Ventas cerradas" value={totalSales.toString()} icon={ShoppingCart} />
        <KpiCard title="Tasa conversión" value={`${conversionRate}%`} icon={TrendingUp} />
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-border bg-card p-5"
        >
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <span className="w-1 h-4 bg-primary rounded" /> Mensajes por Día
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={msgData}>
                <defs>
                  <linearGradient id="msgGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="msgs"
                  stroke="hsl(var(--primary))"
                  fill="url(#msgGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-xl border border-border bg-card p-5"
        >
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <span className="w-1 h-4 bg-purple-500 rounded" /> Ventas por Día (cerradas)
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Bar dataKey="ventas" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Top Productos y Ciudades */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" /> Top Productos
          </h3>
          {topProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No hay pedidos cerrados en este período
            </p>
          ) : (
            <ul className="space-y-2">
              {topProducts.map((p, i) => (
                <li
                  key={p.name}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition"
                >
                  <span className="text-xs font-mono text-muted-foreground w-6">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 text-sm text-foreground truncate">{p.name}</span>
                  <span className="text-sm font-semibold text-primary">{p.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-purple-400" /> Ventas por Ciudad
          </h3>
          {topCities.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No hay pedidos cerrados en este período
            </p>
          ) : (
            <ul className="space-y-2">
              {topCities.map((c, i) => (
                <li
                  key={c.name}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition"
                >
                  <span className="text-xs font-mono text-muted-foreground w-6">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 text-sm text-foreground truncate">{c.name}</span>
                  <span className="text-sm font-semibold text-purple-400">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
