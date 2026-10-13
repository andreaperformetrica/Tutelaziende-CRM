/** Accesso e composizione delle pratiche per il Web Collaboratore. */
import { nomePdfMandato } from "./mandato-compilato";
import type { Request } from "express";
import { and, asc, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  assegnazioniMandatoTable,
  assistitiTable,
  categorieAllegatoTable,
  collaboratoriTable,
  commentiPraticaTable,
  db,
  documentiPraticaTable,
  documentiTipoTable,
  mandatiTable,
  moduliTipoTable,
  personeTable,
  praticheTable,
  statiPraticaTable,
  tipiPraticaTable,
  utentiTable,
} from "@workspace/db";
import { mappaAssistito, selezionaAssistiti } from "./assistiti";
import { HttpError } from "./errori";
import { FUSO, statoInvioPratiche, type StatoInvio } from "./orari";

export const personaCollaboratore = alias(personeTable, "persona_coll_pratica");
const utenteGestore = alias(utentiTable, "utente_gestore");
const utenteAutore = alias(utentiTable, "utente_autore");

export const MAX_MESSAGGIO = 4000;
export const MAX_ALLEGATI_AGGIUNTIVI = 30;

/** Id del collaboratore della sessione; questi endpoint sono riservati ai collaboratori. */
export function mioCollaboratoreId(req: Request): number {
  const id = req.utente?.collaboratoreId;
  if (req.utente?.ruolo !== "collaboratore" || !id) {
    throw new HttpError(403, "Non hai i permessi per eseguire questa operazione.", "NON_AUTORIZZATO");
  }
  return id;
}

/** Il collaboratore vede le proprie pratiche e, se capogruppo, quelle dei collaboratori del suo gruppo. */
export function condizioneVisibilitaPratiche(req: Request): SQL {
  const mio = mioCollaboratoreId(req);
  return or(eq(praticheTable.collaboratoreId, mio), eq(collaboratoriTable.capogruppoId, mio))!;
}

const stato = sql<string>`coalesce(${statiPraticaTable.nome}, 'Bozza')`;

export function selezionaPratiche(where: SQL | undefined, ordine?: SQL[]) {
  return db
    .select({
      id: praticheTable.id,
      numero: praticheTable.numero,
      assistitoId: praticheTable.assistitoId,
      collaboratoreId: praticheTable.collaboratoreId,
      tipoPraticaId: praticheTable.tipoPraticaId,
      statoId: praticheTable.statoId,
      mandatoId: praticheTable.mandatoId,
      messaggio: praticheTable.messaggio,
      creataIl: praticheTable.creataIl,
      inviataIl: praticheTable.inviataIl,
      statoNome: stato,
      statoChiuso: sql<boolean>`coalesce(${statiPraticaTable.chiuso}, false)`,
      statoOrdine: statiPraticaTable.ordine,
      gestitaDaUtenteId: praticheTable.gestitaDaUtenteId,
      ultimaAttivitaCollaboratoreIl: praticheTable.ultimaAttivitaCollaboratoreIl,
      ultimaAttivitaBackofficeIl: praticheTable.ultimaAttivitaBackofficeIl,
      assCitta: assistitiTable.citta,
      tipoNome: tipiPraticaTable.nome,
      tipoAttivo: tipiPraticaTable.attivo,
      assNome: personeTable.nome,
      assCognome: personeTable.cognome,
      assCf: personeTable.codiceFiscale,
      collNome: personaCollaboratore.nome,
      collCognome: personaCollaboratore.cognome,
      collSportello: collaboratoriTable.numeroSportello,
      collCapogruppoId: collaboratoriTable.capogruppoId,
      gestoreNome: utenteGestore.nome,
      gestoreCognome: utenteGestore.cognome,
      gestoreColore: utenteGestore.colore,
    })
    .from(praticheTable)
    .innerJoin(assistitiTable, eq(assistitiTable.id, praticheTable.assistitoId))
    .innerJoin(personeTable, eq(personeTable.id, assistitiTable.personaId))
    .innerJoin(collaboratoriTable, eq(collaboratoriTable.id, praticheTable.collaboratoreId))
    .innerJoin(personaCollaboratore, eq(personaCollaboratore.id, collaboratoriTable.personaId))
    .innerJoin(tipiPraticaTable, eq(tipiPraticaTable.id, praticheTable.tipoPraticaId))
    .leftJoin(statiPraticaTable, eq(statiPraticaTable.id, praticheTable.statoId))
    .leftJoin(utenteGestore, eq(utenteGestore.id, praticheTable.gestitaDaUtenteId))
    .where(where)
    .orderBy(...(ordine ?? [desc(sql`coalesce(${praticheTable.inviataIl}, ${praticheTable.creataIl})`), desc(praticheTable.id)]))
    .$dynamic();
}

