export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly campo?: string,
    /** Campi aggiuntivi inclusi nella risposta di errore (es. assistitoId). */
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const nonAutenticato = () => new HttpError(401, "Accesso richiesto. Effettua il login.", "NON_AUTENTICATO");
export const nonAutorizzato = (msg = "Non hai i permessi per eseguire questa operazione.") =>
  new HttpError(403, msg, "NON_AUTORIZZATO");
export const nonTrovato = (msg: string) => new HttpError(404, msg, "NON_TROVATO");
