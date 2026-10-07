import { ApiError } from "@workspace/api-client-react";

export function fmtData(s?: string | null): string {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

export function fmtIstante(iso?: string | null, secondi = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: secondi ? "2-digit" : undefined, hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}${secondi ? ":" + g("second") : ""}`;
}

export function fmtCellulare(c?: string | null): string {
  if (!c) return "—";
  const m = /^\+39(\d{3})(\d{3,4})(\d{0,4})$/.exec(c);
  if (m) return `+39 ${m[1]} ${m[2]}${m[3] ? " " + m[3] : ""}`;
  return c;
}

export const RUOLI: Record<string, string> = {
  super_admin: "Super amministratore",
  admin: "Amministratore",
  operatore: "Operatore",
  collaboratore: "Collaboratore",
};
export const ruoloLabel = (r?: string | null) => (r ? RUOLI[r] ?? r : "—");
export const tipologiaLabel = (t?: string | null) => (t === "CAF" ? "CAF" : t === "PATRONATO" ? "Patronato" : "—");

export interface ParsedError { message: string; code?: string; campo?: string; status?: number }
export function parseApiError(err: unknown): ParsedError {
  if (err instanceof ApiError) {
    const d = err.data as { error?: string; code?: string; campo?: string } | null;
    const fallback =
      err.status === 429 ? "Troppi tentativi. Attendi qualche minuto e riprova."
      : err.status === 403 ? "Non hai i permessi per eseguire questa operazione."
      : "Si è verificato un errore. Riprova.";
    return { message: d?.error ?? fallback, code: d?.code, campo: d?.campo, status: err.status };
  }
  return { message: "Impossibile contattare il server. Controlla la connessione e riprova." };
}

export function iniziali(nome?: string, cognome?: string) {
  return `${(nome ?? "").charAt(0)}${(cognome ?? "").charAt(0)}`.toUpperCase();
}

export function generaPassword(len = 12): string {
  const set = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => set[n % set.length]).join("");
}

export function fmtEuro(n: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

/** Solo la data (gg/mm/aaaa) di un istante, nel fuso Europe/Rome. */
export function fmtDataIstante(iso?: string | null): string {
  const s = fmtIstante(iso);
  return s.includes(" ") ? s.split(" ")[0]! : s;
}
