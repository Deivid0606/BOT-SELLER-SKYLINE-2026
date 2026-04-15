import {
  LayoutDashboard,
  MessageSquare,
  Inbox,
  Mail,
  ClipboardList,
  FileText,
  Zap,
  Tags,
  GraduationCap,
  Settings,
  Bell,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Chat IA", url: "/chat", icon: MessageSquare, badge: "Gemini" },
  { title: "Inbox", url: "/inbox", icon: Inbox },
  { title: "Mensajes Recibidos", url: "/mensajes", icon: Mail },
  { title: "Pedidos", url: "/pedidos", icon: ClipboardList },
  { title: "Plantillas", url: "/plantillas", icon: FileText },
  { title: "Disparadores", url: "/disparadores", icon: Zap },
  { title: "Etiquetas", url: "/etiquetas", icon: Tags },
  { title: "Entrenamiento", url: "/entrenamiento", icon: GraduationCap },
  { title: "Configuración", url: "/configuracion", icon: Settings },
  { title: "Notificaciones", url: "/notificaciones", icon: Bell },
];

const adminItems = [
  { title: "Gestión Usuarios", url: "/admin/usuarios", icon: ShieldCheck },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { user, role, signOut } = useAuth();

  return (
    <Sidebar collapsible="icon" className="border-r border-border/50">
      <SidebarContent className="bg-sidebar">
        {!collapsed && (
          <div className="px-5 py-5 border-b border-sidebar-border/50">
            <h1 className="text-xl font-bold font-heading text-gradient tracking-tight">
              SELLER SKYLINE
            </h1>
            <p className="text-[10px] text-muted-foreground mt-0.5 tracking-wider uppercase">Sales Automation</p>
          </div>
        )}
        {collapsed && (
          <div className="px-2 py-4 border-b border-sidebar-border/50 flex justify-center">
            <span className="text-gradient font-bold text-lg">SS</span>
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="px-2 py-2 space-y-0.5">
              {navItems.map((item) => {
                const active = location.pathname === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 text-sm ${
                          active
                            ? "glass glass-border text-primary shadow-sm"
                            : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground border border-transparent"
                        }`}
                        activeClassName=""
                      >
                        <item.icon className={`h-4 w-4 shrink-0 ${active ? "drop-shadow-[0_0_6px_hsl(239,84%,67%,0.4)]" : ""}`} />
                        {!collapsed && (
                          <>
                            <span className="flex-1 truncate font-medium">{item.title}</span>
                            {item.badge && (
                              <span className="text-[9px] px-2 py-0.5 rounded-full bg-primary/10 text-primary/70 border border-primary/15 font-mono">
                                {item.badge}
                              </span>
                            )}
                          </>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Admin section */}
        {role === "admin" && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="px-2 py-1 space-y-0.5">
                {!collapsed && (
                  <p className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Admin</p>
                )}
                {adminItems.map((item) => {
                  const active = location.pathname === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url}
                          end
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 text-sm ${
                            active
                              ? "glass glass-border text-primary shadow-sm"
                              : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground border border-transparent"
                          }`}
                          activeClassName=""
                        >
                          <item.icon className={`h-4 w-4 shrink-0 ${active ? "drop-shadow-[0_0_6px_hsl(239,84%,67%,0.4)]" : ""}`} />
                          {!collapsed && <span className="flex-1 truncate font-medium">{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* User info + logout */}
        <div className="mt-auto border-t border-sidebar-border/50 p-3">
          {!collapsed ? (
            <div className="glass glass-border rounded-lg p-3 space-y-2">
              <div className="text-xs text-muted-foreground truncate font-mono">{user?.email}</div>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] px-2.5 py-1 rounded-full font-semibold tracking-wide ${
                  role === "admin"
                    ? "bg-primary/12 text-primary border border-primary/20"
                    : "bg-secondary text-muted-foreground border border-border"
                }`}>
                  {role === "admin" ? "ADMIN" : "VENDEDOR"}
                </span>
                <button onClick={signOut} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-200">
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <button onClick={signOut} className="w-full flex justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-all duration-200 p-2">
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </SidebarContent>
    </Sidebar>
  );
}
