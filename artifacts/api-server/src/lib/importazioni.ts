/**
 * Import dei servizi da Excel (730, ISEE, NASPI, Pensionati): configurazione per servizio, anteprima con errori,
 * calcolo del compenso (importo fisso per riga o percentuale di una colonna) e righe riportate nel dare/avere.
 * Gli importi sono in centesimi nel database e in euro nell'API.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  collaboratoriTable,
  db,
  impostazioniTable,
  importazioniRigheTable,
  importazioniTable,
  personeTable,
  utentiTable,
} from "@workspace/db";
import { HttpError } from "./errori";
import { formattaData } from "./eventi";
import type { Executor } from "./log";
import { leggiFile } from "./storage";
import { leggiImporto, leggiTabella, type Tabella } from "./tabella-file";

export const SERVIZI = {
  mod730: { etichetta: "730", sezione: "caf" },
  isee: { etichetta: "ISEE", sezione: "caf" },
  naspi: { etichetta: "NASPI", sezione: "naspi" },
  pensionati: { etichetta: "Pensionati", sezione: "pensionati" },
} as const;
export type Servizio = keyof typeof SERVIZI;
export const CODICI_SERVIZI = Object.keys(SERVIZI) as Servizio[];

export type TipoChiave = "sportello" | "email" | "nome";
export interface ConfigImport {
  regola: "fisso" | "percentuale";
  /** Regola fissa: centesimi di euro per riga. Regola percentuale: punti base (12,5% = 1250). */
  valoreCentesimi: number;
  colonnaChiave: string;
  tipoChiave: TipoChiave;
  colonnaImporto: string | null;
}

const chiaveConfig = (s: Servizio) => `import.${s}`;
const euro = (c: number) => c / 100;

export function etichettaServizio(s: string): string {
  return (SERVIZI as Record<string, { etichetta: string }>)[s]?.etichetta ?? s;
}

export async function leggiConfigurazione(servizio: Servizio, ex: Executor = db): Promise<ConfigImport | null> {
  const [r] = await ex.select().from(impostazioniTable).where(eq(impostazioniTable.chiave, chiaveConfig(servizio)));
  if (!r) return null;
  try {
    return JSON.parse(r.valore) as ConfigImport;
  } catch {
    return null;
  }
}

export async function scriviConfigurazione(ex: Executor, servizio: Servizio, c: ConfigImport): Promise<void> {
  const valore = JSON.stringify(c);
  await ex.insert(impostazioniTable).values({ chiave: chiaveConfig(servizio), valore }).onConflictDoUpdate({ target: impostazioniTable.chiave, set: { valore } });
}

export function mappaServizio(servizio: Servizio, c: ConfigImport | null) {
  return {
    servizio,
    etichetta: SERVIZI[servizio].etichetta,
    sezione: SERVIZI[servizio].sezione,
    regola: c?.regola ?? null,
    valore: c ? euro(c.valoreCentesimi) : null,
    colonnaChiave: c?.colonnaChiave ?? null,
    tipoChiave: c?.tipoChiave ?? ("sportello" as TipoChiave),
    colonnaImporto: c?.colonnaImporto ?? null,
    configurato: !!c && !!c.colonnaChiave && (c.regola === "fisso" || !!c.colonnaImporto),
  };
}

export async function elencoServizi() {
  return Promise.all(CODICI_SERVIZI.map(async (s) => mappaServizio(s, await leggiConfigurazione(s))));
}

/** Controlla e converte il corpo della richiesta di configurazione. */
export function costruisciConfigurazione(i: { regola: "fisso" | "percentuale"; valore: number; colonnaChiave: string; tipoChiave: TipoChiave; colonnaImporto?: string | null }): ConfigImport {
  const c = Math.round(i.valore * 100);
  if (Math.abs(i.valore * 100 - c) > 1e-6) throw new HttpError(400, "Il valore può avere al massimo due decimali.", "DATI_NON_VALIDI", "valore");
  if (i.regola === "percentuale" && c > 10000) throw new HttpError(400, "La percentuale non può superare 100.", "DATI_NON_VALIDI", "valore");
  const colonnaChiave = i.colonnaChiave.trim();
  if (!colonnaChiave) throw new HttpError(400, "Indica la colonna che identifica il collaboratore.", "DATI_NON_VALIDI", "colonnaChiave");
  const colonnaImporto = i.colonnaImporto?.trim() || null;
  if (i.regola === "percentuale" && !colonnaImporto) {
    throw new HttpError(400, "Con la regola a percentuale indica la colonna dell'importo.", "DATI_NON_VALIDI", "colonnaImporto");
  }
  return { regola: i.regola, valoreCentesimi: c, colonnaChiave, tipoChiave: i.tipoChiave, colonnaImporto: i.regola === "percentuale" ? colonnaImporto : null };
}

