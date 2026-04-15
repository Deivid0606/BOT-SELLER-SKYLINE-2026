import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShieldAlert, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

type ProfileStatus = {
  approved: boolean;
  active: boolean;
  active_from: string | null;
  active_until: string | null;
  inactive_message: string | null;
};

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, role, loading, signOut } = useAuth();
  const [profileStatus, setProfileStatus] = useState<ProfileStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setStatusLoading(false);
      return;
    }
    supabase
      .from("profiles")
      .select("approved, active, active_from, active_until, inactive_message")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setProfileStatus(data as unknown as ProfileStatus);
        }
        setStatusLoading(false);
      });
  }, [user]);

  if (loading || statusLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Admins always have access
  if (role === "admin") {
    return <>{children}</>;
  }

  // Check if user is blocked
  if (profileStatus) {
    const now = new Date();
    const today = now.toISOString().split("T")[0];

    const isNotApproved = !profileStatus.approved;
    const isInactive = !profileStatus.active;
    const isBeforeStart = profileStatus.active_from && today < profileStatus.active_from;
    const isAfterEnd = profileStatus.active_until && today > profileStatus.active_until;

    const blocked = isNotApproved || isInactive || isBeforeStart || isAfterEnd;

    if (blocked) {
      const defaultMessage = isNotApproved
        ? "Tu cuenta está pendiente de aprobación por el administrador. Por favor, espera a que se apruebe tu acceso."
        : "Tu cuenta se encuentra temporalmente inactiva. Contacta al administrador para más información.";

      const message = profileStatus.inactive_message || defaultMessage;

      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-card border border-border rounded-2xl p-8 text-center space-y-6">
            <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <ShieldAlert className="h-8 w-8 text-destructive" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold font-heading">Acceso restringido</h2>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                {message}
              </p>
            </div>
            {(profileStatus.active_from || profileStatus.active_until) && !isNotApproved && (
              <div className="text-xs text-muted-foreground bg-secondary/50 rounded-lg p-3">
                {profileStatus.active_from && <span>Desde: {profileStatus.active_from}</span>}
                {profileStatus.active_from && profileStatus.active_until && <span> · </span>}
                {profileStatus.active_until && <span>Hasta: {profileStatus.active_until}</span>}
              </div>
            )}
            <Button variant="outline" onClick={signOut} className="gap-2">
              <LogOut className="h-4 w-4" /> Cerrar sesión
            </Button>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}
