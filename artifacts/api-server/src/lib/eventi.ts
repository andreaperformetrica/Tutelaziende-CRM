/** Funzioni comuni a back office e Web Collaboratore per eventi e corsi di formazione. */
import { randomBytes } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import {
  collaboratoriTable,
  db,
  eventiInvitiTable,
  eventiPartecipantiTable,
  eventiTable,
  personeTable,
  utentiTable,
  type EventoRow,
} from "@workspace/db";
import { HttpError, nonTrovato } from "./errori";
import type { Executor } from "./log";

const FUSO = "Europe/Rome";

/** Data di oggi nel calendario italiano, AAAA-MM-GG. */
export function oggiRoma(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** AAAA-MM-GG -> gg/mm/aaaa. */
export function formattaData(iso: string): string {
  const [a, m, g] = iso.split("-");
  return `${g}/${m}/${a}`;
}

/** Ora (HH:MM) di un istante, nel fuso italiano. */
export function oraRoma(istante: Date): string {
  return new Intl.DateTimeFormat("it-IT", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hour12: false }).format(istante);
}

/** Controlla che la data esista davvero (es. non 2026-02-31). */
export function dataValida(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** Nome o cognome: spazi ripuliti; se e' tutto minuscolo o tutto maiuscolo diventa "Mario De-Rossi / D'Angelo". */
export function normalizzaNomePersona(valore: string, etichetta: string): string {
  const v = valore.replace(/\s+/g, " ").trim();
  if (!v) throw new HttpError(400, `${etichetta} è obbligatorio.`, "DATI_NON_VALIDI");
  if (v.length > 80) throw new HttpError(400, `${etichetta} può avere al massimo 80 caratteri.`, "DATI_NON_VALIDI");
  if (v !== v.toLowerCase() && v !== v.toUpperCase()) return v;
  return v.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, l: string) => `${sep}${l.toUpperCase()}`);
}

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Contenuto del QR personale: 16 caratteri casuali, non indovinabili. */
export function nuovoCodiceQr(): string {
  const byte = randomBytes(16);
  let s = "";
  for (const b of byte) s += ALFABETO[b % ALFABETO.length];
  return `TUTELA-${s}`;
}

/** Istante corrispondente a un orario HH:MM di una data, nel fuso italiano. */
export async function istanteRoma(ex: Executor, data: string, hhmm: string): Promise<Date> {
  const r = await ex.execute<{ t: Date | string }>(sql`select ((${data}::date + ${hhmm}::time)::timestamp at time zone 'Europe/Rome') as t`);
  const t = r.rows[0]!.t;
  return t instanceof Date ? t : new Date(t);
}

export function controllaOrari(oraInizio: string, oraFine: string | null | undefined) {
  if (oraFine && oraFine <= oraInizio) {
    throw new HttpError(400, "L'ora di fine deve essere dopo l'ora di inizio.", "DATI_NON_VALIDI", "oraFine");
  }
}

export async function caricaEvento(id: number): Promise<EventoRow> {
  const [e] = await db.select().from(eventiTable).where(eq(eventiTable.id, id));
  if (!e) throw nonTrovato("Evento non trovato.");
  return e;
}

export const datiEvento = (e: EventoRow) => ({
  id: e.id,
  titolo: e.titolo,
  data: e.data,
  oraInizio: e.oraInizio,
  oraFine: e.oraFine,
  luogo: e.luogo,
  descrizione: e.descrizione,
  tipoCorso: e.tipoCorso === "CAF" || e.tipoCorso === "PATRONATO" ? e.tipoCorso : null,
  argomento: e.argomento,
  passato: e.data < oggiRoma(),
});

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const fileQuestionario = (e: EventoRow) =>
  e.questionarioChiave && e.questionarioNome && e.questionarioTipo && e.questionarioDimensione != null && e.questionarioCaricatoIl
    ? { nome: e.questionarioNome, tipo: e.questionarioTipo, dimensione: e.questionarioDimensione, caricatoIl: e.questionarioCaricatoIl.toISOString() }
    : null;

/** Sede (collaboratore) con i dati che servono per mostrarla e invitarla. */
const sedeNome = sql<string>`${personeTable.cognome} || ' ' || ${personeTable.nome}`;