export type RigaPratica = Awaited<ReturnType<typeof selezionaPratiche>>[number];

export async function contaPratiche(where: SQL | undefined): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(praticheTable)
    .innerJoin(assistitiTable, eq(assistitiTable.id, praticheTable.assistitoId))
    .innerJoin(personeTable, eq(personeTable.id, assistitiTable.personaId))
    .innerJoin(collaboratoriTable, eq(collaboratoriTable.id, praticheTable.collaboratoreId))
    .where(where);
  return r?.n ?? 0;
}

const GRUPPI_PRATICHE = {
  bozze: sql`${praticheTable.inviataIl} is null`,
  in_lavorazione: sql`(${praticheTable.inviataIl} is not null and coalesce(${statiPraticaTable.chiuso}, false) = false)`,
  chiuse: sql`(${praticheTable.inviataIl} is not null and coalesce(${statiPraticaTable.chiuso}, false) = true)`,
} as const;

export const condizioneGruppoPratiche = (gruppo: keyof typeof GRUPPI_PRATICHE | undefined): SQL | undefined => (gruppo ? GRUPPI_PRATICHE[gruppo] : undefined);

/** Quante pratiche ci sono in ogni gruppo (bozze, in lavorazione, chiuse) tra quelle che rispettano `where`. */
export async function contaGruppiPratiche(where: SQL | undefined) {
  const [r] = await db
    .select({
      tutte: sql<number>`count(*)::int`,
      bozze: sql<number>`(count(*) filter (where ${GRUPPI_PRATICHE.bozze}))::int`,
      inLavorazione: sql<number>`(count(*) filter (where ${GRUPPI_PRATICHE.in_lavorazione}))::int`,
      chiuse: sql<number>`(count(*) filter (where ${GRUPPI_PRATICHE.chiuse}))::int`,
    })
    .from(praticheTable)
    .innerJoin(assistitiTable, eq(assistitiTable.id, praticheTable.assistitoId))
    .innerJoin(personeTable, eq(personeTable.id, assistitiTable.personaId))
    .innerJoin(collaboratoriTable, eq(collaboratoriTable.id, praticheTable.collaboratoreId))
    .leftJoin(statiPraticaTable, eq(statiPraticaTable.id, praticheTable.statoId))
    .where(where);
  return r ?? { tutte: 0, bozze: 0, inLavorazione: 0, chiuse: 0 };
}

export function mappaRiepilogo(r: RigaPratica, mio: number) {
  return {
    id: r.id,
    numero: r.numero,
    bozza: r.inviataIl === null,
    stato: r.statoNome,
    statoChiuso: r.statoChiuso,
    assistito: { id: r.assistitoId, nome: r.assNome, cognome: r.assCognome, codiceFiscale: r.assCf },
    collaboratore: { id: r.collaboratoreId, nome: r.collNome, cognome: r.collCognome, numeroSportello: r.collSportello },
    tipo: { id: r.tipoPraticaId, nome: r.tipoNome },
    dataRichiesta: r.inviataIl?.toISOString() ?? null,
    creataIl: r.creataIl.toISOString(),
    gestitaDa: r.gestoreCognome ? `${r.gestoreCognome} ${r.gestoreNome}` : null,
    propria: r.collaboratoreId === mio,
  };
}

/** Pratica visibile all'utente; una non visibile e' indistinguibile da una inesistente. */
export async function caricaPraticaVisibile(req: Request, id: number): Promise<RigaPratica> {
  const [r] = await selezionaPratiche(and(eq(praticheTable.id, id), condizioneVisibilitaPratiche(req)));
  if (!r) throw new HttpError(404, "Pratica non trovata.", "NON_TROVATO");
  return r;
}

