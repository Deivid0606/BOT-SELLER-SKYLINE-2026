import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet } from "react-router-dom";

export default function AppLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center border-b border-border/50 glass sticky top-0 z-50 px-5 gap-4">
            <SidebarTrigger className="hover:bg-secondary/80 rounded-lg transition-colors" />
            <div className="flex items-center gap-2.5 ml-auto">
              <div className="relative">
                <div className="h-2 w-2 rounded-full bg-success" />
                <div className="absolute inset-0 h-2 w-2 rounded-full bg-success animate-ping opacity-40" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">En línea</span>
            </div>
          </header>
          <main className="flex-1 p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
