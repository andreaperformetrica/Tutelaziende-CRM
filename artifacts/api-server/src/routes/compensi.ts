/** Compensi ai collaboratori: resoconto, estratti, pagamenti, stampati e dare/avere. Solo admin e super admin. */
import express, { Router, type IRouter, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import {
  CreateEstrattiBody,
  CreateRigaDareAvereBody,
  DeleteEstrattoParams,
  DeleteRigaDareAvereParams,
  GetDareAvereQueryParams,
  GetEstrattoParams,
  GetResocontoCompensiQueryParams,
  InviaEstrattoParams,
  ListEstrattiQueryParams,
  RegistraPagamentoEstrattoBody,
  RegistraPagamentoEstrattoParams,
  UpdateImpostazioniStampaBody,
  UpdateRigaDareAvereBody,
  UpdateRigaDareAvereParams,
} from "@workspace/api-zod";
import { compensiRigheTable, db, estrattiRigheTable, estrattiTable, notificheTable, praticheTable, statiPraticaTable } from "@workspace/db";
import {
  CAMPI_STAMPA,
  ETICHETTA_METODO,
  TITOLO_SEZIONE,
  centesimiDaEuro,
  controllaCollaboratore,
  controllaData,
  dareAvere,
  elencoEstratti,
  eliminaImpostazioni,
  estrattoDettaglio,
  leggiImpostazioniStampa,
  mappaImpostazioniStampa,
  nomeCompleto,
  registraCambioStatoPagata,
  resoconto,
  scriviImpostazioni,
  statoPagata,
} from "../lib/compensi";
import { pdfDareAvere, pdfEstratto } from "../lib/compensi-pdf";
import { HttpError, nonTrovato } from "../lib/errori";
import { formattaData, oggiRoma } from "../lib/eventi";
import { contestoDa, registraLog } from "../lib/log";
import { accodaEstrattoInviato } from "../lib/notifiche-eventi";
import { ESITI_NOTIFICA, recapitaNotifiche } from "../lib/notifiche";
import { DIMENSIONE_MASSIMA_FILE, eliminaFile, leggiFile, salvaFile, validaFile } from "../lib/storage";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";
import { inviaFile } from "./tipi-pratica";

const router: IRouter = Router();
router.use("/backoffice/compensi", richiediRuolo("super_admin", "admin"));

const corpoFile = express.raw({ type: () => true, limit: DIMENSIONE_MASSIMA_FILE });
const euroTesto = (c: number) => `€ ${(c / 100).toFixed(2).replace(".", ",")}`;

function inviaPdf(res: Response, pdf: Buffer, nome: string) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", String(pdf.length));
  res.setHeader("Content-Disposition", `inline; filename="stampato.pdf"; filename*=UTF-8''${encodeURIComponent(nome)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.end(pdf);
}

function controllaPeriodo(v: string | undefined, campo: string): string | undefined {
  return v ? controllaData(v, campo, campo === "dal" ? "Data iniziale" : "Data finale") : undefined;
}

// ---------------------------------------------------------------------------------------------
// Resoconto
// ---------------------------------------------------------------------------------------------

router.get("/backoffice/compensi/resoconto", async (req, res) => {
  const q = valida(GetResocontoCompensiQueryParams, req.query);
  res.json(await resoconto({ collaboratoreId: q.collaboratoreId, dal: controllaPeriodo(q.dal, "dal"), al: controllaPeriodo(q.al, "al"), giorni: q.giorni }));
});

// ---------------------------------------------------------------------------------------------
// Estratti
// ---------------------------------------------------------------------------------------------

router.get("/backoffice/compensi/estratti", async (req, res) => {
  const q = valida(ListEstrattiQueryParams, req.query);
  res.json(await elencoEstratti(q));
});

router.post("/backoffice/compensi/estratti", async (req, res) => {
  const { praticaIds } = valida(CreateEstrattiBody, req.body);
  const ids = [...new Set(praticaIds)];
  const creati = await db.transaction(async (tx) => {
    // Si bloccano le pratiche scelte: un secondo estratto in parallelo sulle stesse pratiche aspetta e poi le trova gia' usate.
    await tx.select({ id: praticheTable.id }).from(praticheTable).where(inArray(praticheTable.id, ids)).for("update");
    const valide = await resoconto({ ids });
    if (valide.righe.length !== ids.length) {
      throw new HttpError(409, "Alcune pratiche non sono più disponibili (già in un estratto, riaperte o non più chiuse). Aggiorna il resoconto e riprova.", "PRATICHE_NON_DISPONIBILI");
    }
    const perCollaboratore = new Map<number, typeof valide.righe>();
    for (const r of valide.righe) perCollaboratore.set(r.collaboratoreId, [...(perCollaboratore.get(r.collaboratoreId) ?? []), r]);
    const risultato: number[] = [];
    for (const [collaboratoreId, righe] of perCollaboratore) {
      righe.sort((a, b) => a.numero - b.numero);
      const totaleCentesimi = righe.reduce((t, r) => t + Math.round(r.valoreEuro * 100), 0);
      const totalePunti = righe.reduce((t, r) => t + r.punti, 0);
      const [e] = await tx
        .insert(estrattiTable)
        .values({ collaboratoreId, dataEstratto: oggiRoma(), totalePunti, totaleCentesimi, creatoDaUtenteId: req.utente!.id })
        .returning();
      await tx.insert(estrattiRigheTable).values(
        righe.map((r, i) => ({
          estrattoId: e!.id,
          praticaId: r.praticaId,
          ordine: i + 1,
          assistito: r.assistito,
          numeroPratica: r.numero,
          tipoPratica: r.tipoNome,
          dataPratica: r.dataPratica,
          punti: r.punti,
          valoreCentesimi: Math.round(r.valoreEuro * 100),
        })),
      );
      await registraLog(tx, contestoDa(req), {
        azione: "estratto.crea",
        entita: "estratto",
        entitaId: e!.id,
        descrizione: `Creato l'estratto n. ${e!.id} di ${righe[0]!.collaboratoreNome} (sportello ${righe[0]!.numeroSportello}): ${righe.length} pratiche, ${totalePunti} punti, ${euroTesto(totaleCentesimi)}`,
        dettagli: { collaboratoreId, pratiche: righe.map((r) => r.numero), totalePunti, totaleCentesimi },
      });
      risultato.push(e!.id);
    }
    return risultato;
  });
  const elenco = (await elencoEstratti({})).filter((e) => creati.includes(e.id));
  res.status(201).json(elenco);
});

