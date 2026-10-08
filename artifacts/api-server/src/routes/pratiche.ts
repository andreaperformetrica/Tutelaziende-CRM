import express, { Router, type IRouter } from "express";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import {
  CreateCommentoPraticaBody,
  CreateCommentoPraticaParams,
  CreatePraticaBody,
  DeleteDocumentoPraticaParams,
  DeletePraticaParams,
  GetPraticaParams,
  InviaPraticaBody,
  InviaPraticaParams,
  ListPraticheQueryParams,
  SalvaMessaggioPraticaBody,
  SalvaMessaggioPraticaParams,
} from "@workspace/api-zod";
import {
  assistitiTable,
  commentiPraticaTable,
  db,
  documentiPraticaTable,
  documentiTipoTable,
  personeTable,
  praticheTable,
  statiPraticaTable,
  tipiPraticaTable,
} from "@workspace/db";
import { condizioneRicerca } from "../lib/assistiti";
import { pulisciNome } from "../lib/configurazione-pratiche";
import { HttpError, nonTrovato } from "../lib/errori";
import { contestoDa, registraLog } from "../lib/log";
import { codiceErrorePg } from "../lib/postgres";
import {
  caricaPraticaPropria,
  caricaPraticaVisibile,
  condizioneVisibilitaPratiche,
  contaPratiche,
  dettaglioPratica,
  ERRORE_PRATICA_BOZZA,
  ERRORE_PRATICA_INVIATA,
  invioPratiche,
  mandatoDellaPratica,
  MAX_ALLEGATI_AGGIUNTIVI,
  mappaRiepilogo,
  mioCollaboratoreId,
  selezionaPratiche,
  verificaCompletezza,
} from "../lib/pratiche";
import { DIMENSIONE_MASSIMA_FILE, eliminaFile, leggiFile, salvaFile, validaFile } from "../lib/storage";
import { statoInvioPratiche } from "../lib/orari";
import { notificaPraticaInviata, notificaRispostaSede } from "../lib/notifiche-eventi";
import { recapitaInBackground } from "../lib/notifiche";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";
import { inviaFile } from "./tipi-pratica";

const router: IRouter = Router();
router.use("/pratiche", richiediRuolo("collaboratore"));
const corpoFile = express.raw({ type: () => true, limit: DIMENSIONE_MASSIMA_FILE });

