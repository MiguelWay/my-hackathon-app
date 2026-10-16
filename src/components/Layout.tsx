import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function Layout({ children }: { children: ReactNode }) {
  const { user, isAdmin, asUser, enterUserView, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Package Returns</div>
        <nav>
          {user && <Link to="/customers">Customers</Link>}
          {isAdmin && <Link to="/campaigns">Campaigns</Link>}
          {isAdmin && <Link to="/returns/recent">Returned Packages</Link>}
          {/* The way into the user's view: the same pages a `user` gets. A fresh login is the way out. */}
          {isAdmin && (
            <Link to="/customers" onClick={() => enterUserView()}>
              Process returns
            </Link>
          )}
        </nav>
        <div className="spacer" />
        {user && (
          <div className="who">
            <span>{user.email}</span>
            <span className={`badge role-${user.role}`}>{user.role}</span>
            {asUser && <span className="chip">user view</span>}
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