router.get("/backoffice/compensi/estratti/:id", async (req, res) => {
  const { id } = valida(GetEstrattoParams, req.params);
  res.json(await estrattoDettaglio(id));
});

router.get("/backoffice/compensi/estratti/:id/pdf", async (req, res) => {
  const { id } = valida(GetEstrattoParams, req.params);
  const { pdf, nomeFile } = await pdfEstratto(id);
  inviaPdf(res, pdf, nomeFile);
});

router.delete("/backoffice/compensi/estratti/:id", async (req, res) => {
  const { id } = valida(DeleteEstrattoParams, req.params);
  await db.transaction(async (tx) => {
    const [e] = await tx.select().from(estrattiTable).where(eq(estrattiTable.id, id)).for("update");
    if (!e) throw nonTrovato("Estratto non trovato.");
    if (e.pagatoIl) throw new HttpError(409, "L'estratto è già stato pagato e non si può eliminare.", "ESTRATTO_PAGATO");
    const righe = await tx.select({ numero: estrattiRigheTable.numeroPratica }).from(estrattiRigheTable).where(eq(estrattiRigheTable.estrattoId, id));
    const coll = await controllaCollaboratore(e.collaboratoreId);
    await tx.delete(estrattiTable).where(eq(estrattiTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "estratto.elimina",
      entita: "estratto",
      entitaId: id,
      descrizione: `Eliminato l'estratto n. ${id} di ${nomeCompleto(coll.cognome, coll.nome)} non ancora pagato (${righe.length} pratiche tornate disponibili)`,
      dettagli: { collaboratoreId: e.collaboratoreId, pratiche: righe.map((r) => r.numero), totaleCentesimi: e.totaleCentesimi },
    });
  });
  res.status(204).end();
});