const PER_PAGINA_DEFAULT = 25;
const intero = (v: unknown, nome: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Parametro "${nome}" non valido.`, "DATI_NON_VALIDI", nome);
  return n;
};

function pulisciMessaggio(v: string): string {
  return v.replace(/\r\n/g, "\n").trim();
}

const descrizionePratica = (p: { assCognome: string; assNome: string; tipoNome: string }) => `${p.tipoNome} di ${p.assCognome} ${p.assNome}`;

router.get("/pratiche", async (req, res) => {
  const p = valida(ListPraticheQueryParams, req.query);
  const mio = mioCollaboratoreId(req);
  const pagina = p.pagina ?? 1;
  const perPagina = p.perPagina ?? PER_PAGINA_DEFAULT;
  const q = (p.q ?? "").trim();
  const ricerca = q
    ? /^\d+$/.test(q)
      ? sql`(${condizioneRicerca(q)} or ${praticheTable.numero} = ${Number(q)})`
      : condizioneRicerca(q)
    : undefined;
  const where = and(
    condizioneVisibilitaPratiche(req),
    p.collaboratoreId ? eq(praticheTable.collaboratoreId, p.collaboratoreId) : undefined,
    ricerca,
  );
  const [totale, righe] = await Promise.all([
    contaPratiche(where),
    selezionaPratiche(where)
      .limit(perPagina)
      .offset((pagina - 1) * perPagina),
  ]);
  res.json({ elementi: righe.map((r) => mappaRiepilogo(r, mio)), totale, pagina, perPagina });
});

router.get("/pratiche/stato-invio", async (_req, res) => {
  res.json(await invioPratiche());
});

router.get("/pratiche/tipi-disponibili", async (_req, res) => {
  const tipi = await db.select({ id: tipiPraticaTable.id, nome: tipiPraticaTable.nome }).from(tipiPraticaTable).where(eq(tipiPraticaTable.attivo, true)).orderBy(asc(tipiPraticaTable.nome));
  res.json(tipi);
});

router.post("/pratiche", async (req, res) => {
  const b = valida(CreatePraticaBody, req.body);
  const mio = mioCollaboratoreId(req);
  const [ass] = await db
    .select({ id: assistitiTable.id, collaboratoreId: assistitiTable.collaboratoreId, nome: personeTable.nome, cognome: personeTable.cognome })
    .from(assistitiTable)
    .innerJoin(personeTable, eq(personeTable.id, assistitiTable.personaId))
    .where(eq(assistitiTable.id, b.assistitoId));
  if (!ass) throw nonTrovato("Assistito non trovato.");
  if (ass.collaboratoreId !== mio) {
    throw new HttpError(403, "Puoi aprire pratiche solo per i tuoi assistiti.", "NON_AUTORIZZATO");
  }
  const [tipo] = await db.select().from(tipiPraticaTable).where(eq(tipiPraticaTable.id, b.tipoPraticaId));
  if (!tipo) throw nonTrovato("Tipo di pratica non trovato.");
  if (!tipo.attivo) throw new HttpError(409, "Questo tipo di pratica non è al momento disponibile.", "TIPO_NON_ATTIVO", "tipoPraticaId");
  const id = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(praticheTable)
      .values({ assistitoId: ass.id, collaboratoreId: mio, tipoPraticaId: tipo.id, creataDaUtenteId: req.utente!.id })
      .returning({ id: praticheTable.id });
    await registraLog(tx, contestoDa(req), {
      azione: "pratica.crea",
      entita: "pratica",
      entitaId: r!.id,
      descrizione: `Aperta in bozza la pratica "${tipo.nome}" per l'assistito ${ass.cognome} ${ass.nome}`,
      dettagli: { assistitoId: ass.id, tipoPraticaId: tipo.id },
    });
    return r!.id;
  });
  res.status(201).json(await dettaglioPratica(req, id));
});

router.get("/pratiche/:id", async (req, res) => {
  const { id } = valida(GetPraticaParams, req.params);
  res.json(await dettaglioPratica(req, id));
});

router.delete("/pratiche/:id", async (req, res) => {
  const { id } = valida(DeletePraticaParams, req.params);
  const p = await caricaPraticaPropria(req, id);
  if (p.inviataIl) throw ERRORE_PRATICA_INVIATA("Non puoi cancellarla");
  const file = await db.select({ chiave: documentiPraticaTable.fileChiave }).from(documentiPraticaTable).where(eq(documentiPraticaTable.praticaId, id));
  await db.transaction(async (tx) => {
    const [r] = await tx.delete(praticheTable).where(and(eq(praticheTable.id, id), isNull(praticheTable.inviataIl))).returning({ id: praticheTable.id });
    if (!r) throw ERRORE_PRATICA_INVIATA("Non puoi cancellarla");
    await registraLog(tx, contestoDa(req), {
      azione: "pratica.elimina_bozza",
      entita: "pratica",
      entitaId: id,
      descrizione: `Cancellata la bozza della pratica ${descrizionePratica(p)}`,
      dettagli: { documentiEliminati: file.length },
    });
  });
  for (const f of file) await eliminaFile(f.chiave, req.log);
  res.status(204).end();
});

router.put("/pratiche/:id/messaggio", async (req, res) => {
  const { id } = valida(SalvaMessaggioPraticaParams, req.params);
  const { messaggio } = valida(SalvaMessaggioPraticaBody, req.body);
  const p = await caricaPraticaPropria(req, id);
  if (p.inviataIl) throw ERRORE_PRATICA_INVIATA("Non puoi modificare il messaggio");
  const testo = pulisciMessaggio(messaggio);
  if (testo !== p.messaggio) {
    await db.transaction(async (tx) => {
      await tx.update(praticheTable).set({ messaggio: testo, modificataIl: new Date() }).where(eq(praticheTable.id, id));
      await registraLog(tx, contestoDa(req), {
        azione: "pratica.messaggio",
        entita: "pratica",
        entitaId: id,
        descrizione: `Salvato il messaggio della bozza della pratica ${descrizionePratica(p)}`,
      });
    });
  }
  res.json(await dettaglioPratica(req, id));
});

