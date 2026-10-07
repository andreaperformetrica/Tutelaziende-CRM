import type { Request } from "express";
import { and, asc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  assistitiTable,
  collaboratoriTable,
  db,
  personeTable,
  segnalazioniDuplicatiTable,
  utentiTable,
} from "@workspace/db";
import { HttpError, nonTrovato } from "./errori";
import { contestoDa, registraLog, type Transazione } from "./log";
import { CODICE_ITALIA } from "./luoghi";
import type { AnagraficaNormalizzata } from "./persone";

const personaCollaboratore = alias(personeTable, "persona_collaboratore");

export const colonneAssistito = {
  id: assistitiTable.id,
  personaId: assistitiTable.personaId,
  collaboratoreId: assistitiTable.collaboratoreId,
  citta: assistitiTable.citta,
  indirizzo: assistitiTable.indirizzo,
  creatoIl: assistitiTable.creatoIl,
  modificatoIl: assistitiTable.modificatoIl,
  nome: personeTable.nome,
  cognome: personeTable.cognome,
  sesso: personeTable.sesso,
  dataNascita: personeTable.dataNascita,
  luogoNascitaCodice: personeTable.luogoNascitaCodice,
  luogoNascitaNome: personeTable.luogoNascitaNome,
  luogoNascitaProvincia: personeTable.luogoNascitaProvincia,
  luogoNascitaEstero: personeTable.luogoNascitaEstero,
  nazionalita: personeTable.nazionalita,
  nazionalitaNome: personeTable.nazionalitaNome,
  codiceFiscale: personeTable.codiceFiscale,
  email: personeTable.email,
  cellulare: personeTable.cellulare,
  collNome: personaCollaboratore.nome,
  collCognome: personaCollaboratore.cognome,
  collSportello: collaboratoriTable.numeroSportello,
  collTipologia: collaboratoriTable.tipologia,
  collCapogruppoId: collaboratoriTable.capogruppoId,
};

export type RigaAssistito = Awaited<ReturnType<typeof selezionaAssistiti>>[number];

export function selezionaAssistiti(where: SQL | undefined) {
  return db
    .select(colonneAssistito)
    .from(assistitiTable)
    .innerJoin(personeTable, eq(personeTable.id, assistitiTable.personaId))
    .innerJoin(collaboratoriTable, eq(collaboratoriTable.id, assistitiTable.collaboratoreId))
    .innerJoin(personaCollaboratore, eq(personaCollaboratore.id, collaboratoriTable.personaId))
    .where(where)
    .orderBy(asc(personeTable.cognome), asc(personeTable.nome), asc(assistitiTable.id))
    .$dynamic();
}

export async function contaAssistiti(where: SQL | undefined): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assistitiTable)
    .innerJoin(personeTable, eq(personeTable.id, assistitiTable.personaId))
    .innerJoin(collaboratoriTable, eq(collaboratoriTable.id, assistitiTable.collaboratoreId))
    .where(where);
  return r?.n ?? 0;
}

/** Il collaboratore vede i propri assistiti e, se capogruppo, quelli dei collaboratori del suo gruppo. */
export function condizioneVisibilita(req: Request): SQL | undefined {
  const u = req.utente!;
  if (u.ruolo !== "collaboratore") return undefined;
  const mio = u.collaboratoreId ?? -1;
  return or(eq(assistitiTable.collaboratoreId, mio), eq(collaboratoriTable.capogruppoId, mio));
}

/** Ricerca su nome, cognome, codice fiscale: con piu parole devono corrispondere tutte. */
export function condizioneRicerca(q: string | undefined): SQL | undefined {
  const termini = (q ?? "").trim().split(/\s+/).filter(Boolean);
  if (termini.length === 0) return undefined;
  return and(
    ...termini.map((t) => {
      const like = `%${t.replace(/[%_\\]/g, "\\$&")}%`;
      return or(ilike(personeTable.nome, like), ilike(personeTable.cognome, like), ilike(personeTable.codiceFiscale, like));
    }),
  );
}

export function mappaAssistito(r: RigaAssistito, req: Request) {
  const u = req.utente!;
  return {
    id: r.id,
    nome: r.nome,
    cognome: r.cognome,
    sesso: r.sesso,
    dataNascita: r.dataNascita,
    luogoNascitaCodice: r.luogoNascitaCodice,
    luogoNascitaNome: r.luogoNascitaNome,
    luogoNascitaProvincia: r.luogoNascitaProvincia,
    luogoNascitaEstero: r.luogoNascitaEstero,
    nazionalita: r.nazionalita,
    nazionalitaNome: r.nazionalitaNome,
    straniero: r.nazionalita !== CODICE_ITALIA,
    codiceFiscale: r.codiceFiscale,
    cellulare: r.cellulare,
    email: r.email,
    citta: r.citta,
    indirizzo: r.indirizzo,
    collaboratore: {
      id: r.collaboratoreId,
      nome: r.collNome,
      cognome: r.collCognome,
      numeroSportello: r.collSportello,
      tipologia: r.collTipologia,
    },
    modificabile: u.ruolo === "collaboratore" && u.collaboratoreId === r.collaboratoreId,
    creatoIl: r.creatoIl.toISOString(),
    modificatoIl: r.modificatoIl.toISOString(),
  };
}

