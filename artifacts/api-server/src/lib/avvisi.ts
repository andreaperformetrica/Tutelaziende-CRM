import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import {
  assistitiTable, commentiPraticaTable, db, documentiPraticaTable, eventiInvitiTable, eventiPraticaTable, eventiTable, personeTable,
  praticheTable, tipiPraticaTable, utentiTable,
} from "@workspace/db";
import { oggiRoma } from "./eventi";

/** Le novita' sulle pratiche si mostrano per al massimo questo numero di giorni. */
const GIORNI_AVVISI_PRATICHE = 30;

export type TipoAggiornamento = "stato" | "messaggio" | "allegato" | "presa_in_carico" | "altro";

/** Inviti a eventi futuri non ancora confermati dalla sede. Spariscono da soli alla conferma o a evento passato. */
async function invitiDaConfermare(collaboratoreId: number) {
  const righe = await db
    .select({ e: eventiTable, invitatoIl: eventiInvitiTable.invitatoIl })
    .from(eventiInvitiTable)
    .innerJoin(eventiTable, eq(eventiTable.id, eventiInvitiTable.eventoId))
    .where(and(eq(eventiInvitiTable.collaboratoreId, collaboratoreId), isNull(eventiInvitiTable.confermatoIl), gte(eventiTable.data, oggiRoma())))
    .orderBy(eventiTable.data, eventiTable.oraInizio, eventiTable.id);
  return righe.map((r) => ({
    eventoId: r.e.id, titolo: r.e.titolo, data: r.e.data, oraInizio: r.e.oraInizio, luogo: r.e.luogo, invitatoIl: r.invitatoIl.toISOString(),
  }));
}

/**
 * Pratiche proprie con un aggiornamento del back office successivo all'ultima apertura da parte del collaboratore
 * (o, se non l'ha mai aperta, successivo all'invio). Per ciascuna si descrive l'aggiornamento piu' recente.
 */
async function pratichePiuRecenti(collaboratoreId: number) {
  const baseline = sql`coalesce(${praticheTable.vistaDalCollaboratoreIl}, ${praticheTable.inviataIl})`;
  const limite = new Date(Date.now() - GIORNI_AVVISI_PRATICHE * 24 * 3600 * 1000);
  const pratiche = await db
    .select({
      id: praticheTable.id, numero: praticheTable.numero, baseline: sql<Date>`${baseline}`, ultimaBo: praticheTable.ultimaAttivitaBackofficeIl,
      tipo: tipiPraticaTable.nome, assNome: personeTable.nome, assCognome: personeTable.cognome,
    })
    .from(praticheTable)
    .innerJoin(tipiPraticaTable, eq(tipiPraticaTable.id, praticheTable.tipoPraticaId))
    .innerJoin(assistitiTable, eq(assistitiTable.id, praticheTable.assistitoId))
    .innerJoin(personeTable, eq(personeTable.id, assistitiTable.personaId))
    .where(and(
      eq(praticheTable.collaboratoreId, collaboratoreId), isNotNull(praticheTable.inviataIl),
      isNotNull(praticheTable.ultimaAttivitaBackofficeIl), gt(praticheTable.ultimaAttivitaBackofficeIl, baseline),
      gt(praticheTable.ultimaAttivitaBackofficeIl, limite),
    ))
    .orderBy(desc(praticheTable.ultimaAttivitaBackofficeIl));
  if (!pratiche.length) return [];
  const ids = pratiche.map((p) => p.id);
  const [eventi, commenti, allegati] = await Promise.all([
    db.select().from(eventiPraticaTable).where(inArray(eventiPraticaTable.praticaId, ids)),
    db
      .select({ praticaId: commentiPraticaTable.praticaId, creatoIl: commentiPraticaTable.creatoIl })
      .from(commentiPraticaTable)
      .innerJoin(utentiTable, eq(utentiTable.id, commentiPraticaTable.utenteId))
      .where(and(inArray(commentiPraticaTable.praticaId, ids), ne(utentiTable.ruolo, "collaboratore"))),
    db
      .select({ praticaId: documentiPraticaTable.praticaId, caricatoIl: documentiPraticaTable.caricatoIl })
      .from(documentiPraticaTable)
      .where(and(inArray(documentiPraticaTable.praticaId, ids), eq(documentiPraticaTable.daBackoffice, true))),
  ]);
  return pratiche.map((p) => {
    const da = new Date(p.baseline);
    const candidati: { quando: Date; aggiornamento: TipoAggiornamento; stato: string | null }[] = [];
    for (const e of eventi) if (e.praticaId === p.id && e.creatoIl > da) candidati.push({ quando: e.creatoIl, aggiornamento: e.tipo === "cambio_stato" ? "stato" : "presa_in_carico", stato: e.tipo === "cambio_stato" ? e.a : null });
    for (const c of commenti) if (c.praticaId === p.id && c.creatoIl > da) candidati.push({ quando: c.creatoIl, aggiornamento: "messaggio", stato: null });
    for (const a of allegati) if (a.praticaId === p.id && a.caricatoIl > da) candidati.push({ quando: a.caricatoIl, aggiornamento: "allegato", stato: null });
    candidati.sort((x, y) => y.quando.getTime() - x.quando.getTime());
    const ultimo = candidati[0] ?? { quando: p.ultimaBo!, aggiornamento: "altro" as const, stato: null };
    return {
      praticaId: p.id, numero: p.numero, assistito: `${p.assCognome} ${p.assNome}`, tipo: p.tipo,
      aggiornamento: ultimo.aggiornamento, stato: ultimo.stato, quando: ultimo.quando.toISOString(),
    };
  });
}

export async function avvisiCollaboratore(collaboratoreId: number) {
  const [eventi, pratiche] = await Promise.all([invitiDaConfermare(collaboratoreId), pratichePiuRecenti(collaboratoreId)]);
  return { eventi, pratiche };
}
