/**
 * Ricevute dei collaboratori: impostazioni stampate, importo in lettere, creazione a partire da una riga del dare/avere,
 * elenco con filtri e dettaglio. Importi in centesimi nel database e in euro nell'API.
 */
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { collaboratoriTable, db, impostazioniTable, personeTable, ricevuteTable, utentiTable } from "@workspace/db";
import { like } from "drizzle-orm";
import { HttpError, nonTrovato } from "./errori";
import { oggiRoma } from "./eventi";
import type { Executor } from "./log";
import { TITOLO_SEZIONE, controllaData, dareAvere, euro, leggiImpostazioniStampa, nomeCompleto, type Sezione } from "./compensi";

// ---------------------------------------------------------------------------------------------
// Impostazioni
// ---------------------------------------------------------------------------------------------

const PREFISSO = "ricevuta.";
export const CAUSALE_PREDEFINITA = "compensi per l'attività di collaborazione svolta per conto del patronato";
export const FRASE_BONIFICO_PREDEFINITA = "Tale somma viene liquidata mediante bonifico bancario alle seguenti coordinate";
export const ALIQUOTA_IVA_PREDEFINITA = 22;

export interface ImpostazioniRicevute {
  patronatoNome: string;
  patronatoIndirizzo: string;
  patronatoCapCitta: string;
  patronatoCodiceFiscale: string;
  causale: string;
  fraseBonifico: string;
  aliquotaIva: number;
}

export async function leggiImpostazioniRicevute(ex: Executor = db): Promise<ImpostazioniRicevute> {
  const righe = await ex.select().from(impostazioniTable).where(like(impostazioniTable.chiave, `${PREFISSO}%`));
  const m = new Map(righe.map((r) => [r.chiave.slice(PREFISSO.length), r.valore]));
  const stampa = await leggiImpostazioniStampa(ex);
  const aliquota = Number(m.get("aliquotaIva"));
  return {
    patronatoNome: m.get("patronatoNome") ?? stampa.dati.nome,
    patronatoIndirizzo: m.get("patronatoIndirizzo") ?? stampa.dati.indirizzo,
    patronatoCapCitta: m.get("patronatoCapCitta") ?? "",
    patronatoCodiceFiscale: m.get("patronatoCodiceFiscale") ?? "",
    causale: m.get("causale") ?? CAUSALE_PREDEFINITA,
    fraseBonifico: m.get("fraseBonifico") ?? FRASE_BONIFICO_PREDEFINITA,
    aliquotaIva: m.has("aliquotaIva") && Number.isFinite(aliquota) ? aliquota : ALIQUOTA_IVA_PREDEFINITA,
  };
}

export async function scriviImpostazioniRicevute(ex: Executor, valori: ImpostazioniRicevute): Promise<void> {
  for (const [k, v] of Object.entries(valori)) {
    const valore = String(v);
    await ex
      .insert(impostazioniTable)
      .values({ chiave: `${PREFISSO}${k}`, valore })
      .onConflictDoUpdate({ target: impostazioniTable.chiave, set: { valore } });
  }
}

// ---------------------------------------------------------------------------------------------
// Importo in lettere
// ---------------------------------------------------------------------------------------------

const UNITA = ["zero", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci", "undici", "dodici", "tredici", "quattordici", "quindici", "sedici", "diciassette", "diciotto", "diciannove"];
const DECINE = ["", "", "venti", "trenta", "quaranta", "cinquanta", "sessanta", "settanta", "ottanta", "novanta"];

function sotto100(n: number): string {
  if (n < 20) return UNITA[n]!;
  const d = Math.floor(n / 10);
  const u = n % 10;
  let base = DECINE[d]!;
  if (u === 1 || u === 8) base = base.slice(0, -1);
  return base + (u ? UNITA[u] : "");
}

function sotto1000(n: number): string {
  const c = Math.floor(n / 100);
  const r = n % 100;
  let centi = c === 0 ? "" : c === 1 ? "cento" : `${UNITA[c]}cento`;
  if (r === 0) return centi;
  if (c > 0 && r >= 80 && r < 90) centi = centi.slice(0, -1);
  return centi + sotto100(r);
}

/** Numero intero (da 0 a 999.999.999) in lettere, tutto attaccato come negli importi delle ricevute. */
export function numeroInLettere(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) throw new HttpError(400, "Importo troppo grande.", "DATI_NON_VALIDI", "importoEuro");
  if (n === 0) return "zero";
  const milioni = Math.floor(n / 1_000_000);
  const migliaia = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  let t = "";
  if (milioni) t += milioni === 1 ? "unmilione" : `${sotto1000(milioni)}milioni`;
  if (migliaia) t += migliaia === 1 ? "mille" : `${sotto1000(migliaia)}mila`;
  if (resto) t += sotto1000(resto);
  if (n % 10 === 3 && n > 10 && t.endsWith("tre")) t = `${t.slice(0, -3)}tré`;
  return t;
}

