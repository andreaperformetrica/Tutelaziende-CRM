/**
 * Compensi ai collaboratori: maturazione alla chiusura delle pratiche, resoconto, estratti, impostazioni degli
 * stampati e dare/avere. Gli importi sono in centesimi nel database e in euro (due decimali) nell'API.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, like, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  assistitiTable,
  collaboratoriTable,
  compensiRigheTable,
  db,
  estrattiRigheTable,
  estrattiTable,
  eventiPraticaTable,
  impostazioniTable,
  notificheTable,
  personeTable,
  praticheTable,
  statiPraticaTable,
  tipiPraticaTable,
  utentiTable,
} from "@workspace/db";
import { righeImportateDareAvere } from "./importazioni";
import { HttpError, nonTrovato } from "./errori";
import { dataValida, formattaData, oggiRoma } from "./eventi";
import type { Executor } from "./log";
import { ESITI_NOTIFICA } from "./notifiche";

export const GIORNI_PROPOSTI = 60;
export const NOME_STATO_PAGATA = "pagata";

export const ETICHETTA_METODO = { bonifico: "Bonifico", contanti: "Contanti", assegno: "Assegno", altro: "Altro" } as const;
export const TITOLO_SEZIONE = { naspi: "Naspi", pensionati: "Pensionati", patronato: "Patronato", caf: "CAF", debiti: "Debiti" } as const;
export type Sezione = keyof typeof TITOLO_SEZIONE;
const ORDINE_SEZIONI: Sezione[] = ["naspi", "pensionati", "patronato", "caf", "debiti"];

export const euro = (centesimi: number) => centesimi / 100;

/** Euro con al massimo due decimali -> centesimi. */
export function centesimiDaEuro(valore: number, campo: string): number {
  const c = Math.round(valore * 100);
  if (!Number.isFinite(valore) || Math.abs(valore * 100 - c) > 1e-6) {
    throw new HttpError(400, "L'importo può avere al massimo due decimali.", "DATI_NON_VALIDI", campo);
  }
  if (c <= 0) throw new HttpError(400, "L'importo deve essere maggiore di zero.", "DATI_NON_VALIDI", campo);
  return c;
}

export function controllaData(valore: string, campo: string, etichetta: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valore) || !dataValida(valore)) {
    throw new HttpError(400, `${etichetta}: data non valida.`, "DATA_NON_VALIDA", campo);
  }
  return valore;
}

export const nomeCompleto = (cognome: string, nome: string) => `${cognome} ${nome}`.trim();

// ---------------------------------------------------------------------------------------------
// Maturazione alla chiusura
// ---------------------------------------------------------------------------------------------

export interface EsitoMaturazione {
  maturata: boolean;
  punti: number;
  valoreCentesimi: number;
}

/**
 * Da chiamare quando cambia lo stato di una pratica. Passando a uno stato chiuso, per un tipo pagabile, si fissano punti e valore
 * del tipo; passando a uno stato aperto si azzerano. Da chiuso a chiuso non cambia nulla (la data di chiusura resta la prima).
 */
export async function aggiornaMaturazione(
  tx: Executor,
  pratica: { id: number; tipoPraticaId: number; chiusaIl: Date | null },
  nuovoStato: { chiuso: boolean },
  ora: Date,
): Promise<EsitoMaturazione | null> {
  if (!nuovoStato.chiuso) {
    if (pratica.chiusaIl) {
      await tx.update(praticheTable).set({ chiusaIl: null, maturaPunti: null, maturaValoreCentesimi: null }).where(eq(praticheTable.id, pratica.id));
    }
    return null;
  }
  if (pratica.chiusaIl) return null;
  const [tipo] = await tx.select().from(tipiPraticaTable).where(eq(tipiPraticaTable.id, pratica.tipoPraticaId));
  if (!tipo?.pagabile) return null;
  await tx
    .update(praticheTable)
    .set({ chiusaIl: ora, maturaPunti: tipo.punti, maturaValoreCentesimi: tipo.valoreCentesimi })
    .where(eq(praticheTable.id, pratica.id));
  return { maturata: true, punti: tipo.punti, valoreCentesimi: tipo.valoreCentesimi };
}

