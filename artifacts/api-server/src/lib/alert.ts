/**
 * Alert sui collaboratori. Due regole, con soglie e tipi di pratica scelti dall'admin:
 *  - "inattivita": un collaboratore non carica un tipo di pratica da almeno N mesi (predefinito 2). Chi non ne ha mai caricate
 *    viene misurato dalla data in cui e' stato creato;
 *  - "volume": un collaboratore carica piu' di N pratiche di un tipo in un periodo (predefiniti: 3 pratiche in 30 giorni).
 * Un alert resta "aperto" finche' la condizione vale e passa a "risolto" da solo. Ai nuovi alert segue una sola email agli admin.
 */
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  alertCollaboratoriTable,
  alertRegoleTable,
  alertRegoleTipiTable,
  collaboratoriTable,
  db,
  personeTable,
  praticheTable,
  tipiPraticaTable,
  utentiTable,
} from "@workspace/db";
import { logger } from "./logger";
import type { Executor } from "./log";
import { recapitaInBackground } from "./notifiche";
import { notificaAlertCollaboratori, type RigaAlertEmail } from "./notifiche-eventi";

export type CodiceRegola = "inattivita" | "volume";

export interface ConfigurazioneAlert {
  inattivita: { attiva: boolean; mesi: number; tipiIds: number[] };
  volume: { attiva: boolean; soglia: number; periodoGiorni: number; tipiIds: number[] };
}

const PREDEFINITI = { mesi: 2, soglia: 3, periodoGiorni: 30 };

export async function leggiConfigurazioneAlert(ex: Executor = db): Promise<ConfigurazioneAlert> {
  const regole = await ex.select().from(alertRegoleTable);
  const tipi = await ex.select().from(alertRegoleTipiTable).orderBy(asc(alertRegoleTipiTable.tipoPraticaId));
  const ri = regole.find((r) => r.codice === "inattivita");
  const rv = regole.find((r) => r.codice === "volume");
  const tipiDi = (c: CodiceRegola) => tipi.filter((t) => t.regola === c).map((t) => t.tipoPraticaId);
  return {
    inattivita: { attiva: ri?.attiva ?? true, mesi: ri?.soglia ?? PREDEFINITI.mesi, tipiIds: tipiDi("inattivita") },
    volume: { attiva: rv?.attiva ?? true, soglia: rv?.soglia ?? PREDEFINITI.soglia, periodoGiorni: rv?.periodoGiorni ?? PREDEFINITI.periodoGiorni, tipiIds: tipiDi("volume") },
  };
}

export async function salvaConfigurazioneAlert(ex: Executor, c: ConfigurazioneAlert): Promise<void> {
  await ex
    .insert(alertRegoleTable)
    .values({ codice: "inattivita", attiva: c.inattivita.attiva, soglia: c.inattivita.mesi, periodoGiorni: null })
    .onConflictDoUpdate({ target: alertRegoleTable.codice, set: { attiva: c.inattivita.attiva, soglia: c.inattivita.mesi } });
  await ex
    .insert(alertRegoleTable)
    .values({ codice: "volume", attiva: c.volume.attiva, soglia: c.volume.soglia, periodoGiorni: c.volume.periodoGiorni })
    .onConflictDoUpdate({ target: alertRegoleTable.codice, set: { attiva: c.volume.attiva, soglia: c.volume.soglia, periodoGiorni: c.volume.periodoGiorni } });
  await ex.delete(alertRegoleTipiTable);
  const righe = [
    ...[...new Set(c.inattivita.tipiIds)].map((tipoPraticaId) => ({ regola: "inattivita" as const, tipoPraticaId })),
    ...[...new Set(c.volume.tipiIds)].map((tipoPraticaId) => ({ regola: "volume" as const, tipoPraticaId })),
  ];
  if (righe.length) await ex.insert(alertRegoleTipiTable).values(righe);
}

interface Condizione {
  regola: CodiceRegola;
  collaboratoreId: number;
  tipoPraticaId: number;
  valore: number;
  ultimaPraticaIl: Date | null;
}

const chiave = (c: { regola: string; collaboratoreId: number; tipoPraticaId: number }) => `${c.regola}:${c.collaboratoreId}:${c.tipoPraticaId}`;

/** Mesi interi trascorsi tra due date. */
function mesiTra(da: Date, a: Date): number {
  let m = (a.getFullYear() - da.getFullYear()) * 12 + (a.getMonth() - da.getMonth());
  if (a.getDate() < da.getDate()) m -= 1;
  return Math.max(0, m);
}

