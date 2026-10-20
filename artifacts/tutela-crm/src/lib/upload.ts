/** Caricamento di file verso l'API (corpo binario, fuori dal client generato) e link di download. */
import { toast } from "@/hooks/use-toast";
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
export const urlModuloPratica = (praticaId: number, moduloId: number) => `${BASE}/pratiche/${praticaId}/moduli/${moduloId}/file`;
export const urlAllegatoNewsBackoffice = (newsId: number, allegatoId: number) => `${BASE}/backoffice/news/${newsId}/allegati/${allegatoId}/file`;
export const urlAllegatoNews = (newsId: number, allegatoId: number) => `${BASE}/news/${newsId}/allegati/${allegatoId}/file`;
export const urlMandato = (id: number) => `${BASE}/mandati/${id}/file`;

export const urlMandatoPratica = (praticaId: number) => `${BASE}/pratiche/${praticaId}/mandato/file`;
export const urlDocumentoPratica = (praticaId: number, docId: number) => `${BASE}/pratiche/${praticaId}/documenti/${docId}/file`;

export const urlDocumentoBackoffice = (praticaId: number, docId: number, anteprima = false) =>
  `${BASE}/backoffice/pratiche/${praticaId}/documenti/${docId}/file${anteprima ? "?anteprima=1" : ""}`;
export const urlDocumentiZipBackoffice = (praticaId: number) => `${BASE}/backoffice/pratiche/${praticaId}/documenti.zip`;
export const urlEsportaPraticheBackoffice = (params: Record<string, string | number | boolean | undefined>) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && k !== "pagina" && k !== "perPagina") qs.set(k, String(v));
  return `${BASE}/backoffice/pratiche/esporta?${qs.toString()}`;
};
export const urlMandatoBackoffice = (praticaId: number, anteprima = false) =>
  `${BASE}/backoffice/pratiche/${praticaId}/mandato/file${anteprima ? "?anteprima=1" : ""}`;

export function formatoDimensione(byte: number): string {
  if (byte < 1024) return `${byte} B`;
  if (byte < 1024 * 1024) return `${(byte / 1024).toFixed(0)} KB`;
  return `${(byte / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export const urlQuestionarioBackoffice = (eventoId: number) => `${BASE}/backoffice/eventi/${eventoId}/questionario/file`;
export const urlQuestionarioSede = (eventoId: number) => `${BASE}/eventi/${eventoId}/questionario/file`;
/** `versione` cambia quando cambiano i dati dell'evento, cosi' l'anteprima non resta quella in cache. */
export const FORMATI_DOCUMENTI_CORSO = ".pdf,.ppt,.pptx,.odp,.doc,.docx,.xls,.xlsx,.odt,.ods,.rtf,.txt,.png,.jpg,.jpeg";
export const urlDocumentoEvento = (eventoId: number, documentoId: number) => `${BASE}/backoffice/eventi/${eventoId}/documenti/${documentoId}/file`;
export const urlAnteprimaAttestato = (eventoId: number, versione: string) =>
  `${BASE}/backoffice/eventi/${eventoId}/attestato/anteprima?v=${encodeURIComponent(versione)}`;
export const urlAttestatoPartecipante = (eventoId: number, partecipanteId: number) => `${BASE}/backoffice/eventi/${eventoId}/attestato/partecipanti/${partecipanteId}`;
export const urlAttestatiPresenti = (eventoId: number) => `${BASE}/backoffice/eventi/${eventoId}/attestato/presenti`;

export const urlEstrattoPdf = (id: number) => `${BASE}/backoffice/compensi/estratti/${id}/pdf`;
export const urlDareAverePdf = (collaboratoreId: number, anno: number) => `${BASE}/backoffice/compensi/dare-avere/pdf?collaboratoreId=${collaboratoreId}&anno=${anno}`;
export const urlLogoStampa = (versione: string = "") => `${BASE}/backoffice/compensi/impostazioni-stampa/logo?v=${encodeURIComponent(versione)}`;
export const urlEsportaStatisticheOperatori = (dal: string, al: string) => `${BASE}/backoffice/statistiche-operatori/esporta?${new URLSearchParams({ dal, al }).toString()}`;
export const urlAllegatoPagamentoEstratto = (id: number, anteprima = false) => `${BASE}/backoffice/compensi/estratti/${id}/pagamento/allegato/file${anteprima ? "?anteprima=1" : ""}`;
export const urlRicevutaPdf = (id: number) => `${BASE}/backoffice/ricevute/${id}/pdf`;
export const urlAllegatoRicevuta = (id: number, anteprima = false) => `${BASE}/backoffice/ricevute/${id}/allegato/file${anteprima ? "?anteprima=1" : ""}`;

/**
 * Apre un file riservato (PDF, allegato) in una nuova scheda. Nell'anteprima di Replit il cookie di sessione
 * non viene inviato a una scheda aperta con un semplice link, quindi il file si scarica da qui, con la sessione, e
 * la nuova scheda mostra la copia scaricata. Si apre la scheda subito (prima del download) per non farla bloccare dal browser.
 */
export function apriFile(e: { preventDefault: () => void }, url: string): void {
  e.preventDefault();
  const scheda = window.open("", "_blank");
  fetch(url, { credentials: "include" })
    .then(async (res) => {
      if (!res.ok) {
        let d: { error?: string } | null = null;
        try { d = await res.json(); } catch { /* risposta non JSON */ }
        throw new Error(d?.error ?? "Non è stato possibile aprire il file.");
      }
      const blob = await res.blob();
      const indirizzo = URL.createObjectURL(blob);
      if (scheda) scheda.location.href = indirizzo;
      else window.location.href = indirizzo;
      setTimeout(() => URL.revokeObjectURL(indirizzo), 10 * 60 * 1000);
    })
    .catch((err: unknown) => {
      scheda?.close();
      toast({ title: "File non disponibile", description: messaggioErrore(err, "Non è stato possibile aprire il file."), variant: "destructive" });
    });
}
