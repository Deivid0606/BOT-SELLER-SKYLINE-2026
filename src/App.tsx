import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import AuthPage from "@/pages/AuthPage";
import DashboardPage from "@/pages/DashboardPage";
import ChatPage from "@/pages/ChatPage";
import InboxPage from "@/pages/InboxPage";
import MessagesPage from "@/pages/MessagesPage";
import OrdersPage from "@/pages/OrdersPage";
import TemplatesPage from "@/pages/TemplatesPage";
import TriggersV2Page from "@/pages/TriggersV2Page";
import TagsPage from "@/pages/TagsPage";
import TrainingPage from "@/pages/TrainingPage";
import SettingsPage from "@/pages/SettingsPage";
import NotificationsPage from "@/pages/NotificationsPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="/mensajes" element={<MessagesPage />} />
              <Route path="/pedidos" element={<OrdersPage />} />
              <Route path="/plantillas" element={<TemplatesPage />} />
              <Route path="/disparadores" element={<TriggersV2Page />} />
              <Route path="/etiquetas" element={<TagsPage />} />
              <Route path="/entrenamiento" element={<TrainingPage />} />
              <Route path="/configuracion" element={<SettingsPage />} />
              <Route path="/notificaciones" element={<NotificationsPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
