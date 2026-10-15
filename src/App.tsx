import type { ReactNode } from "react";
import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
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

/** The company-wide reports, and the admin screens. An operator is sent to their customers instead. */
function SuperAdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "superadmin") return <Navigate to="/customers" replace />;
  return <>{children}</>;
}

/** An operator starts at the customers; a super-admin still starts at the campaigns. */
function Home() {
  const { user } = useAuth();
  if (user?.role !== "superadmin") return <Navigate to="/customers" replace />;
  return <CampaignsPage />;
}

/**
 * The returns screen used to live at `/returns`, behind a customer and campaign picker. A link that
 * still names a campaign leads to that campaign's own screen; one that does not goes to the customers.
 */
function LegacyReturns() {
  const [params] = useSearchParams();
  const campaign = params.get("campaign");
  return <Navigate to={campaign ? `/campaigns/${campaign}/returns` : "/customers"} replace />;
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
            <Home />
          </Protected>
        }
      />
      <Route
        path="/customers"
        element={
          <Protected>
            <CustomersPage />
          </Protected>
        }
      />
      <Route path="/superadmin/customers" element={<Navigate to="/customers" replace />} />
      <Route
        path="/campaigns/:id"
        element={
          <Protected>
            <CampaignDetailPage />
          </Protected>
        }
      />
      <Route
        path="/campaigns/:id/returns"
        element={
          <Protected>
            <ReturnsPage />
          </Protected>
        }
      />
      <Route
        path="/returns"
        element={
          <Protected>
            <LegacyReturns />
          </Protected>
        }
      />
      <Route
        path="/returns/recent"
        element={
          <Protected>
            <SuperAdminOnly>
              <RecentReturnsPage />
            </SuperAdminOnly>
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
