import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { LanguageSwitch } from "./LanguageSwitch";

export function Layout({ children }: { children: ReactNode }) {
  const { user, isAdmin, asUser, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">{t("header.brand")}</div>
        <nav>
          {user && <Link to="/customers">{t("nav.customers")}</Link>}
          {isAdmin && <Link to="/campaigns">{t("nav.campaigns")}</Link>}
          {isAdmin && <Link to="/users">{t("nav.users")}</Link>}
          {isAdmin && <Link to="/translations">{t("nav.translations")}</Link>}
        </nav>
        <div className="spacer" />
        {user && (
          <div className="who">
            <span>{user.email}</span>
            <span className={`badge role-${user.role}`}>
              {t(user.role === "superadmin" ? "header.roleSuperadmin" : "header.roleUser")}
            </span>
            {asUser && <span className="chip">{t("header.userView")}</span>}
            <LanguageSwitch />
            <button
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              {t("header.logout")}
            </button>
          </div>
        )}
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
