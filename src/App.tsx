import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { CampaignsPage } from "./pages/CampaignsPage";
import { CampaignDetailPage } from "./pages/CampaignDetailPage";
import { ReturnsPage } from "./pages/ReturnsPage";
import { RecentReturnsPage } from "./pages/RecentReturnsPage";
import { CustomersPage } from "./pages/CustomersPage";

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function SuperAdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "superadmin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <CampaignsPage />
          </Protected>
        }
      />
      <Route
        path="/campaigns/:id"
        element={
          <Protected>
            <CampaignDetailPage />
          </Protected>
        }
      />
      <Route
        path="/returns"
        element={
          <Protected>
            <ReturnsPage />
          </Protected>
        }
      />
      <Route
        path="/returns/recent"
        element={
          <Protected>
            <RecentReturnsPage />
          </Protected>
        }
      />
      <Route
        path="/superadmin/customers"
        element={
          <Protected>
            <SuperAdminOnly>
              <CustomersPage />
            </SuperAdminOnly>
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