/** Estratto che contiene la pratica, se c'e'. */
export async function estrattoDellaPratica(ex: Executor, praticaId: number): Promise<number | null> {
  const [r] = await ex.select({ id: estrattiRigheTable.estrattoId }).from(estrattiRigheTable).where(eq(estrattiRigheTable.praticaId, praticaId));
  return r?.id ?? null;
}

/**
 * Una sola volta, all'avvio: le pratiche gia' chiuse prima dell'introduzione dei compensi maturano con la data dell'ultimo
 * cambio di stato e con i valori attuali del tipo.
 */
export async function maturaPraticheGiaChiuse(): Promise<number> {
  const MARCATORE = "compensi_maturazione_iniziale";
  return db.transaction(async (tx) => {
    const [gia] = await tx.select().from(impostazioniTable).where(eq(impostazioniTable.chiave, MARCATORE));
    if (gia) return 0;
    const risultato = await tx.execute(sql`
      update pratiche p
         set chiusa_il = coalesce(
               (select max(e.creato_il) from eventi_pratica e where e.pratica_id = p.id and e.tipo = 'cambio_stato'),
               p.modificata_il),
             matura_punti = t.punti,
             matura_valore_centesimi = t.valore_centesimi
        from stati_pratica s, tipi_pratica t
       where s.id = p.stato_id and s.chiuso = true
         and t.id = p.tipo_pratica_id and t.pagabile = true
         and p.chiusa_il is null and p.inviata_il is not null`);
    await tx.insert(impostazioniTable).values({ chiave: MARCATORE, valore: new Date().toISOString() });
    return risultato.rowCount ?? 0;
  });
}

/** Stato "Pagata": quello con questo nome oppure, se non esiste, uno nuovo (chiuso, in fondo all'elenco). */
export async function statoPagata(tx: Executor): Promise<{ id: number; nome: string }> {
  const [esistente] = await tx
    .select({ id: statiPraticaTable.id, nome: statiPraticaTable.nome })
    .from(statiPraticaTable)
    .where(sql`lower(trim(${statiPraticaTable.nome})) = ${NOME_STATO_PAGATA}`);
  if (esistente) return esistente;
  const [ultimo] = await tx.select({ max: sql<number>`coalesce(max(${statiPraticaTable.ordine}), 0)::int` }).from(statiPraticaTable);
  const [nuovo] = await tx
    .insert(statiPraticaTable)
    .values({ nome: "Pagata", chiuso: true, ordine: (ultimo?.max ?? 0) + 1 })
    .returning({ id: statiPraticaTable.id, nome: statiPraticaTable.nome });
  return nuovo!;
}

// ---------------------------------------------------------------------------------------------
// Resoconto
// ---------------------------------------------------------------------------------------------

const personaColl = personeTable;
const personaAss = alias(personeTable, "persona_assistito");