router.post("/backoffice/compensi/estratti/:id/pagamento", async (req, res) => {
  const { id } = valida(RegistraPagamentoEstrattoParams, req.params);
  const b = valida(RegistraPagamentoEstrattoBody, req.body);
  const data = controllaData(b.data, "data", "Data del pagamento");
  const importo = centesimiDaEuro(b.importoEuro, "importoEuro");
  await db.transaction(async (tx) => {
    const [e] = await tx.select().from(estrattiTable).where(eq(estrattiTable.id, id)).for("update");
    if (!e) throw nonTrovato("Estratto non trovato.");
    if (e.pagatoIl) throw new HttpError(409, "Il pagamento di questo estratto è già stato registrato.", "ESTRATTO_PAGATO");
    const ora = new Date();
    await tx
      .update(estrattiTable)
      .set({ pagatoIl: data, pagamentoCentesimi: importo, pagamentoMetodo: b.metodo, pagamentoRegistratoIl: ora, pagamentoUtenteId: req.utente!.id })
      .where(eq(estrattiTable.id, id));
    const pagata = await statoPagata(tx);
    const pratiche = await tx
      .select({ id: praticheTable.id, statoId: praticheTable.statoId, statoNome: statiPraticaTable.nome })
      .from(estrattiRigheTable)
      .innerJoin(praticheTable, eq(praticheTable.id, estrattiRigheTable.praticaId))
      .leftJoin(statiPraticaTable, eq(statiPraticaTable.id, praticheTable.statoId))
      .where(eq(estrattiRigheTable.estrattoId, id))
      .for("update", { of: praticheTable });
    for (const p of pratiche) {
      if (p.statoId === pagata.id) continue;
      await tx.update(praticheTable).set({ statoId: pagata.id, modificataIl: ora, ultimaAttivitaBackofficeIl: ora }).where(eq(praticheTable.id, p.id));
      await registraCambioStatoPagata(tx, p.id, req.utente!.id, p.statoNome ?? null, pagata.nome);
    }
    const coll = await controllaCollaboratore(e.collaboratoreId);
    await registraLog(tx, contestoDa(req), {
      azione: "estratto.pagamento",
      entita: "estratto",
      entitaId: id,
      descrizione: `Registrato il pagamento dell'estratto n. ${id} di ${nomeCompleto(coll.cognome, coll.nome)}: ${euroTesto(importo)} il ${formattaData(data)} (${ETICHETTA_METODO[b.metodo]}); ${pratiche.length} pratiche in stato "${pagata.nome}"`,
      dettagli: { collaboratoreId: e.collaboratoreId, data, importoCentesimi: importo, totaleEstrattoCentesimi: e.totaleCentesimi, metodo: b.metodo, pratiche: pratiche.length },
    });
  });
  res.json(await estrattoDettaglio(id));
});

router.post("/backoffice/compensi/estratti/:id/invio", async (req, res) => {
  const { id } = valida(InviaEstrattoParams, req.params);
  const [e] = await db.select().from(estrattiTable).where(eq(estrattiTable.id, id));
  if (!e) throw nonTrovato("Estratto non trovato.");
  const coll = await controllaCollaboratore(e.collaboratoreId);
  const ids = await db.transaction(async (tx) => {
    const accodate = await accodaEstrattoInviato(tx, { id, collaboratoreId: e.collaboratoreId, dataEstratto: e.dataEstratto });
    await registraLog(tx, contestoDa(req), {
      azione: "estratto.invia",
      entita: "estratto",
      entitaId: id,
      descrizione: `Richiesto l'invio per email dell'estratto n. ${id} a ${nomeCompleto(coll.cognome, coll.nome)} (sportello ${coll.sportello})`,
      dettagli: { collaboratoreId: e.collaboratoreId },
    });
    return accodate;
  });
  await recapitaNotifiche(ids);
  const [n] = await db.select().from(notificheTable).where(and(eq(notificheTable.estrattoId, id), eq(notificheTable.evento, "estratto_inviato"))).orderBy(desc(notificheTable.id)).limit(1);
  res.json({
    estratto: await estrattoDettaglio(id),
    esito: n?.esito ?? "errore",
    esitoEtichetta: n ? ESITI_NOTIFICA[n.esito] : ESITI_NOTIFICA.errore,
    dettaglio: n?.dettaglioEsito ?? null,
  });
});

// ---------------------------------------------------------------------------------------------
// Impostazioni degli stampati
// ---------------------------------------------------------------------------------------------

router.get("/backoffice/compensi/impostazioni-stampa", async (_req, res) => {
  res.json(mappaImpostazioniStampa(await leggiImpostazioniStampa()));
});

