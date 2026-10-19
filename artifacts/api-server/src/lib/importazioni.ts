/**
 * Import dei compensi da Excel (730, ISEE, NASPI): anteprima con segnalazione degli errori, abbinamento al collaboratore
 * tramite la colonna "sportello" e righe riportate nel dare/avere. Gli importi sono in centesimi nel database e in euro
 * nell'API.
 *
 * - 730 e ISEE: il "totale dovuto" di ogni sportello e' l'importo del dare/avere (un import per anno, ISEE per trimestre).
 * - NASPI: il file contiene l'importo cumulato. Il primo import di uno sportello crea il riferimento; ogni import
 *   successivo paga la differenza rispetto al cumulato gia' coperto. Una differenza negativa viene segnalata e non pagata.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { collaboratoriTable, db, importazioniRigheTable, importazioniTable, personeTable, utentiTable } from "@workspace/db";
import { HttpError } from "./errori";
import { formattaData } from "./eventi";
import type { Executor } from "./log";
import { leggiFile } from "./storage";
import { leggiImporto, leggiTabella, type Cella, type Tabella } from "./tabella-file";

export const SERVIZI = {
  mod730: { etichetta: "730", sezione: "caf" },
  isee: { etichetta: "ISEE", sezione: "caf" },
  naspi: { etichetta: "NASPI", sezione: "naspi" },
} as const;
export type Servizio = keyof typeof SERVIZI;
export const CODICI_SERVIZI = Object.keys(SERVIZI) as Servizio[];

const euro = (c: number) => c / 100;
const euroTesto = (c: number) => `${c < 0 ? "-" : ""}€ ${(Math.abs(c) / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataRoma = (d: Date) => formattaData(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(d));

export function etichettaServizio(s: string): string {
  return (SERVIZI as Record<string, { etichetta: string }>)[s]?.etichetta ?? s;
}

type RigaImportazione = typeof importazioniTable.$inferSelect;
type DatiTitolo = Pick<RigaImportazione, "servizio" | "anno" | "trimestre" | "periodo">;

/** Nome dell'import come lo vede l'utente: "730/2025", "ISEE trimestre 1 2026", "NASPI 2026 gen-set". */
export function titoloImport(i: DatiTitolo): string {
  if (i.servizio === "mod730") return `730/${i.anno}`;
  if (i.servizio === "isee") return `ISEE trimestre ${i.trimestre} ${i.anno}`;
  return i.periodo ? `NASPI ${i.anno} ${i.periodo}` : `NASPI ${i.anno}`;
}

// ---------------------------------------------------------------------------------------------
// Analisi del file
// ---------------------------------------------------------------------------------------------

const normTesto = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
/** Lo sportello si confronta in maiuscolo e senza spazi. */
const normSportello = (s: string) => s.replace(/\s+/g, "").toUpperCase();

const ALIAS = {
  sportello: ["sportello", "sport", "n sportello", "numero sportello", "codice sportello"],
  sede: ["sede", "ragione sociale", "ragione", "denominazione"],
  totale: ["totale dovuto", "totale", "da pagare", "importo"],
  cumulato: ["importo cumulato", "cumulato", "importo", "totale"],
} as const;

function trovaColonna(intestazioni: string[], alias: readonly string[]): number {
  const norm = intestazioni.map(normTesto);
  for (const a of alias) {
    const i = norm.indexOf(a);
    if (i >= 0) return i;
  }
  return -1;
}

const testoCella = (c: Cella): string => (c === null ? "" : typeof c === "number" ? String(c) : c.trim());

export type EsitoRiga = "valida" | "errore" | "avviso" | "riferimento";

export interface RigaAnalizzata {
  numeroRiga: number;
  sportello: string | null;
  sedeFile: string | null;
  collaboratoreId: number | null;
  collaboratoreNome: string | null;
  collaboratoreSede: string | null;
  /** Importo letto nel file: totale dovuto (730, ISEE) o cumulato (NASPI). */
  importoCentesimi: number | null;
  /** NASPI: cumulato gia' coperto prima di questo import. */
  precedenteCentesimi: number | null;
  /** Importo da pagare / riportare nel dare/avere. */
  compensoCentesimi: number | null;
  esito: EsitoRiga;
  messaggi: string[];
}

