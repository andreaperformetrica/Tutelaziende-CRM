/**
 * Scadenze delle pratiche. Il tipo di pratica puo' avere una scadenza in giorni dall'invio e un anticipo (in giorni):
 *  - "vicina": da (scadenza - anticipo) fino alla scadenza;
 *  - "superata": dopo la scadenza.
 * Valgono solo per le pratiche inviate, non chiuse, di tipi con scadenza. Per gli altri tipi non c'e' nulla da mostrare.
 */
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { assistitiTable, db, personeTable, praticheTable, statiPraticaTable, tipiPraticaTable } from "@workspace/db";
import { logger } from "./logger";
import { notificaScadenzaPratica } from "./notifiche-eventi";
import { recapitaInBackground } from "./notifiche";

const GIORNO_MS = 24 * 60 * 60 * 1000;

export type StatoScadenza = "in_corso" | "vicina" | "superata";

export interface InfoScadenza {
  scadenzaIl: string;
  stato: StatoScadenza;
  giorniResidui: number;
}

/** Scadenza di una pratica, oppure null se non ne ha (bozza, pratica chiusa o tipo senza scadenza). */
export function infoScadenza(
  r: { inviataIl: Date | null; statoChiuso: boolean; tipoScadenzaGiorni: number | null; tipoAnticipoGiorni: number },
  ora = new Date(),
): InfoScadenza | null {
  if (!r.inviataIl || r.statoChiuso || r.tipoScadenzaGiorni === null) return null;
  const scadenza = new Date(r.inviataIl.getTime() + r.tipoScadenzaGiorni * GIORNO_MS);
  const diff = scadenza.getTime() - ora.getTime();
  const stato: StatoScadenza = diff < 0 ? "superata" : diff <= r.tipoAnticipoGiorni * GIORNO_MS ? "vicina" : "in_corso";
  return { scadenzaIl: scadenza.toISOString(), stato, giorniResidui: diff >= 0 ? Math.ceil(diff / GIORNO_MS) : Math.floor(diff / GIORNO_MS) };
}

const scadenzaSql = sql`(${praticheTable.inviataIl} + ${tipiPraticaTable.scadenzaGiorni} * interval '1 day')`;
const praticaAperta = sql`coalesce(${statiPraticaTable.chiuso}, false) = false`;

/** Pratiche in carico a un operatore con scadenza vicina o superata, le piu' urgenti per prime. */
export async function scadenzeInCarico(utenteId: number) {
  const righe = await db
    .select({
      id: praticheTable.id,
      numero: praticheTable.numero,
      inviataIl: praticheTable.inviataIl,
      tipoNome: tipiPraticaTable.nome,
      scadenzaGiorni: tipiPraticaTable.scadenzaGiorni,
      anticipoGiorni: tipiPraticaTable.anticipoGiorni,
      assNome: personeTable.nome,
      assCognome: personeTable.cognome,
    })
    .from(praticheTable)
    .innerJoin(tipiPraticaTable, eq(tipiPraticaTable.id, praticheTable.tipoPraticaId))
    .innerJoin(assistitiTable, eq(assistitiTable.id, praticheTable.assistitoId))
    .innerJoin(personeTable, eq(personeTable.id, assistitiTable.personaId))
    .leftJoin(statiPraticaTable, eq(statiPraticaTable.id, praticheTable.statoId))
    .where(
      and(
        eq(praticheTable.gestitaDaUtenteId, utenteId),
        isNotNull(praticheTable.inviataIl),
        isNotNull(tipiPraticaTable.scadenzaGiorni),
        praticaAperta,
        // scadenza - anticipo <= adesso
        sql`${scadenzaSql} - ${tipiPraticaTable.anticipoGiorni} * interval '1 day' <= now()`,
      ),
    )
    .orderBy(asc(scadenzaSql), asc(praticheTable.id));
  const ora = new Date();
  const esito: { id: number; numero: number; assistito: string; tipoNome: string; scadenzaIl: string; stato: "vicina" | "superata"; giorniResidui: number }[] = [];
  for (const r of righe) {
    const s = infoScadenza({ inviataIl: r.inviataIl, statoChiuso: false, tipoScadenzaGiorni: r.scadenzaGiorni, tipoAnticipoGiorni: r.anticipoGiorni }, ora);
    if (!s || s.stato === "in_corso") continue;
    esito.push({ id: r.id, numero: r.numero!, assistito: `${r.assCognome} ${r.assNome}`.toUpperCase(), tipoNome: r.tipoNome, scadenzaIl: s.scadenzaIl, stato: s.stato, giorniResidui: s.giorniResidui });
  }
  return esito;
}