export async function resoconto(filtri: { collaboratoreId?: number; dal?: string; al?: string; giorni?: number; ids?: number[] }) {
  const oggi = oggiRoma();
  const dataChiusura = sql<string>`to_char((${praticheTable.chiusaIl} at time zone 'Europe/Rome')::date, 'YYYY-MM-DD')`;
  const condizioni: (SQL | undefined)[] = [
    isNotNull(praticheTable.chiusaIl),
    isNotNull(praticheTable.inviataIl),
    eq(statiPraticaTable.chiuso, true),
    eq(tipiPraticaTable.pagabile, true),
    sql`not exists (select 1 from ${estrattiRigheTable} er where er.pratica_id = ${praticheTable.id})`,
    filtri.collaboratoreId ? eq(praticheTable.collaboratoreId, filtri.collaboratoreId) : undefined,
    filtri.ids ? inArray(praticheTable.id, filtri.ids) : undefined,
    filtri.dal ? sql`(${praticheTable.chiusaIl} at time zone 'Europe/Rome')::date >= ${filtri.dal}::date` : undefined,
    filtri.al ? sql`(${praticheTable.chiusaIl} at time zone 'Europe/Rome')::date <= ${filtri.al}::date` : undefined,
    filtri.giorni ? sql`(${praticheTable.chiusaIl} at time zone 'Europe/Rome')::date <= ${oggi}::date - ${filtri.giorni}::int` : undefined,
  ];
  const righe = await db
    .select({
      praticaId: praticheTable.id,
      numero: praticheTable.numero,
      assCognome: personaAss.cognome,
      assNome: personaAss.nome,
      collaboratoreId: praticheTable.collaboratoreId,
      collCognome: personaColl.cognome,
      collNome: personaColl.nome,
      sportello: collaboratoriTable.numeroSportello,
      tipoNome: tipiPraticaTable.nome,
      inviataIl: praticheTable.inviataIl,
      chiusaIl: praticheTable.chiusaIl,
      giorni: sql<number>`(${oggi}::date - (${praticheTable.chiusaIl} at time zone 'Europe/Rome')::date)::int`,
      punti: praticheTable.maturaPunti,
      valore: praticheTable.maturaValoreCentesimi,
      dataChiusura,
    })
    .from(praticheTable)
    .innerJoin(statiPraticaTable, eq(statiPraticaTable.id, praticheTable.statoId))
    .innerJoin(tipiPraticaTable, eq(tipiPraticaTable.id, praticheTable.tipoPraticaId))
    .innerJoin(assistitiTable, eq(assistitiTable.id, praticheTable.assistitoId))
    .innerJoin(personaAss, eq(personaAss.id, assistitiTable.personaId))
    .innerJoin(collaboratoriTable, eq(collaboratoriTable.id, praticheTable.collaboratoreId))
    .innerJoin(personaColl, eq(personaColl.id, collaboratoriTable.personaId))
    .where(and(...condizioni))
    .orderBy(asc(personaColl.cognome), asc(personaColl.nome), asc(praticheTable.chiusaIl), asc(praticheTable.numero));
  const mappate = righe.map((r) => ({
    praticaId: r.praticaId,
    numero: r.numero!,
    assistito: nomeCompleto(r.assCognome, r.assNome).toUpperCase(),
    collaboratoreId: r.collaboratoreId,
    collaboratoreNome: nomeCompleto(r.collCognome, r.collNome),
    numeroSportello: r.sportello,
    tipoNome: r.tipoNome,
    dataPratica: r.inviataIl ? dataRoma(r.inviataIl) : null,
    chiusaIl: r.chiusaIl!.toISOString(),
    giorniDallaChiusura: r.giorni,
    punti: r.punti ?? 0,
    valoreEuro: euro(r.valore ?? 0),
  }));
  return {
    righe: mappate,
    totalePunti: mappate.reduce((t, r) => t + r.punti, 0),
    totaleEuro: euro(righe.reduce((t, r) => t + (r.valore ?? 0), 0)),
  };
}

