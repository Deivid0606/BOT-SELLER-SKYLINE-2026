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
import { useAuth } from "@/contexts/AuthContext";
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
  sender_id: string | null;
  message: string | null;
  message_type: string | null;
  is_processed: boolean | null;
  message_origin: string | null;
  is_meta_ad: boolean | null;
  ad_id?: string | null;
  ad_headline?: string | null;
  ad_body?: string | null;
  created_at?: string | null;
};

type DbOrder = {
  id: string;
  product: string | null;
  city: string | null;
  status: string | null;
  total_amount: string | null;
  from_number?: string | null;
  message_origin?: string | null;
  ad_id?: string | null;
  ad_name?: string | null;
  ad_product?: string | null;
  ad_initial_message?: string | null;
  created_at: string;
};

type MetaAdCatalogItem = {
  ad_id: string;
  ad_name: string | null;
  product_name: string;
  default_message: string | null;
  is_active: boolean | null;
};

type RangeKey = "hoy" | "7d" | "30d" | "mes" | "custom";

const SALE_STATUSES = new Set([
  "confirmado",
  "confirmed",
  "cargado",
  "procesado",
  "enviado",
  "droppx",
  "entregado",
  "delivered",
]);

const LOADED_STATUSES = new Set([
  "cargado",
  "procesado",
  "enviado",
  "droppx",
  "entregado",
  "delivered",
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
  }).formatToParts(parseDatabaseTimestamp(value));

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

function parseDatabaseTimestamp(value: string | Date) {
  if (value instanceof Date) return value;

  const raw = String(value ?? "").trim();
  if (!raw) return new Date(NaN);

  // Supabase devuelve timestamp without time zone sin sufijo. En esta tabla
  // esos valores fueron generados por el servidor y representan UTC.
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  return new Date(hasExplicitZone ? normalized : `${normalized}Z`);
}