/**
 * Invia i solleciti per email all'operatore che ha la pratica in carico: uno quando la scadenza e' vicina e uno quando e' superata.
 * Ogni sollecito parte una sola volta per pratica: la riga viene "prenotata" con un update condizionato prima di accodare il messaggio,
 * cosi' anche due esecuzioni ravvicinate non producono doppioni. Restituisce quante email sono state accodate.
 */
export async function inviaSolleciti(): Promise<number> {
  const candidate = await db
    .select({ id: praticheTable.id, numero: praticheTable.numero, operatoreId: praticheTable.gestitaDaUtenteId })
    .from(praticheTable)
    .innerJoin(tipiPraticaTable, eq(tipiPraticaTable.id, praticheTable.tipoPraticaId))
    .leftJoin(statiPraticaTable, eq(statiPraticaTable.id, praticheTable.statoId))
    .where(
      and(
        isNotNull(praticheTable.inviataIl),
        isNotNull(praticheTable.gestitaDaUtenteId),
        isNotNull(tipiPraticaTable.scadenzaGiorni),
        praticaAperta,
        sql`${scadenzaSql} - ${tipiPraticaTable.anticipoGiorni} * interval '1 day' <= now()`,
        sql`(${praticheTable.sollecitoVicinaIl} is null or (${scadenzaSql} < now() and ${praticheTable.sollecitoSuperataIl} is null))`,
      ),
    );
  let inviati = 0;
  for (const c of candidate) {
    try {
      const ids = await db.transaction(async (tx) => {
        const raccolti: number[] = [];
        // Scaduta: parte il sollecito "superata" (se la vicina non era ancora partita la si considera superata dalla scadenza).
        const [superata] = await tx
          .update(praticheTable)
          .set({ sollecitoSuperataIl: new Date(), sollecitoVicinaIl: sql`coalesce(${praticheTable.sollecitoVicinaIl}, now())` })
          .from(tipiPraticaTable)
          .where(
            and(
              eq(praticheTable.id, c.id),
              eq(tipiPraticaTable.id, praticheTable.tipoPraticaId),
              isNull(praticheTable.sollecitoSuperataIl),
              sql`${praticheTable.inviataIl} + ${tipiPraticaTable.scadenzaGiorni} * interval '1 day' < now()`,
            ),
          )
          .returning({ id: praticheTable.id });
        if (superata) {
          raccolti.push(...(await notificaScadenzaPratica(tx, { id: c.id, numero: c.numero! }, c.operatoreId!, "superata")));
          return raccolti;
        }
        const [vicina] = await tx
          .update(praticheTable)
          .set({ sollecitoVicinaIl: new Date() })
          .where(and(eq(praticheTable.id, c.id), isNull(praticheTable.sollecitoVicinaIl)))
          .returning({ id: praticheTable.id });
        if (vicina) raccolti.push(...(await notificaScadenzaPratica(tx, { id: c.id, numero: c.numero! }, c.operatoreId!, "vicina")));
        return raccolti;
      });
      inviati += ids.length;
      recapitaInBackground(ids);
    } catch (err) {
      logger.error({ err, praticaId: c.id }, "Impossibile inviare il sollecito di scadenza");
    }
  }
  return inviati;
}

const OGNI_ORA_MS = 60 * 60 * 1000;

/** Controlla le scadenze all'avvio e poi ogni ora. */
export function avviaSolleciti(): void {
  const giro = () => inviaSolleciti().then((n) => n > 0 && logger.info({ n }, "Solleciti di scadenza accodati")).catch((err) => logger.error({ err }, "Controllo scadenze non riuscito"));
  void giro();
  setInterval(giro, OGNI_ORA_MS).unref();
}
