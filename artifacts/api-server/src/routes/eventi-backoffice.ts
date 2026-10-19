import express, { Router, type IRouter, type Response } from "express";
import { randomBytes } from "node:crypto";
import { and, asc, count, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import {
  AddInvitiEventoBody,
  AddInvitiEventoParams,
  CreateEventoBody,
  DeleteDocumentoEventoParams,
  DeleteEventoParams,
  DeleteQuestionarioEventoParams,
  DeleteQuizEventoParams,
  GetEventoBackofficeParams,
  InviaDocumentiEventoBody,
  InviaDocumentiEventoParams,
  InviaQuizEventoBody,
  InviaQuizEventoParams,
  RegistraCheckInEventoBody,
  RegistraCheckInEventoParams,
  RegistraPresenzaPartecipanteBody,
  RegistraPresenzaPartecipanteParams,
  RemoveInvitoEventoParams,
  SaveQuizEventoBody,
  SaveQuizEventoParams,
  UpdateSogliaAttestatoBody,
  UpdateSogliaAttestatoParams,
  SaveQuestionarioEventoBody,
  SaveQuestionarioEventoParams,
  UpdateEventoBody,
  UpdateEventoParams,
  UpdateOrariPartecipanteBody,
  UpdateOrariPartecipanteParams,
} from "@workspace/api-zod";
import {
  collaboratoriTable,
  db,
  eventiDocumentiTable,
  eventiInvitiTable,
  eventiPartecipantiTable,
  eventiQuizInvitiTable,
  eventiQuizTable,
  eventiTable,
  personeTable,
  utentiTable,
} from "@workspace/db";
import { generaAttestati, type PartecipanteAttestato } from "../lib/attestati";
import { generaQuestionarioPdf } from "../lib/questionario-pdf";
import { HttpError, nonTrovato } from "../lib/errori";
import {
  caricaEvento,
  controllaOrari,
  dataValida,
  datiEvento,
  formattaData,
  haOreSufficienti,
  intero,
  istanteRoma,
  minutiPresenza,
  oraRoma,
  partecipantiBackoffice,
  schedaBackoffice,
} from "../lib/eventi";
import { contestoDa, differenze, registraLog } from "../lib/log";
import { notificaDocumentiCorso, notificaInvitoEvento, notificaQuestionarioCorso } from "../lib/notifiche-eventi";
import { leggiBuffer } from "../lib/eventi-email";
import { recapitaInBackground } from "../lib/notifiche";
import { DIMENSIONE_MASSIMA_FILE, eliminaFile, leggiFile, salvaFile, validaFile } from "../lib/storage";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";
import { inviaFile } from "./tipi-pratica";

const router: IRouter = Router();
router.use("/backoffice/eventi", richiediRuolo("super_admin", "admin"));
const corpoFile = express.raw({ type: () => true, limit: DIMENSIONE_MASSIMA_FILE });

/** Dopo l'entrata, una nuova scansione ravvicinata non vale come uscita. */
const SECONDI_MINIMI_TRA_ENTRATA_E_USCITA = 60;

const descrizioneData = (e: { data: string; oraInizio: string }) => `${formattaData(e.data)} ore ${e.oraInizio}`;

/** Sedi esistenti e attive, nell'ordine ricevuto e senza doppioni. */
async function sediInvitabili(ids: number[]): Promise<number[]> {
  const unici = [...new Set(ids)];
  if (unici.length === 0) return [];
  const righe = await db
    .select({ id: collaboratoriTable.id, attivo: utentiTable.attivo })
    .from(collaboratoriTable)
    .innerJoin(utentiTable, eq(utentiTable.id, collaboratoriTable.utenteId))
    .where(inArray(collaboratoriTable.id, unici));
  if (righe.length !== unici.length) throw new HttpError(400, "Una delle sedi scelte non esiste.", "DATI_NON_VALIDI", "collaboratoriIds");
  if (righe.some((r) => !r.attivo)) throw new HttpError(400, "Non si possono invitare sedi disattivate.", "DATI_NON_VALIDI", "collaboratoriIds");
  return unici;
}

async function orariRegistrati(eventoId: number): Promise<number> {
  const [n] = await db
    .select({ n: count() })
    .from(eventiPartecipantiTable)
    .where(and(eq(eventiPartecipantiTable.eventoId, eventoId), or(isNotNull(eventiPartecipantiTable.entrataIl), isNotNull(eventiPartecipantiTable.uscitaIl))));
  return n?.n ?? 0;
}

function inviaPdf(res: Response, pdf: Buffer, nome: string) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", String(pdf.length));
  res.setHeader("Content-Disposition", `inline; filename="attestato.pdf"; filename*=UTF-8''${encodeURIComponent(nome)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.end(pdf);
}

// ---------------------------------------------------------------------------------------------
// Elenco, creazione, scheda
// ---------------------------------------------------------------------------------------------

// Nelle select su una sola tabella drizzle scrive la colonna senza il nome della tabella ("id"): dentro la sottoquery
// verrebbe letta come colonna della tabella interna. Qui il riferimento va quindi qualificato a mano.
const EVENTO_ID = sql.raw('"eventi"."id"');

router.get("/backoffice/eventi", async (_req, res) => {
  const righe = await db
    .select({
      e: eventiTable,
      invitati: sql<number>`(select count(*)::int from ${eventiInvitiTable} i where i.evento_id = ${EVENTO_ID})`,
      confermati: sql<number>`(select count(*)::int from ${eventiInvitiTable} i where i.evento_id = ${EVENTO_ID} and i.confermato_il is not null)`,
      partecipanti: sql<number>`(select count(*)::int from ${eventiPartecipantiTable} p where p.evento_id = ${EVENTO_ID})`,
      presenti: sql<number>`(select count(*)::int from ${eventiPartecipantiTable} p where p.evento_id = ${EVENTO_ID} and p.entrata_il is not null)`,
    })
    .from(eventiTable)
    .orderBy(sql`${eventiTable.data} desc`, sql`${eventiTable.oraInizio} desc`, sql`${eventiTable.id} desc`);
  res.json(
    righe.map((r) => ({
      evento: datiEvento(r.e),
      invitati: r.invitati,
      confermati: r.confermati,
      partecipanti: r.partecipanti,
      presenti: r.presenti,
      questionario: !!r.e.questionarioChiave,
    })),
  );
});

function pulisciTesto(v: string, nome: string): string {
  const t = v.replace(/[ \t]+/g, " ").trim();
  if (!t) throw new HttpError(400, `${nome} è obbligatorio.`, "DATI_NON_VALIDI");
  return t;
}

router.post("/backoffice/eventi", async (req, res) => {
  const b = valida(CreateEventoBody, req.body);
  if (!dataValida(b.data)) throw new HttpError(400, "La data non è valida.", "DATI_NON_VALIDI", "data");
  controllaOrari(b.oraInizio, b.oraFine);
  const sedi = await sediInvitabili(b.collaboratoriIds);
  const titolo = pulisciTesto(b.titolo, "Il titolo");
  const luogo = pulisciTesto(b.luogo, "Il luogo");
  const argomento = pulisciTesto(b.argomento, "L'argomento del corso");
  const { id, notifiche } = await db.transaction(async (tx) => {
    const [e] = await tx
      .insert(eventiTable)
      .values({
        titolo, data: b.data, oraInizio: b.oraInizio, oraFine: b.oraFine || null, luogo, tipoCorso: b.tipoCorso, argomento,
        descrizione: (b.descrizione ?? "").trim(), creatoDaUtenteId: req.utente!.id,
      })
      .returning();
    if (sedi.length) await tx.insert(eventiInvitiTable).values(sedi.map((collaboratoreId) => ({ eventoId: e!.id, collaboratoreId })));
    await registraLog(tx, contestoDa(req), {
      azione: "evento.crea",
      entita: "evento",
      entitaId: e!.id,
      descrizione: `Creato l'evento "${titolo}" del ${descrizioneData(e!)}, con ${sedi.length} ${sedi.length === 1 ? "sede invitata" : "sedi invitate"}`,
      dettagli: { titolo, data: b.data, oraInizio: b.oraInizio, oraFine: b.oraFine ?? null, luogo, tipoCorso: b.tipoCorso, argomento, sediInvitate: sedi },
    });
    const notifiche = await notificaInvitoEvento(tx, e!, sedi);
    return { id: e!.id, notifiche };
  });
  recapitaInBackground(notifiche);
  res.status(201).json(await schedaBackoffice(id));
});