function normalizeChatPhone(value?: string | null) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("595")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
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
  const { user } = useAuth();
  const [messages, setMessages] = useState<DbMessage[]>([]);
  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [metaAdsCatalog, setMetaAdsCatalog] = useState<MetaAdCatalogItem[]>([]);
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

    return {
      from: startOfDay(now),
      to: endOfDay(now),
      label: "Hoy",
    };
  }, [rangeKey, customRange]);

  const fromKey = format(from, "yyyy-MM-dd");
  const toKey = format(to, "yyyy-MM-dd");

  const loadDashboardData = async () => {
    if (!user?.id) {
      setMessages([]);
      setOrders([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const [messagesRes, ordersRes, catalogRes] = await Promise.all([
      supabase
        .from("inbox_messages")
        .select(
          "id, from_number, sender_id, message, message_type, is_processed, message_origin, is_meta_ad, ad_id, ad_headline, ad_body, created_at"
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("orders")
        .select("id, product, city, status, total_amount, from_number, message_origin, ad_id, ad_name, ad_product, ad_initial_message, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("meta_ads_catalog")
        .select("ad_id, ad_name, product_name, default_message, is_active")
        .eq("user_id", user.id)
        .eq("is_active", true),
    ]);

    if (messagesRes.error) console.error("Error mensajes:", messagesRes.error);
    if (ordersRes.error) console.error("Error órdenes:", ordersRes.error);
    if (catalogRes.error) console.error("Error catálogo anuncios:", catalogRes.error);

    setMessages((messagesRes.data || []) as DbMessage[]);
    setOrders((ordersRes.data || []) as DbOrder[]);
    setMetaAdsCatalog((catalogRes.data || []) as MetaAdCatalogItem[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!user?.id) return;

    loadDashboardData();

    const messagesChannel = supabase
      .channel("dashboard_inbox_messages_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inbox_messages", filter: `user_id=eq.${user.id}` },
        loadDashboardData
      )
      .subscribe();

    const ordersChannel = supabase
      .channel("dashboard_orders_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `user_id=eq.${user.id}` },
        loadDashboardData
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(ordersChannel);
    };
  }, [user?.id]);

  const allOrdersInRange = useMemo(
    () =>
      orders.filter((order) => {
        if (!order.created_at) return false;
        const key = paraguayDateKey(order.created_at);
        return key >= fromKey && key <= toKey;
      }),
    [orders, fromKey, toKey]
  );

  const salesInRange = useMemo(
    () => allOrdersInRange.filter((order) => SALE_STATUSES.has(normalizeStatus(order.status))),
    [allOrdersInRange]
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
        if (!message.created_at || !(message.from_number || message.sender_id)) return false;
        if (isOutgoingMessage(message.message_type)) return false;
        const key = paraguayDateKey(message.created_at);
        return key >= fromKey && key <= toKey;
      }),
    [messages, fromKey, toKey]
  );

  // Cada teléfono cuenta una sola vez en el período seleccionado.
  const uniqueReceivedPhones = useMemo(
    () =>
      new Set(
        receivedMessagesInRange
          .map((message) => normalizeChatPhone(message.from_number || message.sender_id))
          .filter(Boolean)
      ),
    [receivedMessagesInRange]
  );

  // Si un teléfono tuvo al menos un mensaje con referral de anuncio durante
  // el período, se clasifica como chat de Meta Ads. El resto queda orgánico.
  const uniqueMetaAdPhones = useMemo(
    () =>
      new Set(
        receivedMessagesInRange
          .filter(
            (message) =>
              message.is_meta_ad === true ||
              String(message.message_origin || "").toLowerCase() === "meta_ads"
          )
          .map((message) => normalizeChatPhone(message.from_number || message.sender_id))
          .filter(Boolean)
      ),
    [receivedMessagesInRange]
  );

  const totalMessages = uniqueReceivedPhones.size;
  const totalMetaAds = uniqueMetaAdPhones.size;
  const totalOrganic = Math.max(0, totalMessages - totalMetaAds);
  const totalSales = salesInRange.length;
  const totalLoaded = loadedOrders.length;
  const totalCancelled = cancelledOrders.length;

  const chartRange = useMemo(
    () => ({
      start: from,
      end: to,
    }),
    [from, to]
  );

  const msgData = useMemo(() => {
    const days = eachDayOfInterval({
      start: chartRange.start,
      end: chartRange.end,
    });

    return days.map((day) => {
      const dayKey = format(day, "yyyy-MM-dd");
      const uniquePhones = new Set(
        receivedMessagesInRange
          .filter(
            (message) =>
              message.created_at &&
              paraguayDateKey(message.created_at) === dayKey
          )
          .map((message) => normalizeChatPhone(message.from_number || message.sender_id))
          .filter(Boolean)
      );

      return {
        day: format(day, days.length <= 7 ? "EEE" : "dd/MM", { locale: es }),
        chats: uniquePhones.size,
      };
    });
  }, [receivedMessagesInRange, chartRange]);

  const ordersData = useMemo(() => {
    const days = eachDayOfInterval({
      start: chartRange.start,
      end: chartRange.end,
    });

    return days.map((day) => {
      const dayKey = format(day, "yyyy-MM-dd");
      const dayOrders = allOrdersInRange.filter(
        (order) => paraguayDateKey(order.created_at) === dayKey
      );

      return {
        day: format(day, days.length <= 7 ? "EEE" : "dd/MM", { locale: es }),
        ventas: dayOrders.filter((order) =>
          SALE_STATUSES.has(normalizeStatus(order.status))
        ).length,
        cargados: dayOrders.filter((order) =>
          LOADED_STATUSES.has(normalizeStatus(order.status))
        ).length,
        cancelados: dayOrders.filter((order) =>
          CANCELLED_STATUSES.has(normalizeStatus(order.status))
        ).length,
      };
    });
  }, [allOrdersInRange, chartRange]);

  const adPerformance = useMemo(() => {
    const catalogMap = new Map(metaAdsCatalog.map((item) => [item.ad_id, item]));
    const phoneToAd = new Map<string, string>();

    const sortedIncoming = [...messages]
      .filter((message) => !isOutgoingMessage(message.message_type))
      .sort(
        (a, b) =>
          parseDatabaseTimestamp(a.created_at || "").getTime() -
          parseDatabaseTimestamp(b.created_at || "").getTime()
      );

    for (const message of sortedIncoming) {
      const phone = normalizeChatPhone(message.from_number || message.sender_id);
      if (!phone || !message.ad_id) continue;
      if (!phoneToAd.has(phone)) phoneToAd.set(phone, message.ad_id);
    }

    const rows = new Map<
      string,
      {
        adId: string;
        adName: string;
        product: string;
        initialMessage: string;
        chatPhones: Set<string>;
        messages: number;
        sales: number;
        revenue: number;
      }
    >();

    const ensure = (adId: string) => {
      if (!rows.has(adId)) {
        const catalog = catalogMap.get(adId);
        rows.set(adId, {
          adId,
          adName: catalog?.ad_name || "Anuncio sin nombre",
          product: catalog?.product_name || "Sin identificar",
          initialMessage: catalog?.default_message || "",
          chatPhones: new Set<string>(),
          messages: 0,
          sales: 0,
          revenue: 0,
        });
      }
      return rows.get(adId)!;
    };

    for (const message of receivedMessagesInRange) {
      const phone = normalizeChatPhone(message.from_number || message.sender_id);
      const adId = message.ad_id || (phone ? phoneToAd.get(phone) : undefined);
      if (!adId) continue;
      const row = ensure(adId);
      if (phone) row.chatPhones.add(phone);
      row.messages += 1;
      if (!row.initialMessage) row.initialMessage = message.ad_body || message.message || "";
      if (row.adName === "Anuncio sin nombre" && message.ad_headline) row.adName = message.ad_headline;
    }

    for (const order of salesInRange) {
      const phone = normalizeChatPhone(order.from_number);
      const adId = order.ad_id || (phone ? phoneToAd.get(phone) : undefined);
      if (!adId) continue;
      const row = ensure(adId);
      row.sales += 1;
      const numericAmount = Number(String(order.total_amount || "").replace(/\D/g, ""));
      if (Number.isFinite(numericAmount)) row.revenue += numericAmount;
      if (order.ad_name) row.adName = order.ad_name;
      if (order.ad_product) row.product = order.ad_product;
      if (order.ad_initial_message && !row.initialMessage) row.initialMessage = order.ad_initial_message;
    }

    return Array.from(rows.values())
      .map((row) => ({
        adId: row.adId,
        adName: row.adName,
        product: row.product,
        initialMessage: row.initialMessage,
        chats: row.chatPhones.size,
        messages: row.messages,
        sales: row.sales,
        conversion: row.chatPhones.size > 0 ? (row.sales / row.chatPhones.size) * 100 : 0,
        revenue: row.revenue,
      }))
      .sort((a, b) => b.sales - a.sales || b.chats - a.chats);
  }, [messages, receivedMessagesInRange, salesInRange, metaAdsCatalog]);

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
            {label} · {loading ? "Cargando..." : `${totalSales} ventas`}
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
        <KpiCard title="Desde Meta Ads" value={totalMetaAds.toString()} icon={Users} />
        <KpiCard title="Orgánicos" value={totalOrganic.toString()} icon={TrendingUp} />
        <KpiCard title="Ventas" value={totalSales.toString()} icon={ClipboardList} />
        <KpiCard title="Pedidos cargados" value={totalLoaded.toString()} icon={CheckCircle2} />
        <KpiCard title="Pedidos cancelados" value={totalCancelled.toString()} icon={XCircle} />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-5 border-b border-border">
          <h3 className="font-semibold flex items-center gap-2">
            <Users className="h-4 w-4" /> Rendimiento por anuncio
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Chats únicos, mensajes entrantes y ventas atribuidas por ID de anuncio.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">ID / anuncio</th>
                <th className="px-4 py-3 text-left">Producto</th>
                <th className="px-4 py-3 text-right">Chats</th>
                <th className="px-4 py-3 text-right">Mensajes</th>
                <th className="px-4 py-3 text-right">Ventas</th>
                <th className="px-4 py-3 text-right">Conversión</th>
                <th className="px-4 py-3 text-right">Facturación</th>
              </tr>
            </thead>
            <tbody>
              {adPerformance.map((row) => (
                <tr key={row.adId} className="border-t border-border/60">
                  <td className="px-4 py-3 min-w-64">
                    <p className="font-medium">{row.adName}</p>
                    <p className="text-[11px] text-muted-foreground break-all">{row.adId}</p>
                    {row.initialMessage && (
                      <p className="mt-1 max-w-sm truncate text-[11px] text-muted-foreground" title={row.initialMessage}>
                        {row.initialMessage}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">{row.product}</td>
                  <td className="px-4 py-3 text-right">{row.chats}</td>
                  <td className="px-4 py-3 text-right">{row.messages}</td>
                  <td className="px-4 py-3 text-right font-semibold">{row.sales}</td>
                  <td className="px-4 py-3 text-right">{row.conversion.toFixed(1)}%</td>
                  <td className="px-4 py-3 text-right">
                    {new Intl.NumberFormat("es-PY").format(row.revenue)} Gs.
                  </td>
                </tr>
              ))}
              {!loading && adPerformance.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Todavía no hay anuncios identificados con actividad en este período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
            <span className="w-1 h-4 bg-purple-500 rounded" /> Ventas por día
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
                <Bar dataKey="ventas" name="Ventas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
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