// ---------------------------------------------------------------------------------------------
// Documenti e allegati
// ---------------------------------------------------------------------------------------------

/**
 * Carica un file nella pratica. Con `documentoTipoId` e' il documento obbligatorio (sostituibile solo in bozza);
 * senza e' un allegato aggiuntivo (si puo' aggiungere anche dopo l'invio, mai sostituire).
 */
router.post("/pratiche/:id/documenti/file", corpoFile, async (req, res) => {
  const id = intero(req.params["id"], "id");
  const p = await caricaPraticaPropria(req, id);
  const bozza = p.inviataIl === null;
  const documentoTipoId = req.query["documentoTipoId"] === undefined ? null : intero(req.query["documentoTipoId"], "documentoTipoId");
  const file = validaFile(req.query["nomeFile"], req.body, { soloPdfEImmagini: true });
  const quando = bozza ? "in bozza" : "inviata";

  let nome: string;
  if (documentoTipoId !== null) {
    if (!bozza) throw ERRORE_PRATICA_INVIATA("Non puoi sostituire i documenti già inviati");
    const [doc] = await db
      .select()
      .from(documentiTipoTable)
      .where(and(eq(documentiTipoTable.id, documentoTipoId), eq(documentiTipoTable.tipoPraticaId, p.tipoPraticaId)));
    if (!doc || doc.mandato) throw new HttpError(400, "Documento non richiesto per questo tipo di pratica.", "DATI_NON_VALIDI", "documentoTipoId");
    nome = doc.nome;
  } else {
    nome = pulisciNome(req.query["nome"] ?? file.nome.replace(/\.[^.]+$/, ""), "Il nome dell'allegato", 100);
    const [n] = await db
      .select({ n: count() })
      .from(documentiPraticaTable)
      .where(and(eq(documentiPraticaTable.praticaId, id), sql`${documentiPraticaTable.documentoTipoId} is null`));
    if ((n?.n ?? 0) >= MAX_ALLEGATI_AGGIUNTIVI) {
      throw new HttpError(409, `Una pratica può avere al massimo ${MAX_ALLEGATI_AGGIUNTIVI} allegati aggiuntivi.`, "TROPPI_ALLEGATI");
    }
  }

  const chiave = await salvaFile(file.buffer, file.tipo);
  let vecchiaChiave: string | null = null;
  try {
    await db.transaction(async (tx) => {
      // Il blocco sulla pratica evita che un invio concorrente lasci passare un documento dopo l'invio.
      const [corrente] = await tx.select({ inviataIl: praticheTable.inviataIl }).from(praticheTable).where(eq(praticheTable.id, id)).for("update");
      if (!corrente || (corrente.inviataIl === null) !== bozza) throw new HttpError(409, "La pratica è appena cambiata: ricarica la pagina.", "PRATICA_CAMBIATA");
      const esistente =
        documentoTipoId === null
          ? undefined
          : (await tx.select().from(documentiPraticaTable).where(and(eq(documentiPraticaTable.praticaId, id), eq(documentiPraticaTable.documentoTipoId, documentoTipoId))))[0];
      const valori = { fileChiave: chiave, fileNome: file.nome, fileTipo: file.tipo, fileDimensione: file.dimensione, caricatoIl: new Date(), caricatoDaUtenteId: req.utente!.id };
      let docId: number;
      if (esistente) {
        vecchiaChiave = esistente.fileChiave;
        await tx.update(documentiPraticaTable).set(valori).where(eq(documentiPraticaTable.id, esistente.id));
        docId = esistente.id;
      } else {
        const [d] = await tx
          .insert(documentiPraticaTable)
          .values({ praticaId: id, documentoTipoId, nome, dopoInvio: !bozza, ...valori })
          .returning({ id: documentiPraticaTable.id });
        docId = d!.id;
      }
      await registraLog(tx, contestoDa(req), {
        azione: esistente ? "pratica.documento_sostituisci" : bozza ? "pratica.documento_carica" : "pratica.allegato_aggiungi",
        entita: "pratica",
        entitaId: id,
        descrizione: `${esistente ? "Sostituito" : bozza ? "Caricato" : "Aggiunto"} ${documentoTipoId === null ? "l'allegato" : "il documento"} "${nome}" (${file.nome}) nella pratica ${quando} ${descrizionePratica(p)}`,
        dettagli: { documentoId: docId, documentoTipoId, fileNome: file.nome, dimensione: file.dimensione },
      });
      const ora = new Date();
      await tx.update(praticheTable).set(bozza ? { modificataIl: ora } : { modificataIl: ora, ultimaAttivitaCollaboratoreIl: ora }).where(eq(praticheTable.id, id));
    });
  } catch (err) {
    await eliminaFile(chiave, req.log);
    if (codiceErrorePg(err).code === "23505") throw new HttpError(409, "Questo documento è già stato caricato: ricarica la pagina.", "PRATICA_CAMBIATA");
    throw err;
  }
  if (vecchiaChiave) await eliminaFile(vecchiaChiave, req.log);
  res.status(201).json(await dettaglioPratica(req, id));
});

