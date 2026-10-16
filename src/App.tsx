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
import { AccountsPage } from "./pages/AccountsPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

/** The company-wide reports, and the admin screens. An operator is sent to their customers instead. */
function SuperAdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/customers" replace />;
  return <>{children}</>;
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
      {/* Every role lands on the customers: it is the one screen both of them use. */}
      <Route path="/" element={<Navigate to="/customers" replace />} />
      <Route
        path="/customers"
        element={
          <Protected>
            <CustomersPage />
          </Protected>
        }
      />
      {/* A customer's accounts, on their own page: the *Users* button on a customer's row lands here. */}
      <Route
        path="/customers/:id/accounts"
        element={
          <Protected>
            <SuperAdminOnly>
              <AccountsPage />
            </SuperAdminOnly>
          </Protected>
        }
      />
      {/* Changing your own password: a plain setting, so both roles have it. */}
      <Route
        path="/account/password"
        element={
          <Protected>
            <ChangePasswordPage />
          </Protected>
        }
      />
      <Route path="/superadmin/customers" element={<Navigate to="/customers" replace />} />
      <Route
        path="/campaigns"
        element={
          <Protected>
            <CampaignsPage />
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
