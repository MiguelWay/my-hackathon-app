import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";

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
  /** A super-admin has dropped into the user's view. */
  asUser: boolean;
  /** May render the admin controls: a super-admin, and not currently in the user's view. */
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (customerName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Sends a super-admin into the user's view. Only a fresh login brings them back out. */
  enterUserView: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

// The user's view is a *view*, not a permission: the account stays a super-admin and the API still
// allows it everything. It survives navigation and a reload, and is cleared only by a fresh login.
const VIEW_KEY = "pkgreturns.asUser";

export function AuthProvider({ children }: { children: ReactNode }) {
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

  const login = async (email: string, password: string) => {
    const me = await api.post<User>("/auth/login", { email, password });
    setView(false);
    setUser(me);
  };

  const register = async (customerName: string, email: string, password: string) => {
    const me = await api.post<User>("/auth/register", { customerName, email, password });
    setView(false);
    setUser(me);
  };

  const logout = async () => {
    await api.post("/auth/logout");
    setView(false);
    setUser(null);
  };

  const isAdmin = user?.role === "superadmin" && !asUser;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        asUser,
        isAdmin,
        login,
        register,
        logout,
        enterUserView: () => setView(true),
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
