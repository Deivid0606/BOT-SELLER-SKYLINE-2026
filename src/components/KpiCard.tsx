import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: { value: string; positive: boolean };
  delay?: number;
}

export function KpiCard({ title, value, icon: Icon, trend, delay = 0 }: KpiCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative glass glass-border rounded-xl p-5 overflow-hidden group hover:-translate-y-1 hover:shadow-pro-hover transition-all duration-300 cursor-default"
    >
      {/* Top gradient line */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      
      {/* Subtle corner glow */}
      <div className="absolute -top-12 -right-12 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors duration-500" />
      
      <div className="flex items-start justify-between relative z-10">
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-medium">{title}</p>
          <p className="text-3xl font-bold font-heading text-gradient mt-2 leading-none">{value}</p>
          {trend && (
            <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${trend.positive ? "text-success" : "text-destructive"}`}>
              <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] ${trend.positive ? "bg-success/15" : "bg-destructive/15"}`}>
                {trend.positive ? "↑" : "↓"}
              </span>
              {trend.value}
            </div>
          )}
        </div>
        <div className="p-2.5 rounded-xl bg-primary/8 text-primary border border-primary/10 group-hover:bg-primary/12 group-hover:border-primary/20 transition-all duration-300">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </motion.div>
  );
}