export interface Analisi {
  righe: RigaAnalizzata[];
  avvisiFile: string[];
}

interface Coll {
  id: number;
  nome: string;
  sede: string | null;
}

async function mappaSportelli(ex: Executor): Promise<Map<string, Coll>> {
  const lista = await ex
    .select({ id: collaboratoriTable.id, sportello: collaboratoriTable.numeroSportello, nome: personeTable.nome, cognome: personeTable.cognome, denominazione: collaboratoriTable.denominazione })
    .from(collaboratoriTable)
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId));
  return new Map(lista.map((r) => [normSportello(r.sportello), { id: r.id, nome: `${r.cognome} ${r.nome}`.trim(), sede: r.denominazione?.trim() || null }]));
}

/**
 * Cumulato NASPI gia' coperto per ogni collaboratore nell'anno: il massimo tra i cumulati e i riferimenti delle importazioni
 * confermate. Un cumulato piu' basso (differenza negativa) non abbassa il riferimento, cosi' non si paga due volte.
 */
export async function riferimentiNaspi(anno: number, ex: Executor): Promise<Map<number, number>> {
  const righe = await ex
    .select({ collaboratoreId: importazioniRigheTable.collaboratoreId, base: importazioniRigheTable.baseCentesimi, precedente: importazioniRigheTable.precedenteCentesimi })
    .from(importazioniRigheTable)
    .innerJoin(importazioniTable, eq(importazioniTable.id, importazioniRigheTable.importazioneId))
    .where(and(eq(importazioniTable.servizio, "naspi"), eq(importazioniTable.anno, anno), eq(importazioniTable.stato, "confermata")));
  const m = new Map<number, number>();
  for (const r of righe) m.set(r.collaboratoreId, Math.max(m.get(r.collaboratoreId) ?? 0, r.base ?? 0, r.precedente ?? 0));
  return m;
}

