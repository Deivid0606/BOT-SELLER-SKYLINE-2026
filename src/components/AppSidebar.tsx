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

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { user, role, signOut } = useAuth();

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarContent className="bg-sidebar">
        {!collapsed && (
          <div className="px-5 py-5 border-b border-sidebar-border">
            <h1 className="text-xl font-bold font-heading text-gradient tracking-tight">
              SELLER SKYLINE
            </h1>
          </div>
        )}
        {collapsed && (
          <div className="px-2 py-4 border-b border-sidebar-border flex justify-center">
            <span className="text-gradient font-bold text-lg">SS</span>
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const active = location.pathname === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${
                          active
                            ? "bg-primary/10 text-primary border border-primary/20"
                            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground border border-transparent"
                        }`}
                        activeClassName=""
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && (
                          <>
                            <span className="flex-1 truncate">{item.title}</span>
                            {item.badge && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
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

        {/* User info + logout */}
        <div className="mt-auto border-t border-sidebar-border p-3">
          {!collapsed ? (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  role === "admin"
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "bg-secondary text-muted-foreground border border-border"
                }`}>
                  {role === "admin" ? "Admin" : "Vendedor"}
                </span>
                <button onClick={signOut} className="text-muted-foreground hover:text-destructive transition-colors p-1">
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <button onClick={signOut} className="w-full flex justify-center text-muted-foreground hover:text-destructive transition-colors p-1">
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </SidebarContent>
    </Sidebar>
  );
}
