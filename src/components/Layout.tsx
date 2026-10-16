import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function Layout({ children }: { children: ReactNode }) {
  const { user, isAdmin, asUser, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Package Returns</div>
        <nav>
          {user && <Link to="/customers">Customers</Link>}
          {isAdmin && <Link to="/campaigns">Campaigns</Link>}
        </nav>
        <div className="spacer" />
        {user && (
          <div className="who">
            <span>{user.email}</span>
            <span className={`badge role-${user.role}`}>{user.role}</span>
            {asUser && <span className="chip">user view</span>}
            <Link to="/account/password">Change password</Link>
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