/** AAAA-MM-GG di un istante nel calendario italiano. */
export function dataRoma(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// ---------------------------------------------------------------------------------------------
// Estratti
// ---------------------------------------------------------------------------------------------

function mappaRiepilogo(r: {
  e: typeof estrattiTable.$inferSelect;
  cognome: string;
  nome: string;
  sportello: string;
  numeroPratiche: number;
}) {
  return {
    id: r.e.id,
    collaboratoreId: r.e.collaboratoreId,
    collaboratoreNome: nomeCompleto(r.cognome, r.nome),
    numeroSportello: r.sportello,
    dataEstratto: r.e.dataEstratto,
    numeroPratiche: r.numeroPratiche,
    totalePunti: r.e.totalePunti,
    totaleEuro: euro(r.e.totaleCentesimi),
    pagato: r.e.pagatoIl !== null,
    pagatoIl: r.e.pagatoIl,
    pagamentoEuro: r.e.pagamentoCentesimi === null ? null : euro(r.e.pagamentoCentesimi),
    pagamentoMetodo: r.e.pagamentoMetodo,
  };
}

export async function elencoEstratti(filtri: { collaboratoreId?: number; stato?: "da_pagare" | "pagato"; anno?: number; id?: number }) {
  const righe = await db
    .select({
      e: estrattiTable,
      cognome: personeTable.cognome,
      nome: personeTable.nome,
      sportello: collaboratoriTable.numeroSportello,
      numeroPratiche: sql<number>`(select count(*)::int from ${estrattiRigheTable} er where er.estratto_id = "estratti"."id")`,
    })
    .from(estrattiTable)
    .innerJoin(collaboratoriTable, eq(collaboratoriTable.id, estrattiTable.collaboratoreId))
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .where(
      and(
        filtri.id ? eq(estrattiTable.id, filtri.id) : undefined,
        filtri.collaboratoreId ? eq(estrattiTable.collaboratoreId, filtri.collaboratoreId) : undefined,
        filtri.stato === "pagato" ? isNotNull(estrattiTable.pagatoIl) : filtri.stato === "da_pagare" ? isNull(estrattiTable.pagatoIl) : undefined,
        filtri.anno ? sql`extract(year from ${estrattiTable.dataEstratto})::int = ${filtri.anno}` : undefined,
      ),
    )
    .orderBy(desc(estrattiTable.dataEstratto), desc(estrattiTable.id));
  return righe.map(mappaRiepilogo);
}

export async function emailCollaboratore(collaboratoreId: number): Promise<{ nome: string; email: string | null; utenteId: number } | null> {
  const [r] = await db
    .select({ nome: personeTable.nome, emailPersona: personeTable.email, emailUtente: utentiTable.email, utenteId: collaboratoriTable.utenteId })
    .from(collaboratoriTable)
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .innerJoin(utentiTable, eq(utentiTable.id, collaboratoriTable.utenteId))
    .where(eq(collaboratoriTable.id, collaboratoreId));
  return r ? { nome: r.nome, email: r.emailPersona ?? r.emailUtente, utenteId: r.utenteId } : null;
}

export async function estrattoDettaglio(id: number) {
  const [riepilogo] = await elencoEstratti({ id });
  if (!riepilogo) throw nonTrovato("Estratto non trovato.");
  const [e] = await db.select().from(estrattiTable).where(eq(estrattiTable.id, id));
  const righe = await db.select().from(estrattiRigheTable).where(eq(estrattiRigheTable.estrattoId, id)).orderBy(asc(estrattiRigheTable.ordine));
  const nomeUtente = async (utenteId: number | null) => {
    if (!utenteId) return null;
    const [u] = await db.select({ nome: utentiTable.nome, cognome: utentiTable.cognome }).from(utentiTable).where(eq(utentiTable.id, utenteId));
    return u ? nomeCompleto(u.cognome, u.nome) : null;
  };
  const invii = await db.select().from(notificheTable).where(eq(notificheTable.estrattoId, id)).orderBy(desc(notificheTable.creatoIl), desc(notificheTable.id));
  const dest = await emailCollaboratore(e!.collaboratoreId);
  return {
    estratto: riepilogo,
    righe: righe.map((r) => ({
      praticaId: r.praticaId,
      assistito: r.assistito,
      numeroPratica: r.numeroPratica,
      tipoPratica: r.tipoPratica,
      dataPratica: r.dataPratica,
      punti: r.punti,
      valoreEuro: euro(r.valoreCentesimi),
    })),
    creatoIl: e!.creatoIl.toISOString(),
    creatoDa: await nomeUtente(e!.creatoDaUtenteId),
    pagamentoRegistratoIl: e!.pagamentoRegistratoIl?.toISOString() ?? null,
    pagamentoRegistratoDa: await nomeUtente(e!.pagamentoUtenteId),
    emailDestinatario: dest?.email ?? null,
    invii: invii.map((n) => ({
      id: n.id,
      creatoIl: n.creatoIl.toISOString(),
      destinatarioContatto: n.destinatarioContatto,
      esito: n.esito,
      esitoEtichetta: ESITI_NOTIFICA[n.esito],
      dettaglioEsito: n.dettaglioEsito,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Impostazioni degli stampati
// ---------------------------------------------------------------------------------------------

const PREFISSO = "stampa.";
export const NOTA_1_PREDEFINITA =
  "Si comunica ai signori collaboratori che per la consegna della documentazione delle sopraelencate pratiche, devono obbligatoriamente verificare se per le stesse è stata richiesta un'integrazione documentale in piattaforma patronato.";
export const NOTA_2_PREDEFINITA = "N.B. Per la consegna delle pratiche in sede, fissare l'appuntamento con l'ufficio";
const PREDEFINITI = { nome: "Tutela", motto: "", indirizzo: "", telefono: "", email: "", nota1: NOTA_1_PREDEFINITA, nota2: NOTA_2_PREDEFINITA };
export const CAMPI_STAMPA = Object.keys(PREDEFINITI) as (keyof typeof PREDEFINITI)[];

export type DatiStampa = typeof PREDEFINITI;
export interface LogoStampa {
  chiave: string;
  nome: string;
  tipo: string;
  dimensione: number;
}

export async function leggiImpostazioniStampa(ex: Executor = db): Promise<{ dati: DatiStampa; logo: LogoStampa | null }> {
  const righe = await ex.select().from(impostazioniTable).where(like(impostazioniTable.chiave, `${PREFISSO}%`));
  const m = new Map(righe.map((r) => [r.chiave.slice(PREFISSO.length), r.valore]));
  const dati = { ...PREDEFINITI };
  for (const c of CAMPI_STAMPA) if (m.has(c)) dati[c] = m.get(c)!;
  const chiave = m.get("logo_chiave");
  const logo = chiave ? { chiave, nome: m.get("logo_nome") ?? "logo", tipo: m.get("logo_tipo") ?? "image/png", dimensione: Number(m.get("logo_dimensione") ?? 0) } : null;
  return { dati, logo };
}

export async function scriviImpostazioni(ex: Executor, valori: Record<string, string>): Promise<void> {
  for (const [k, v] of Object.entries(valori)) {
    await ex
      .insert(impostazioniTable)
      .values({ chiave: `${PREFISSO}${k}`, valore: v })
      .onConflictDoUpdate({ target: impostazioniTable.chiave, set: { valore: v } });
  }
}

export async function eliminaImpostazioni(ex: Executor, chiavi: string[]): Promise<void> {
  await ex.delete(impostazioniTable).where(inArray(impostazioniTable.chiave, chiavi.map((k) => `${PREFISSO}${k}`)));
}

export function mappaImpostazioniStampa(s: { dati: DatiStampa; logo: LogoStampa | null }) {
  return { ...s.dati, logo: s.logo ? { nome: s.logo.nome, dimensione: s.logo.dimensione } : null };
}

// ---------------------------------------------------------------------------------------------
// Dare/avere
// ---------------------------------------------------------------------------------------------

const ROMANI = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];

export async function dareAvere(collaboratoreId: number, anno: number) {
  const [coll] = await db
    .select({ cognome: personeTable.cognome, nome: personeTable.nome, sportello: collaboratoriTable.numeroSportello })
    .from(collaboratoriTable)
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .where(eq(collaboratoriTable.id, collaboratoreId));
  if (!coll) throw nonTrovato("Collaboratore non trovato.");
  const manuali = await db
    .select()
    .from(compensiRigheTable)
    .where(and(eq(compensiRigheTable.collaboratoreId, collaboratoreId), eq(compensiRigheTable.anno, anno)))
    .orderBy(asc(compensiRigheTable.dataPagamento), asc(compensiRigheTable.id));
  const estratti = await db
    .select()
    .from(estrattiTable)
    .where(and(eq(estrattiTable.collaboratoreId, collaboratoreId), sql`extract(year from ${estrattiTable.dataEstratto})::int = ${anno}`))
    .orderBy(asc(estrattiTable.dataEstratto), asc(estrattiTable.id));

  const importate = await righeImportateDareAvere(collaboratoreId, anno);
  const sezioni = ORDINE_SEZIONI.map((sezione) => {
    const righe =
      sezione === "patronato"
        ? estratti.map((e, i) => ({
            id: null as number | null,
            descrizione: `${ROMANI[i] ?? i + 1}° Acconto`,
            importoEuro: euro(e.totaleCentesimi),
            dataPagamento: null as string | null,
            riferimento: `Estratto ${formattaData(e.dataEstratto)}`,
            nota: e.pagatoIl ? `Pagato il ${formattaData(e.pagatoIl)}` : "Non ancora pagato",
            estrattoId: e.id as number | null,
            importazioneId: null as number | null,
            centesimi: e.totaleCentesimi,
          }))
        : manuali
            .filter((r) => r.sezione === sezione)
            .map((r) => ({
              id: r.id as number | null,
              descrizione: r.descrizione,
              importoEuro: euro(r.importoCentesimi),
              dataPagamento: r.dataPagamento,
              riferimento: null as string | null,
              nota: r.nota,
              estrattoId: null as number | null,
              importazioneId: null as number | null,
              centesimi: r.importoCentesimi,
            }))
            .concat(
              importate
                .filter((r) => r.sezione === sezione)
                .map((r) => ({
                  id: null as number | null,
                  descrizione: r.descrizione,
                  importoEuro: euro(r.centesimi),
                  dataPagamento: null as string | null,
                  riferimento: r.riferimento,
                  nota: r.nota,
                  estrattoId: null as number | null,
                  importazioneId: r.importazioneId as number | null,
                  centesimi: r.centesimi,
                })),
            );
    const totale = righe.reduce((t, r) => t + r.centesimi, 0);
    return {
      sezione,
      titolo: TITOLO_SEZIONE[sezione],
      automatica: sezione === "patronato",
      righe: righe.map(({ centesimi: _c, ...r }) => r),
      totaleCentesimi: totale,
    };
  });
  const avere = sezioni.reduce((t, s) => t + (s.sezione === "debiti" ? -s.totaleCentesimi : s.totaleCentesimi), 0);
  return {
    collaboratoreId,
    collaboratoreNome: nomeCompleto(coll.cognome, coll.nome),
    numeroSportello: coll.sportello,
    anno,
    sezioni: sezioni.map(({ totaleCentesimi, ...s }) => ({ ...s, totaleEuro: euro(totaleCentesimi) })),
    totaleAvereEuro: euro(avere),
  };
}

export type DareAvereDati = Awaited<ReturnType<typeof dareAvere>>;

export async function controllaCollaboratore(id: number): Promise<{ cognome: string; nome: string; sportello: string }> {
  const [c] = await db
    .select({ cognome: personeTable.cognome, nome: personeTable.nome, sportello: collaboratoriTable.numeroSportello })
    .from(collaboratoriTable)
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .where(eq(collaboratoriTable.id, id));
  if (!c) throw nonTrovato("Collaboratore non trovato.");
  return c;
}

/** Aggiunge al cambio di stato dello storico di una pratica. */
export async function registraCambioStatoPagata(tx: Executor, praticaId: number, utenteId: number, da: string | null, a: string): Promise<void> {
  await tx.insert(eventiPraticaTable).values({ praticaId, tipo: "cambio_stato", utenteId, da, a });
}
