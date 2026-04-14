import { KpiCard } from "@/components/KpiCard";
import {
  MessageSquare,
  Users,
  ShoppingCart,
  TrendingUp,
  MapPin,
  Package,
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

const msgData = [
  { day: "Lun", msgs: 45 },
  { day: "Mar", msgs: 62 },
  { day: "Mié", msgs: 58 },
  { day: "Jue", msgs: 71 },
  { day: "Vie", msgs: 89 },
  { day: "Sáb", msgs: 34 },
  { day: "Dom", msgs: 22 },
];

const salesData = [
  { day: "Lun", ventas: 3 },
  { day: "Mar", ventas: 5 },
  { day: "Mié", ventas: 4 },
  { day: "Jue", ventas: 7 },
  { day: "Vie", ventas: 6 },
  { day: "Sáb", ventas: 2 },
  { day: "Dom", ventas: 1 },
];

const topProducts = [
  { name: "iPhone 15 Pro Max", count: 12 },
  { name: "Samsung Galaxy S24", count: 8 },
  { name: "AirPods Pro 2", count: 6 },
  { name: "iPad Air M2", count: 5 },
  { name: "MacBook Air M3", count: 3 },
];

const topCities = [
  { name: "Asunción", count: 18 },
  { name: "Ciudad del Este", count: 12 },
  { name: "Encarnación", count: 7 },
  { name: "Luque", count: 5 },
  { name: "San Lorenzo", count: 4 },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading text-gradient">
          Dashboard de Ventas
        </h1>
        <div className="flex gap-2">
          {["Hoy", "7 días", "30 días", "Este mes"].map((label) => (
            <button
              key={label}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-secondary text-secondary-foreground border border-border hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Mensajes Hoy" value="127" icon={MessageSquare} trend={{ value: "+23%", positive: true }} delay={0} />
        <KpiCard title="Chats Activos" value="34" icon={Users} trend={{ value: "+5", positive: true }} delay={0.1} />
        <KpiCard title="Ventas del Día" value="8" icon={ShoppingCart} trend={{ value: "+2", positive: true }} delay={0.2} />
        <KpiCard title="Tasa Conversión" value="12%" icon={TrendingUp} trend={{ value: "-1.2%", positive: false }} delay={0.3} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-card border border-border rounded-lg p-5"
        >
          <h3 className="text-sm font-semibold text-foreground mb-4 font-heading">📈 Mensajes por Día</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={msgData}>
              <defs>
                <linearGradient id="colorMsgs" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(239 84% 67%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(239 84% 67%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(232 30% 16%)" />
              <XAxis dataKey="day" stroke="hsl(220 20% 55%)" fontSize={12} />
              <YAxis stroke="hsl(220 20% 55%)" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(232 45% 7%)",
                  border: "1px solid hsl(232 30% 16%)",
                  borderRadius: "8px",
                  color: "hsl(220 30% 94%)",
                  fontSize: "12px",
                }}
              />
              <Area type="monotone" dataKey="msgs" stroke="hsl(239 84% 67%)" fill="url(#colorMsgs)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-card border border-border rounded-lg p-5"
        >
          <h3 className="text-sm font-semibold text-foreground mb-4 font-heading">💰 Ventas por Día</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={salesData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(232 30% 16%)" />
              <XAxis dataKey="day" stroke="hsl(220 20% 55%)" fontSize={12} />
              <YAxis stroke="hsl(220 20% 55%)" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(232 45% 7%)",
                  border: "1px solid hsl(232 30% 16%)",
                  borderRadius: "8px",
                  color: "hsl(220 30% 94%)",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="ventas" fill="hsl(239 84% 67%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Top Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="bg-card border border-border rounded-lg p-5"
        >
          <h3 className="text-sm font-semibold text-foreground mb-4 font-heading flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" /> Top Productos
          </h3>
          <div className="space-y-2">
            {topProducts.map((p, i) => (
              <div key={p.name} className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-secondary/50 transition-colors">
                <span className="text-xs font-bold text-primary w-5">{i + 1}</span>
                <span className="flex-1 text-sm">{p.name}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-secondary border border-border font-medium">
                  {p.count}
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="bg-card border border-border rounded-lg p-5"
        >
          <h3 className="text-sm font-semibold text-foreground mb-4 font-heading flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" /> Ventas por Ciudad
          </h3>
          <div className="space-y-2">
            {topCities.map((c, i) => (
              <div key={c.name} className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-secondary/50 transition-colors">
                <span className="text-xs font-bold text-primary w-5">{i + 1}</span>
                <span className="flex-1 text-sm">{c.name}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-secondary border border-border font-medium">
                  {c.count}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