router.get("/backoffice/eventi/:id", async (req, res) => {
  const { id } = valida(GetEventoBackofficeParams, req.params);
  res.json(await schedaBackoffice(id));
});

router.patch("/backoffice/eventi/:id", async (req, res) => {
  const { id } = valida(UpdateEventoParams, req.params);
  const b = valida(UpdateEventoBody, req.body);
  const prima = await caricaEvento(id);
  if (!dataValida(b.data)) throw new HttpError(400, "La data non è valida.", "DATI_NON_VALIDI", "data");
  controllaOrari(b.oraInizio, b.oraFine);
  if (b.data !== prima.data && (await orariRegistrati(id)) > 0) {
    throw new HttpError(409, "Ci sono già orari di entrata o uscita registrati: la data non si può più cambiare.", "ORARI_REGISTRATI", "data");
  }
  const dopo = {
    titolo: pulisciTesto(b.titolo, "Il titolo"),
    data: b.data,
    oraInizio: b.oraInizio,
    oraFine: b.oraFine || null,
    luogo: pulisciTesto(b.luogo, "Il luogo"),
    tipoCorso: b.tipoCorso,
    argomento: pulisciTesto(b.argomento, "L'argomento del corso"),
    descrizione: (b.descrizione ?? "").trim(),
  };
  const diff = differenze(prima, { ...prima, ...dopo }, {
    titolo: "titolo", data: "data", oraInizio: "ora di inizio", oraFine: "ora di fine", luogo: "luogo", tipoCorso: "tipo di corso", argomento: "argomento del corso", descrizione: "descrizione",
  });
  await db.transaction(async (tx) => {
    await tx.update(eventiTable).set({ ...dopo, modificatoIl: new Date() }).where(eq(eventiTable.id, id));
    if (diff.elenco.length) {
      await registraLog(tx, contestoDa(req), {
        azione: "evento.modifica",
        entita: "evento",
        entitaId: id,
        descrizione: `Modificato l'evento "${dopo.titolo}": ${diff.elenco.join(", ")}`,
        dettagli: { prima: diff.prima, dopo: diff.dopo },
      });
    }
  });
  res.json(await schedaBackoffice(id));
});

router.delete("/backoffice/eventi/:id", async (req, res) => {
  const { id } = valida(DeleteEventoParams, req.params);
  const e = await caricaEvento(id);
  if ((await orariRegistrati(id)) > 0) {
    throw new HttpError(409, "Nell'evento sono già stati registrati orari di entrata o uscita: non si può eliminare.", "ORARI_REGISTRATI");
  }
  const documenti = await db.select({ chiave: eventiDocumentiTable.chiave }).from(eventiDocumentiTable).where(eq(eventiDocumentiTable.eventoId, id));
  await db.transaction(async (tx) => {
    await tx.delete(eventiTable).where(eq(eventiTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "evento.elimina",
      entita: "evento",
      entitaId: id,
      descrizione: `Eliminato l'evento "${e.titolo}" del ${descrizioneData(e)}`,
      dettagli: { titolo: e.titolo, data: e.data },
    });
  });
  for (const chiave of [e.questionarioChiave, e.layoutChiave, ...documenti.map((d) => d.chiave)]) if (chiave) await eliminaFile(chiave, req.log);
  res.status(204).end();
});

// ---------------------------------------------------------------------------------------------
// Inviti
// ---------------------------------------------------------------------------------------------

