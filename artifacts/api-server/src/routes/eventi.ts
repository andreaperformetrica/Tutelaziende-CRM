import { Router, type IRouter } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  AddPartecipanteEventoBody,
  AddPartecipanteEventoParams,
  ConfermaPartecipazioneEventoParams,
  DeletePartecipanteEventoParams,
  GetEventoParams,
  UpdatePartecipanteEventoBody,
  UpdatePartecipanteEventoParams,
} from "@workspace/api-zod";
import { db, eventiInvitiTable, eventiPartecipantiTable, eventiTable } from "@workspace/db";
import { HttpError, nonTrovato } from "../lib/errori";
import { caricaEvento, datiEvento, formattaData, intero, invitoSede, nuovoCodiceQr, normalizzaNomePersona, schedaSede } from "../lib/eventi";
import { contestoDa, registraLog } from "../lib/log";
import { notificaQrPartecipante } from "../lib/notifiche-eventi";
import { recapitaInBackground } from "../lib/notifiche";
import { codiceErrorePg } from "../lib/postgres";
import { mioCollaboratoreId } from "../lib/pratiche";
import { leggiFile } from "../lib/storage";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";
import { inviaFile } from "./tipi-pratica";

const router: IRouter = Router();
router.use("/eventi", richiediRuolo("collaboratore"));

const NON_CONFERMATO = new HttpError(409, "Conferma prima la partecipazione della sede all'evento.", "NON_CONFERMATO");
const DUPLICATO = new HttpError(409, "Questo partecipante è già nell'elenco dell'evento.", "PARTECIPANTE_DUPLICATO");

router.get("/eventi", async (req, res) => {
  const mio = mioCollaboratoreId(req);
  const righe = await db
    .select({
      e: eventiTable,
      confermatoIl: eventiInvitiTable.confermatoIl,
      partecipanti: sql<number>`(select count(*)::int from ${eventiPartecipantiTable} p where p.evento_id = ${eventiTable.id} and p.collaboratore_id = ${mio})`,
    })
    .from(eventiInvitiTable)
    .innerJoin(eventiTable, eq(eventiTable.id, eventiInvitiTable.eventoId))
    .where(eq(eventiInvitiTable.collaboratoreId, mio))
    .orderBy(sql`${eventiTable.data} desc`, sql`${eventiTable.oraInizio} desc`, sql`${eventiTable.id} desc`);
  res.json(
    righe.map((r) => ({
      evento: datiEvento(r.e),
      confermatoIl: r.confermatoIl ? r.confermatoIl.toISOString() : null,
      partecipanti: r.partecipanti,
      questionario: !!r.e.questionarioChiave,
    })),
  );
});

router.get("/eventi/:id", async (req, res) => {
  const { id } = valida(GetEventoParams, req.params);
  res.json(await schedaSede(id, mioCollaboratoreId(req)));
});

router.get("/eventi/:id/questionario/file", async (req, res) => {
  const mio = mioCollaboratoreId(req);
  const id = intero(req.params["id"], "id");
  if (!(await invitoSede(id, mio))) throw nonTrovato("Evento non trovato.");
  const e = await caricaEvento(id);
  if (!e.questionarioChiave) throw nonTrovato("Per questo evento non c'è nessun questionario.");
  const { stream } = await leggiFile(e.questionarioChiave);
  inviaFile(res, stream, e.questionarioNome!, e.questionarioTipo!, e.questionarioDimensione!);
});

router.post("/eventi/:id/conferma", async (req, res) => {
  const { id } = valida(ConfermaPartecipazioneEventoParams, req.params);
  const mio = mioCollaboratoreId(req);
  const invito = await invitoSede(id, mio);
  if (!invito) throw nonTrovato("Evento non trovato.");
  const e = await caricaEvento(id);
  await db.transaction(async (tx) => {
    const [agg] = await tx
      .update(eventiInvitiTable)
      .set({ confermatoIl: new Date(), confermatoDaUtenteId: req.utente!.id })
      .where(and(eq(eventiInvitiTable.id, invito.id), isNull(eventiInvitiTable.confermatoIl)))
      .returning({ id: eventiInvitiTable.id });
    if (agg) {
      await registraLog(tx, contestoDa(req), {
        azione: "evento.conferma",
        entita: "evento",
        entitaId: id,
        descrizione: `Confermata la partecipazione all'evento "${e.titolo}" del ${formattaData(e.data)}`,
        dettagli: { collaboratoreId: mio },
      });
    }
  });
  res.json(await schedaSede(id, mio));
});

async function controllaDuplicato(eventoId: number, collaboratoreId: number, nome: string, cognome: string, escludiId?: number) {
  const [d] = await db
    .select({ id: eventiPartecipantiTable.id })
    .from(eventiPartecipantiTable)
    .where(
      and(
        eq(eventiPartecipantiTable.eventoId, eventoId),
        eq(eventiPartecipantiTable.collaboratoreId, collaboratoreId),
        sql`lower(${eventiPartecipantiTable.nome}) = lower(${nome}) and lower(${eventiPartecipantiTable.cognome}) = lower(${cognome})`,
        escludiId ? sql`${eventiPartecipantiTable.id} <> ${escludiId}` : undefined,
      ),
    );
  if (d) throw DUPLICATO;
}