export async function partecipantiBackoffice(eventoId: number) {
  const righe = await db
    .select({
      id: eventiPartecipantiTable.id,
      nome: eventiPartecipantiTable.nome,
      cognome: eventiPartecipantiTable.cognome,
      collaboratoreId: eventiPartecipantiTable.collaboratoreId,
      sedeNome,
      numeroSportello: collaboratoriTable.numeroSportello,
      entrataIl: eventiPartecipantiTable.entrataIl,
      uscitaIl: eventiPartecipantiTable.uscitaIl,
    })
    .from(eventiPartecipantiTable)
    .innerJoin(collaboratoriTable, eq(collaboratoriTable.id, eventiPartecipantiTable.collaboratoreId))
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .where(eq(eventiPartecipantiTable.eventoId, eventoId))
    .orderBy(asc(sql`lower(${eventiPartecipantiTable.cognome})`), asc(sql`lower(${eventiPartecipantiTable.nome})`), asc(eventiPartecipantiTable.id));
  return righe.map(mappaPartecipanteBackoffice);
}

export const mappaPartecipanteBackoffice = (r: {
  id: number; nome: string; cognome: string; collaboratoreId: number; sedeNome: string; numeroSportello: string; entrataIl: Date | null; uscitaIl: Date | null;
}) => ({ ...r, entrataIl: iso(r.entrataIl), uscitaIl: iso(r.uscitaIl) });

export async function schedaBackoffice(id: number) {
  const e = await caricaEvento(id);
  const inviti = await db
    .select({
      collaboratoreId: eventiInvitiTable.collaboratoreId,
      nome: sedeNome,
      numeroSportello: collaboratoriTable.numeroSportello,
      tipologia: collaboratoriTable.tipologia,
      attivo: utentiTable.attivo,
      invitatoIl: eventiInvitiTable.invitatoIl,
      confermatoIl: eventiInvitiTable.confermatoIl,
      partecipanti: sql<number>`(select count(*)::int from ${eventiPartecipantiTable} p where p.evento_id = ${eventiInvitiTable.eventoId} and p.collaboratore_id = ${eventiInvitiTable.collaboratoreId})`,
    })
    .from(eventiInvitiTable)
    .innerJoin(collaboratoriTable, eq(collaboratoriTable.id, eventiInvitiTable.collaboratoreId))
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .innerJoin(utentiTable, eq(utentiTable.id, collaboratoriTable.utenteId))
    .where(eq(eventiInvitiTable.eventoId, id))
    .orderBy(asc(sql`lower(${personeTable.cognome})`), asc(sql`lower(${personeTable.nome})`));
  return {
    evento: datiEvento(e),
    questionario: fileQuestionario(e),
    domande: e.questionarioDomande ?? [],
    inviti: inviti.map((i) => ({ ...i, invitatoIl: i.invitatoIl.toISOString(), confermatoIl: iso(i.confermatoIl) })),
    partecipanti: await partecipantiBackoffice(id),
  };
}

export async function invitoSede(eventoId: number, collaboratoreId: number) {
  const [i] = await db
    .select()
    .from(eventiInvitiTable)
    .where(sql`${eventiInvitiTable.eventoId} = ${eventoId} and ${eventiInvitiTable.collaboratoreId} = ${collaboratoreId}`);
  return i ?? null;
}

export async function schedaSede(eventoId: number, collaboratoreId: number) {
  const invito = await invitoSede(eventoId, collaboratoreId);
  if (!invito) throw nonTrovato("Evento non trovato.");
  const e = await caricaEvento(eventoId);
  const parte = await db
    .select()
    .from(eventiPartecipantiTable)
    .where(sql`${eventiPartecipantiTable.eventoId} = ${eventoId} and ${eventiPartecipantiTable.collaboratoreId} = ${collaboratoreId}`)
    .orderBy(asc(sql`lower(${eventiPartecipantiTable.cognome})`), asc(sql`lower(${eventiPartecipantiTable.nome})`), asc(eventiPartecipantiTable.id));
  return {
    evento: datiEvento(e),
    confermatoIl: iso(invito.confermatoIl),
    questionario: fileQuestionario(e),
    partecipanti: parte.map((p) => ({
      id: p.id,
      nome: p.nome,
      cognome: p.cognome,
      codiceQr: p.codiceQr,
      entrataIl: iso(p.entrataIl),
      uscitaIl: iso(p.uscitaIl),
      modificabile: !p.entrataIl && !p.uscitaIl,
    })),
  };
}

export function intero(v: unknown, nome: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Parametro "${nome}" non valido.`, "DATI_NON_VALIDI", nome);
  return n;
}