export async function analizzaTabella(t: Tabella, servizio: Servizio, anno: number, ex: Executor = db): Promise<Analisi> {
  const iSportello = trovaColonna(t.intestazioni, ALIAS.sportello);
  const iImporto = trovaColonna(t.intestazioni, servizio === "naspi" ? ALIAS.cumulato : ALIAS.totale);
  const trovate = t.intestazioni.map((h) => `«${h}»`).join(", ");
  if (iSportello < 0) {
    throw new HttpError(400, `Nel file non trovo la colonna «sportello». Colonne trovate: ${trovate}.`, "FILE_COLONNE_MANCANTI");
  }
  if (iImporto < 0) {
    const nome = servizio === "naspi" ? "importo cumulato" : "totale dovuto";
    throw new HttpError(400, `Nel file non trovo la colonna «${nome}». Colonne trovate: ${trovate}.`, "FILE_COLONNE_MANCANTI");
  }
  const iSede = trovaColonna(t.intestazioni, ALIAS.sede);
  const normIntest = t.intestazioni.map(normTesto);
  const avvisiFile: string[] = [];
  if (normIntest.includes("centro")) {
    avvisiFile.push("Il file contiene anche la colonna «centro»: l'abbinamento usa solo la colonna «sportello».");
  }

  const sportelli = await mappaSportelli(ex);
  const riferimenti = servizio === "naspi" ? await riferimentiNaspi(anno, ex) : new Map<number, number>();
  const viste = new Map<string, number>();

  const righe = t.righe.map((r): RigaAnalizzata => {
    const messaggi: string[] = [];
    const grezzo = testoCella(r.celle[iSportello] ?? null);
    const sede = iSede >= 0 ? testoCella(r.celle[iSede] ?? null) : "";
    let coll: Coll | null = null;
    if (!grezzo) messaggi.push("Sportello mancante.");
    else {
      const chiave = normSportello(grezzo);
      coll = sportelli.get(chiave) ?? null;
      if (!coll) messaggi.push(`Sportello «${grezzo}» non trovato tra i collaboratori.`);
      const prima = viste.get(chiave);
      if (prima !== undefined) messaggi.push(`Sportello già presente alla riga ${prima}.`);
      else viste.set(chiave, r.numero);
    }
    const cella = r.celle[iImporto] ?? null;
    const nImporto = leggiImporto(cella);
    let importo: number | null = null;
    if (nImporto === null) messaggi.push(cella === null ? "Importo mancante." : `Importo non valido: «${testoCella(cella)}».`);
    else if (nImporto < 0) messaggi.push(`Importo non valido (negativo): «${testoCella(cella)}».`);
    else {
      importo = Math.round(nImporto * 100);
    }
    const base = {
      numeroRiga: r.numero,
      sportello: grezzo || null,
      sedeFile: sede || null,
      collaboratoreId: coll?.id ?? null,
      collaboratoreNome: coll?.nome ?? null,
      collaboratoreSede: coll?.sede ?? null,
      importoCentesimi: importo,
    };
    if (messaggi.length > 0 || importo === null || !coll) {
      return { ...base, precedenteCentesimi: null, compensoCentesimi: null, esito: "errore", messaggi };
    }
    if (servizio !== "naspi") return { ...base, precedenteCentesimi: null, compensoCentesimi: importo, esito: "valida", messaggi };
    const rif = riferimenti.get(coll.id);
    if (rif === undefined) {
      return { ...base, precedenteCentesimi: null, compensoCentesimi: 0, esito: "riferimento", messaggi: ["Primo import per questo sportello: crea il riferimento, nessun importo da pagare."] };
    }
    const diff = importo - rif;
    if (diff < 0) {
      return { ...base, precedenteCentesimi: rif, compensoCentesimi: 0, esito: "avviso", messaggi: [`Differenza negativa (${euroTesto(diff)}): non viene pagata. Il riferimento resta ${euroTesto(rif)}.`] };
    }
    return { ...base, precedenteCentesimi: rif, compensoCentesimi: diff, esito: "valida", messaggi };
  });
  return { righe, avvisiFile };
}

// ---------------------------------------------------------------------------------------------
// Importazioni
// ---------------------------------------------------------------------------------------------

export const hashContenuto = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function nomeUtente(id: number | null): Promise<string | null> {
  if (!id) return null;
  const [u] = await db.select({ nome: utentiTable.nome }).from(utentiTable).where(eq(utentiTable.id, id));
  return u?.nome ?? null;
}

export async function mappaImportazione(i: RigaImportazione) {
  return {
    id: i.id,
    servizio: i.servizio,
    servizioEtichetta: etichettaServizio(i.servizio),
    titolo: titoloImport(i),
    anno: i.anno,
    trimestre: i.trimestre,
    periodo: i.periodo,
    annoDareAvere: i.annoDareAvere,
    nomeFile: i.nomeFile,
    stato: i.stato,
    righeLette: i.righeLette,
    righeImportate: i.righeImportate,
    totaleEuro: euro(i.totaleCentesimi),
    creatoIl: i.creatoIl.toISOString(),
    creatoDa: await nomeUtente(i.creatoDaUtenteId),
    confermatoIl: i.confermatoIl ? i.confermatoIl.toISOString() : null,
  };
}

export async function elencoImportazioni(f: { servizio?: Servizio; anno?: number }) {
  const cond = [f.servizio ? eq(importazioniTable.servizio, f.servizio) : undefined, f.anno ? eq(importazioniTable.anno, f.anno) : undefined].filter((x) => x !== undefined);
  const righe = await db.select().from(importazioniTable).where(cond.length ? and(...cond) : undefined).orderBy(desc(importazioniTable.id));
  return Promise.all(righe.map(mappaImportazione));
}

