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
  { day: "Lun", msgs: 0 },
  { day: "Mar", msgs: 0 },
  { day: "Mié", msgs: 0 },
  { day: "Jue", msgs: 0 },
  { day: "Vie", msgs: 0 },
  { day: "Sáb", msgs: 0 },
  { day: "Dom", msgs: 0 },
];

const salesData = [
  { day: "Lun", ventas: 0 },
  { day: "Mar", ventas: 0 },
  { day: "Mié", ventas: 0 },
  { day: "Jue", ventas: 0 },
  { day: "Vie", ventas: 0 },
  { day: "Sáb", ventas: 0 },
  { day: "Dom", ventas: 0 },
];

const topProducts: { name: string; count: number }[] = [];

const topCities: { name: string; count: number }[] = [];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading text-gradient">
            Dashboard de Ventas
          </h1>
          <p className="text-xs text-muted-foreground mt-1">Resumen en tiempo real de tu negocio</p>
        </div>
        <div className="flex gap-1.5">
          {["Hoy", "7 días", "30 días", "Este mes"].map((label, i) => (
            <button
              key={label}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                i === 0
                  ? "glass glass-border text-primary shadow-sm"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground border border-transparent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Mensajes Hoy" value="0" icon={MessageSquare} delay={0} />
        <KpiCard title="Chats Activos" value="0" icon={Users} delay={0.08} />
        <KpiCard title="Ventas del Día" value="0" icon={ShoppingCart} delay={0.16} />
        <KpiCard title="Tasa Conversión" value="0%" icon={TrendingUp} delay={0.24} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="glass glass-border rounded-xl p-5"
        >
          <h3 className="text-sm font-semibold text-foreground mb-4 font-heading flex items-center gap-2">
            <div className="w-1 h-4 rounded-full bg-primary" />
            Mensajes por Día
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={msgData}>
              <defs>
                <linearGradient id="colorMsgs" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(239 84% 67%)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="hsl(239 84% 67%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(230 20% 13%)" vertical={false} />
              <XAxis dataKey="day" stroke="hsl(220 15% 40%)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="hsl(220 15% 40%)" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(230 35% 9%)",
                  border: "1px solid hsl(230 20% 16%)",
                  borderRadius: "12px",
                  color: "hsl(220 30% 94%)",
                  fontSize: "12px",
                  backdropFilter: "blur(12px)",
                  boxShadow: "0 8px 32px hsl(0 0% 0% / 0.4)",
                }}
              />
              <Area type="monotone" dataKey="msgs" stroke="hsl(239 84% 67%)" fill="url(#colorMsgs)" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: "hsl(239 84% 67%)", stroke: "hsl(0 0% 100%)", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="glass glass-border rounded-xl p-5"
        >
          <h3 className="text-sm font-semibold text-foreground mb-4 font-heading flex items-center gap-2">
            <div className="w-1 h-4 rounded-full bg-accent" />
            Ventas por Día
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={salesData}>
              <defs>
                <linearGradient id="colorBar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(239 84% 67%)" />
                  <stop offset="100%" stopColor="hsl(270 70% 55%)" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(230 20% 13%)" vertical={false} />
              <XAxis dataKey="day" stroke="hsl(220 15% 40%)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="hsl(220 15% 40%)" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(230 35% 9%)",
                  border: "1px solid hsl(230 20% 16%)",
                  borderRadius: "12px",
                  color: "hsl(220 30% 94%)",
                  fontSize: "12px",
                  backdropFilter: "blur(12px)",
                  boxShadow: "0 8px 32px hsl(0 0% 0% / 0.4)",
                }}
              />
              <Bar dataKey="ventas" fill="url(#colorBar)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Top Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="glass glass-border rounded-xl p-5"
        >
          <h3 className="text-sm font-semibold text-foreground mb-4 font-heading flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" /> Top Productos
          </h3>
          {topProducts.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">Sin datos todavía</p>
          ) : (
            <div className="space-y-1">
              {topProducts.map((p, i) => (
                <div key={p.name} className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-secondary/30 transition-colors duration-200 group">
                  <span className="text-xs font-bold text-primary/60 w-5 font-mono">{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex-1 text-sm font-medium">{p.name}</span>
                  <span className="text-xs px-2.5 py-1 rounded-lg bg-secondary/60 border border-border/40 font-mono font-medium group-hover:bg-primary/10 group-hover:text-primary group-hover:border-primary/20 transition-all">
                    {p.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="glass glass-border rounded-xl p-5"
        >
          <h3 className="text-sm font-semibold text-foreground mb-4 font-heading flex items-center gap-2">
            <MapPin className="h-4 w-4 text-accent" /> Ventas por Ciudad
          </h3>
          {topCities.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">Sin datos todavía</p>
          ) : (
            <div className="space-y-1">
              {topCities.map((c, i) => (
                <div key={c.name} className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-secondary/30 transition-colors duration-200 group">
                  <span className="text-xs font-bold text-accent/60 w-5 font-mono">{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex-1 text-sm font-medium">{c.name}</span>
                  <span className="text-xs px-2.5 py-1 rounded-lg bg-secondary/60 border border-border/40 font-mono font-medium group-hover:bg-accent/10 group-hover:text-accent group-hover:border-accent/20 transition-all">
                    {c.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