router.put("/backoffice/compensi/impostazioni-stampa", async (req, res) => {
  const b = valida(UpdateImpostazioniStampaBody, req.body);
  const nuovi = Object.fromEntries(CAMPI_STAMPA.map((c) => [c, b[c].replace(/\r\n/g, "\n").trim()])) as Record<(typeof CAMPI_STAMPA)[number], string>;
  if (!nuovi.nome) throw new HttpError(400, "Inserisci il nome da stampare in intestazione.", "DATI_NON_VALIDI", "nome");
  await db.transaction(async (tx) => {
    const prima = await leggiImpostazioniStampa(tx);
    const cambiati = CAMPI_STAMPA.filter((c) => prima.dati[c] !== nuovi[c]);
    await scriviImpostazioni(tx, nuovi);
    await registraLog(tx, contestoDa(req), {
      azione: "compensi.stampa_modifica",
      descrizione: cambiati.length ? `Modificati intestazione e note degli stampati (${cambiati.join(", ")})` : "Salvati intestazione e note degli stampati senza modifiche",
      dettagli: { campi: cambiati },
    });
  });
  res.json(mappaImpostazioniStampa(await leggiImpostazioniStampa()));
});

router.get("/backoffice/compensi/impostazioni-stampa/logo", async (_req, res) => {
  const { logo } = await leggiImpostazioniStampa();
  if (!logo) throw nonTrovato("Nessun logo caricato.");
  const { stream } = await leggiFile(logo.chiave);
  inviaFile(res, stream, logo.nome, logo.tipo, logo.dimensione, true);
});

router.put("/backoffice/compensi/impostazioni-stampa/logo", corpoFile, async (req, res) => {
  const file = validaFile(req.query["nomeFile"], req.body, { soloPdfEImmagini: true });
  if (file.tipo === "application/pdf") throw new HttpError(400, "Il logo deve essere un'immagine PNG o JPG.", "FILE_FORMATO_NON_AMMESSO");
  try {
    const doc = await PDFDocument.create();
    if (file.tipo === "image/png") await doc.embedPng(file.buffer);
    else await doc.embedJpg(file.buffer);
  } catch {
    throw new HttpError(400, "L'immagine non può essere letta. Carica un PNG o un JPG valido.", "FILE_NON_VALIDO");
  }
  const chiave = await salvaFile(file.buffer, file.tipo);
  let vecchia: string | null = null;
  try {
    await db.transaction(async (tx) => {
      vecchia = (await leggiImpostazioniStampa(tx)).logo?.chiave ?? null;
      await scriviImpostazioni(tx, { logo_chiave: chiave, logo_nome: file.nome, logo_tipo: file.tipo, logo_dimensione: String(file.dimensione) });
      await registraLog(tx, contestoDa(req), {
        azione: "compensi.logo_carica",
        descrizione: `${vecchia ? "Sostituito" : "Caricato"} il logo degli stampati (${file.nome})`,
        dettagli: { fileNome: file.nome, dimensione: file.dimensione },
      });
    });
  } catch (err) {
    await eliminaFile(chiave, req.log);
    throw err;
  }
  if (vecchia) await eliminaFile(vecchia, req.log);
  res.json(mappaImpostazioniStampa(await leggiImpostazioniStampa()));
});

router.delete("/backoffice/compensi/impostazioni-stampa/logo", async (req, res) => {
  let vecchia: string | null = null;
  await db.transaction(async (tx) => {
    const { logo } = await leggiImpostazioniStampa(tx);
    if (!logo) throw nonTrovato("Nessun logo caricato.");
    vecchia = logo.chiave;
    await eliminaImpostazioni(tx, ["logo_chiave", "logo_nome", "logo_tipo", "logo_dimensione"]);
    await registraLog(tx, contestoDa(req), { azione: "compensi.logo_elimina", descrizione: `Tolto il logo degli stampati (${logo.nome})` });
  });
  if (vecchia) await eliminaFile(vecchia, req.log);
  res.json(mappaImpostazioniStampa(await leggiImpostazioniStampa()));
});

// ---------------------------------------------------------------------------------------------
// Dare/avere
// ---------------------------------------------------------------------------------------------

router.get("/backoffice/compensi/dare-avere", async (req, res) => {
  const q = valida(GetDareAvereQueryParams, req.query);
  res.json(await dareAvere(q.collaboratoreId, q.anno));
});

router.get("/backoffice/compensi/dare-avere/pdf", async (req, res) => {
  const q = valida(GetDareAvereQueryParams, req.query);
  await controllaCollaboratore(q.collaboratoreId);
  const { pdf, nomeFile } = await pdfDareAvere(q.collaboratoreId, q.anno);
  inviaPdf(res, pdf, nomeFile);
});