router.post("/backoffice/eventi/:id/inviti", async (req, res) => {
  const { id } = valida(AddInvitiEventoParams, req.params);
  const b = valida(AddInvitiEventoBody, req.body);
  const e = await caricaEvento(id);
  const sedi = await sediInvitabili(b.collaboratoriIds);
  const esistenti = await db.select({ id: eventiInvitiTable.collaboratoreId }).from(eventiInvitiTable).where(eq(eventiInvitiTable.eventoId, id));
  const gia = new Set(esistenti.map((x) => x.id));
  const nuove = sedi.filter((s) => !gia.has(s));
  if (nuove.length === 0) throw new HttpError(409, "Le sedi scelte sono già invitate.", "GIA_INVITATE", "collaboratoriIds");
  const notifiche = await db.transaction(async (tx) => {
    await tx.insert(eventiInvitiTable).values(nuove.map((collaboratoreId) => ({ eventoId: id, collaboratoreId }))).onConflictDoNothing();
    await registraLog(tx, contestoDa(req), {
      azione: "evento.invita",
      entita: "evento",
      entitaId: id,
      descrizione: `Invitate ${nuove.length} ${nuove.length === 1 ? "sede" : "sedi"} all'evento "${e.titolo}"`,
      dettagli: { sediInvitate: nuove },
    });
    return notificaInvitoEvento(tx, e, nuove);
  });
  recapitaInBackground(notifiche);
  res.json(await schedaBackoffice(id));
});

router.delete("/backoffice/eventi/:id/inviti/:collaboratoreId", async (req, res) => {
  const { id, collaboratoreId } = valida(RemoveInvitoEventoParams, req.params);
  const e = await caricaEvento(id);
  const [invito] = await db
    .select({ id: eventiInvitiTable.id, nome: sql<string>`${personeTable.cognome} || ' ' || ${personeTable.nome}`, sportello: collaboratoriTable.numeroSportello })
    .from(eventiInvitiTable)
    .innerJoin(collaboratoriTable, eq(collaboratoriTable.id, eventiInvitiTable.collaboratoreId))
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .where(and(eq(eventiInvitiTable.eventoId, id), eq(eventiInvitiTable.collaboratoreId, collaboratoreId)));
  if (!invito) throw nonTrovato("Questa sede non è invitata all'evento.");
  const [n] = await db
    .select({ n: count() })
    .from(eventiPartecipantiTable)
    .where(and(eq(eventiPartecipantiTable.eventoId, id), eq(eventiPartecipantiTable.collaboratoreId, collaboratoreId)));
  if ((n?.n ?? 0) > 0) {
    throw new HttpError(409, "La sede ha già inserito dei partecipanti: non si può togliere l'invito.", "SEDE_CON_PARTECIPANTI");
  }
  await db.transaction(async (tx) => {
    await tx.delete(eventiInvitiTable).where(eq(eventiInvitiTable.id, invito.id));
    await registraLog(tx, contestoDa(req), {
      azione: "evento.invito_rimuovi",
      entita: "evento",
      entitaId: id,
      descrizione: `Tolto l'invito all'evento "${e.titolo}" alla sede ${invito.nome} (sportello ${invito.sportello})`,
      dettagli: { collaboratoreId },
    });
  });
  res.json(await schedaBackoffice(id));
});

// ---------------------------------------------------------------------------------------------
// Orari e check-in
// ---------------------------------------------------------------------------------------------

async function caricaPartecipanteEvento(eventoId: number, partecipanteId: number) {
  const [p] = await db
    .select()
    .from(eventiPartecipantiTable)
    .where(and(eq(eventiPartecipantiTable.id, partecipanteId), eq(eventiPartecipantiTable.eventoId, eventoId)));
  if (!p) throw nonTrovato("Partecipante non trovato.");
  return p;
}

const nomeCompleto = (p: { cognome: string; nome: string }) => `${p.cognome} ${p.nome}`;

router.patch("/backoffice/eventi/:id/partecipanti/:partecipanteId/orari", async (req, res) => {
  const { id, partecipanteId } = valida(UpdateOrariPartecipanteParams, req.params);
  const b = valida(UpdateOrariPartecipanteBody, req.body);
  const e = await caricaEvento(id);
  const p = await caricaPartecipanteEvento(id, partecipanteId);
  const entrata = b.entrata ? await istanteRoma(db, e.data, b.entrata) : null;
  const uscita = b.uscita ? await istanteRoma(db, e.data, b.uscita) : null;
  if (entrata && uscita && uscita <= entrata) {
    throw new HttpError(400, "L'uscita deve essere dopo l'entrata.", "DATI_NON_VALIDI", "uscita");
  }
  const fmt = (d: Date | null) => (d ? oraRoma(d) : "nessuno");
  await db.transaction(async (tx) => {
    await tx.update(eventiPartecipantiTable).set({ entrataIl: entrata, uscitaIl: uscita }).where(eq(eventiPartecipantiTable.id, p.id));
    await registraLog(tx, contestoDa(req), {
      azione: "evento.orari_modifica",
      entita: "evento",
      entitaId: id,
      descrizione: `Orari di ${nomeCompleto(p)} all'evento "${e.titolo}": entrata ${fmt(p.entrataIl)} -> ${fmt(entrata)}, uscita ${fmt(p.uscitaIl)} -> ${fmt(uscita)}`,
      dettagli: { partecipanteId: p.id, prima: { entrata: p.entrataIl, uscita: p.uscitaIl }, dopo: { entrata, uscita } },
    });
  });
  res.json(await schedaBackoffice(id));
});