/** Scheda di un assistito visibile all'utente; per un collaboratore, uno non visibile e' indistinguibile da uno inesistente. */
export async function caricaAssistitoVisibile(req: Request, id: number): Promise<RigaAssistito> {
  const [r] = await selezionaAssistiti(and(eq(assistitiTable.id, id), condizioneVisibilita(req)));
  if (!r) throw new HttpError(404, "Assistito non trovato.", "NON_TROVATO");
  return r;
}

// ---------------------------------------------------------------------------------------------
// Duplicati
// ---------------------------------------------------------------------------------------------

type CampoDuplicato = "codice_fiscale" | "cellulare";

interface Corrispondenza {
  personaId: number;
  campi: CampoDuplicato[];
  assistitoId: number | null;
  proprietarioId: number | null;
  capogruppoProprietarioId: number | null;
  tipo: "assistito" | "collaboratore";
}

const proprietario = alias(collaboratoriTable, "proprietario");
const comeCollaboratore = alias(collaboratoriTable, "come_collaboratore");

async function trovaCorrispondenze(
  a: AnagraficaNormalizzata,
  escludiPersonaId: number | undefined,
): Promise<Corrispondenza[]> {
  const righe = await db
    .select({
      personaId: personeTable.id,
      codiceFiscale: personeTable.codiceFiscale,
      cellulare: personeTable.cellulare,
      assistitoId: assistitiTable.id,
      proprietarioId: proprietario.id,
      capogruppoProprietarioId: proprietario.capogruppoId,
      collaboratoreId: comeCollaboratore.id,
    })
    .from(personeTable)
    .leftJoin(assistitiTable, eq(assistitiTable.personaId, personeTable.id))
    .leftJoin(proprietario, eq(proprietario.id, assistitiTable.collaboratoreId))
    .leftJoin(comeCollaboratore, eq(comeCollaboratore.personaId, personeTable.id))
    .where(
      and(
        or(eq(personeTable.codiceFiscale, a.codiceFiscale), eq(personeTable.cellulare, a.cellulare)),
        escludiPersonaId !== undefined ? ne(personeTable.id, escludiPersonaId) : undefined,
      ),
    )
    .orderBy(asc(personeTable.id));
  return righe.map((r) => {
    const campi: CampoDuplicato[] = [];
    if (r.codiceFiscale === a.codiceFiscale) campi.push("codice_fiscale");
    if (r.cellulare === a.cellulare) campi.push("cellulare");
    return {
      personaId: r.personaId,
      campi,
      assistitoId: r.assistitoId,
      proprietarioId: r.proprietarioId,
      capogruppoProprietarioId: r.capogruppoProprietarioId,
      tipo: r.collaboratoreId !== null ? "collaboratore" : "assistito",
    };
  });
}

const NOME_CAMPO: Record<CampoDuplicato, { frase: string; campoForm: string }> = {
  codice_fiscale: { frase: "Il codice fiscale inserito", campoForm: "codiceFiscale" },
  cellulare: { frase: "Il numero di cellulare inserito", campoForm: "cellulare" },
};

function datiTentati(a: AnagraficaNormalizzata, citta: string, indirizzo: string | null) {
  return {
    nome: a.nome,
    cognome: a.cognome,
    sesso: a.sesso,
    dataNascita: a.dataNascita,
    luogoNascita: a.luogoNascitaProvincia ? `${a.luogoNascitaNome} (${a.luogoNascitaProvincia})` : a.luogoNascitaNome,
    nazionalita: a.nazionalitaNome,
    codiceFiscale: a.codiceFiscale,
    cellulare: a.cellulare,
    citta,
    indirizzo,
    email: a.email ?? null,
  };
}

/** Registra (o aggiorna) la segnalazione per il back office e scrive il log, nella stessa transazione. */
async function registraSegnalazione(
  req: Request,
  c: Corrispondenza,
  dati: ReturnType<typeof datiTentati>,
  azione: "creare" | "modificare",
): Promise<void> {
  const u = req.utente!;
  await db.transaction(async (tx) => {
    const [aperta] = await tx
      .select({ id: segnalazioniDuplicatiTable.id, campi: segnalazioniDuplicatiTable.campi })
      .from(segnalazioniDuplicatiTable)
      .where(
        and(
          eq(segnalazioniDuplicatiTable.stato, "aperta"),
          eq(segnalazioniDuplicatiTable.richiedenteCollaboratoreId, u.collaboratoreId!),
          eq(segnalazioniDuplicatiTable.personaEsistenteId, c.personaId),
        ),
      )
      .for("update");
    let segnalazioneId: number;
    if (aperta) {
      segnalazioneId = aperta.id;
      await tx
        .update(segnalazioniDuplicatiTable)
        .set({
          tentativi: sql`${segnalazioniDuplicatiTable.tentativi} + 1`,
          ultimoTentativoIl: sql`now()`,
          campi: Array.from(new Set([...aperta.campi, ...c.campi])),
          datiTentati: dati,
        })
        .where(eq(segnalazioniDuplicatiTable.id, aperta.id));
    } else {
      const [nuova] = await tx
        .insert(segnalazioniDuplicatiTable)
        .values({
          richiedenteCollaboratoreId: u.collaboratoreId!,
          richiedenteUtenteId: u.id,
          personaEsistenteId: c.personaId,
          tipoCorrispondenza: c.tipo,
          campi: c.campi,
          datiTentati: dati,
        })
        .returning({ id: segnalazioniDuplicatiTable.id });
      segnalazioneId = nuova!.id;
    }
    await registraLog(tx, contestoDa(req), {
      azione: "assistito.duplicato_segnalato",
      entita: "segnalazione",
      entitaId: segnalazioneId,
      descrizione: `${u.cognome} ${u.nome} ha tentato di ${azione} l'assistito ${dati.cognome} ${dati.nome}, ma ${c.campi
        .map((x) => (x === "codice_fiscale" ? "il codice fiscale" : "il cellulare"))
        .join(" e ")} coincide con ${c.tipo === "collaboratore" ? "un collaboratore" : "un assistito"} gia registrato`,
      dettagli: { personaEsistenteId: c.personaId, tipo: c.tipo, campi: c.campi, assistitoId: c.assistitoId },
    });
  });
}