/** Pratica che il collaboratore puo' modificare: solo le proprie (il capogruppo vede quelle del gruppo in sola lettura). */
export async function caricaPraticaPropria(req: Request, id: number): Promise<RigaPratica> {
  const r = await caricaPraticaVisibile(req, id);
  if (r.collaboratoreId !== mioCollaboratoreId(req)) {
    throw new HttpError(403, "Puoi modificare solo le pratiche del tuo sportello.", "NON_AUTORIZZATO");
  }
  return r;
}

export const ERRORE_PRATICA_INVIATA = (azione: string) =>
  new HttpError(409, `${azione}: la pratica è già stata inviata. Puoi solo aggiungere allegati e rispondere ai commenti.`, "PRATICA_GIA_INVIATA");

export const ERRORE_PRATICA_BOZZA = new HttpError(409, "La pratica non è ancora stata inviata.", "PRATICA_IN_BOZZA");

/** Mandato (modello della sede) del collaboratore: quello fissato all'invio, altrimenti quello attualmente assegnato. */
export async function mandatoDellaPratica(p: Pick<RigaPratica, "mandatoId" | "collaboratoreId">) {
  const base = db
    .select({ id: mandatiTable.id, nome: mandatiTable.nome, fileNome: mandatiTable.fileNome, fileChiave: mandatiTable.fileChiave, fileTipo: mandatiTable.fileTipo, dimensione: mandatiTable.fileDimensione })
    .from(mandatiTable);
  if (p.mandatoId) return (await base.where(eq(mandatiTable.id, p.mandatoId)))[0] ?? null;
  return (
    (
      await base
        .innerJoin(assegnazioniMandatoTable, eq(assegnazioniMandatoTable.mandatoId, mandatiTable.id))
        .where(eq(assegnazioniMandatoTable.collaboratoreId, p.collaboratoreId))
    )[0] ?? null
  );
}