/** Entrata o uscita scelta dall'elenco dei partecipanti (senza QR): registra l'istante attuale. */
router.post("/backoffice/eventi/:id/partecipanti/:partecipanteId/presenza", async (req, res) => {
  const { id, partecipanteId } = valida(RegistraPresenzaPartecipanteParams, req.params);
  const { tipo } = valida(RegistraPresenzaPartecipanteBody, req.body);
  const e = await caricaEvento(id);
  const p = await caricaPartecipanteEvento(id, partecipanteId);
  const adesso = new Date();
  await db.transaction(async (tx) => {
    if (tipo === "entrata") {
      const [agg] = await tx
        .update(eventiPartecipantiTable)
        .set({ entrataIl: adesso })
        .where(and(eq(eventiPartecipantiTable.id, p.id), isNull(eventiPartecipantiTable.entrataIl)))
        .returning({ id: eventiPartecipantiTable.id });
      if (!agg) throw new HttpError(409, `L'entrata di ${nomeCompleto(p)} è già registrata.`, "GIA_REGISTRATO");
    } else {
      if (!p.entrataIl) throw new HttpError(409, `Registra prima l'entrata di ${nomeCompleto(p)}.`, "ENTRATA_MANCANTE");
      if (adesso <= p.entrataIl) throw new HttpError(409, "L'uscita deve essere dopo l'entrata.", "DATI_NON_VALIDI");
      const [agg] = await tx
        .update(eventiPartecipantiTable)
        .set({ uscitaIl: adesso })
        .where(and(eq(eventiPartecipantiTable.id, p.id), isNull(eventiPartecipantiTable.uscitaIl)))
        .returning({ id: eventiPartecipantiTable.id });
      if (!agg) throw new HttpError(409, `L'uscita di ${nomeCompleto(p)} è già registrata.`, "GIA_REGISTRATO");
    }
    await registraLog(tx, contestoDa(req), {
      azione: "evento.presenza",
      entita: "evento",
      entitaId: id,
      descrizione: `${tipo === "entrata" ? "Entrata" : "Uscita"} di ${nomeCompleto(p)} all'evento "${e.titolo}" registrata dall'elenco alle ${oraRoma(adesso)}`,
      dettagli: { partecipanteId: p.id, tipo },
    });
  });
  const aggiornato = (await partecipantiBackoffice(id)).find((x) => x.id === p.id)!;
  res.json({ esito: "registrato", tipo, avviso: null, partecipante: aggiornato });
});

router.post("/backoffice/eventi/:id/check-in", async (req, res) => {
  const { id } = valida(RegistraCheckInEventoParams, req.params);
  const b = valida(RegistraCheckInEventoBody, req.body);
  const e = await caricaEvento(id);
  const codice = b.codice.trim();
  const [p] = await db.select().from(eventiPartecipantiTable).where(eq(eventiPartecipantiTable.codiceQr, codice));
  if (!p) throw nonTrovato("QR code non riconosciuto.");
  if (p.eventoId !== id) throw new HttpError(409, "Questo QR code appartiene a un altro evento.", "QR_ALTRO_EVENTO");

  const adesso = new Date();
  const esito = await db.transaction(async (tx): Promise<{ tipo: "entrata" | "uscita"; registrato: boolean; avviso: string | null }> => {
    // Prima scansione: entrata. L'aggiornamento condizionato evita che due scansioni ravvicinate registrino entrambe l'entrata.
    const [entrata] = await tx
      .update(eventiPartecipantiTable)
      .set({ entrataIl: adesso })
      .where(and(eq(eventiPartecipantiTable.id, p.id), isNull(eventiPartecipantiTable.entrataIl)))
      .returning({ id: eventiPartecipantiTable.id });
    if (entrata) {
      await registraLog(tx, contestoDa(req), {
        azione: "evento.check_in",
        entita: "evento",
        entitaId: id,
        descrizione: `Entrata di ${nomeCompleto(p)} all'evento "${e.titolo}" alle ${oraRoma(adesso)}`,
        dettagli: { partecipanteId: p.id, tipo: "entrata" },
      });
      return { tipo: "entrata", registrato: true, avviso: null };
    }
    // Seconda scansione: uscita, ma non subito dopo l'entrata (la stessa persona inquadrata due volte di seguito).
    const limite = new Date(adesso.getTime() - SECONDI_MINIMI_TRA_ENTRATA_E_USCITA * 1000);
    const [uscita] = await tx
      .update(eventiPartecipantiTable)
      .set({ uscitaIl: adesso })
      .where(and(eq(eventiPartecipantiTable.id, p.id), isNull(eventiPartecipantiTable.uscitaIl), lte(eventiPartecipantiTable.entrataIl, limite)))
      .returning({ id: eventiPartecipantiTable.id });
    if (uscita) {
      await registraLog(tx, contestoDa(req), {
        azione: "evento.check_in",
        entita: "evento",
        entitaId: id,
        descrizione: `Uscita di ${nomeCompleto(p)} all'evento "${e.titolo}" alle ${oraRoma(adesso)}`,
        dettagli: { partecipanteId: p.id, tipo: "uscita" },
      });
      return { tipo: "uscita", registrato: true, avviso: null };
    }
    const [att] = await tx.select().from(eventiPartecipantiTable).where(eq(eventiPartecipantiTable.id, p.id));
    if (att?.uscitaIl) {
      return { tipo: "uscita", registrato: false, avviso: `Entrata (${att.entrataIl ? oraRoma(att.entrataIl) : ""}) e uscita (${oraRoma(att.uscitaIl)}) già registrate.` };
    }
    return { tipo: "entrata", registrato: false, avviso: `Entrata già registrata alle ${att?.entrataIl ? oraRoma(att.entrataIl) : ""}: attendi qualche istante prima di registrare l'uscita.` };
  });
  const lista = await partecipantiBackoffice(id);
  const aggiornato = lista.find((x) => x.id === p.id)!;
  res.json({ esito: esito.registrato ? "registrato" : "gia_registrato", tipo: esito.tipo, avviso: esito.avviso, partecipante: aggiornato });
});

// ---------------------------------------------------------------------------------------------
// Questionario
// ---------------------------------------------------------------------------------------------