router.delete("/pratiche/:id/documenti/:docId", async (req, res) => {
  const { id, docId } = valida(DeleteDocumentoPraticaParams, req.params);
  const p = await caricaPraticaPropria(req, id);
  if (p.inviataIl) throw ERRORE_PRATICA_INVIATA("Non puoi eliminare i documenti già inviati");
  const [d] = await db.select().from(documentiPraticaTable).where(and(eq(documentiPraticaTable.id, docId), eq(documentiPraticaTable.praticaId, id)));
  if (!d) throw nonTrovato("Documento non trovato.");
  await db.transaction(async (tx) => {
    const [corrente] = await tx.select({ inviataIl: praticheTable.inviataIl }).from(praticheTable).where(eq(praticheTable.id, id)).for("update");
    if (!corrente || corrente.inviataIl) throw ERRORE_PRATICA_INVIATA("Non puoi eliminare i documenti già inviati");
    await tx.delete(documentiPraticaTable).where(eq(documentiPraticaTable.id, docId));
    await registraLog(tx, contestoDa(req), {
      azione: "pratica.documento_elimina",
      entita: "pratica",
      entitaId: id,
      descrizione: `Tolto il documento "${d.nome}" (${d.fileNome}) dalla bozza della pratica ${descrizionePratica(p)}`,
      dettagli: { documentoId: docId, fileNome: d.fileNome },
    });
  });
  await eliminaFile(d.fileChiave, req.log);
  res.json(await dettaglioPratica(req, id));
});

router.get("/pratiche/:id/documenti/:docId/file", async (req, res) => {
  const id = intero(req.params["id"], "id");
  const docId = intero(req.params["docId"], "docId");
  await caricaPraticaVisibile(req, id);
  const [d] = await db.select().from(documentiPraticaTable).where(and(eq(documentiPraticaTable.id, docId), eq(documentiPraticaTable.praticaId, id)));
  if (!d) throw nonTrovato("Documento non trovato.");
  const { stream } = await leggiFile(d.fileChiave);
  inviaFile(res, stream, d.fileNome, d.fileTipo, d.fileDimensione);
});

router.get("/pratiche/:id/mandato/file", async (req, res) => {
  const p = await caricaPraticaVisibile(req, intero(req.params["id"], "id"));
  const m = await mandatoDellaPratica(p);
  if (!m) throw nonTrovato("Nessun mandato assegnato per questa pratica.");
  const { stream } = await leggiFile(m.fileChiave);
  inviaFile(res, stream, m.fileNome, m.fileTipo, m.dimensione);
});

// ---------------------------------------------------------------------------------------------
// Invio e commenti
// ---------------------------------------------------------------------------------------------