export function formattaIstanteRoma(d: Date): string {
  const parti = new Intl.DateTimeFormat("it-IT", {
    timeZone: FUSO, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const v = (t: string) => parti.find((x) => x.type === t)?.value ?? "";
  return `${v("weekday")} ${v("day")}/${v("month")}/${v("year")} alle ${v("hour")}:${v("minute")}`;
}

export function descriviStatoInvio(s: StatoInvio) {
  return {
    consentito: s.consentito,
    bloccatoFinoA: s.bloccatoFinoA?.toISOString() ?? null,
    messaggio: s.consentito
      ? null
      : s.bloccatoFinoA
        ? `In questo momento non è possibile inviare pratiche. Potrai inviare le pratiche da ${formattaIstanteRoma(s.bloccatoFinoA)}.`
        : "In questo momento non è possibile inviare pratiche.",
  };
}

export async function invioPratiche() {
  return descriviStatoInvio(await statoInvioPratiche());
}

export interface Completezza {
  mancanti: string[];
  richiesti: { id: number; nome: string }[];
  mandatoMancante: boolean;
}

/** Cosa manca per poter inviare una bozza: documenti obbligatori non caricati e mandato non assegnato. */
export async function verificaCompletezza(p: RigaPratica, mandato: unknown): Promise<Completezza> {
  const docs = await db.select().from(documentiTipoTable).where(eq(documentiTipoTable.tipoPraticaId, p.tipoPraticaId)).orderBy(asc(documentiTipoTable.ordine), asc(documentiTipoTable.id));
  const caricati = await db.select({ documentoTipoId: documentiPraticaTable.documentoTipoId }).from(documentiPraticaTable).where(eq(documentiPraticaTable.praticaId, p.id));
  const caricatiIds = new Set(caricati.map((c) => c.documentoTipoId));
  const richiesti = docs.filter((d) => !d.mandato).map((d) => ({ id: d.id, nome: d.nome }));
  const mandatoMancante = docs.some((d) => d.mandato) && !mandato;
  const mancanti = [
    ...richiesti.filter((d) => !caricatiIds.has(d.id)).map((d) => `Documento da caricare: ${d.nome}`),
    ...(mandatoMancante ? ["Al tuo sportello non è stato assegnato il mandato: contatta l'amministrazione"] : []),
  ];
  return { mancanti, richiesti, mandatoMancante };
}

export function mappaDocumentoPratica(
  d: typeof documentiPraticaTable.$inferSelect,
  nome: string | null,
  cognome: string | null,
  categorie: Map<number, string>,
) {
  return {
    id: d.id,
    documentoTipoId: d.documentoTipoId,
    nome: d.nome,
    fileNome: d.fileNome,
    fileTipo: d.fileTipo,
    dimensione: d.fileDimensione,
    caricatoIl: d.caricatoIl.toISOString(),
    caricatoDa: cognome ? `${cognome} ${nome}` : "—",
    dopoInvio: d.dopoInvio,
    daUfficio: d.daBackoffice,
    categoria: d.categoriaId ? (categorie.get(d.categoriaId) ?? null) : null,
  };
}

/** Nomi delle categorie degli allegati, per id. */
export async function mappaCategorieAllegato(): Promise<Map<number, string>> {
  const righe = await db.select({ id: categorieAllegatoTable.id, nome: categorieAllegatoTable.nome }).from(categorieAllegatoTable);
  return new Map(righe.map((r) => [r.id, r.nome]));
}

/** Dettaglio completo della pratica per la scheda del collaboratore. */
export async function dettaglioPratica(req: Request, id: number) {
  const p = await caricaPraticaVisibile(req, id);
  const mio = mioCollaboratoreId(req);
  const bozza = p.inviataIl === null;
  const propria = p.collaboratoreId === mio;
  const [ass] = await selezionaAssistiti(eq(assistitiTable.id, p.assistitoId));
  const moduli = await db.select().from(moduliTipoTable).where(eq(moduliTipoTable.tipoPraticaId, p.tipoPraticaId)).orderBy(asc(moduliTipoTable.id));
  const mandato = await mandatoDellaPratica(p);
  const documenti = await db
    .select({ d: documentiPraticaTable, nome: utenteAutore.nome, cognome: utenteAutore.cognome })
    .from(documentiPraticaTable)
    .leftJoin(utenteAutore, eq(utenteAutore.id, documentiPraticaTable.caricatoDaUtenteId))
    .where(eq(documentiPraticaTable.praticaId, id))
    .orderBy(asc(documentiPraticaTable.id));
  const commenti = await db
    .select({ c: commentiPraticaTable, nome: utentiTable.nome, cognome: utentiTable.cognome, ruolo: utentiTable.ruolo })
    .from(commentiPraticaTable)
    .innerJoin(utentiTable, eq(utentiTable.id, commentiPraticaTable.utenteId))
    .where(eq(commentiPraticaTable.praticaId, id))
    .orderBy(asc(commentiPraticaTable.creatoIl), asc(commentiPraticaTable.id));
  const categorie = await mappaCategorieAllegato();
  const completezza = bozza ? await verificaCompletezza(p, mandato) : { mancanti: [], richiesti: [], mandatoMancante: false };
  return {
    ...mappaRiepilogo(p, mio),
    assistito: mappaAssistito(ass!, req),
    moduli: moduli.map((m) => ({ id: m.id, nome: m.nome, fileNome: m.fileNome, dimensione: m.fileDimensione })),
    mandato: mandato ? { id: mandato.id, nome: mandato.nome, fileNome: nomePdfMandato(p) } : null,
    mandatoMancante: completezza.mandatoMancante,
    richiesti: completezza.richiesti,
    documenti: documenti.map(({ d, nome, cognome }) => mappaDocumentoPratica(d, nome, cognome, categorie)),
    messaggio: p.messaggio,
    commenti: commenti.map(({ c, nome, cognome, ruolo }) => ({
      id: c.id,
      testo: c.testo,
      autore: `${cognome} ${nome}`,
      ruolo: ruolo === "collaboratore" ? ("collaboratore" as const) : ("backoffice" as const),
      creatoIl: c.creatoIl.toISOString(),
      mio: c.utenteId === req.utente!.id,
    })),
    inviataIl: p.inviataIl?.toISOString() ?? null,
    gestitaDa: p.gestoreCognome ? `${p.gestoreCognome} ${p.gestoreNome}` : null,
    modificabile: propria && bozza,
    puoAllegare: propria && !bozza,
    puoCommentare: propria && !bozza,
    mancanti: completezza.mancanti,
    invio: await invioPratiche(),
  };
}

