import type { Request } from "express";
import { db, logOperazioniTable } from "@workspace/db";

/** Qualsiasi connessione o transazione Drizzle: il log si scrive nella stessa transazione dell'operazione. */
export type Transazione = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Transazione;

/** Catalogo delle azioni registrate. Ogni nuova funzione deve aggiungere qui le proprie azioni. */
export const AZIONI_LOG = {
  "auth.login": "Accesso",
  "auth.login_fallito": "Accesso non riuscito",
  "auth.logout": "Uscita",
  "auth.cambio_password": "Cambio password",
  "utente.crea": "Creazione utente interno",
  "utente.modifica": "Modifica utente interno",
  "utente.password_provvisoria": "Password provvisoria utente",
  "collaboratore.crea": "Creazione collaboratore",
  "collaboratore.modifica": "Modifica collaboratore",
  "collaboratore.disattiva": "Disattivazione collaboratore",
  "collaboratore.riattiva": "Riattivazione collaboratore",
  "collaboratore.capogruppo": "Assegnazione capogruppo",
  "collaboratore.password_provvisoria": "Password provvisoria collaboratore",
  "assistito.crea": "Creazione assistito",
  "assistito.modifica": "Modifica assistito",
  "assistito.riassegna": "Cambio collaboratore di un assistito",
  "assistito.duplicato_segnalato": "Tentativo di inserire un assistito gia presente",
  "segnalazione.associa": "Segnalazione chiusa con associazione",
  "segnalazione.archivia": "Segnalazione archiviata",
  "tipo_pratica.crea": "Creazione tipo di pratica",
  "tipo_pratica.modifica": "Modifica tipo di pratica",
  "documento_tipo.crea": "Aggiunta documento obbligatorio",
  "documento_tipo.modifica": "Modifica documento obbligatorio",
  "documento_tipo.elimina": "Eliminazione documento obbligatorio",
  "documento_tipo.ordina": "Riordino documenti obbligatori",
  "modulo_tipo.carica": "Caricamento modulo",
  "modulo_tipo.sostituisci": "Sostituzione file di un modulo",
  "modulo_tipo.rinomina": "Modifica nome di un modulo",
  "modulo_tipo.elimina": "Eliminazione modulo",
  "mandato.carica": "Caricamento mandato",
  "mandato.sostituisci": "Sostituzione file di un mandato",
  "mandato.rinomina": "Modifica nome di un mandato",
  "mandato.elimina": "Eliminazione mandato",
  "mandato.assegna": "Assegnazione mandato a un collaboratore",
  "mandato.rimuovi": "Rimozione mandato da un collaboratore",
  "stato_pratica.crea": "Creazione stato pratica",
  "stato_pratica.modifica": "Modifica stato pratica",
  "stato_pratica.elimina": "Eliminazione stato pratica",
  "stato_pratica.ordina": "Riordino stati pratica",
  "orari.modifica": "Modifica orari di caricamento",
} as const;

export type AzioneLog = keyof typeof AZIONI_LOG;

export function etichettaAzione(codice: string): string {
  return (AZIONI_LOG as Record<string, string>)[codice] ?? codice;
}

export interface ContestoLog {
  utente: { id: number; nome: string; ruolo: string } | null;
  ip: string | null;
}

export function contestoDa(req: Request): ContestoLog {
  const u = req.utente;
  return {
    utente: u ? { id: u.id, nome: `${u.nome} ${u.cognome}`, ruolo: u.ruolo } : null,
    ip: req.ip ?? null,
  };
}

export interface VoceLog {
  azione: AzioneLog;
  entita?: string;
  entitaId?: number;
  descrizione: string;
  dettagli?: Record<string, unknown>;
}

/** Scrive una riga di log. Non registrare mai password o altri segreti in descrizione/dettagli. */
export async function registraLog(executor: Executor, contesto: ContestoLog, voce: VoceLog): Promise<void> {
  await executor.insert(logOperazioniTable).values({
    utenteId: contesto.utente?.id ?? null,
    utenteNome: contesto.utente?.nome ?? null,
    ruolo: contesto.utente?.ruolo ?? null,
    azione: voce.azione,
    entita: voce.entita ?? null,
    entitaId: voce.entitaId ?? null,
    descrizione: voce.descrizione,
    dettagli: voce.dettagli ?? null,
    ip: contesto.ip,
  });
}

/** Confronta due oggetti sui campi indicati e restituisce solo le differenze (prima/dopo) con etichette italiane. */
export function differenze<T extends Record<string, unknown>>(
  prima: T,
  dopo: T,
  campi: Record<string, string>,
): { elenco: string[]; prima: Record<string, unknown>; dopo: Record<string, unknown> } {
  const elenco: string[] = [];
  const p: Record<string, unknown> = {};
  const d: Record<string, unknown> = {};
  for (const [campo, etichetta] of Object.entries(campi)) {
    if (prima[campo] !== dopo[campo]) {
      elenco.push(etichetta);
      p[campo] = prima[campo] ?? null;
      d[campo] = dopo[campo] ?? null;
    }
  }
  return { elenco, prima: p, dopo: d };
}
