/**
 * Statistiche di lavoro per operatore in un periodo (solo super admin).
 *  - prese in carico: pratiche che l'operatore ha preso in carico nel periodo;
 *  - lavorate: pratiche diverse su cui ha cambiato stato, scritto un commento o aggiunto un allegato;
 *  - chiuse: pratiche che ha portato in uno stato "chiuso" nel periodo;
 *  - tempo medio: ore dalla prima presa in carico (o, se manca, dall'invio) alla chiusura, sulle pratiche che ha chiuso;
 *  - commenti inviati: commenti scritti dall'operatore ai collaboratori.
 */
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db, utentiTable } from "@workspace/db";
import { HttpError } from "./errori";

export interface RigaStatistica {
  utenteId: number;
  nome: string;
  cognome: string;
  ruolo: string;
  colore: string | null;
  preseInCarico: number;
  lavorate: number;
  chiuse: number;
  tempoMedioOre: number | null;
  commentiInviati: number;
}

const formatoRoma = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
const oggiRoma = () => formatoRoma.format(new Date());

function controlla(valore: string | undefined, campo: string): string | undefined {
  if (!valore) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valore) || Number.isNaN(Date.parse(valore))) throw new HttpError(400, "Data non valida (formato AAAA-MM-GG).", "DATA_NON_VALIDA", campo);
  return valore;
}

/** Periodo richiesto; senza date gli ultimi 30 giorni, oggi compreso. */
export function periodoStatistiche(dalIn?: string, alIn?: string): { dal: string; al: string } {
  const al = controlla(alIn, "al") ?? oggiRoma();
  const dal = controlla(dalIn, "dal") ?? new Date(Date.parse(al) - 29 * 86400000).toISOString().slice(0, 10);
  if (dal > al) throw new HttpError(400, "La data iniziale non può essere dopo quella finale.", "DATA_NON_VALIDA", "dal");
  return { dal, al };
}

export async function calcolaStatistiche(dal: string, al: string): Promise<RigaStatistica[]> {
  const nel = (colonna: string) =>
    sql.raw(`${colonna} >= (('${dal}'::date)::timestamp AT TIME ZONE 'Europe/Rome') AND ${colonna} < ((('${al}'::date + 1))::timestamp AT TIME ZONE 'Europe/Rome')`);

  const prese = await db.execute(sql`select e.utente_id as u, count(*)::int as n from eventi_pratica e where e.tipo = 'presa_in_carico' and ${nel("e.creato_il")} group by e.utente_id`);
  const lavorate = await db.execute(sql`
    select u, count(distinct pratica_id)::int as n from (
      select e.utente_id as u, e.pratica_id from eventi_pratica e where e.tipo = 'cambio_stato' and ${nel("e.creato_il")}
      union all select c.utente_id, c.pratica_id from commenti_pratica c where ${nel("c.creato_il")}
      union all select d.caricato_da_utente_id, d.pratica_id from documenti_pratica d where d.da_backoffice and d.caricato_da_utente_id is not null and ${nel("d.caricato_il")}
    ) x group by u`);
  const chiuse = await db.execute(sql`
    select c.u, count(*)::int as n,
           avg(extract(epoch from (c.chiusa_il - c.inizio)) / 3600.0) filter (where c.inizio is not null and c.chiusa_il >= c.inizio) as ore
    from (
      select e.utente_id as u, e.pratica_id, max(e.creato_il) as chiusa_il,
             coalesce((select min(p.creato_il) from eventi_pratica p where p.pratica_id = e.pratica_id and p.tipo = 'presa_in_carico'), pr.inviata_il) as inizio
      from eventi_pratica e
      join stati_pratica s on s.nome = e.a and s.chiuso
      join pratiche pr on pr.id = e.pratica_id
      where e.tipo = 'cambio_stato' and ${nel("e.creato_il")}
      group by e.utente_id, e.pratica_id, pr.inviata_il
    ) c group by c.u`);
  const commenti = await db.execute(sql`select c.utente_id as u, count(*)::int as n from commenti_pratica c where ${nel("c.creato_il")} group by c.utente_id`);

  const per = (r: { rows: Record<string, unknown>[] }) => new Map(r.rows.map((x) => [Number(x["u"]), x]));
  const mPrese = per(prese);
  const mLavorate = per(lavorate);
  const mChiuse = per(chiuse);
  const mCommenti = per(commenti);
  const conAttivita = new Set([...mPrese.keys(), ...mLavorate.keys(), ...mChiuse.keys(), ...mCommenti.keys()]);

  const utenti = await db
    .select({ id: utentiTable.id, nome: utentiTable.nome, cognome: utentiTable.cognome, ruolo: utentiTable.ruolo, colore: utentiTable.colore })
    .from(utentiTable)
    .where(
      and(
        ne(utentiTable.ruolo, "collaboratore"),
        conAttivita.size ? or(eq(utentiTable.attivo, true), inArray(utentiTable.id, [...conAttivita])) : eq(utentiTable.attivo, true),
      ),
    )
    .orderBy(utentiTable.cognome, utentiTable.nome);
  const num = (m: Map<number, Record<string, unknown>>, id: number) => Number(m.get(id)?.["n"] ?? 0);
  return utenti.map((u) => {
    const ore = mChiuse.get(u.id)?.["ore"];
    return {
      utenteId: u.id,
      nome: u.nome,
      cognome: u.cognome,
      ruolo: u.ruolo,
      colore: u.colore,
      preseInCarico: num(mPrese, u.id),
      lavorate: num(mLavorate, u.id),
      chiuse: num(mChiuse, u.id),
      tempoMedioOre: ore === null || ore === undefined ? null : Math.round(Number(ore) * 10) / 10,
      commentiInviati: num(mCommenti, u.id),
    };
  });
}