function dataFacoltativa(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? controllaData(t, "dataPagamento", "Data di pagamento") : null;
}

router.post("/backoffice/compensi/dare-avere/righe", async (req, res) => {
  const b = valida(CreateRigaDareAvereBody, req.body);
  const coll = await controllaCollaboratore(b.collaboratoreId);
  const importo = centesimiDaEuro(b.importoEuro, "importoEuro");
  const data = dataFacoltativa(b.dataPagamento);
  await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(compensiRigheTable)
      .values({
        collaboratoreId: b.collaboratoreId,
        anno: b.anno,
        sezione: b.sezione,
        descrizione: b.descrizione.trim(),
        importoCentesimi: importo,
        dataPagamento: data,
        nota: (b.nota ?? "").trim(),
      })
      .returning({ id: compensiRigheTable.id });
    await registraLog(tx, contestoDa(req), {
      azione: "dare_avere.riga_aggiungi",
      entita: "compenso_riga",
      entitaId: r!.id,
      descrizione: `Dare/avere ${b.anno} di ${nomeCompleto(coll.cognome, coll.nome)}: aggiunta in ${TITOLO_SEZIONE[b.sezione]} la riga "${b.descrizione.trim()}" di ${euroTesto(importo)}`,
      dettagli: { collaboratoreId: b.collaboratoreId, anno: b.anno, sezione: b.sezione, importoCentesimi: importo, dataPagamento: data },
    });
  });
  res.status(201).json(await dareAvere(b.collaboratoreId, b.anno));
});

async function caricaRiga(id: number) {
  const [r] = await db.select().from(compensiRigheTable).where(eq(compensiRigheTable.id, id));
  if (!r) throw nonTrovato("Riga non trovata.");
  return r;
}

router.put("/backoffice/compensi/dare-avere/righe/:id", async (req, res) => {
  const { id } = valida(UpdateRigaDareAvereParams, req.params);
  const b = valida(UpdateRigaDareAvereBody, req.body);
  const prima = await caricaRiga(id);
  const coll = await controllaCollaboratore(prima.collaboratoreId);
  const importo = centesimiDaEuro(b.importoEuro, "importoEuro");
  const data = dataFacoltativa(b.dataPagamento);
  await db.transaction(async (tx) => {
    await tx
      .update(compensiRigheTable)
      .set({ descrizione: b.descrizione.trim(), importoCentesimi: importo, dataPagamento: data, nota: (b.nota ?? "").trim(), modificatoIl: new Date() })
      .where(eq(compensiRigheTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "dare_avere.riga_modifica",
      entita: "compenso_riga",
      entitaId: id,
      descrizione: `Dare/avere ${prima.anno} di ${nomeCompleto(coll.cognome, coll.nome)}: modificata in ${TITOLO_SEZIONE[prima.sezione]} la riga "${prima.descrizione}" (ora "${b.descrizione.trim()}", ${euroTesto(importo)})`,
      dettagli: {
        prima: { descrizione: prima.descrizione, importoCentesimi: prima.importoCentesimi, dataPagamento: prima.dataPagamento, nota: prima.nota },
        dopo: { descrizione: b.descrizione.trim(), importoCentesimi: importo, dataPagamento: data, nota: (b.nota ?? "").trim() },
      },
    });
  });
  res.json(await dareAvere(prima.collaboratoreId, prima.anno));
});

router.delete("/backoffice/compensi/dare-avere/righe/:id", async (req, res) => {
  const { id } = valida(DeleteRigaDareAvereParams, req.params);
  const r = await caricaRiga(id);
  const coll = await controllaCollaboratore(r.collaboratoreId);
  await db.transaction(async (tx) => {
    await tx.delete(compensiRigheTable).where(eq(compensiRigheTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "dare_avere.riga_elimina",
      entita: "compenso_riga",
      entitaId: id,
      descrizione: `Dare/avere ${r.anno} di ${nomeCompleto(coll.cognome, coll.nome)}: eliminata da ${TITOLO_SEZIONE[r.sezione]} la riga "${r.descrizione}" di ${euroTesto(r.importoCentesimi)}`,
      dettagli: { collaboratoreId: r.collaboratoreId, anno: r.anno, sezione: r.sezione, importoCentesimi: r.importoCentesimi, dataPagamento: r.dataPagamento },
    });
  });
  res.json(await dareAvere(r.collaboratoreId, r.anno));
});

export default router;
