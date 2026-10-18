import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useIdleLogout } from "../lib/idle";

export type Role = "superadmin" | "user";

export interface User {
  id: number;
  email: string;
  role: Role;
  customerId: number | null;
}

interface AuthValue {
  user: User | null;
  loading: boolean;
  /** A super-admin has entered the operator's view instead of the administrator's. */
  asUser: boolean;
  /** May render the admin controls: a super-admin, and not currently in the operator's view. */
  isAdmin: boolean;
  /**
   * Logs in through one of the login screen's two doors. `asOperator` picks the *view*, never the
   * role: the account's own role always wins, and an operator account may only enter the operator's
   * view — asking for the administrator's door is refused, with the reason, rather than quietly
   * landing somewhere else.
   */
  login: (email: string, password: string, asOperator?: boolean) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

// The user's view is a *view*, not a permission: the account stays a super-admin and the API still
// allows it everything. It survives navigation and a reload, and is cleared only by a fresh login.
const VIEW_KEY = "pkgreturns.asUser";

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [asUser, setAsUser] = useState(() => sessionStorage.getItem(VIEW_KEY) === "1");

  function setView(on: boolean) {
    setAsUser(on);
    if (on) sessionStorage.setItem(VIEW_KEY, "1");
    else sessionStorage.removeItem(VIEW_KEY);
  }

  useEffect(() => {
    api
      .get<User>("/auth/me")
      .then((me) => {
        setUser(me);
        // A `user` role is always in the user's view; only a super-admin can be outside it.
        if (me.role !== "superadmin") setView(false);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Any authenticated request that comes back 401 means the session is gone — expired, or idle too
  // long. Leave the protected screen instead of showing an error on top of stale data.
  useEffect(() => {
    const expired = () => {
      setView(false);
      setUser(null);
      navigate("/login?timeout=1", { replace: true });
    };
    window.addEventListener("auth:expired", expired);
    return () => window.removeEventListener("auth:expired", expired);
  }, [navigate]);

  const login = async (email: string, password: string, asOperator = false) => {
    const me = await api.post<User>("/auth/login", { email, password });
    // The account decides the role; the door only decides the view. An operator account has no
    // administrator view to enter, so that door is refused rather than quietly downgraded — the person
    // is told which door is theirs instead of landing somewhere they did not ask for. The session made
    // by that attempt is dropped again straight away.
    if (me.role !== "superadmin" && !asOperator) {
      await api.post("/auth/logout").catch(() => undefined);
      throw new Error('This is an operator account — use "Enter as operator".');
    }
    // A super-admin enters whichever view they asked for; an operator is always in the operator's.
    setView(asOperator || me.role !== "superadmin");
    setUser(me);
  };

  const logout = async () => {
    await api.post("/auth/logout");
    setView(false);
    setUser(null);
  };

  // Thirty minutes without a click, key or scroll — in any tab — signs out. The server enforces the
  // same window, so this only makes the moment visible rather than letting the screen sit on data.
  useIdleLogout(user !== null, () => {
    void api.post("/auth/logout").catch(() => undefined);
    setView(false);
    setUser(null);
    navigate("/login?timeout=1", { replace: true });
  });

  const isAdmin = user?.role === "superadmin" && !asUser;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        asUser,
        isAdmin,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