/** Calcola le condizioni oggi vere, in base alla configurazione. Non scrive nulla. */
export async function calcolaCondizioni(cfg: ConfigurazioneAlert, ora = new Date()): Promise<Condizione[]> {
  const esito: Condizione[] = [];
  const attivi = await db
    .select({ id: collaboratoriTable.id, creatoIl: collaboratoriTable.creatoIl })
    .from(collaboratoriTable)
    .innerJoin(utentiTable, eq(utentiTable.id, collaboratoriTable.utenteId))
    .where(eq(utentiTable.attivo, true));
  if (attivi.length === 0) return esito;

  if (cfg.inattivita.attiva && cfg.inattivita.tipiIds.length) {
    const taglio = new Date(ora);
    taglio.setMonth(taglio.getMonth() - cfg.inattivita.mesi);
    const ultime = await db
      .select({ collaboratoreId: praticheTable.collaboratoreId, tipoPraticaId: praticheTable.tipoPraticaId, ultima: sql<Date>`max(${praticheTable.inviataIl})` })
      .from(praticheTable)
      .where(and(isNotNull(praticheTable.inviataIl), inArray(praticheTable.tipoPraticaId, cfg.inattivita.tipiIds)))
      .groupBy(praticheTable.collaboratoreId, praticheTable.tipoPraticaId);
    const mappa = new Map(ultime.map((u) => [`${u.collaboratoreId}:${u.tipoPraticaId}`, new Date(u.ultima)]));
    for (const col of attivi) {
      for (const tipoId of cfg.inattivita.tipiIds) {
        const ultima = mappa.get(`${col.id}:${tipoId}`) ?? null;
        const base = ultima ?? col.creatoIl;
        if (base < taglio) esito.push({ regola: "inattivita", collaboratoreId: col.id, tipoPraticaId: tipoId, valore: mesiTra(base, ora), ultimaPraticaIl: ultima });
      }
    }
  }

  if (cfg.volume.attiva && cfg.volume.tipiIds.length) {
    const dal = new Date(ora.getTime() - cfg.volume.periodoGiorni * 24 * 60 * 60 * 1000);
    const idAttivi = new Set(attivi.map((a) => a.id));
    const conteggi = await db
      .select({ collaboratoreId: praticheTable.collaboratoreId, tipoPraticaId: praticheTable.tipoPraticaId, n: sql<number>`count(*)::int` })
      .from(praticheTable)
      .where(and(isNotNull(praticheTable.inviataIl), sql`${praticheTable.inviataIl} >= ${dal.toISOString()}::timestamptz`, inArray(praticheTable.tipoPraticaId, cfg.volume.tipiIds)))
      .groupBy(praticheTable.collaboratoreId, praticheTable.tipoPraticaId)
      .having(sql`count(*) > ${cfg.volume.soglia}`);
    for (const c of conteggi) {
      if (idAttivi.has(c.collaboratoreId)) esito.push({ regola: "volume", collaboratoreId: c.collaboratoreId, tipoPraticaId: c.tipoPraticaId, valore: c.n, ultimaPraticaIl: null });
    }
  }
  return esito;
}

export function descrizioneAlert(a: { regola: string; tipoNome: string; valore: number; ultimaPraticaIl: Date | null }, cfg: ConfigurazioneAlert): string {
  if (a.regola === "inattivita") {
    const mesi = a.valore === 1 ? "1 mese" : `${a.valore} mesi`;
    return a.ultimaPraticaIl ? `Non carica pratiche "${a.tipoNome}" da ${mesi}` : `Non ha mai caricato pratiche "${a.tipoNome}" (da ${mesi} dalla creazione)`;
  }
  return `Ha caricato ${a.valore} pratiche "${a.tipoNome}" negli ultimi ${cfg.volume.periodoGiorni} giorni (soglia: ${cfg.volume.soglia})`;
}

/**
 * Allinea gli alert alla situazione di oggi: apre i nuovi, aggiorna i valori degli aperti, risolve quelli non piu' veri.
 * Ai nuovi alert segue un'unica email agli admin. Restituisce quanti alert nuovi sono stati aperti.
 */