// ---------------------------------------------------------------------------------------------
// Analisi del file
// ---------------------------------------------------------------------------------------------

const normTesto = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@._-]+/g, " ")
    .trim();
const normSportello = (s: string) => s.replace(/\s+/g, "").replace(/^0+(?=\d)/, "").toLowerCase();

interface Coll {
  id: number;
  nome: string;
  sportello: string;
}
interface Indici {
  sportello: Map<string, Coll[]>;
  email: Map<string, Coll[]>;
  nome: Map<string, Coll[]>;
}

async function indiciCollaboratori(): Promise<Indici> {
  const lista = await db
    .select({ id: collaboratoriTable.id, sportello: collaboratoriTable.numeroSportello, nome: personeTable.nome, cognome: personeTable.cognome, email: personeTable.email })
    .from(collaboratoriTable)
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId));
  const idx: Indici = { sportello: new Map(), email: new Map(), nome: new Map() };
  const aggiungi = (m: Map<string, Coll[]>, k: string, c: Coll) => {
    if (!k) return;
    const v = m.get(k) ?? [];
    if (!v.some((x) => x.id === c.id)) m.set(k, [...v, c]);
  };
  for (const r of lista) {
    const c = { id: r.id, nome: `${r.cognome} ${r.nome}`.trim(), sportello: r.sportello };
    aggiungi(idx.sportello, normSportello(r.sportello), c);
    if (r.email) aggiungi(idx.email, r.email.trim().toLowerCase(), c);
    aggiungi(idx.nome, normTesto(`${r.cognome} ${r.nome}`), c);
    aggiungi(idx.nome, normTesto(`${r.nome} ${r.cognome}`), c);
  }
  return idx;
}

export interface RigaAnalizzata {
  numeroRiga: number;
  riferimento: string | null;
  collaboratoreId: number | null;
  collaboratoreNome: string | null;
  baseCentesimi: number | null;
  compensoCentesimi: number | null;
  errori: string[];
}

export interface Analisi {
  intestazioni: string[];
  configurazioneCompleta: boolean;
  messaggioConfigurazione: string | null;
  righe: RigaAnalizzata[];
}

const testoCella = (c: string | number | null): string => (c === null ? "" : typeof c === "number" ? (Number.isInteger(c) ? String(c) : String(c)) : c.trim());
const colonna = (intest: string[], nome: string) => {
  const n = normTesto(nome);
  return intest.findIndex((h) => normTesto(h) === n);
};