/** Indirizzo email in minuscolo e senza spazi; deve avere la forma di un indirizzo valido. */
function pulisciEmail(v: string): string {
  const e = v.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new HttpError(400, "Inserisci un indirizzo email valido.", "DATI_NON_VALIDI", "email");
  return e;
}

router.post("/eventi/:id/partecipanti", async (req, res) => {
  const { id } = valida(AddPartecipanteEventoParams, req.params);
  const b = valida(AddPartecipanteEventoBody, req.body);
  const mio = mioCollaboratoreId(req);
  const invito = await invitoSede(id, mio);
  if (!invito) throw nonTrovato("Evento non trovato.");
  if (!invito.confermatoIl) throw NON_CONFERMATO;
  const e = await caricaEvento(id);
  const nome = normalizzaNomePersona(b.nome, "Il nome");
  const cognome = normalizzaNomePersona(b.cognome, "Il cognome");
  const email = pulisciEmail(b.email);
  await controllaDuplicato(id, mio, nome, cognome);
  let notifiche: number[] = [];
  try {
    await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(eventiPartecipantiTable)
        .values({ eventoId: id, collaboratoreId: mio, nome, cognome, email, codiceQr: nuovoCodiceQr(), creatoDaUtenteId: req.utente!.id })
        .returning({ id: eventiPartecipantiTable.id });
      notifiche = await notificaQrPartecipante(tx, e, { id: p!.id, nome, email });
      await registraLog(tx, contestoDa(req), {
        azione: "evento.partecipante_aggiungi",
        entita: "evento",
        entitaId: id,
        descrizione: `Aggiunto ${cognome} ${nome} all'evento "${e.titolo}"`,
        dettagli: { partecipanteId: p!.id, collaboratoreId: mio },
      });
    });
  } catch (err) {
    if (codiceErrorePg(err).code === "23505") throw DUPLICATO;
    throw err;
  }
  recapitaInBackground(notifiche);
  res.status(201).json(await schedaSede(id, mio));
});

async function partecipantePropria(eventoId: number, partecipanteId: number, mio: number) {
  const [p] = await db
    .select()
    .from(eventiPartecipantiTable)
    .where(and(eq(eventiPartecipantiTable.id, partecipanteId), eq(eventiPartecipantiTable.eventoId, eventoId), eq(eventiPartecipantiTable.collaboratoreId, mio)));
  if (!p) throw nonTrovato("Partecipante non trovato.");
  if (p.entrataIl || p.uscitaIl) {
    throw new HttpError(409, "Per questo partecipante è già stato registrato un orario: non si può più modificare.", "PARTECIPANTE_BLOCCATO");
  }
  return p;
}

router.patch("/eventi/:id/partecipanti/:partecipanteId", async (req, res) => {
  const { id, partecipanteId } = valida(UpdatePartecipanteEventoParams, req.params);
  const b = valida(UpdatePartecipanteEventoBody, req.body);
  const mio = mioCollaboratoreId(req);
  const p = await partecipantePropria(id, partecipanteId, mio);
  const e = await caricaEvento(id);
  const nome = normalizzaNomePersona(b.nome, "Il nome");
  const cognome = normalizzaNomePersona(b.cognome, "Il cognome");
  const email = pulisciEmail(b.email);
  await controllaDuplicato(id, mio, nome, cognome, p.id);
  if (nome !== p.nome || cognome !== p.cognome || email !== p.email) {
    let notifiche: number[] = [];
    await db.transaction(async (tx) => {
      await tx.update(eventiPartecipantiTable).set({ nome, cognome, email }).where(eq(eventiPartecipantiTable.id, p.id));
      // Se l'indirizzo cambia (o non c'era), il QR code arriva al nuovo indirizzo.
      if (email !== p.email) notifiche = await notificaQrPartecipante(tx, e, { id: p.id, nome, email });
      await registraLog(tx, contestoDa(req), {
        azione: "evento.partecipante_modifica",
        entita: "evento",
        entitaId: id,
        descrizione: `Corretto il partecipante "${p.cognome} ${p.nome}" in "${cognome} ${nome}" all'evento "${e.titolo}"`,
        dettagli: { partecipanteId: p.id, prima: { nome: p.nome, cognome: p.cognome, email: p.email }, dopo: { nome, cognome, email } },
      });
    });
    recapitaInBackground(notifiche);
  }
  res.json(await schedaSede(id, mio));
});

router.delete("/eventi/:id/partecipanti/:partecipanteId", async (req, res) => {
  const { id, partecipanteId } = valida(DeletePartecipanteEventoParams, req.params);
  const mio = mioCollaboratoreId(req);
  const p = await partecipantePropria(id, partecipanteId, mio);
  const e = await caricaEvento(id);
  await db.transaction(async (tx) => {
    await tx.delete(eventiPartecipantiTable).where(eq(eventiPartecipantiTable.id, p.id));
    await registraLog(tx, contestoDa(req), {
      azione: "evento.partecipante_elimina",
      entita: "evento",
      entitaId: id,
      descrizione: `Tolto ${p.cognome} ${p.nome} dall'evento "${e.titolo}"`,
      dettagli: { partecipanteId: p.id, collaboratoreId: mio },
    });
  });
  res.json(await schedaSede(id, mio));
});

export default router;