export async function ricalcolaAlert(): Promise<number> {
  const cfg = await leggiConfigurazioneAlert();
  const condizioni = await calcolaCondizioni(cfg);
  const vere = new Map(condizioni.map((c) => [chiave(c), c]));
  const { nuovi, notifiche } = await db.transaction(async (tx) => {
    const aperti = await tx.select().from(alertCollaboratoriTable).where(eq(alertCollaboratoriTable.stato, "aperto"));
    const apertiPerChiave = new Map(aperti.map((a) => [chiave(a), a]));
    const daRisolvere = aperti.filter((a) => !vere.has(chiave(a))).map((a) => a.id);
    if (daRisolvere.length) await tx.update(alertCollaboratoriTable).set({ stato: "risolto", risoltoIl: new Date() }).where(inArray(alertCollaboratoriTable.id, daRisolvere));
    for (const [k, c] of vere) {
      const a = apertiPerChiave.get(k);
      if (a && (a.valore !== c.valore || a.ultimaPraticaIl?.getTime() !== c.ultimaPraticaIl?.getTime())) {
        await tx.update(alertCollaboratoriTable).set({ valore: c.valore, ultimaPraticaIl: c.ultimaPraticaIl }).where(eq(alertCollaboratoriTable.id, a.id));
      }
    }
    const daAprire = condizioni.filter((c) => !apertiPerChiave.has(chiave(c)));
    const creati = daAprire.length
      ? await tx.insert(alertCollaboratoriTable).values(daAprire).onConflictDoNothing().returning({ id: alertCollaboratoriTable.id })
      : [];
    if (creati.length === 0) return { nuovi: 0, notifiche: [] as number[] };
    const righe = await elencoAlert(tx, { ids: creati.map((c) => c.id) }, cfg);
    const email: RigaAlertEmail[] = righe.map((r) => ({ collaboratore: `${r.collaboratoreNome} (sportello ${r.sportello})`, descrizione: r.descrizione }));
    return { nuovi: creati.length, notifiche: await notificaAlertCollaboratori(tx, email) };
  });
  recapitaInBackground(notifiche);
  return nuovi;
}

export async function elencoAlert(ex: Executor, filtro: { stato?: "aperto" | "risolto"; ids?: number[] }, cfg?: ConfigurazioneAlert) {
  const configurazione = cfg ?? (await leggiConfigurazioneAlert(ex));
  const righe = await ex
    .select({
      id: alertCollaboratoriTable.id,
      regola: alertCollaboratoriTable.regola,
      collaboratoreId: alertCollaboratoriTable.collaboratoreId,
      sportello: collaboratoriTable.numeroSportello,
      nome: personeTable.nome,
      cognome: personeTable.cognome,
      denominazione: collaboratoriTable.denominazione,
      tipoId: alertCollaboratoriTable.tipoPraticaId,
      tipoNome: tipiPraticaTable.nome,
      stato: alertCollaboratoriTable.stato,
      valore: alertCollaboratoriTable.valore,
      ultimaPraticaIl: alertCollaboratoriTable.ultimaPraticaIl,
      creatoIl: alertCollaboratoriTable.creatoIl,
      risoltoIl: alertCollaboratoriTable.risoltoIl,
    })
    .from(alertCollaboratoriTable)
    .innerJoin(collaboratoriTable, eq(collaboratoriTable.id, alertCollaboratoriTable.collaboratoreId))
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .innerJoin(tipiPraticaTable, eq(tipiPraticaTable.id, alertCollaboratoriTable.tipoPraticaId))
    .where(and(filtro.stato ? eq(alertCollaboratoriTable.stato, filtro.stato) : undefined, filtro.ids ? inArray(alertCollaboratoriTable.id, filtro.ids) : undefined))
    .orderBy(desc(alertCollaboratoriTable.creatoIl), desc(alertCollaboratoriTable.id))
    .limit(500);
  return righe.map((r) => ({
    id: r.id,
    regola: r.regola,
    collaboratoreId: r.collaboratoreId,
    collaboratoreNome: `${r.cognome} ${r.nome}`.toUpperCase(),
    sportello: r.sportello,
    tipoId: r.tipoId,
    tipoNome: r.tipoNome,
    stato: r.stato,
    valore: r.valore,
    ultimaPraticaIl: r.ultimaPraticaIl?.toISOString() ?? null,
    creatoIl: r.creatoIl.toISOString(),
    risoltoIl: r.risoltoIl?.toISOString() ?? null,
    descrizione: descrizioneAlert(r, configurazione),
  }));
}

export async function contaAlertAperti(): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(alertCollaboratoriTable).where(eq(alertCollaboratoriTable.stato, "aperto"));
  return r?.n ?? 0;
}

const OGNI_ORA_MS = 60 * 60 * 1000;

/** Controlla gli alert all'avvio e poi ogni ora. */
export function avviaAlert(): void {
  const giro = () => ricalcolaAlert().then((n) => n > 0 && logger.info({ n }, "Nuovi alert sui collaboratori")).catch((err) => logger.error({ err }, "Controllo alert non riuscito"));
  void giro();
  setInterval(giro, OGNI_ORA_MS).unref();
}