export async function analizzaTabella(t: Tabella, c: ConfigImport | null): Promise<Analisi> {
  const base = { intestazioni: t.intestazioni, righe: [] as RigaAnalizzata[] };
  if (!c || !c.colonnaChiave) {
    return { ...base, configurazioneCompleta: false, messaggioConfigurazione: "Imposta la regola di calcolo e la colonna che identifica il collaboratore." };
  }
  const iChiave = colonna(t.intestazioni, c.colonnaChiave);
  if (iChiave < 0) {
    return { ...base, configurazioneCompleta: false, messaggioConfigurazione: `La colonna «${c.colonnaChiave}» non è presente nel file. Scegli una delle colonne trovate.` };
  }
  let iImporto = -1;
  if (c.regola === "percentuale") {
    iImporto = c.colonnaImporto ? colonna(t.intestazioni, c.colonnaImporto) : -1;
    if (iImporto < 0) {
      return { ...base, configurazioneCompleta: false, messaggioConfigurazione: c.colonnaImporto ? `La colonna dell'importo «${c.colonnaImporto}» non è presente nel file.` : "Indica la colonna dell'importo su cui calcolare la percentuale." };
    }
  }
  const idx = await indiciCollaboratori();
  const mappa = idx[c.tipoChiave];
  const etichettaChiave = { sportello: "numero sportello", email: "email", nome: "nome" }[c.tipoChiave];
  const righe: RigaAnalizzata[] = t.righe.map((r) => {
    const errori: string[] = [];
    const grezzo = testoCella(r.celle[iChiave] ?? null);
    const k = c.tipoChiave === "sportello" ? normSportello(grezzo) : c.tipoChiave === "email" ? grezzo.toLowerCase() : normTesto(grezzo);
    let coll: Coll | null = null;
    if (!grezzo) errori.push(`Manca il valore della colonna «${c.colonnaChiave}».`);
    else {
      const trovati = mappa.get(k) ?? [];
      if (trovati.length === 0) errori.push(`Nessun collaboratore con ${etichettaChiave} «${grezzo}».`);
      else if (trovati.length > 1) errori.push(`Più collaboratori corrispondono a ${etichettaChiave} «${grezzo}».`);
      else coll = trovati[0]!;
    }
    let base: number | null = null;
    let compenso: number | null = null;
    if (c.regola === "fisso") compenso = c.valoreCentesimi;
    else {
      const cella = r.celle[iImporto] ?? null;
      const n = leggiImporto(cella);
      if (n === null) errori.push(cella === null ? `Manca l'importo (colonna «${c.colonnaImporto}»).` : `Importo non valido: «${testoCella(cella)}».`);
      else if (n < 0) errori.push(`Importo negativo: «${testoCella(cella)}».`);
      else {
        base = Math.round(n * 100);
        compenso = Math.round((base * c.valoreCentesimi) / 10000);
      }
    }
    return {
      numeroRiga: r.numero,
      riferimento: grezzo || null,
      collaboratoreId: coll?.id ?? null,
      collaboratoreNome: coll?.nome ?? null,
      baseCentesimi: base,
      compensoCentesimi: errori.length ? null : compenso,
      errori,
    };
  });
  return { ...base, righe, configurazioneCompleta: true, messaggioConfigurazione: null };
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

type RigaImportazione = typeof importazioniTable.$inferSelect;

export async function mappaImportazione(i: RigaImportazione) {
  return {
    id: i.id,
    servizio: i.servizio,
    servizioEtichetta: etichettaServizio(i.servizio),
    anno: i.anno,
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

export async function importazioneConfermataDuplicata(servizio: Servizio, hash: string, ex: Executor = db) {
  const [d] = await ex
    .select()
    .from(importazioniTable)
    .where(and(eq(importazioniTable.servizio, servizio), eq(importazioniTable.hashFile, hash), eq(importazioniTable.stato, "confermata")));
  return d ?? null;
}

export function erroreDuplicato(d: RigaImportazione): HttpError {
  const quando = d.confermatoIl ? formattaData(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(d.confermatoIl)) : "";
  return new HttpError(409, `Questo file è già stato importato per ${etichettaServizio(d.servizio)}${quando ? ` il ${quando}` : ""} (importazione n. ${d.id}). Lo stesso file non si può importare due volte.`, "IMPORT_DUPLICATO");
}

export async function leggiBuffer(chiave: string): Promise<Buffer> {
  const { stream } = await leggiFile(chiave);
  const pezzi: Buffer[] = [];
  for await (const c of stream) pezzi.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(pezzi);
}

export const estensioneDi = (nomeFile: string) => (nomeFile.includes(".") ? nomeFile.split(".").pop()!.toLowerCase() : "");

export async function analizzaImportazione(i: RigaImportazione, ex: Executor = db) {
  const buffer = await leggiBuffer(i.chiaveFile);
  const tabella = await leggiTabella(buffer, estensioneDi(i.nomeFile));
  const config = await leggiConfigurazione(i.servizio, ex);
  return { config, analisi: await analizzaTabella(tabella, config) };
}

function raggruppa(righe: { collaboratoreId: number; collaboratoreNome: string; sportello: string; compenso: number }[]) {
  const m = new Map<number, { collaboratoreId: number; collaboratoreNome: string; numeroSportello: string; righe: number; cent: number }>();
  for (const r of righe) {
    const e = m.get(r.collaboratoreId) ?? { collaboratoreId: r.collaboratoreId, collaboratoreNome: r.collaboratoreNome, numeroSportello: r.sportello, righe: 0, cent: 0 };
    e.righe += 1;
    e.cent += r.compenso;
    m.set(r.collaboratoreId, e);
  }
  return [...m.values()]
    .sort((a, b) => a.collaboratoreNome.localeCompare(b.collaboratoreNome, "it"))
    .map(({ cent, ...e }) => ({ ...e, compensoEuro: euro(cent) }));
}

async function sportelloDi(ids: number[]): Promise<Map<number, string>> {
  const righe = await db.select({ id: collaboratoriTable.id, s: collaboratoriTable.numeroSportello }).from(collaboratoriTable);
  const m = new Map(righe.map((r) => [r.id, r.s]));
  return new Map(ids.map((id) => [id, m.get(id) ?? ""]));
}

/** Dettaglio di un'importazione: per un'anteprima rilegge il file con la regola attuale, per una confermata usa le righe salvate. */
export async function dettaglioImportazione(id: number) {
  const i = await caricaImportazione(id);
  const importazione = await mappaImportazione(i);
  if (i.stato === "confermata") {
    const righe = await db
      .select({ r: importazioniRigheTable, cognome: personeTable.cognome, nome: personeTable.nome, sportello: collaboratoriTable.numeroSportello })
      .from(importazioniRigheTable)
      .innerJoin(collaboratoriTable, eq(collaboratoriTable.id, importazioniRigheTable.collaboratoreId))
      .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
      .where(eq(importazioniRigheTable.importazioneId, id))
      .orderBy(importazioniRigheTable.numeroRiga);
    const conf = i.configurazione ? (JSON.parse(i.configurazione) as ConfigImport) : null;
    return {
      importazione,
      configurazione: mappaServizio(i.servizio, conf),
      configurazioneCompleta: true,
      messaggioConfigurazione: null,
      intestazioni: [] as string[],
      righe: righe.map((x) => ({
        numeroRiga: x.r.numeroRiga,
        riferimento: x.r.riferimento,
        collaboratoreId: x.r.collaboratoreId,
        collaboratoreNome: `${x.cognome} ${x.nome}`.trim(),
        baseEuro: x.r.baseCentesimi === null ? null : euro(x.r.baseCentesimi),
        compensoEuro: euro(x.r.compensoCentesimi),
        errori: [] as string[],
      })),
      righeValide: righe.length,
      righeConErrori: 0,
      totaleEuro: euro(righe.reduce((t, x) => t + x.r.compensoCentesimi, 0)),
      perCollaboratore: raggruppa(righe.map((x) => ({ collaboratoreId: x.r.collaboratoreId, collaboratoreNome: `${x.cognome} ${x.nome}`.trim(), sportello: x.sportello, compenso: x.r.compensoCentesimi }))),
    };
  }
  const { config, analisi } = await analizzaImportazione(i);
  const valide = analisi.righe.filter((r) => r.errori.length === 0);
  const sp = await sportelloDi(valide.map((r) => r.collaboratoreId!));
  return {
    importazione,
    configurazione: mappaServizio(i.servizio, config),
    configurazioneCompleta: analisi.configurazioneCompleta,
    messaggioConfigurazione: analisi.messaggioConfigurazione,
    intestazioni: analisi.intestazioni,
    righe: analisi.righe.map((r) => ({
      numeroRiga: r.numeroRiga,
      riferimento: r.riferimento,
      collaboratoreId: r.collaboratoreId,
      collaboratoreNome: r.collaboratoreNome,
      baseEuro: r.baseCentesimi === null ? null : euro(r.baseCentesimi),
      compensoEuro: r.compensoCentesimi === null ? null : euro(r.compensoCentesimi),
      errori: r.errori,
    })),
    righeValide: valide.length,
    righeConErrori: analisi.righe.length - valide.length,
    totaleEuro: euro(valide.reduce((t, r) => t + (r.compensoCentesimi ?? 0), 0)),
    perCollaboratore: raggruppa(valide.map((r) => ({ collaboratoreId: r.collaboratoreId!, collaboratoreNome: r.collaboratoreNome!, sportello: sp.get(r.collaboratoreId!) ?? "", compenso: r.compensoCentesimi ?? 0 }))),
  };
}

// ---------------------------------------------------------------------------------------------
// Dare/avere
// ---------------------------------------------------------------------------------------------

/** Una riga per ogni importazione confermata che riguarda il collaboratore nell'anno, raggruppata per sezione. */
export async function righeImportateDareAvere(collaboratoreId: number, anno: number) {
  const righe = await db
    .select({
      importazioneId: importazioniTable.id,
      servizio: importazioniTable.servizio,
      nomeFile: importazioniTable.nomeFile,
      confermatoIl: importazioniTable.confermatoIl,
      righe: sql<number>`count(*)::int`,
      totale: sql<number>`sum(${importazioniRigheTable.compensoCentesimi})::int`,
    })
    .from(importazioniRigheTable)
    .innerJoin(importazioniTable, eq(importazioniTable.id, importazioniRigheTable.importazioneId))
    .where(and(eq(importazioniRigheTable.collaboratoreId, collaboratoreId), eq(importazioniTable.anno, anno), eq(importazioniTable.stato, "confermata")))
    .groupBy(importazioniTable.id)
    .orderBy(importazioniTable.confermatoIl, importazioniTable.id);
  return righe.map((r) => ({
    importazioneId: r.importazioneId,
    sezione: SERVIZI[r.servizio].sezione,
    descrizione: `${SERVIZI[r.servizio].etichetta} - ${r.nomeFile}`.slice(0, 120),
    centesimi: r.totale,
    riferimento: r.confermatoIl ? `Import ${formattaData(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(r.confermatoIl))}` : null,
    nota: `${r.righe} ${r.righe === 1 ? "riga" : "righe"}`,
  }));
}
