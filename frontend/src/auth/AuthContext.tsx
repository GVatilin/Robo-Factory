import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, ApiError, getToken, setToken, setUnauthorizedHandler } from "../api/client";
import type { Permission, Role, TokenResponse, User } from "../api/types";

/** Права гостя — запрос без токена (зеркало app/core/permissions.py). */
const GUEST_PERMISSIONS: Permission[] = ["catalog:read"];

export interface RegisterData {
  email: string;
  password: string;
  full_name: string | null;
  organization: string | null;
}

interface AuthState {
  user: User | null;
  role: Role;
  /** Идёт проверка сохранённого токена при загрузке страницы. */
  loading: boolean;
  can: (...permissions: Permission[]) => boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: RegisterData) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => getToken() !== null);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) return;
    try {
      setUser(await api<User>("/auth/me"));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) logout();
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    void refresh();
    return () => setUnauthorizedHandler(null);
  }, [logout, refresh]);

  const accept = useCallback((response: TokenResponse) => {
    setToken(response.access_token);
    setUser(response.user);
    return response.user;
  }, []);

  const login = useCallback(
    async (email: string, password: string) =>
      accept(await api<TokenResponse>("/auth/login", { method: "POST", form: { username: email, password } })),
    [accept],
  );

  const register = useCallback(
    async (data: RegisterData) => accept(await api<TokenResponse>("/auth/register", { method: "POST", body: data })),
    [accept],
  );

  const value = useMemo<AuthState>(() => {
    const permissions = user?.permissions ?? GUEST_PERMISSIONS;
    return {
      user,
      role: user?.role ?? "guest",
      loading,
      can: (...required) => required.some((p) => permissions.includes(p)),
      login,
      register,
      logout,
      refresh,
    };
  }, [user, loading, login, register, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth вызывается вне AuthProvider");
  return context;
}

export const ROLE_LABELS: Record<Role, string> = {
  guest: "Гость",
  user: "Пользователь",
  vendor: "Вендор",
  admin: "Администратор",
};