/** Importo in lettere nel formato delle ricevute, esempio "milleduecentotrentaquattro/56". */
export function importoInLettere(centesimi: number): string {
  const euroIntero = Math.floor(centesimi / 100);
  const cent = String(centesimi % 100).padStart(2, "0");
  return `${numeroInLettere(euroIntero)}/${cent}`;
}

// ---------------------------------------------------------------------------------------------
// Dati stampati
// ---------------------------------------------------------------------------------------------

export interface DatiRicevuta {
  collaboratore: { denominazione: string; indirizzo: string; capComune: string; codiceFiscale: string; banca: string; filiale: string; iban: string };
  patronato: { nome: string; indirizzo: string; capCitta: string; codiceFiscale: string };
  causale: string;
  fraseBonifico: string;
}

export async function anagraficaCollaboratore(ex: Executor, collaboratoreId: number) {
  const [c] = await ex
    .select({
      cognome: personeTable.cognome,
      nome: personeTable.nome,
      codiceFiscalePersona: personeTable.codiceFiscale,
      c: collaboratoriTable,
    })
    .from(collaboratoriTable)
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .where(eq(collaboratoriTable.id, collaboratoreId));
  if (!c) throw nonTrovato("Collaboratore non trovato.");
  return c;
}

function capComune(c: { sedeCap: string | null; sedeComune: string | null; sedeProvincia: string | null }): string {
  const comune = [c.sedeComune, c.sedeProvincia ? `(${c.sedeProvincia})` : null].filter(Boolean).join(" ");
  return [c.sedeCap, comune].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------------------------
// Creazione
// ---------------------------------------------------------------------------------------------

export type OrigineRicevuta = "riga" | "estratto" | "importazione";

export interface CreaRicevuta {
  collaboratoreId: number;
  anno: number;
  origineTipo: OrigineRicevuta;
  origineId: number;
  importoCentesimi: number;
  aliquotaIva: number | null | undefined;
  dataRicevuta: string | null | undefined;
  utenteId: number;
}

export interface RicevutaCreata {
  id: number;
  anno: number;
  numero: number;
  descrizione: string;
  collaboratoreNome: string;
  totaleCentesimi: number;
}

export async function creaRicevuta(tx: Executor, i: CreaRicevuta): Promise<RicevutaCreata> {
  const { c, cognome, nome, codiceFiscalePersona } = await anagraficaCollaboratore(tx, i.collaboratoreId);
  const nomeColl = nomeCompleto(cognome, nome);
  // La riga deve esistere nel dare/avere del collaboratore per quell'anno e non essere un debito.
  const dati = await dareAvere(i.collaboratoreId, i.anno);
  let trovata: { sezione: Sezione; descrizione: string } | null = null;
  for (const s of dati.sezioni) {
    const r = s.righe.find((x) =>
      i.origineTipo === "riga" ? x.id === i.origineId : i.origineTipo === "estratto" ? x.estrattoId === i.origineId : x.importazioneId === i.origineId,
    );
    if (r) trovata = { sezione: s.sezione, descrizione: `${TITOLO_SEZIONE[s.sezione]}: ${r.descrizione}${r.riferimento ? ` (${r.riferimento})` : ""}` };
  }
  if (!trovata) throw nonTrovato("La riga del dare/avere non esiste più. Aggiorna la pagina e riprova.");
  if (trovata.sezione === "debiti") throw new HttpError(400, "Per i debiti non si emette la ricevuta.", "DATI_NON_VALIDI", "origineId");

  const iban = c.iban?.trim();
  if (!iban) throw new HttpError(409, `${nomeColl} non ha l'IBAN: inseriscilo nella scheda del collaboratore prima di creare la ricevuta.`, "IBAN_MANCANTE");
  const denominazione = c.denominazione?.trim() || c.ragioneSociale?.trim() || nomeColl;
  const codiceFiscale = c.tipoSoggetto === "ASSOCIAZIONE" && c.codiceFiscaleAssociazione ? c.codiceFiscaleAssociazione : codiceFiscalePersona;

  const data = i.dataRicevuta ? controllaData(i.dataRicevuta, "dataRicevuta", "Data della ricevuta") : oggiRoma();
  if (data > oggiRoma()) throw new HttpError(400, "La data della ricevuta non può essere futura.", "DATA_NON_VALIDA", "dataRicevuta");
  const anno = Number(data.slice(0, 4));

  const impostazioni = await leggiImpostazioniRicevute(tx);
  const conIva = c.tipoSoggetto === "PARTITA_IVA";
  const aliquota = conIva ? (i.aliquotaIva ?? impostazioni.aliquotaIva) : null;
  const iva = conIva ? Math.round((i.importoCentesimi * aliquota!) / 100) : 0;
  const totale = i.importoCentesimi + iva;

  const stampati: DatiRicevuta = {
    collaboratore: {
      denominazione,
      indirizzo: c.sedeIndirizzo ?? "",
      capComune: capComune(c),
      codiceFiscale,
      banca: c.banca ?? "",
      filiale: c.filiale ?? "",
      iban,
    },
    patronato: { nome: impostazioni.patronatoNome, indirizzo: impostazioni.patronatoIndirizzo, capCitta: impostazioni.patronatoCapCitta, codiceFiscale: impostazioni.patronatoCodiceFiscale },
    causale: impostazioni.causale,
    fraseBonifico: impostazioni.fraseBonifico,
  };

  // Numerazione progressiva dell'anno, senza buchi: un solo inserimento alla volta per anno.
  await tx.execute(sql`select pg_advisory_xact_lock(7001, ${anno})`);
  const [ultimo] = await tx.select({ max: sql<number>`coalesce(max(${ricevuteTable.numero}), 0)::int` }).from(ricevuteTable).where(eq(ricevuteTable.anno, anno));
  const numero = (ultimo?.max ?? 0) + 1;
  const [r] = await tx
    .insert(ricevuteTable)
    .values({
      anno,
      numero,
      dataRicevuta: data,
      collaboratoreId: i.collaboratoreId,
      annoDareAvere: i.anno,
      origineTipo: i.origineTipo,
      origineId: i.origineId,
      origineDescrizione: trovata.descrizione.slice(0, 200),
      imponibileCentesimi: i.importoCentesimi,
      aliquotaIva: aliquota,
      ivaCentesimi: iva,
      totaleCentesimi: totale,
      dati: JSON.stringify(stampati),
      creatoDaUtenteId: i.utenteId,
    })
    .returning({ id: ricevuteTable.id });
  return { id: r!.id, anno, numero, descrizione: trovata.descrizione, collaboratoreNome: nomeColl, totaleCentesimi: totale };
}

// ---------------------------------------------------------------------------------------------
// Elenco e dettaglio
// ---------------------------------------------------------------------------------------------

function riepilogo(r: {
  r: typeof ricevuteTable.$inferSelect;
  cognome: string;
  nome: string;
  denominazione: string | null;
  tipoSoggetto: "PARTITA_IVA" | "ASSOCIAZIONE" | null;
}) {
  return {
    id: r.r.id,
    anno: r.r.anno,
    numero: r.r.numero,
    dataRicevuta: r.r.dataRicevuta,
    collaboratoreId: r.r.collaboratoreId,
    collaboratoreNome: nomeCompleto(r.cognome, r.nome),
    denominazione: r.denominazione,
    tipoSoggetto: r.tipoSoggetto,
    imponibileEuro: euro(r.r.imponibileCentesimi),
    aliquotaIva: r.r.aliquotaIva,
    ivaEuro: euro(r.r.ivaCentesimi),
    totaleEuro: euro(r.r.totaleCentesimi),
    pagata: r.r.pagatoIl !== null,
    pagatoIl: r.r.pagatoIl,
    origineDescrizione: r.r.origineDescrizione,
  };
}

const colonneRiepilogo = {
  r: ricevuteTable,
  cognome: personeTable.cognome,
  nome: personeTable.nome,
  denominazione: collaboratoriTable.denominazione,
  tipoSoggetto: collaboratoriTable.tipoSoggetto,
};

export async function elencoRicevute(f: { dal?: string; al?: string; numero?: number; collaboratoreId?: number; stato?: "da_pagare" | "pagata" }) {
  const condizioni: (SQL | undefined)[] = [
    f.dal ? gte(ricevuteTable.dataRicevuta, f.dal) : undefined,
    f.al ? lte(ricevuteTable.dataRicevuta, f.al) : undefined,
    f.numero ? eq(ricevuteTable.numero, f.numero) : undefined,
    f.collaboratoreId ? eq(ricevuteTable.collaboratoreId, f.collaboratoreId) : undefined,
    f.stato === "pagata" ? sql`${ricevuteTable.pagatoIl} is not null` : f.stato === "da_pagare" ? sql`${ricevuteTable.pagatoIl} is null` : undefined,
  ];
  const righe = await db
    .select(colonneRiepilogo)
    .from(ricevuteTable)
    .innerJoin(collaboratoriTable, eq(collaboratoriTable.id, ricevuteTable.collaboratoreId))
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .where(and(...condizioni))
    .orderBy(desc(ricevuteTable.dataRicevuta), desc(ricevuteTable.anno), desc(ricevuteTable.numero));
  const mappate = righe.map(riepilogo);
  return {
    righe: mappate,
    totale: mappate.length,
    daPagare: mappate.filter((r) => !r.pagata).length,
    pagate: mappate.filter((r) => r.pagata).length,
    totaleEuro: euro(righe.reduce((t, r) => t + r.r.totaleCentesimi, 0)),
  };
}

export async function caricaRicevuta(id: number) {
  const [r] = await db
    .select(colonneRiepilogo)
    .from(ricevuteTable)
    .innerJoin(collaboratoriTable, eq(collaboratoriTable.id, ricevuteTable.collaboratoreId))
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .where(eq(ricevuteTable.id, id));
  if (!r) throw nonTrovato("Ricevuta non trovata.");
  return r;
}

export async function dettaglioRicevuta(id: number) {
  const r = await caricaRicevuta(id);
  const nomeUtente = async (utenteId: number | null) => {
    if (!utenteId) return null;
    const [u] = await db.select({ nome: utentiTable.nome, cognome: utentiTable.cognome }).from(utentiTable).where(eq(utentiTable.id, utenteId));
    return u ? nomeCompleto(u.cognome, u.nome) : null;
  };
  const [successiva] = await db
    .select({ id: ricevuteTable.id })
    .from(ricevuteTable)
    .where(and(eq(ricevuteTable.anno, r.r.anno), sql`${ricevuteTable.numero} > ${r.r.numero}`))
    .limit(1);
  return {
    ricevuta: riepilogo(r),
    annoDareAvere: r.r.annoDareAvere,
    origineTipo: r.r.origineTipo,
    origineId: r.r.origineId,
    creatoIl: r.r.creatoIl.toISOString(),
    creatoDa: await nomeUtente(r.r.creatoDaUtenteId),
    pagamentoMetodo: r.r.pagamentoMetodo,
    pagamentoRegistratoIl: r.r.pagamentoRegistratoIl?.toISOString() ?? null,
    pagamentoRegistratoDa: await nomeUtente(r.r.pagamentoUtenteId),
    allegato: r.r.allegatoChiave
      ? { nome: r.r.allegatoNome ?? "allegato", dimensione: r.r.allegatoDimensione ?? 0, caricatoIl: (r.r.allegatoCaricatoIl ?? r.r.creatoIl).toISOString() }
      : null,
    eliminabile: !r.r.pagatoIl && !successiva,
  };
}