router.put("/backoffice/eventi/:id/questionario/file", corpoFile, async (req, res) => {
  const id = intero(req.params["id"], "id");
  const e = await caricaEvento(id);
  const file = validaFile(req.query["nomeFile"], req.body);
  const chiave = await salvaFile(file.buffer, file.tipo);
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(eventiTable)
        .set({
          questionarioChiave: chiave, questionarioNome: file.nome, questionarioTipo: file.tipo,
          questionarioDimensione: file.dimensione, questionarioCaricatoIl: new Date(), questionarioDomande: null, modificatoIl: new Date(),
        })
        .where(eq(eventiTable.id, id));
      await registraLog(tx, contestoDa(req), {
        azione: "evento.questionario_carica",
        entita: "evento",
        entitaId: id,
        descrizione: `${e.questionarioChiave ? "Sostituito" : "Caricato"} il questionario dell'evento "${e.titolo}" (${file.nome})`,
        dettagli: { fileNome: file.nome, dimensione: file.dimensione, precedente: e.questionarioNome },
      });
    });
  } catch (err) {
    await eliminaFile(chiave, req.log);
    throw err;
  }
  if (e.questionarioChiave) await eliminaFile(e.questionarioChiave, req.log);
  res.json(await schedaBackoffice(id));
});

/** Salva le domande e genera il PDF da stampare, che prende il posto del file del questionario. */
router.put("/backoffice/eventi/:id/questionario/domande", async (req, res) => {
  const { id } = valida(SaveQuestionarioEventoParams, req.params);
  const body = valida(SaveQuestionarioEventoBody, req.body);
  const e = await caricaEvento(id);
  const domande = body.domande.map((d, i) => {
    const testo = d.testo.trim();
    if (!testo) throw new HttpError(400, `La domanda ${i + 1} è vuota.`, "DATI_NON_VALIDI", "domande");
    if (d.tipo === "aperta") return { testo, tipo: "aperta" as const, opzioni: [], righe: d.righe };
    const opzioni = d.opzioni.map((o) => o.trim()).filter(Boolean);
    if (opzioni.length < 2) throw new HttpError(400, `La domanda ${i + 1} deve avere almeno due risposte da spuntare.`, "DATI_NON_VALIDI", "domande");
    return { testo, tipo: "scelta" as const, opzioni, righe: d.righe };
  });
  const pdf = await generaQuestionarioPdf(e, domande);
  const nome = `Questionario - ${e.titolo}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) + ".pdf";
  const chiave = await salvaFile(pdf, "application/pdf");
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(eventiTable)
        .set({
          questionarioChiave: chiave, questionarioNome: nome, questionarioTipo: "application/pdf",
          questionarioDimensione: pdf.length, questionarioCaricatoIl: new Date(), questionarioDomande: domande, modificatoIl: new Date(),
        })
        .where(eq(eventiTable.id, id));
      await registraLog(tx, contestoDa(req), {
        azione: "evento.questionario_domande",
        entita: "evento",
        entitaId: id,
        descrizione: `${e.questionarioDomande ? "Modificato" : "Creato"} il questionario dell'evento "${e.titolo}" (${domande.length} ${domande.length === 1 ? "domanda" : "domande"})`,
        dettagli: { domande: domande.length, scelta: domande.filter((d) => d.tipo === "scelta").length, aperte: domande.filter((d) => d.tipo === "aperta").length, precedente: e.questionarioNome },
      });
    });
  } catch (err) {
    await eliminaFile(chiave, req.log);
    throw err;
  }
  if (e.questionarioChiave) await eliminaFile(e.questionarioChiave, req.log);
  res.json(await schedaBackoffice(id));
});

router.get("/backoffice/eventi/:id/questionario/file", async (req, res) => {
  const e = await caricaEvento(intero(req.params["id"], "id"));
  if (!e.questionarioChiave) throw nonTrovato("Per questo evento non c'è nessun questionario.");
  const { stream } = await leggiFile(e.questionarioChiave);
  inviaFile(res, stream, e.questionarioNome!, e.questionarioTipo!, e.questionarioDimensione!);
});

router.delete("/backoffice/eventi/:id/questionario", async (req, res) => {
  const { id } = valida(DeleteQuestionarioEventoParams, req.params);
  const e = await caricaEvento(id);
  if (!e.questionarioChiave) throw nonTrovato("Per questo evento non c'è nessun questionario.");
  await db.transaction(async (tx) => {
    await tx
      .update(eventiTable)
      .set({ questionarioChiave: null, questionarioNome: null, questionarioTipo: null, questionarioDimensione: null, questionarioCaricatoIl: null, questionarioDomande: null, modificatoIl: new Date() })
      .where(eq(eventiTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "evento.questionario_elimina",
      entita: "evento",
      entitaId: id,
      descrizione: `Eliminato il questionario dell'evento "${e.titolo}" (${e.questionarioNome})`,
      dettagli: { fileNome: e.questionarioNome },
    });
  });
  await eliminaFile(e.questionarioChiave, req.log);
  res.json(await schedaBackoffice(id));
});

// ---------------------------------------------------------------------------------------------
// Attestati
// ---------------------------------------------------------------------------------------------

async function pdfAttestati(eventoId: number, partecipanti: PartecipanteAttestato[]) {
  const e = await caricaEvento(eventoId);
  if (e.tipoCorso !== "CAF" && e.tipoCorso !== "PATRONATO") {
    throw new HttpError(409, "Indica il tipo di corso (CAF o Patronato) nell'evento prima di stampare gli attestati.", "DATI_ATTESTATO_MANCANTI");
  }
  return generaAttestati({ tipoCorso: e.tipoCorso, argomento: e.argomento ?? "", data: e.data }, partecipanti);
}

const nomiOrdinati = [asc(sql`lower(${eventiPartecipantiTable.cognome})`), asc(sql`lower(${eventiPartecipantiTable.nome})`), asc(eventiPartecipantiTable.id)];

/** Anteprima con un nome di prova, le ore minime del corso e i dati reali dell'evento. */
router.get("/backoffice/eventi/:id/attestato/anteprima", async (req, res) => {
  const id = intero(req.params["id"], "id");
  const e = await caricaEvento(id);
  inviaPdf(res, await pdfAttestati(id, [{ nome: "Maria Rossi Esempio", minuti: Math.max(60, Math.round(e.oreMinimeAttestato * 60)) }]), "anteprima-attestato.pdf");
});

