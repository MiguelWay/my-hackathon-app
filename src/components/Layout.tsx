import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Package Returns</div>
        <nav>
          {user && <Link to="/returns">Packages returns</Link>}
          {user && <Link to="/returns/recent">Recently recorded</Link>}
          {user && <Link to="/">Campaigns</Link>}
          {user?.role === "superadmin" && <Link to="/superadmin/customers">Customers</Link>}
        </nav>
        <div className="spacer" />
        {user && (
          <div className="who">
            <span>{user.email}</span>
            <span className={`badge role-${user.role}`}>{user.role}</span>
            <button
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              Log out
            </button>
          </div>
        )}
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
