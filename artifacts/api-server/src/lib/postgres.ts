/** Estrae il codice di errore PostgreSQL (es. 23505 = violazione di univocita') da un errore Drizzle/pg. */
export function codiceErrorePg(err: unknown): { code?: string; constraint?: string } {
  let corrente: unknown = err;
  for (let i = 0; i < 4 && corrente; i++) {
    if (typeof corrente === "object" && "code" in corrente && typeof (corrente as { code: unknown }).code === "string") {
      const e = corrente as { code: string; constraint?: string };
      return { code: e.code, constraint: e.constraint };
    }
    corrente = typeof corrente === "object" ? (corrente as { cause?: unknown }).cause : undefined;
  }
  return {};
}
