import express, { Router, type IRouter, type Response } from "express";
import { and, asc, count, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import {
  AddInvitiEventoBody,
  AddInvitiEventoParams,
  CreateEventoBody,
  DeleteEventoParams,
  DeleteLayoutAttestatoParams,
  DeleteQuestionarioEventoParams,
  GetEventoBackofficeParams,
  RegistraCheckInEventoBody,
  RegistraCheckInEventoParams,
  RemoveInvitoEventoParams,
  UpdateEventoBody,
  UpdateEventoParams,
  UpdateOrariPartecipanteBody,
  UpdateOrariPartecipanteParams,
  UpdatePosizioneAttestatoBody,
  UpdatePosizioneAttestatoParams,
} from "@workspace/api-zod";
import {
  collaboratoriTable,
  db,
  eventiInvitiTable,
  eventiPartecipantiTable,
  eventiTable,
  personeTable,
  utentiTable,
} from "@workspace/db";
import { generaAttestati } from "../lib/attestati";
import { HttpError, nonTrovato } from "../lib/errori";
import {
  caricaEvento,
  controllaOrari,
  dataValida,
  datiEvento,
  formattaData,
  intero,
  istanteRoma,
  oraRoma,
  partecipantiBackoffice,
  schedaBackoffice,
} from "../lib/eventi";
import { contestoDa, differenze, registraLog } from "../lib/log";
import { notificaInvitoEvento } from "../lib/notifiche-eventi";
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

async function leggiBuffer(chiave: string): Promise<Buffer> {
  const { stream } = await leggiFile(chiave);
  const pezzi: Buffer[] = [];
  for await (const p of stream) pezzi.push(Buffer.isBuffer(p) ? p : Buffer.from(p));
  return Buffer.concat(pezzi);
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

router.get("/backoffice/eventi", async (_req, res) => {
  const righe = await db
    .select({
      e: eventiTable,
      invitati: sql<number>`(select count(*)::int from ${eventiInvitiTable} i where i.evento_id = ${eventiTable.id})`,
      confermati: sql<number>`(select count(*)::int from ${eventiInvitiTable} i where i.evento_id = ${eventiTable.id} and i.confermato_il is not null)`,
      partecipanti: sql<number>`(select count(*)::int from ${eventiPartecipantiTable} p where p.evento_id = ${eventiTable.id})`,
      presenti: sql<number>`(select count(*)::int from ${eventiPartecipantiTable} p where p.evento_id = ${eventiTable.id} and p.entrata_il is not null)`,
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
  const { id, notifiche } = await db.transaction(async (tx) => {
    const [e] = await tx
      .insert(eventiTable)
      .values({
        titolo, data: b.data, oraInizio: b.oraInizio, oraFine: b.oraFine || null, luogo,
        descrizione: (b.descrizione ?? "").trim(), creatoDaUtenteId: req.utente!.id,
      })
      .returning();
    if (sedi.length) await tx.insert(eventiInvitiTable).values(sedi.map((collaboratoreId) => ({ eventoId: e!.id, collaboratoreId })));
    await registraLog(tx, contestoDa(req), {
      azione: "evento.crea",
      entita: "evento",
      entitaId: e!.id,
      descrizione: `Creato l'evento "${titolo}" del ${descrizioneData(e!)}, con ${sedi.length} ${sedi.length === 1 ? "sede invitata" : "sedi invitate"}`,
      dettagli: { titolo, data: b.data, oraInizio: b.oraInizio, oraFine: b.oraFine ?? null, luogo, sediInvitate: sedi },
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
    descrizione: (b.descrizione ?? "").trim(),
  };
  const diff = differenze(prima, { ...prima, ...dopo }, {
    titolo: "titolo", data: "data", oraInizio: "ora di inizio", oraFine: "ora di fine", luogo: "luogo", descrizione: "descrizione",
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
  for (const chiave of [e.questionarioChiave, e.layoutChiave]) if (chiave) await eliminaFile(chiave, req.log);
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
          questionarioDimensione: file.dimensione, questionarioCaricatoIl: new Date(), modificatoIl: new Date(),
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
      .set({ questionarioChiave: null, questionarioNome: null, questionarioTipo: null, questionarioDimensione: null, questionarioCaricatoIl: null, modificatoIl: new Date() })
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

router.put("/backoffice/eventi/:id/attestato/file", corpoFile, async (req, res) => {
  const id = intero(req.params["id"], "id");
  const e = await caricaEvento(id);
  const file = validaFile(req.query["nomeFile"], req.body, { soloPdfEImmagini: true });
  // Si controlla subito che il layout si possa leggere, cosi' l'errore compare al caricamento e non alla stampa.
  await generaAttestati({ buffer: file.buffer, tipo: file.tipo }, { x: 50, y: 50, dimensione: 20 }, ["Prova"]);
  const chiave = await salvaFile(file.buffer, file.tipo);
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(eventiTable)
        .set({ layoutChiave: chiave, layoutNome: file.nome, layoutTipo: file.tipo, layoutDimensione: file.dimensione, modificatoIl: new Date() })
        .where(eq(eventiTable.id, id));
      await registraLog(tx, contestoDa(req), {
        azione: "evento.attestato_carica",
        entita: "evento",
        entitaId: id,
        descrizione: `${e.layoutChiave ? "Sostituito" : "Caricato"} il layout dell'attestato dell'evento "${e.titolo}" (${file.nome})`,
        dettagli: { fileNome: file.nome, dimensione: file.dimensione, precedente: e.layoutNome },
      });
    });
  } catch (err) {
    await eliminaFile(chiave, req.log);
    throw err;
  }
  if (e.layoutChiave) await eliminaFile(e.layoutChiave, req.log);
  res.json(await schedaBackoffice(id));
});

router.delete("/backoffice/eventi/:id/attestato/layout", async (req, res) => {
  const { id } = valida(DeleteLayoutAttestatoParams, req.params);
  const e = await caricaEvento(id);
  if (!e.layoutChiave) throw nonTrovato("Per questo evento non c'è nessun layout dell'attestato.");
  await db.transaction(async (tx) => {
    await tx
      .update(eventiTable)
      .set({ layoutChiave: null, layoutNome: null, layoutTipo: null, layoutDimensione: null, modificatoIl: new Date() })
      .where(eq(eventiTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "evento.attestato_elimina",
      entita: "evento",
      entitaId: id,
      descrizione: `Eliminato il layout dell'attestato dell'evento "${e.titolo}" (${e.layoutNome})`,
      dettagli: { fileNome: e.layoutNome },
    });
  });
  await eliminaFile(e.layoutChiave, req.log);
  res.json(await schedaBackoffice(id));
});

router.put("/backoffice/eventi/:id/attestato/posizione", async (req, res) => {
  const { id } = valida(UpdatePosizioneAttestatoParams, req.params);
  const b = valida(UpdatePosizioneAttestatoBody, req.body);
  const e = await caricaEvento(id);
  await db.transaction(async (tx) => {
    await tx.update(eventiTable).set({ nomeX: b.nomeX, nomeY: b.nomeY, nomeDimensione: b.nomeDimensione, modificatoIl: new Date() }).where(eq(eventiTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "evento.attestato_posizione",
      entita: "evento",
      entitaId: id,
      descrizione: `Posizione del nome sull'attestato dell'evento "${e.titolo}": da ${e.nomeX}%, ${e.nomeY}%, corpo ${e.nomeDimensione} a ${b.nomeX}%, ${b.nomeY}%, corpo ${b.nomeDimensione}`,
      dettagli: { prima: { x: e.nomeX, y: e.nomeY, dimensione: e.nomeDimensione }, dopo: { x: b.nomeX, y: b.nomeY, dimensione: b.nomeDimensione } },
    });
  });
  res.json(await schedaBackoffice(id));
});

async function pdfAttestati(eventoId: number, nomi: string[], posizione?: { x: number; y: number; dimensione: number }) {
  const e = await caricaEvento(eventoId);
  if (!e.layoutChiave || !e.layoutTipo) {
    throw new HttpError(409, "Carica prima il layout dell'attestato.", "LAYOUT_MANCANTE");
  }
  const buffer = await leggiBuffer(e.layoutChiave);
  return generaAttestati(
    { buffer, tipo: e.layoutTipo },
    posizione ?? { x: e.nomeX, y: e.nomeY, dimensione: e.nomeDimensione },
    nomi,
  );
}

const numeroInRange = (v: unknown, min: number, max: number): number | null => {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

/** Anteprima con un nome di prova; accetta x, y e dim in query per provare i valori senza salvarli. */
router.get("/backoffice/eventi/:id/attestato/anteprima", async (req, res) => {
  const id = intero(req.params["id"], "id");
  const e = await caricaEvento(id);
  const pos = {
    x: numeroInRange(req.query["x"], 0, 100) ?? e.nomeX,
    y: numeroInRange(req.query["y"], 0, 100) ?? e.nomeY,
    dimensione: numeroInRange(req.query["dim"], 8, 120) ?? e.nomeDimensione,
  };
  inviaPdf(res, await pdfAttestati(id, ["Maria Rossi Esempio"], pos), "anteprima-attestato.pdf");
});

router.get("/backoffice/eventi/:id/attestato/partecipanti/:partecipanteId", async (req, res) => {
  const id = intero(req.params["id"], "id");
  const p = await caricaPartecipanteEvento(id, intero(req.params["partecipanteId"], "partecipanteId"));
  inviaPdf(res, await pdfAttestati(id, [`${p.nome} ${p.cognome}`]), `attestato-${p.cognome}-${p.nome}.pdf`);
});

/** Un attestato per ogni presente (entrata registrata), in ordine alfabetico. */
router.get("/backoffice/eventi/:id/attestato/presenti", async (req, res) => {
  const id = intero(req.params["id"], "id");
  const presenti = await db
    .select({ nome: eventiPartecipantiTable.nome, cognome: eventiPartecipantiTable.cognome })
    .from(eventiPartecipantiTable)
    .where(and(eq(eventiPartecipantiTable.eventoId, id), isNotNull(eventiPartecipantiTable.entrataIl)))
    .orderBy(asc(sql`lower(${eventiPartecipantiTable.cognome})`), asc(sql`lower(${eventiPartecipantiTable.nome})`), asc(eventiPartecipantiTable.id));
  if (presenti.length === 0) throw new HttpError(409, "Nessun partecipante risulta presente: registra almeno un'entrata.", "NESSUN_PRESENTE");
  inviaPdf(res, await pdfAttestati(id, presenti.map((p) => `${p.nome} ${p.cognome}`)), "attestati-presenti.pdf");
});

export default router;