router.get("/backoffice/eventi/:id/attestato/partecipanti/:partecipanteId", async (req, res) => {
  const id = intero(req.params["id"], "id");
  const e = await caricaEvento(id);
  const p = await caricaPartecipanteEvento(id, intero(req.params["partecipanteId"], "partecipanteId"));
  const minuti = minutiPresenza(p.entrataIl, p.uscitaIl);
  if (!haOreSufficienti(minuti, e.oreMinimeAttestato)) {
    throw new HttpError(
      409,
      minuti === null
        ? `Per ${nomeCompleto(p)} mancano l'entrata o l'uscita: senza le ore di presenza l'attestato non si può generare.`
        : `${nomeCompleto(p)} ha partecipato ${formattaOre(minuti)}: servono almeno ${formattaOre(Math.round(e.oreMinimeAttestato * 60))} per l'attestato.`,
      "ORE_INSUFFICIENTI",
    );
  }
  inviaPdf(res, await pdfAttestati(id, [{ nome: `${p.nome} ${p.cognome}`, minuti: minuti! }]), `attestato-${p.cognome}-${p.nome}.pdf`);
});

function formattaOre(minuti: number): string {
  const h = Math.floor(minuti / 60);
  const m = minuti % 60;
  return h === 0 ? `${m} minuti` : m === 0 ? `${h} ${h === 1 ? "ora" : "ore"}` : `${h} h ${m} min`;
}

/** Un attestato per ogni partecipante con le ore minime di presenza, in ordine alfabetico. */
router.get("/backoffice/eventi/:id/attestato/presenti", async (req, res) => {
  const id = intero(req.params["id"], "id");
  const e = await caricaEvento(id);
  const righe = await db
    .select({ nome: eventiPartecipantiTable.nome, cognome: eventiPartecipantiTable.cognome, entrataIl: eventiPartecipantiTable.entrataIl, uscitaIl: eventiPartecipantiTable.uscitaIl })
    .from(eventiPartecipantiTable)
    .where(and(eq(eventiPartecipantiTable.eventoId, id), isNotNull(eventiPartecipantiTable.entrataIl), isNotNull(eventiPartecipantiTable.uscitaIl)))
    .orderBy(...nomiOrdinati);
  const idonei = righe
    .map((r) => ({ nome: `${r.nome} ${r.cognome}`, minuti: minutiPresenza(r.entrataIl, r.uscitaIl) }))
    .filter((r): r is PartecipanteAttestato => haOreSufficienti(r.minuti, e.oreMinimeAttestato));
  if (idonei.length === 0) {
    throw new HttpError(409, `Nessun partecipante ha almeno ${formattaOre(Math.round(e.oreMinimeAttestato * 60))} di presenza (servono entrata e uscita registrate).`, "NESSUN_IDONEO");
  }
  inviaPdf(res, await pdfAttestati(id, idonei), "attestati-partecipanti.pdf");
});

router.put("/backoffice/eventi/:id/attestato/soglia", async (req, res) => {
  const { id } = valida(UpdateSogliaAttestatoParams, req.params);
  const { oreMinime } = valida(UpdateSogliaAttestatoBody, req.body);
  const e = await caricaEvento(id);
  const nuova = Math.round(oreMinime * 4) / 4;
  if (nuova !== e.oreMinimeAttestato) {
    await db.transaction(async (tx) => {
      await tx.update(eventiTable).set({ oreMinimeAttestato: nuova, modificatoIl: new Date() }).where(eq(eventiTable.id, id));
      await registraLog(tx, contestoDa(req), {
        azione: "evento.attestato_soglia",
        entita: "evento",
        entitaId: id,
        descrizione: `Ore minime per l'attestato dell'evento "${e.titolo}": da ${e.oreMinimeAttestato} a ${nuova}`,
        dettagli: { prima: e.oreMinimeAttestato, dopo: nuova },
      });
    });
  }
  res.json(await schedaBackoffice(id));
});

// ---------------------------------------------------------------------------------------------
// Documenti del corso (slide, dispense): si inviano per email ai soli presenti
// ---------------------------------------------------------------------------------------------

const DIMENSIONE_MASSIMA_DOCUMENTI = 25 * 1024 * 1024;

router.put("/backoffice/eventi/:id/documenti", corpoFile, async (req, res) => {
  const id = intero(req.params["id"], "id");
  const e = await caricaEvento(id);
  const file = validaFile(req.query["nomeFile"], req.body, { conPresentazioni: true });
  const [somma] = await db
    .select({ t: sql<number>`coalesce(sum(${eventiDocumentiTable.dimensione}), 0)::int` })
    .from(eventiDocumentiTable)
    .where(eq(eventiDocumentiTable.eventoId, id));
  if ((somma?.t ?? 0) + file.dimensione > DIMENSIONE_MASSIMA_DOCUMENTI) {
    throw new HttpError(413, "I documenti del corso possono pesare al massimo 25 MB in tutto, perché vengono inviati per email.", "FILE_TROPPO_GRANDE");
  }
  const chiave = await salvaFile(file.buffer, file.tipo);
  try {
    await db.transaction(async (tx) => {
      const [d] = await tx
        .insert(eventiDocumentiTable)
        .values({ eventoId: id, chiave, nome: file.nome, tipo: file.tipo, dimensione: file.dimensione, caricatoDaUtenteId: req.utente!.id })
        .returning({ id: eventiDocumentiTable.id });
      await registraLog(tx, contestoDa(req), {
        azione: "evento.documento_carica",
        entita: "evento",
        entitaId: id,
        descrizione: `Caricato il documento "${file.nome}" per il corso "${e.titolo}"`,
        dettagli: { documentoId: d!.id, fileNome: file.nome, dimensione: file.dimensione },
      });
    });
  } catch (err) {
    await eliminaFile(chiave, req.log);
    throw err;
  }
  res.json(await schedaBackoffice(id));
});