router.post("/pratiche/:id/invio", async (req, res) => {
  const { id } = valida(InviaPraticaParams, req.params);
  const b = valida(InviaPraticaBody, req.body ?? {});
  const p = await caricaPraticaPropria(req, id);
  if (p.inviataIl) throw ERRORE_PRATICA_INVIATA("Non puoi inviarla di nuovo");

  // Controllo degli orari lato server: ha la precedenza su ogni altro controllo.
  const orari = await statoInvioPratiche();
  if (!orari.consentito) {
    const { messaggio } = await invioPratiche();
    throw new HttpError(409, messaggio ?? "In questo momento non è possibile inviare pratiche.", "INVIO_FUORI_ORARIO");
  }

  const mandato = await mandatoDellaPratica(p);
  const { mancanti } = await verificaCompletezza(p, mandato);
  if (mancanti.length) {
    throw new HttpError(409, `La pratica non è completa. ${mancanti.join(". ")}.`, "PRATICA_INCOMPLETA");
  }

  const stati = await db.select().from(statiPraticaTable).orderBy(asc(statiPraticaTable.ordine), asc(statiPraticaTable.id));
  const iniziale = stati.find((s) => s.nome.trim().toLowerCase() !== "bozza");
  if (!iniziale) {
    throw new HttpError(409, "Non c'è uno stato pratica a cui assegnare la pratica inviata: contatta l'amministrazione.", "STATO_INIZIALE_MANCANTE");
  }

  const messaggio = pulisciMessaggio(b.messaggio ?? p.messaggio);
  const ora = new Date();
  const { numero, notifiche } = await db.transaction(async (tx) => {
    // Numeri progressivi senza buchi: l'assegnazione e' serializzata da un blocco di transazione.
    await tx.execute(sql`select pg_advisory_xact_lock(4001)`);
    const [m] = await tx.select({ max: sql<number>`coalesce(max(${praticheTable.numero}), 0)::int` }).from(praticheTable);
    const nuovo = (m?.max ?? 0) + 1;
    const [r] = await tx
      .update(praticheTable)
      .set({ numero: nuovo, statoId: iniziale.id, mandatoId: mandato?.id ?? null, messaggio, inviataIl: ora, modificataIl: ora, ultimaAttivitaCollaboratoreIl: ora })
      .where(and(eq(praticheTable.id, id), isNull(praticheTable.inviataIl)))
      .returning({ numero: praticheTable.numero });
    if (!r) throw ERRORE_PRATICA_INVIATA("Non puoi inviarla di nuovo");
    if (messaggio) await tx.insert(commentiPraticaTable).values({ praticaId: id, utenteId: req.utente!.id, testo: messaggio });
    await registraLog(tx, contestoDa(req), {
      azione: "pratica.invia",
      entita: "pratica",
      entitaId: id,
      descrizione: `Inviata la pratica n. ${nuovo}: ${descrizionePratica(p)}`,
      dettagli: { numero: nuovo, statoId: iniziale.id, mandatoId: mandato?.id ?? null },
    });
    const notifiche = await notificaPraticaInviata(tx, { id, numero: nuovo, collaboratoreId: p.collaboratoreId });
    return { numero: r.numero, notifiche };
  });
  recapitaInBackground(notifiche);
  req.log.info({ praticaId: id, numero }, "Pratica inviata");
  res.json(await dettaglioPratica(req, id));
});

router.post("/pratiche/:id/commenti", async (req, res) => {
  const { id } = valida(CreateCommentoPraticaParams, req.params);
  const { testo } = valida(CreateCommentoPraticaBody, req.body);
  const p = await caricaPraticaPropria(req, id);
  if (!p.inviataIl) throw ERRORE_PRATICA_BOZZA;
  const pulito = pulisciMessaggio(testo);
  if (!pulito) throw new HttpError(400, "Scrivi un messaggio.", "DATI_NON_VALIDI", "testo");
  const notifiche = await db.transaction(async (tx) => {
    const [c] = await tx.insert(commentiPraticaTable).values({ praticaId: id, utenteId: req.utente!.id, testo: pulito }).returning({ id: commentiPraticaTable.id });
    await tx.update(praticheTable).set({ ultimaAttivitaCollaboratoreIl: new Date() }).where(eq(praticheTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "pratica.commento",
      entita: "pratica",
      entitaId: id,
      descrizione: `Commento sulla pratica n. ${p.numero}: ${descrizionePratica(p)}`,
      dettagli: { commentoId: c!.id },
    });
    return notificaRispostaSede(tx, { id, numero: p.numero!, collaboratoreId: p.collaboratoreId }, p.gestitaDaUtenteId);
  });
  recapitaInBackground(notifiche);
  res.status(201).json(await dettaglioPratica(req, id));
});

export default router;
