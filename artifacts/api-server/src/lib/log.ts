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
  "collaboratore.rimosso_dal_gruppo": "Collaboratore tolto dal gruppo",
  "collaboratore.ruolo_capogruppo": "Ruolo di capogruppo",
  "collaboratore.password_provvisoria": "Password provvisoria collaboratore",
  "collaboratore.reinvia_credenziali": "Reinvio credenziali al collaboratore",
  "collaboratore.elimina": "Eliminazione collaboratore",
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
  "mandato.collega_provincia": "Mandato collegato a una provincia",
  "mandato.firma_richiesta": "Codice SMS richiesto per firmare il mandato",
  "mandato.firma": "Mandato firmato con codice SMS",
  "news.crea": "Creazione notizia",
  "news.modifica": "Modifica notizia",
  "news.elimina": "Eliminazione notizia",
  "news.allegato_aggiungi": "Allegato aggiunto a notizia",
  "news.allegato_elimina": "Allegato eliminato da notizia",
  "stato_pratica.crea": "Creazione stato pratica",
  "stato_pratica.modifica": "Modifica stato pratica",
  "stato_pratica.elimina": "Eliminazione stato pratica",
  "stato_pratica.ordina": "Riordino stati pratica",
  "pratica.crea": "Apertura pratica (bozza)",
  "pratica.messaggio": "Salvataggio messaggio della pratica",
  "pratica.documento_carica": "Caricamento documento di una pratica",
  "pratica.documento_sostituisci": "Sostituzione documento di una pratica in bozza",
  "pratica.documento_elimina": "Eliminazione documento di una pratica in bozza",
  "pratica.allegato_aggiungi": "Aggiunta allegato a una pratica inviata",
  "pratica.elimina_bozza": "Cancellazione pratica in bozza",
  "pratica.invia": "Invio pratica",
  "pratica.commento": "Commento su una pratica",
  "pratica.presa_in_carico": "Presa in carico di una pratica",
  "pratica.cambio_stato": "Cambio di stato di una pratica",
  "pratica.priorita": "Cambio di priorità di una pratica",
  "pratica.documenti_scarica": "Scaricamento di tutti i documenti di una pratica",
  "pratica.esporta": "Esportazione dell'elenco pratiche in Excel",
  "alert.configura": "Impostazione degli alert sui collaboratori",
  "statistiche.esporta": "Esportazione in Excel delle statistiche operatori",
  "chat.messaggio": "Messaggio nella chat interna",
  "notifiche.indirizzo_app": "Indirizzo dell'app nei link delle email",
  "tipo_pratica.scadenza": "Scadenza e anticipo avvisi di un tipo di pratica",
  "pratica.commento_backoffice": "Commento del back office su una pratica",
  "pratica.allegato_backoffice": "Allegato dell'operatore su una pratica",
  "pratica.elimina": "Cancellazione di una pratica",
  "categoria_allegato.crea": "Creazione categoria allegato (funzione rimossa)",
  "categoria_allegato.modifica": "Modifica categoria allegato (funzione rimossa)",
  "categoria_allegato.elimina": "Eliminazione categoria allegato (funzione rimossa)",
  "documento_noto.crea": "Nuovo documento nell'elenco dei documenti noti",
  "compenso_collaboratore.salva": "Eccezione di compenso per un collaboratore",
  "compenso_collaboratore.elimina": "Eccezione di compenso tolta",
  "normativa_tipo.crea": "Link a una normativa aggiunto",
  "normativa_tipo.modifica": "Link a una normativa modificato",
  "normativa_tipo.elimina": "Link a una normativa eliminato",
  "allegato_tipo.crea": "Allegato dell'operatore aggiunto a un tipo di pratica",
  "allegato_tipo.elimina": "Allegato dell'operatore tolto da un tipo di pratica",
  "orari.modifica": "Modifica orari di caricamento",
  "evento.crea": "Creazione evento",
  "evento.modifica": "Modifica evento",
  "evento.elimina": "Eliminazione evento",
  "evento.invita": "Invito di sedi a un evento",
  "evento.invito_rimuovi": "Invito a un evento tolto a una sede",
  "evento.conferma": "Conferma di partecipazione a un evento",
  "evento.partecipante_aggiungi": "Aggiunta partecipante a un evento",
  "evento.partecipante_modifica": "Modifica partecipante di un evento",
  "evento.partecipante_elimina": "Eliminazione partecipante di un evento",
  "evento.check_in": "Check-in di un partecipante",
  "evento.orari_modifica": "Modifica manuale degli orari di un partecipante",
  "evento.questionario_carica": "Caricamento questionario di un evento",
  "evento.questionario_elimina": "Eliminazione questionario di un evento",
  "evento.questionario_domande": "Creazione o modifica delle domande del questionario di un evento",
  "evento.attestato_carica": "Caricamento layout dell'attestato",
  "evento.attestato_elimina": "Eliminazione layout dell'attestato",
  "evento.attestato_posizione": "Modifica posizione del nome sull'attestato",
  "evento.attestato_soglia": "Modifica delle ore minime per l'attestato",
  "evento.presenza": "Entrata o uscita registrata dal back office",
  "evento.documento_carica": "Caricamento documento del corso",
  "evento.documento_elimina": "Eliminazione documento del corso",
  "evento.documenti_invia": "Documenti del corso inviati ai presenti",
  "evento.quiz_salva": "Creazione o modifica del questionario online",
  "evento.quiz_elimina": "Eliminazione del questionario online",
  "evento.quiz_invia": "Questionario online inviato ai partecipanti",
  "evento.quiz_compila": "Questionario online compilato da un partecipante",
  "estratto.crea": "Creazione estratto pratiche chiuse",
  "estratto.elimina": "Eliminazione estratto non pagato",
  "estratto.pagamento": "Pagamento di un estratto",
  "estratto.invia": "Invio estratto al collaboratore",
  "estratto.allegato_pagamento": "Documento allegato al pagamento di un estratto",
  "ricevute.impostazioni_modifica": "Modifica dei dati stampati sulle ricevute",
  "ricevuta.crea": "Creazione ricevuta",
  "ricevuta.elimina": "Eliminazione ricevuta",
  "ricevuta.pagamento": "Pagamento di una ricevuta",
  "ricevuta.allegato": "Documento allegato al pagamento di una ricevuta",
  "compensi.stampa_modifica": "Modifica intestazione e note degli stampati",
  "compensi.logo_carica": "Caricamento logo degli stampati",
  "compensi.logo_elimina": "Eliminazione logo degli stampati",
  "dare_avere.riga_aggiungi": "Aggiunta riga al dare/avere",
  "dare_avere.riga_modifica": "Modifica riga del dare/avere",
  "dare_avere.riga_elimina": "Eliminazione riga del dare/avere",
  "importazione.anteprima": "Caricamento file Excel per anteprima",
  "importazione.scarta": "Anteprima di importazione scartata",
  "importazione.conferma": "Conferma importazione da Excel",
  "importazione.annulla": "Annullamento importazione da Excel",
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