export async function caricaImportazione(id: number, ex: Executor = db): Promise<RigaImportazione> {
  const [i] = await ex.select().from(importazioniTable).where(eq(importazioniTable.id, id));
  if (!i) throw new HttpError(404, "Importazione non trovata.", "NON_TROVATO");
  return i;
}

export async function importazioneConfermataDuplicata(hash: string, ex: Executor = db) {
  const [d] = await ex.select().from(importazioniTable).where(and(eq(importazioniTable.hashFile, hash), eq(importazioniTable.stato, "confermata")));
  return d ?? null;
}

export function erroreDuplicato(d: RigaImportazione): HttpError {
  const quando = d.confermatoIl ? ` il ${dataRoma(d.confermatoIl)}` : "";
  return new HttpError(409, `Questo file è già stato importato${quando} (${titoloImport(d)}, importazione n. ${d.id}). Lo stesso file non si può importare due volte.`, "IMPORT_DUPLICATO");
}

/** 730 e ISEE: un solo import confermato per anno (e trimestre). */
export async function importazionePeriodoEsistente(d: DatiTitolo, ex: Executor = db) {
  if (d.servizio === "naspi") return null;
  const [e] = await ex
    .select()
    .from(importazioniTable)
    .where(
      and(
        eq(importazioniTable.servizio, d.servizio),
        eq(importazioniTable.anno, d.anno),
        d.trimestre === null ? sql`${importazioniTable.trimestre} is null` : eq(importazioniTable.trimestre, d.trimestre),
        eq(importazioniTable.stato, "confermata"),
      ),
    );
  return e ?? null;
}

export function errorePeriodoEsistente(e: RigaImportazione): HttpError {
  return new HttpError(409, `${titoloImport(e)} è già stato importato (importazione n. ${e.id}). Per rifarlo annulla prima quell'importazione.`, "IMPORT_PERIODO_GIA_IMPORTATO");
}

export async function leggiBuffer(chiave: string): Promise<Buffer> {
  const { stream } = await leggiFile(chiave);
  const pezzi: Buffer[] = [];
  for await (const c of stream) pezzi.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(pezzi);
}

export const estensioneDi = (nomeFile: string) => (nomeFile.includes(".") ? nomeFile.split(".").pop()!.toLowerCase() : "");

export async function analizzaImportazione(i: RigaImportazione, ex: Executor = db): Promise<Analisi> {
  const buffer = await leggiBuffer(i.chiaveFile);
  const tabella = await leggiTabella(buffer, estensioneDi(i.nomeFile));
  return analizzaTabella(tabella, i.servizio, i.anno, ex);
}

function esitoSalvata(servizio: Servizio, base: number | null, precedente: number | null): EsitoRiga {
  if (servizio !== "naspi") return "valida";
  if (precedente === null) return "riferimento";
  return (base ?? 0) < precedente ? "avviso" : "valida";
}

const mappaRiga = (r: RigaAnalizzata) => ({
  numeroRiga: r.numeroRiga,
  sportello: r.sportello,
  sedeFile: r.sedeFile,
  collaboratoreId: r.collaboratoreId,
  collaboratoreNome: r.collaboratoreNome,
  collaboratoreSede: r.collaboratoreSede,
  importoEuro: r.importoCentesimi === null ? null : euro(r.importoCentesimi),
  precedenteEuro: r.precedenteCentesimi === null ? null : euro(r.precedenteCentesimi),
  daPagareEuro: r.compensoCentesimi === null ? null : euro(r.compensoCentesimi),
  esito: r.esito,
  messaggi: r.messaggi,
});

