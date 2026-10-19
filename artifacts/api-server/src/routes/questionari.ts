/**
 * Questionario online del corso, aperto dal link personale ricevuto per email. Rotte pubbliche (senza accesso):
 * l'unica chiave e' il token casuale del partecipante. Le risposte esatte non lasciano mai il server.
 */
import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { GetQuestionarioPubblicoParams, InviaRisposteQuestionarioBody, InviaRisposteQuestionarioParams } from "@workspace/api-zod";
import { db, eventiPartecipantiTable, eventiQuizInvitiTable, eventiQuizTable, eventiTable } from "@workspace/db";
import { HttpError, nonTrovato } from "../lib/errori";
import { contestoDa, registraLog } from "../lib/log";
import { valida } from "../lib/validazione";

const router: IRouter = Router();

const LINK_NON_VALIDO = () => nonTrovato("Il link del questionario non è valido.");

async function caricaPerToken(token: string) {
  const [r] = await db
    .select({
      invito: eventiQuizInvitiTable,
      nome: eventiPartecipantiTable.nome,
      cognome: eventiPartecipantiTable.cognome,
      titolo: eventiTable.titolo,
      data: eventiTable.data,
      domande: eventiQuizTable.domande,
      punteggioMinimo: eventiQuizTable.punteggioMinimo,
    })
    .from(eventiQuizInvitiTable)
    .innerJoin(eventiPartecipantiTable, eq(eventiPartecipantiTable.id, eventiQuizInvitiTable.partecipanteId))
    .innerJoin(eventiTable, eq(eventiTable.id, eventiQuizInvitiTable.eventoId))
    .innerJoin(eventiQuizTable, eq(eventiQuizTable.eventoId, eventiQuizInvitiTable.eventoId))
    .where(eq(eventiQuizInvitiTable.token, token));
  if (!r) throw LINK_NON_VALIDO();
  return r;
}

type Caricato = Awaited<ReturnType<typeof caricaPerToken>>;

function risposta(r: Caricato) {
  const base = { titolo: r.titolo, data: r.data, partecipante: `${r.nome} ${r.cognome}`, punteggioMinimo: r.punteggioMinimo };
  const i = r.invito;
  if (i.compilatoIl) {
    return {
      ...base,
      stato: "compilato" as const,
      domande: [],
      esito: { punteggio: i.punteggio ?? 0, punteggioMassimo: i.punteggioMassimo ?? r.domande.length, punteggioMinimo: r.punteggioMinimo, superato: !!i.superato, compilatoIl: i.compilatoIl.toISOString() },
    };
  }
  return { ...base, stato: "da_compilare" as const, domande: r.domande.map((d) => ({ testo: d.testo, opzioni: d.opzioni })), esito: null };
}

router.get("/questionari/:token", async (req, res) => {
  const { token } = valida(GetQuestionarioPubblicoParams, req.params);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(risposta(await caricaPerToken(token)));
});

router.post("/questionari/:token", async (req, res) => {
  const { token } = valida(InviaRisposteQuestionarioParams, req.params);
  const { risposte } = valida(InviaRisposteQuestionarioBody, req.body);
  const r = await caricaPerToken(token);
  if (r.invito.compilatoIl) {
    throw new HttpError(409, "Hai già compilato questo questionario: il link si può usare una sola volta.", "QUIZ_GIA_COMPILATO");
  }
  if (risposte.length !== r.domande.length) throw new HttpError(400, "Rispondi a tutte le domande.", "DATI_NON_VALIDI");
  r.domande.forEach((d, i) => {
    if (!Number.isInteger(risposte[i]) || risposte[i]! < 0 || risposte[i]! >= d.opzioni.length) {
      throw new HttpError(400, `La risposta alla domanda ${i + 1} non è valida.`, "DATI_NON_VALIDI");
    }
  });
  const punteggio = r.domande.filter((d, i) => d.corretta === risposte[i]).length;
  const massimo = r.domande.length;
  const superato = punteggio >= r.punteggioMinimo;
  await db.transaction(async (tx) => {
    // L'aggiornamento condizionato garantisce una sola compilazione anche con due invii contemporanei.
    const [agg] = await tx
      .update(eventiQuizInvitiTable)
      .set({ compilatoIl: new Date(), punteggio, punteggioMassimo: massimo, superato, risposte })
      .where(and(eq(eventiQuizInvitiTable.id, r.invito.id), isNull(eventiQuizInvitiTable.compilatoIl)))
      .returning({ id: eventiQuizInvitiTable.id });
    if (!agg) throw new HttpError(409, "Hai già compilato questo questionario: il link si può usare una sola volta.", "QUIZ_GIA_COMPILATO");
    await registraLog(tx, contestoDa(req), {
      azione: "evento.quiz_compila",
      entita: "evento",
      entitaId: r.invito.eventoId,
      descrizione: `${r.cognome} ${r.nome} ha compilato il questionario del corso "${r.titolo}": ${punteggio}/${massimo}, ${superato ? "superato" : "non superato"}`,
      dettagli: { partecipanteId: r.invito.partecipanteId, punteggio, punteggioMassimo: massimo, superato },
    });
  });
  res.setHeader("Cache-Control", "private, no-store");
  res.json(risposta(await caricaPerToken(token)));
});

export default router;
