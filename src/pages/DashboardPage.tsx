import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/KpiCard";
import {
  MessageSquare,
  Users,
  TrendingUp,
  MapPin,
  Package,
  CalendarIcon,
  CheckCircle2,
  XCircle,
  ClipboardList,
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
  Legend,
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
} from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";

const PARAGUAY_TIME_ZONE = "America/Asuncion";

type DbMessage = {
  id: string;
  from_number: string | null;
  message: string | null;
  message_type: string | null;
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

type RangeKey = "hoy" | "7d" | "30d" | "mes" | "custom";

const LOADED_STATUSES = new Set([
  "cargado",
  "confirmado",
  "confirmed",
  "droppx",
  "procesado",
  "enviado",
]);

const CANCELLED_STATUSES = new Set([
  "cancelado",
  "cancelada",
  "cancelled",
  "rechazado",
  "rechazada",
  "anulado",
  "anulada",
]);

function normalizeStatus(status?: string | null) {
  return String(status ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isOutgoingMessage(messageType?: string | null) {
  return Boolean(messageType?.startsWith("out_"));
}

function getTimeZoneParts(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PARAGUAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));

  const result: Record<string, string> = {};
  for (const part of parts) result[part.type] = part.value;

  return {
    year: Number(result.year),
    month: Number(result.month),
    day: Number(result.day),
    hour: Number(result.hour),
    minute: Number(result.minute),
    second: Number(result.second),
  };
}

function paraguayDateKey(value: string | Date) {
  const { year, month, day } = getTimeZoneParts(value);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function paraguayNowAsLocalDate() {
  const { year, month, day, hour, minute, second } = getTimeZoneParts(new Date());
  return new Date(year, month - 1, day, hour, minute, second);
}

export default function DashboardPage() {
  const [messages, setMessages] = useState<DbMessage[]>([]);
  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const [rangeKey, setRangeKey] = useState<RangeKey>("hoy");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();

  const { from, to, label } = useMemo(() => {
    const now = paraguayNowAsLocalDate();

    if (rangeKey === "hoy") {
      return { from: startOfDay(now), to: endOfDay(now), label: "Hoy" };
    }

    if (rangeKey === "7d") {
      return {
        from: startOfDay(subDays(now, 6)),
        to: endOfDay(now),
        label: "Últimos 7 días",
      };
    }

    if (rangeKey === "30d") {
      return {
        from: startOfDay(subDays(now, 29)),
        to: endOfDay(now),
        label: "Últimos 30 días",
      };
    }

    if (rangeKey === "mes") {
      return {
        from: startOfMonth(now),
        to: endOfMonth(now),
        label: "Este mes",
      };
    }

    if (customRange?.from) {
      const f = startOfDay(customRange.from);
      const t = endOfDay(customRange.to ?? customRange.from);
      return {
        from: f,
        to: t,
        label: `${format(f, "dd MMM", { locale: es })} → ${format(t, "dd MMM", {
          locale: es,
        })}`,
      };
    }

    return { from: startOfDay(now), to: endOfDay(now), label: "Hoy" };
  }, [rangeKey, customRange]);

  const fromKey = format(from, "yyyy-MM-dd");
  const toKey = format(to, "yyyy-MM-dd");

  const loadDashboardData = async () => {
    setLoading(true);

    const [messagesRes, ordersRes] = await Promise.all([
      supabase
        .from("received_messages")
        .select("id, from_number, message, message_type, is_processed, created_at")
        .order("created_at", { ascending: false }),
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

    const messagesChannel = supabase
      .channel("dashboard_messages_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "received_messages" },
        loadDashboardData
      )
      .subscribe();

    const ordersChannel = supabase
      .channel("dashboard_orders_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        loadDashboardData
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(ordersChannel);
    };
  }, []);

  const allOrdersInRange = useMemo(
    () =>
      orders.filter((order) => {
        if (!order.created_at) return false;
        const key = paraguayDateKey(order.created_at);
        return key >= fromKey && key <= toKey;
      }),
    [orders, fromKey, toKey]
  );

  const loadedOrders = useMemo(
    () => allOrdersInRange.filter((order) => LOADED_STATUSES.has(normalizeStatus(order.status))),
    [allOrdersInRange]
  );

  const cancelledOrders = useMemo(
    () =>
      allOrdersInRange.filter((order) => CANCELLED_STATUSES.has(normalizeStatus(order.status))),
    [allOrdersInRange]
  );

  const receivedMessagesInRange = useMemo(
    () =>
      messages.filter((message) => {
        if (!message.created_at || !message.from_number) return false;
        if (isOutgoingMessage(message.message_type)) return false;
        const key = paraguayDateKey(message.created_at);
        return key >= fromKey && key <= toKey;
      }),
    [messages, fromKey, toKey]
  );

  // Un “mensaje” del dashboard equivale a un chat recibido único por número.
  const uniqueReceivedPhones = useMemo(
    () =>
      new Set(
        receivedMessagesInRange
          .map((message) => message.from_number?.trim())
          .filter((phone): phone is string => Boolean(phone))
      ),
    [receivedMessagesInRange]
  );

  const totalMessages = uniqueReceivedPhones.size;
  const activeChats = uniqueReceivedPhones.size;
  const totalOrders = allOrdersInRange.length;
  const totalLoaded = loadedOrders.length;
  const totalCancelled = cancelledOrders.length;
  const conversionRate = activeChats > 0 ? Math.round((totalLoaded / activeChats) * 100) : 0;

  const msgData = useMemo(() => {
    const days = eachDayOfInterval({ start: from, end: to });

    return days.map((day) => {
      const dayKey = format(day, "yyyy-MM-dd");
      const uniquePhones = new Set(
        receivedMessagesInRange
          .filter((message) => message.created_at && paraguayDateKey(message.created_at) === dayKey)
          .map((message) => message.from_number?.trim())
          .filter((phone): phone is string => Boolean(phone))
      );

      return {
        day: format(day, days.length <= 7 ? "EEE" : "dd/MM", { locale: es }),
        chats: uniquePhones.size,
      };
    });
  }, [receivedMessagesInRange, from, to]);

  const ordersData = useMemo(() => {
    const days = eachDayOfInterval({ start: from, end: to });

    return days.map((day) => {
      const dayKey = format(day, "yyyy-MM-dd");
      const dayOrders = allOrdersInRange.filter(
        (order) => paraguayDateKey(order.created_at) === dayKey
      );

      return {
        day: format(day, days.length <= 7 ? "EEE" : "dd/MM", { locale: es }),
        pedidos: dayOrders.length,
        cargados: dayOrders.filter((order) => LOADED_STATUSES.has(normalizeStatus(order.status)))
          .length,
        cancelados: dayOrders.filter((order) =>
          CANCELLED_STATUSES.has(normalizeStatus(order.status))
        ).length,
      };
    });
  }, [allOrdersInRange, from, to]);

  const topProducts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const order of loadedOrders) {
      const name = order.product?.trim();
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [loadedOrders]);

  const topCities = useMemo(() => {
    const counts = new Map<string, number>();

    for (const order of loadedOrders) {
      const name = order.city?.trim();
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [loadedOrders]);

  const rangeButtons: { key: RangeKey; label: string }[] = [
    { key: "hoy", label: "Hoy" },
    { key: "7d", label: "7 días" },
    { key: "30d", label: "30 días" },
    { key: "mes", label: "Este mes" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
            Dashboard de Ventas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {label} · {loading ? "Cargando..." : `${totalOrders} pedidos totales`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {rangeButtons.map((button) => (
            <Button
              key={button.key}
              variant={rangeKey === button.key ? "default" : "outline"}
              size="sm"
              onClick={() => setRangeKey(button.key)}
            >
              {button.label}
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
                onSelect={(range) => {
                  setCustomRange(range);
                  if (range?.from) setRangeKey("custom");
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

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4">
        <KpiCard title="Chats recibidos" value={totalMessages.toString()} icon={MessageSquare} />
        <KpiCard title="Chats activos" value={activeChats.toString()} icon={Users} />
        <KpiCard title="Pedidos totales" value={totalOrders.toString()} icon={ClipboardList} />
        <KpiCard title="Pedidos cargados" value={totalLoaded.toString()} icon={CheckCircle2} />
        <KpiCard title="Pedidos cancelados" value={totalCancelled.toString()} icon={XCircle} />
        <KpiCard title="Tasa conversión" value={`${conversionRate}%`} icon={TrendingUp} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-border bg-card p-5"
        >
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <span className="w-1 h-4 bg-primary rounded" /> Chats recibidos por día
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
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="chats"
                  name="Chats"
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
            <span className="w-1 h-4 bg-purple-500 rounded" /> Pedidos por día
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ordersData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Legend />
                <Bar dataKey="pedidos" name="Pedidos" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cargados" name="Cargados" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cancelados" name="Cancelados" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" /> Top productos cargados
          </h3>
          {topProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No hay pedidos cargados en este período
            </p>
          ) : (
            <ul className="space-y-2">
              {topProducts.map((product, index) => (
                <li
                  key={product.name}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition"
                >
                  <span className="text-xs font-mono text-muted-foreground w-6">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 text-sm text-foreground truncate">{product.name}</span>
                  <span className="text-sm font-semibold text-primary">{product.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-purple-400" /> Pedidos cargados por ciudad
          </h3>
          {topCities.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No hay pedidos cargados en este período
            </p>
          ) : (
            <ul className="space-y-2">
              {topCities.map((city, index) => (
                <li
                  key={city.name}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition"
                >
                  <span className="text-xs font-mono text-muted-foreground w-6">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 text-sm text-foreground truncate">{city.name}</span>
                  <span className="text-sm font-semibold text-purple-400">{city.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
