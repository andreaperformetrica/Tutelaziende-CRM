/** Caricamento di file verso l'API (corpo binario, fuori dal client generato) e link di download. */
const BASE = `${import.meta.env.BASE_URL}api`;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
/** Per i documenti delle pratiche sono ammessi solo PDF e immagini. */
export const FORMATI_DOCUMENTI = ".pdf,.png,.jpg,.jpeg";
export const FORMATI_FILE = ".pdf,.doc,.docx,.xls,.xlsx,.odt,.ods,.rtf,.txt,.png,.jpg,.jpeg";

export class ErroreUpload extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

export function messaggioErrore(err: unknown, fallback = "Si è verificato un errore. Riprova."): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export async function inviaFile<T>(metodo: "POST" | "PUT", percorso: string, query: Record<string, string | number>, file: File): Promise<T> {
  if (file.size === 0) throw new ErroreUpload("Il file selezionato è vuoto.");
  if (file.size > MAX_FILE_BYTES) throw new ErroreUpload("Il file supera la dimensione massima di 15 MB.", "FILE_TROPPO_GRANDE");
  const qs = new URLSearchParams(Object.entries({ ...query, nomeFile: file.name }).map(([k, v]) => [k, String(v)]));
  let res: Response;
  try {
    res = await fetch(`${BASE}${percorso}?${qs.toString()}`, {
      method: metodo,
      credentials: "include",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
  } catch {
    throw new ErroreUpload("Impossibile contattare il server. Controlla la connessione e riprova.");
  }
  if (!res.ok) {
    let d: { error?: string; code?: string } | null = null;
    try { d = await res.json(); } catch { /* risposta non JSON */ }
    throw new ErroreUpload(d?.error ?? (res.status === 403 ? "Non hai i permessi per eseguire questa operazione." : "Caricamento non riuscito. Riprova."), d?.code);
  }
  return (await res.json()) as T;
}

export const urlModulo = (id: number) => `${BASE}/moduli-tipo/${id}/file`;
export const urlMandato = (id: number) => `${BASE}/mandati/${id}/file`;

export const urlMandatoPratica = (praticaId: number) => `${BASE}/pratiche/${praticaId}/mandato/file`;
export const urlDocumentoPratica = (praticaId: number, docId: number) => `${BASE}/pratiche/${praticaId}/documenti/${docId}/file`;

export const urlDocumentoBackoffice = (praticaId: number, docId: number, anteprima = false) =>
  `${BASE}/backoffice/pratiche/${praticaId}/documenti/${docId}/file${anteprima ? "?anteprima=1" : ""}`;
export const urlMandatoBackoffice = (praticaId: number, anteprima = false) =>
  `${BASE}/backoffice/pratiche/${praticaId}/mandato/file${anteprima ? "?anteprima=1" : ""}`;

export function formatoDimensione(byte: number): string {
  if (byte < 1024) return `${byte} B`;
  if (byte < 1024 * 1024) return `${(byte / 1024).toFixed(0)} KB`;
  return `${(byte / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