/** Dettaglio: per un'anteprima rilegge il file con lo stato attuale dei riferimenti, per una confermata usa le righe salvate. */
export async function dettaglioImportazione(id: number) {
  const i = await caricaImportazione(id);
  const importazione = await mappaImportazione(i);
  if (i.stato === "confermata") {
    const salvate = await db
      .select({ r: importazioniRigheTable, cognome: personeTable.cognome, nome: personeTable.nome, denominazione: collaboratoriTable.denominazione })
      .from(importazioniRigheTable)
      .innerJoin(collaboratoriTable, eq(collaboratoriTable.id, importazioniRigheTable.collaboratoreId))
      .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
      .where(eq(importazioniRigheTable.importazioneId, id))
      .orderBy(asc(importazioniRigheTable.numeroRiga));
    const righe = salvate.map(({ r, cognome, nome, denominazione }) =>
      mappaRiga({
        numeroRiga: r.numeroRiga,
        sportello: r.riferimento,
        sedeFile: r.sedeFile,
        collaboratoreId: r.collaboratoreId,
        collaboratoreNome: `${cognome} ${nome}`.trim(),
        collaboratoreSede: denominazione?.trim() || null,
        importoCentesimi: i.servizio === "naspi" ? r.baseCentesimi : r.compensoCentesimi,
        precedenteCentesimi: r.precedenteCentesimi,
        compensoCentesimi: r.compensoCentesimi,
        esito: esitoSalvata(i.servizio, r.baseCentesimi, r.precedenteCentesimi),
        messaggi: [],
      }),
    );
    return {
      importazione,
      righe,
      righeValide: righe.length,
      righeConErrori: Math.max(0, i.righeLette - i.righeImportate),
      righeAvviso: righe.filter((r) => r.esito === "avviso").length,
      totaleEuro: euro(i.totaleCentesimi),
      avvisiFile: [] as string[],
    };
  }
  const analisi = await analizzaImportazione(i);
  const righe = analisi.righe.map(mappaRiga);
  return {
    importazione,
    righe,
    righeValide: analisi.righe.filter((r) => r.esito !== "errore").length,
    righeConErrori: analisi.righe.filter((r) => r.esito === "errore").length,
    righeAvviso: analisi.righe.filter((r) => r.esito === "avviso").length,
    totaleEuro: euro(analisi.righe.reduce((t, r) => t + (r.compensoCentesimi ?? 0), 0)),
    avvisiFile: analisi.avvisiFile,
  };
}

// ---------------------------------------------------------------------------------------------
// Dare/avere
// ---------------------------------------------------------------------------------------------

/** Una riga per ogni importazione confermata che riguarda il collaboratore nell'anno, con importo maggiore di zero. */
export async function righeImportateDareAvere(collaboratoreId: number, anno: number) {
  const righe = await db
    .select({
      importazione: importazioniTable,
      righe: sql<number>`count(*)::int`,
      totale: sql<number>`sum(${importazioniRigheTable.compensoCentesimi})::int`,
      base: sql<number | null>`max(${importazioniRigheTable.baseCentesimi})::int`,
      precedente: sql<number | null>`max(${importazioniRigheTable.precedenteCentesimi})::int`,
    })
    .from(importazioniRigheTable)
    .innerJoin(importazioniTable, eq(importazioniTable.id, importazioniRigheTable.importazioneId))
    .where(and(eq(importazioniRigheTable.collaboratoreId, collaboratoreId), eq(importazioniTable.annoDareAvere, anno), eq(importazioniTable.stato, "confermata")))
    .groupBy(importazioniTable.id)
    .orderBy(importazioniTable.confermatoIl, importazioniTable.id);
  return righe
    .filter((r) => r.totale > 0)
    .map(({ importazione: i, totale, base, precedente }) => ({
      importazioneId: i.id,
      sezione: SERVIZI[i.servizio].sezione,
      descrizione:
        i.servizio === "mod730"
          ? `730/${i.anno} Saldo`
          : i.servizio === "isee"
            ? `ISEE trimestre ${i.trimestre} ${i.anno}`
            : `NASPI ${i.periodo || `import del ${i.confermatoIl ? dataRoma(i.confermatoIl) : ""}`.trim()}`,
      centesimi: totale,
      riferimento: i.confermatoIl ? `Import ${dataRoma(i.confermatoIl)}` : null,
      nota: i.servizio === "naspi" && base !== null && precedente !== null ? `Cumulato ${euroTesto(base)}, precedente ${euroTesto(precedente)}` : `File ${i.nomeFile}`.slice(0, 120),
    }));
}
