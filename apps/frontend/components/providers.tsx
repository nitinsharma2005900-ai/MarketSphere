"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
export type User = { id: string; name: string; email: string; role: string };
let accessToken = "";
export const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4040/api/v1";
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const multipart = options.body instanceof FormData;
  const response = await fetch(apiUrl + path, {
    ...options,
    credentials: "include",
    headers: {
      ...(multipart ? {} : { "Content-Type": "application/json" }),
      ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}),
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body.error?.message ?? "Something went wrong. Please try again.",
    );
  return body;
}
export async function action(
  path: string,
  body?: unknown,
  method = "POST",
  idempotent = false,
) {
  return api(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: idempotent
      ? { "Idempotency-Key": crypto.randomUUID() }
      : undefined,
  });
}
const Auth = createContext<{
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: unknown) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
}>({
  user: null,
  ready: false,
  login: async () => {
    throw new Error("Loading");
  },
  register: async () => {
    throw new Error("Loading");
  },
  logout: () => {},
  refresh: async () => {},
});
export const useAuth = () => useContext(Auth);
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 10000, refetchOnWindowFocus: false },
          mutations: { onError: (e) => toast.error(e.message) },
        },
      }),
  );
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false);
  function accept(data: { user: User; accessToken: string }) {
    accessToken = data.accessToken;
    setUser(data.user);
    sessionStorage.setItem("marketsphere-session", JSON.stringify(data));
    client.clear();
    return data.user;
  }
  async function refresh() {
    const result = await api("/auth/refresh", { method: "POST" });
    accept(result.data);
  }
  useEffect(() => {
    const saved = sessionStorage.getItem("marketsphere-session");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        accessToken = data.accessToken;
        setUser(data.user);
        api("/auth/me").catch(() =>
          refresh().catch(() => {
            accessToken = "";
            setUser(null);
            sessionStorage.removeItem("marketsphere-session");
          }),
        );
      } catch {
        sessionStorage.removeItem("marketsphere-session");
      }
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(
      () =>
        refresh().catch(() =>
          toast.error("Your session expired. Please sign in again."),
        ),
      12 * 60000,
    );
    return () => clearInterval(timer);
  }, [user?.id]);
  return (
    <QueryClientProvider client={client}>
      <Auth.Provider
        value={{
          user,
          ready,
          login: async (email, password) =>
            accept((await action("/auth/login", { email, password })).data),
          register: async (data) =>
            accept((await action("/auth/register", data)).data),
          logout: () => {
            void action("/auth/logout").catch(() => {});
            accessToken = "";
            setUser(null);
            sessionStorage.removeItem("marketsphere-session");
            client.clear();
          },
          refresh,
        }}
      >
        {children}
        <Toaster richColors position="bottom-right" />
      </Auth.Provider>
    </QueryClientProvider>
  );
}