/**
 * Controlla le coincidenze di codice fiscale e cellulare con altre persone gia registrate.
 *
 * Per un collaboratore il messaggio e' sempre generico: non rivela nome, ruolo o sportello della persona
 * esistente, ne se sia un assistito o un collaboratore. Solo il back office vede i dettagli (segnalazioni).
 * Se la persona e' un assistito gia visibile al collaboratore (proprio o del suo gruppo) lo si indica e non
 * si crea alcuna segnalazione.
 */
export async function controllaDuplicatiAssistito(
  req: Request,
  a: AnagraficaNormalizzata,
  extra: { citta: string; indirizzo: string | null },
  azione: "creare" | "modificare",
  escludiPersonaId?: number,
): Promise<void> {
  const corrispondenze = await trovaCorrispondenze(a, escludiPersonaId);
  if (corrispondenze.length === 0) return;
  const mio = req.utente!.collaboratoreId;
  const visibile = (c: Corrispondenza) =>
    c.assistitoId !== null && mio !== null && (c.proprietarioId === mio || c.capogruppoProprietarioId === mio);

  const nascoste = corrispondenze.filter((c) => !visibile(c));
  if (nascoste.length === 0) {
    const c = corrispondenze[0]!;
    const { frase, campoForm } = NOME_CAMPO[c.campi[0]!];
    throw new HttpError(
      409,
      `${frase} corrisponde a un assistito che hai già tra i tuoi elenchi. Non è stato creato un duplicato.`,
      "ASSISTITO_GIA_NEI_TUOI_ELENCHI",
      campoForm,
      { assistitoId: c.assistitoId },
    );
  }

  const dati = datiTentati(a, extra.citta, extra.indirizzo);
  for (const c of nascoste) await registraSegnalazione(req, c, dati, azione);

  const { frase, campoForm } = NOME_CAMPO[nascoste[0]!.campi[0]!];
  throw new HttpError(
    409,
    `${frase} risulta già presente nella piattaforma. ${
      azione === "creare" ? "L'assistito non è stato creato" : "Le modifiche non sono state salvate"
    } e l'ufficio è stato avvisato.`,
    "ASSISTITO_GIA_PRESENTE",
    campoForm,
  );
}

/** Il collaboratore di destinazione di un'associazione deve esistere ed essere attivo. */
export async function controllaDestinazione(collaboratoreId: number): Promise<void> {
  const [c] = await db
    .select({ id: collaboratoriTable.id, attivo: utentiTable.attivo })
    .from(collaboratoriTable)
    .innerJoin(utentiTable, eq(utentiTable.id, collaboratoriTable.utenteId))
    .where(eq(collaboratoriTable.id, collaboratoreId));
  if (!c) throw nonTrovato("Collaboratore non trovato.");
  if (!c.attivo) {
    throw new HttpError(400, "Il collaboratore scelto è disattivato.", "DATI_NON_VALIDI", "collaboratoreId");
  }
}

/** Sposta un assistito a un altro collaboratore e scrive il log nella stessa transazione. */
export async function riassegnaInTransazione(
  tx: Transazione,
  req: Request,
  prima: { id: number; nome: string; cognome: string; collaboratoreId: number },
  collaboratoreId: number,
): Promise<void> {
  await tx
    .update(assistitiTable)
    .set({ collaboratoreId, modificatoIl: sql`now()` })
    .where(eq(assistitiTable.id, prima.id));
  await registraLog(tx, contestoDa(req), {
    azione: "assistito.riassegna",
    entita: "assistito",
    entitaId: prima.id,
    descrizione: `Assistito ${prima.cognome} ${prima.nome} spostato dal collaboratore n. ${prima.collaboratoreId} al collaboratore n. ${collaboratoreId}`,
    dettagli: { prima: { collaboratoreId: prima.collaboratoreId }, dopo: { collaboratoreId } },
  });
}