router.get("/backoffice/eventi/:id/documenti/:documentoId/file", async (req, res) => {
  const id = intero(req.params["id"], "id");
  const [d] = await db
    .select()
    .from(eventiDocumentiTable)
    .where(and(eq(eventiDocumentiTable.id, intero(req.params["documentoId"], "documentoId")), eq(eventiDocumentiTable.eventoId, id)));
  if (!d) throw nonTrovato("Documento non trovato.");
  const { stream } = await leggiFile(d.chiave);
  inviaFile(res, stream, d.nome, d.tipo, d.dimensione);
});

router.post("/backoffice/eventi/:id/documenti/invia", async (req, res) => {
  const { id } = valida(InviaDocumentiEventoParams, req.params);
  const { documentiIds } = valida(InviaDocumentiEventoBody, req.body);
  const e = await caricaEvento(id);
  const docs = await db
    .select()
    .from(eventiDocumentiTable)
    .where(and(eq(eventiDocumentiTable.eventoId, id), inArray(eventiDocumentiTable.id, [...new Set(documentiIds)])));
  if (docs.length === 0) throw nonTrovato("Documenti non trovati.");
  const presenti = await db
    .select({ id: eventiPartecipantiTable.id, nome: eventiPartecipantiTable.nome, cognome: eventiPartecipantiTable.cognome, email: eventiPartecipantiTable.email })
    .from(eventiPartecipantiTable)
    .where(and(eq(eventiPartecipantiTable.eventoId, id), isNotNull(eventiPartecipantiTable.entrataIl)))
    .orderBy(...nomiOrdinati);
  if (presenti.length === 0) throw new HttpError(409, "Nessun partecipante risulta presente: registra almeno un'entrata.", "NESSUN_PRESENTE");
  const conEmail = presenti.filter((p) => p.email);
  if (conEmail.length === 0) throw new HttpError(409, "Nessun presente ha un indirizzo email.", "NESSUN_DESTINATARIO");
  const totale = docs.reduce((t, d) => t + d.dimensione, 0);
  if (totale > DIMENSIONE_MASSIMA_DOCUMENTI) throw new HttpError(413, "I documenti scelti pesano troppo per un'email (massimo 25 MB).", "FILE_TROPPO_GRANDE");
  const notifiche = await db.transaction(async (tx) => {
    const ids = await notificaDocumentiCorso(tx, e, conEmail, docs.map((d) => d.id));
    await tx
      .update(eventiDocumentiTable)
      .set({ inviatoIl: new Date(), inviatoA: conEmail.length })
      .where(inArray(eventiDocumentiTable.id, docs.map((d) => d.id)));
    await registraLog(tx, contestoDa(req), {
      azione: "evento.documenti_invia",
      entita: "evento",
      entitaId: id,
      descrizione: `Inviati ${docs.length} ${docs.length === 1 ? "documento" : "documenti"} del corso "${e.titolo}" a ${conEmail.length} ${conEmail.length === 1 ? "presente" : "presenti"}`,
      dettagli: { documenti: docs.map((d) => d.nome), destinatari: conEmail.length, senzaEmail: presenti.length - conEmail.length },
    });
    return ids;
  });
  recapitaInBackground(notifiche);
  res.json({ inviati: conEmail.length, senzaEmail: presenti.length - conEmail.length, saltati: 0 });
});

router.delete("/backoffice/eventi/:id/documenti/:documentoId", async (req, res) => {
  const { id, documentoId } = valida(DeleteDocumentoEventoParams, req.params);
  const e = await caricaEvento(id);
  const [d] = await db.select().from(eventiDocumentiTable).where(and(eq(eventiDocumentiTable.id, documentoId), eq(eventiDocumentiTable.eventoId, id)));
  if (!d) throw nonTrovato("Documento non trovato.");
  await db.transaction(async (tx) => {
    await tx.delete(eventiDocumentiTable).where(eq(eventiDocumentiTable.id, d.id));
    await registraLog(tx, contestoDa(req), {
      azione: "evento.documento_elimina",
      entita: "evento",
      entitaId: id,
      descrizione: `Eliminato il documento "${d.nome}" del corso "${e.titolo}"`,
      dettagli: { documentoId: d.id, fileNome: d.nome },
    });
  });
  await eliminaFile(d.chiave, req.log);
  res.json(await schedaBackoffice(id));
});

// ---------------------------------------------------------------------------------------------
// Questionario online (a scelta multipla, con punteggio)
// ---------------------------------------------------------------------------------------------

async function invitiQuiz(eventoId: number): Promise<number> {
  const [n] = await db.select({ n: count() }).from(eventiQuizInvitiTable).where(eq(eventiQuizInvitiTable.eventoId, eventoId));
  return n?.n ?? 0;
}

