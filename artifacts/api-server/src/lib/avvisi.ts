import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import {
  assistitiTable, commentiPraticaTable, db, documentiPraticaTable, eventiInvitiTable, eventiPartecipantiTable, eventiPraticaTable, eventiTable, personeTable,
  praticheTable, tipiPraticaTable, utentiTable,
} from "@workspace/db";
import { formattaData, oggiRoma } from "./eventi";
import { statoInvioPratiche } from "./orari";

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

export type TipoPromemoria = "evento" | "partecipanti" | "questionario" | "bozza" | "invio_sospeso";

export interface Promemoria {
  chiave: string;
  tipo: TipoPromemoria;
  titolo: string;
  dettaglio: string;
  link: string;
  /** Data di riferimento (AAAA-MM-GG) quando il promemoria riguarda un giorno preciso. */
  data: string | null;
  urgente: boolean;
}

/** Giorni di calendario tra oggi e una data AAAA-MM-GG (0 = oggi). */
function giorniA(data: string, oggi: string): number {
  return Math.round((Date.parse(`${data}T00:00:00Z`) - Date.parse(`${oggi}T00:00:00Z`)) / 86_400_000);
}

const quando = (g: number) => (g <= 0 ? "Oggi" : g === 1 ? "Domani" : `Tra ${g} giorni`);
const GIORNI_PREAVVISO_QUESTIONARIO = 7;
const MAX_BOZZE = 10;

/**
 * Promemoria della home: eventi confermati in arrivo, cose da fare per prepararli, bozze di pratica da completare
 * e invio pratiche sospeso. Calcolati al volo, nessun dato viene salvato.
 */
async function promemoriaCollaboratore(collaboratoreId: number): Promise<Promemoria[]> {
  const oggi = oggiRoma();
  const [eventi, bozze, invio] = await Promise.all([
    db
      .select({
        e: eventiTable,
        partecipanti: sql<number>`(select count(*)::int from ${eventiPartecipantiTable} p where p.evento_id = ${eventiTable.id} and p.collaboratore_id = ${collaboratoreId})`,
      })
      .from(eventiInvitiTable)
      .innerJoin(eventiTable, eq(eventiTable.id, eventiInvitiTable.eventoId))
      .where(and(eq(eventiInvitiTable.collaboratoreId, collaboratoreId), isNotNull(eventiInvitiTable.confermatoIl), gte(eventiTable.data, oggi)))
      .orderBy(eventiTable.data, eventiTable.oraInizio, eventiTable.id),
    db
      .select({ id: praticheTable.id, creataIl: praticheTable.creataIl, tipo: tipiPraticaTable.nome, assNome: personeTable.nome, assCognome: personeTable.cognome })
      .from(praticheTable)
      .innerJoin(tipiPraticaTable, eq(tipiPraticaTable.id, praticheTable.tipoPraticaId))
      .innerJoin(assistitiTable, eq(assistitiTable.id, praticheTable.assistitoId))
      .innerJoin(personeTable, eq(personeTable.id, assistitiTable.personaId))
      .where(and(eq(praticheTable.collaboratoreId, collaboratoreId), isNull(praticheTable.inviataIl)))
      .orderBy(praticheTable.creataIl)
      .limit(MAX_BOZZE),
    statoInvioPratiche(),
  ]);

  const risultato: Promemoria[] = [];
  for (const { e, partecipanti } of eventi) {
    const g = giorniA(e.data, oggi);
    const link = `/collaboratore/eventi/${e.id}`;
    risultato.push({
      chiave: `evento-${e.id}`, tipo: "evento", titolo: `${quando(g)}: ${e.titolo}`,
      dettaglio: `${formattaData(e.data)} · ${e.oraFine ? `${e.oraInizio} – ${e.oraFine}` : e.oraInizio} · ${e.luogo}`,
      link, data: e.data, urgente: g <= 1,
    });
    if (partecipanti === 0) {
      risultato.push({
        chiave: `partecipanti-${e.id}`, tipo: "partecipanti", titolo: `Nessun partecipante inserito per "${e.titolo}"`,
        dettaglio: `L'evento è ${quando(g).toLowerCase()}: inserisci i nomi di chi partecipa per ricevere i QR.`, link, data: e.data, urgente: g <= 3,
      });
    }
    if (e.questionarioChiave && g <= GIORNI_PREAVVISO_QUESTIONARIO) {
      risultato.push({
        chiave: `questionario-${e.id}`, tipo: "questionario", titolo: `Scarica il questionario di "${e.titolo}"`,
        dettaglio: "Il questionario va stampato e portato all'evento.", link, data: e.data, urgente: g <= 1,
      });
    }
  }
  for (const b of bozze) {
    const giorni = Math.max(0, Math.floor((Date.now() - b.creataIl.getTime()) / 86_400_000));
    risultato.push({
      chiave: `bozza-${b.id}`, tipo: "bozza", titolo: `Bozza da completare: ${b.tipo} di ${b.assCognome} ${b.assNome}`,
      dettaglio: giorni === 0 ? "Creata oggi, non ancora inviata." : `Creata ${giorni === 1 ? "ieri" : `${giorni} giorni fa`}, non ancora inviata.`,
      link: `/collaboratore/pratiche/${b.id}`, data: null, urgente: giorni >= 7,
    });
  }
  if (!invio.consentito) {
    const fino = invio.bloccatoFinoA;
    const testo = fino
      ? new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(fino)
      : null;
    risultato.push({
      chiave: "invio-sospeso", tipo: "invio_sospeso", titolo: "L'invio delle pratiche è sospeso in questo momento",
      dettaglio: testo ? `Potrai inviare di nuovo da ${testo}. Le bozze restano salvate.` : "Le bozze restano salvate.",
      link: "/collaboratore/pratiche", data: null, urgente: false,
    });
  }
  return risultato;
}

export async function avvisiCollaboratore(collaboratoreId: number) {
  const [eventi, pratiche, promemoria] = await Promise.all([invitiDaConfermare(collaboratoreId), pratichePiuRecenti(collaboratoreId), promemoriaCollaboratore(collaboratoreId)]);
  return { eventi, pratiche, promemoria };
}
