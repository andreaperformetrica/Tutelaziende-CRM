import { HttpError } from "./errori";

interface SchemaLike<T> {
  safeParse(
    dati: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
}

/** Valida con uno schema zod generato dalla specifica; in caso di errore risponde 400. */
export function valida<T>(schema: SchemaLike<T>, dati: unknown): T {
  const esito = schema.safeParse(dati);
  if (esito.success) return esito.data;
  const primo = esito.error.issues[0];
  const campo = primo?.path.length ? String(primo.path[primo.path.length - 1]) : undefined;
  throw new HttpError(400, `Dati non validi${campo ? ` (campo "${campo}")` : ""}.`, "DATI_NON_VALIDI", campo);
}