router.put("/backoffice/eventi/:id/quiz", async (req, res) => {
  const { id } = valida(SaveQuizEventoParams, req.params);
  const b = valida(SaveQuizEventoBody, req.body);
  const e = await caricaEvento(id);
  if ((await invitiQuiz(id)) > 0) {
    throw new HttpError(409, "Il questionario è già stato inviato ai partecipanti: non si può più modificare.", "QUIZ_GIA_INVIATO");
  }
  const domande = b.domande.map((d, i) => {
    const testo = d.testo.trim();
    if (!testo) throw new HttpError(400, `La domanda ${i + 1} è vuota.`, "DATI_NON_VALIDI", "domande");
    const opzioni = d.opzioni.map((o) => o.trim());
    if (opzioni.some((o) => !o)) throw new HttpError(400, `La domanda ${i + 1} ha una risposta vuota.`, "DATI_NON_VALIDI", "domande");
    if (new Set(opzioni.map((o) => o.toLowerCase())).size !== opzioni.length) throw new HttpError(400, `La domanda ${i + 1} ha due risposte uguali.`, "DATI_NON_VALIDI", "domande");
    if (d.corretta >= opzioni.length) throw new HttpError(400, `Indica la risposta esatta della domanda ${i + 1}.`, "DATI_NON_VALIDI", "domande");
    return { testo, opzioni, corretta: d.corretta };
  });
  if (b.punteggioMinimo > domande.length) {
    throw new HttpError(400, `Il punteggio minimo non può superare il numero di domande (${domande.length}).`, "DATI_NON_VALIDI", "punteggioMinimo");
  }
  const [esistente] = await db.select({ id: eventiQuizTable.id }).from(eventiQuizTable).where(eq(eventiQuizTable.eventoId, id));
  await db.transaction(async (tx) => {
    if (esistente) {
      await tx.update(eventiQuizTable).set({ domande, punteggioMinimo: b.punteggioMinimo, modificatoIl: new Date() }).where(eq(eventiQuizTable.id, esistente.id));
    } else {
      await tx.insert(eventiQuizTable).values({ eventoId: id, domande, punteggioMinimo: b.punteggioMinimo });
    }
    await registraLog(tx, contestoDa(req), {
      azione: "evento.quiz_salva",
      entita: "evento",
      entitaId: id,
      descrizione: `${esistente ? "Modificato" : "Creato"} il questionario online del corso "${e.titolo}" (${domande.length} ${domande.length === 1 ? "domanda" : "domande"}, minimo ${b.punteggioMinimo})`,
      dettagli: { domande: domande.length, punteggioMinimo: b.punteggioMinimo },
    });
  });
  res.json(await schedaBackoffice(id));
});

router.delete("/backoffice/eventi/:id/quiz", async (req, res) => {
  const { id } = valida(DeleteQuizEventoParams, req.params);
  const e = await caricaEvento(id);
  const [q] = await db.select({ id: eventiQuizTable.id }).from(eventiQuizTable).where(eq(eventiQuizTable.eventoId, id));
  if (!q) throw nonTrovato("Per questo corso non c'è nessun questionario online.");
  if ((await invitiQuiz(id)) > 0) throw new HttpError(409, "Il questionario è già stato inviato ai partecipanti: non si può eliminare.", "QUIZ_GIA_INVIATO");
  await db.transaction(async (tx) => {
    await tx.delete(eventiQuizTable).where(eq(eventiQuizTable.id, q.id));
    await registraLog(tx, contestoDa(req), {
      azione: "evento.quiz_elimina",
      entita: "evento",
      entitaId: id,
      descrizione: `Eliminato il questionario online del corso "${e.titolo}"`,
    });
  });
  res.json(await schedaBackoffice(id));
});

/**
 * Invia il link personale. Chi non l'ha ancora compilato lo riceve di nuovo (stesso link); chi ha già compilato non riceve nulla:
 * il link vale una sola volta.
 */
router.post("/backoffice/eventi/:id/quiz/invia", async (req, res) => {
  const { id } = valida(InviaQuizEventoParams, req.params);
  const { soloPresenti } = valida(InviaQuizEventoBody, req.body);
  const e = await caricaEvento(id);
  const [q] = await db.select({ id: eventiQuizTable.id }).from(eventiQuizTable).where(eq(eventiQuizTable.eventoId, id));
  if (!q) throw new HttpError(409, "Crea prima il questionario online.", "QUIZ_MANCANTE");
  const partecipanti = await db
    .select({
      id: eventiPartecipantiTable.id, nome: eventiPartecipantiTable.nome, cognome: eventiPartecipantiTable.cognome, email: eventiPartecipantiTable.email,
      invitoId: eventiQuizInvitiTable.id, token: eventiQuizInvitiTable.token, compilatoIl: eventiQuizInvitiTable.compilatoIl,
    })
    .from(eventiPartecipantiTable)
    .leftJoin(eventiQuizInvitiTable, eq(eventiQuizInvitiTable.partecipanteId, eventiPartecipantiTable.id))
    .where(and(eq(eventiPartecipantiTable.eventoId, id), soloPresenti ? isNotNull(eventiPartecipantiTable.entrataIl) : undefined))
    .orderBy(...nomiOrdinati);
  if (partecipanti.length === 0) {
    throw new HttpError(409, soloPresenti ? "Nessun partecipante risulta presente: registra almeno un'entrata." : "Non ci sono partecipanti iscritti.", "NESSUN_PARTECIPANTE");
  }
  const senzaEmail = partecipanti.filter((p) => !p.email).length;
  const saltati = partecipanti.filter((p) => p.email && p.compilatoIl).length;
  const daInviare = partecipanti.filter((p) => p.email && !p.compilatoIl);
  if (daInviare.length === 0) {
    throw new HttpError(409, saltati > 0 ? "Tutti i destinatari hanno già compilato il questionario." : "Nessun destinatario ha un indirizzo email.", "NESSUN_DESTINATARIO");
  }
  const notifiche = await db.transaction(async (tx) => {
    const ids: number[] = [];
    for (const p of daInviare) {
      let token = p.token;
      if (!p.invitoId) {
        token = randomBytes(24).toString("base64url");
        await tx.insert(eventiQuizInvitiTable).values({ eventoId: id, partecipanteId: p.id, token });
      } else {
        await tx.update(eventiQuizInvitiTable).set({ inviatoIl: new Date() }).where(eq(eventiQuizInvitiTable.id, p.invitoId));
      }
      ids.push(...(await notificaQuestionarioCorso(tx, e, p, token!)));
    }
    await registraLog(tx, contestoDa(req), {
      azione: "evento.quiz_invia",
      entita: "evento",
      entitaId: id,
      descrizione: `Inviato il questionario online del corso "${e.titolo}" a ${daInviare.length} ${daInviare.length === 1 ? "partecipante" : "partecipanti"}`,
      dettagli: { soloPresenti, inviati: daInviare.length, senzaEmail, giaCompilati: saltati },
    });
    return ids;
  });
  recapitaInBackground(notifiche);
  res.json({ inviati: daInviare.length, senzaEmail, saltati });
});

export default router;
