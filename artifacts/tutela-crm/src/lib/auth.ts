import { ApiError, getGetSessioneQueryKey, useGetSessione } from "@workspace/api-client-react";

export function useSession() {
  const q = useGetSessione({
    query: { queryKey: getGetSessioneQueryKey(), retry: false, staleTime: 60_000, refetchOnWindowFocus: false },
  });
  const unauth = q.error instanceof ApiError && q.error.status === 401;
  return {
    session: q.data ?? null,
    isLoading: q.isLoading,
    failed: !!q.error && !unauth,
    refetch: q.refetch,
  };
}
export const homeFor = (area?: string) => (area === "collaboratore" ? "/collaboratore" : "/admin/dashboard");

/** Pagina richiesta prima del login (per esempio da un link in un'email): si torna lì dopo l'accesso. Solo percorsi interni all'app. */
export function paginaDiRitorno(): string | null {
  const r = new URLSearchParams(window.location.search).get("ritorno");
  if (!r || !r.startsWith("/") || r.startsWith("//") || r.startsWith("/login") || r.includes("\\")) return null;
  return r;
}
