/** Compensi ai collaboratori: resoconto, estratti, pagamenti, stampati e dare/avere. Solo admin e super admin. */
import express, { Router, type IRouter, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { NextFunction, Request } from "express";
import { PDFDocument } from "pdf-lib";
import {
  CreateEstrattiBody,
  CreateRigaDareAvereBody,
  DeleteEstrattoParams,
  DeleteRigaDareAvereParams,
  GetDareAvereQueryParams,
  InviaEstrattiMultiploBody,
  UpdateImpostazioniRicevuteBody,
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
import { compensiRigheTable, db, estrattiEsclusioniTable, estrattiRigheTable, estrattiTable, notificheTable, praticheTable, ricevuteTable, statiPraticaTable } from "@workspace/db";
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
  registroInviiEstratti,
  resoconto,
  scriviImpostazioni,
  statoPagata,
} from "../lib/compensi";
import { salvaAllegatoPagamento } from "../lib/allegato-pagamento";
import { pdfDareAvere, pdfEstratto } from "../lib/compensi-pdf";
import { leggiImpostazioniRicevute, scriviImpostazioniRicevute } from "../lib/ricevute";
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
const soloAdmin = richiediRuolo("super_admin", "admin");
// L'operatore vede solo il dare/avere (in lettura), per poter creare le ricevute: il resto dei compensi e' di admin e super admin.
router.use("/backoffice/compensi", (req: Request, res, next: NextFunction) => {
  if (req.utente?.ruolo === "operatore" && req.method === "GET" && req.path.startsWith("/dare-avere")) return next();
  return soloAdmin(req, res, next);
});

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
  const b = valida(CreateEstrattiBody, req.body);
  const ids = [...new Set(b.praticaIds)];
  const escluse = new Map<number, string>();
  for (const x of b.escluse ?? []) {
    const motivo = x.motivo.trim();
    if (!motivo) throw new HttpError(400, "Per ogni pratica esclusa scrivi il motivo.", "DATI_NON_VALIDI", "escluse");
    if (ids.includes(x.praticaId)) throw new HttpError(400, "Una pratica non può essere insieme inclusa ed esclusa.", "DATI_NON_VALIDI", "escluse");
    escluse.set(x.praticaId, motivo);
  }
  const creati = await db.transaction(async (tx) => {
    const tutte = [...ids, ...escluse.keys()];
    // Si bloccano le pratiche scelte: un secondo estratto in parallelo sulle stesse pratiche aspetta e poi le trova gia' usate.
    await tx.select({ id: praticheTable.id }).from(praticheTable).where(inArray(praticheTable.id, tutte)).for("update");
    const valide = await resoconto({ ids: tutte });
    if (valide.righe.length !== tutte.length) {
      throw new HttpError(409, "Alcune pratiche non sono più disponibili (già in un estratto, riaperte o non più chiuse). Aggiorna il resoconto e riprova.", "PRATICHE_NON_DISPONIBILI");
    }
    const perCollaboratore = new Map<number, typeof valide.righe>();
    const escluseValide = valide.righe.filter((r) => escluse.has(r.praticaId));
    for (const r of valide.righe) {
      if (!escluse.has(r.praticaId)) perCollaboratore.set(r.collaboratoreId, [...(perCollaboratore.get(r.collaboratoreId) ?? []), r]);
    }
    for (const r of escluseValide) {
      if (!perCollaboratore.has(r.collaboratoreId)) {
        throw new HttpError(400, `La pratica ${r.numero} è esclusa, ma di ${r.collaboratoreNome} non resta nessuna pratica da pagare: toglila dalla selezione.`, "DATI_NON_VALIDI", "escluse");
      }
    }
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
      const sue = escluseValide.filter((r) => r.collaboratoreId === collaboratoreId);
      if (sue.length) {
        await tx.insert(estrattiEsclusioniTable).values(
          sue.map((r) => ({ estrattoId: e!.id, praticaId: r.praticaId, numeroPratica: r.numero, assistito: r.assistito, tipoPratica: r.tipoNome, motivo: escluse.get(r.praticaId)! })),
        );
      }
      await registraLog(tx, contestoDa(req), {
        azione: "estratto.crea",
        entita: "estratto",
        entitaId: e!.id,
        descrizione: `Creato l'estratto n. ${e!.id} di ${righe[0]!.collaboratoreNome} (sportello ${righe[0]!.numeroSportello}): ${righe.length} pratiche, ${totalePunti} punti, ${euroTesto(totaleCentesimi)}${
          sue.length ? `; escluse ${sue.length} pratiche (${sue.map((r) => `${r.numero}: ${escluse.get(r.praticaId)}`).join("; ")})` : ""
        }`,
        dettagli: { collaboratoreId, pratiche: righe.map((r) => r.numero), totalePunti, totaleCentesimi, escluse: sue.map((r) => ({ numero: r.numero, motivo: escluse.get(r.praticaId) })) },
      });
      risultato.push(e!.id);
    }
    return risultato;
  });
  const elenco = (await elencoEstratti({})).filter((e) => creati.includes(e.id));
  res.status(201).json(elenco);
});

router.get("/backoffice/compensi/estratti/registro-invii", async (_req, res) => {
  res.json(await registroInviiEstratti());
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
    const [conRicevuta] = await tx.select({ id: ricevuteTable.id }).from(ricevuteTable).where(and(eq(ricevuteTable.origineTipo, "estratto"), eq(ricevuteTable.origineId, id)));
    if (conRicevuta) throw new HttpError(409, "Per questo estratto è stata emessa una ricevuta: eliminala prima di eliminare l'estratto.", "ESTRATTO_CON_RICEVUTA");
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

/** Accoda e recapita l'email di un estratto al suo collaboratore; restituisce l'esito dell'invio. */
async function inviaEstrattoPerEmail(req: Request, id: number) {
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
  return {
    collaboratoreNome: nomeCompleto(coll.cognome, coll.nome),
    esito: n?.esito ?? ("errore" as const),
    esitoEtichetta: n ? ESITI_NOTIFICA[n.esito] : ESITI_NOTIFICA.errore,
    dettaglio: n?.dettaglioEsito ?? null,
  };
}

router.post("/backoffice/compensi/estratti/invio-multiplo", async (req, res) => {
  const { ids } = valida(InviaEstrattiMultiploBody, req.body);
  const unici = [...new Set(ids)];
  const esistenti = await db.select({ id: estrattiTable.id }).from(estrattiTable).where(inArray(estrattiTable.id, unici));
  if (esistenti.length !== unici.length) throw nonTrovato("Alcuni estratti non esistono più. Aggiorna l'elenco e riprova.");
  const risultati = [];
  for (const id of unici) {
    try {
      risultati.push({ id, ...(await inviaEstrattoPerEmail(req, id)) });
    } catch (err) {
      req.log.error({ err, estrattoId: id }, "Invio dell'estratto non riuscito");
      risultati.push({ id, collaboratoreNome: "", esito: "errore" as const, esitoEtichetta: ESITI_NOTIFICA.errore, dettaglio: err instanceof Error ? err.message : "Invio non riuscito" });
    }
  }
  res.json({ risultati });
});

router.post("/backoffice/compensi/estratti/:id/invio", async (req, res) => {
  const { id } = valida(InviaEstrattoParams, req.params);
  const esito = await inviaEstrattoPerEmail(req, id);
  res.json({ estratto: await estrattoDettaglio(id), esito: esito.esito, esitoEtichetta: esito.esitoEtichetta, dettaglio: esito.dettaglio });
});

// Allegato al pagamento (contabile del bonifico): si carica dopo aver registrato il pagamento e si puo' sostituire.
router.put("/backoffice/compensi/estratti/:id/pagamento/allegato", corpoFile, async (req, res) => {
  const { id } = valida(GetEstrattoParams, req.params);
  const [e] = await db.select().from(estrattiTable).where(eq(estrattiTable.id, id));
  if (!e) throw nonTrovato("Estratto non trovato.");
  if (!e.pagatoIl) throw new HttpError(409, "Registra prima il pagamento dell'estratto: poi potrai allegare la contabile.", "ESTRATTO_NON_PAGATO");
  const coll = await controllaCollaboratore(e.collaboratoreId);
  await salvaAllegatoPagamento(req, async (tx, a) => {
    const [att] = await tx.select({ chiave: estrattiTable.allegatoChiave }).from(estrattiTable).where(eq(estrattiTable.id, id)).for("update");
    await tx
      .update(estrattiTable)
      .set({ allegatoChiave: a.chiave, allegatoNome: a.nome, allegatoTipo: a.tipo, allegatoDimensione: a.dimensione, allegatoCaricatoIl: new Date() })
      .where(eq(estrattiTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "estratto.allegato_pagamento",
      entita: "estratto",
      entitaId: id,
      descrizione: `${att?.chiave ? "Sostituito" : "Allegato"} il documento "${a.nome}" al pagamento dell'estratto n. ${id} di ${nomeCompleto(coll.cognome, coll.nome)}`,
      dettagli: { fileNome: a.nome, dimensione: a.dimensione },
    });
    return att?.chiave ?? null;
  });
  res.json(await estrattoDettaglio(id));
});

router.get("/backoffice/compensi/estratti/:id/pagamento/allegato/file", async (req, res) => {
  const { id } = valida(GetEstrattoParams, req.params);
  const [e] = await db.select().from(estrattiTable).where(eq(estrattiTable.id, id));
  if (!e?.allegatoChiave) throw nonTrovato("Nessun documento allegato al pagamento.");
  const { stream } = await leggiFile(e.allegatoChiave);
  inviaFile(res, stream, e.allegatoNome ?? "allegato", e.allegatoTipo ?? "application/octet-stream", e.allegatoDimensione ?? 0, req.query["anteprima"] === "1");
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
// Impostazioni delle ricevute
// ---------------------------------------------------------------------------------------------

router.get("/backoffice/compensi/impostazioni-ricevute", async (_req, res) => {
  res.json(await leggiImpostazioniRicevute());
});

router.put("/backoffice/compensi/impostazioni-ricevute", async (req, res) => {
  const b = valida(UpdateImpostazioniRicevuteBody, req.body);
  const nuovi = {
    patronatoNome: b.patronatoNome.trim(),
    patronatoIndirizzo: b.patronatoIndirizzo.trim(),
    patronatoCapCitta: b.patronatoCapCitta.trim(),
    patronatoCodiceFiscale: b.patronatoCodiceFiscale.trim(),
    causale: b.causale.replace(/\s+/g, " ").trim(),
    fraseBonifico: b.fraseBonifico.replace(/\s+/g, " ").trim(),
    aliquotaIva: b.aliquotaIva,
  };
  if (!nuovi.patronatoNome) throw new HttpError(400, "Inserisci il nome del patronato.", "DATI_NON_VALIDI", "patronatoNome");
  if (!nuovi.causale) throw new HttpError(400, "Inserisci la causale.", "DATI_NON_VALIDI", "causale");
  if (!nuovi.fraseBonifico) throw new HttpError(400, "Inserisci la frase sul bonifico.", "DATI_NON_VALIDI", "fraseBonifico");
  await db.transaction(async (tx) => {
    const prima = await leggiImpostazioniRicevute(tx);
    const cambiati = (Object.keys(nuovi) as (keyof typeof nuovi)[]).filter((k) => prima[k] !== nuovi[k]);
    await scriviImpostazioniRicevute(tx, nuovi);
    await registraLog(tx, contestoDa(req), {
      azione: "ricevute.impostazioni_modifica",
      descrizione: cambiati.length ? `Modificati i dati stampati sulle ricevute (${cambiati.join(", ")})` : "Salvati i dati stampati sulle ricevute senza modifiche",
      dettagli: { campi: cambiati },
    });
  });
  res.json(await leggiImpostazioniRicevute());
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

async function impedisciSeConRicevuta(rigaId: number, azione: string) {
  const [r] = await db.select({ numero: ricevuteTable.numero, anno: ricevuteTable.anno }).from(ricevuteTable).where(and(eq(ricevuteTable.origineTipo, "riga"), eq(ricevuteTable.origineId, rigaId)));
  if (r) throw new HttpError(409, `Per questa riga è stata emessa la ricevuta n. ${r.numero}/${r.anno}: non si può ${azione}. Elimina prima la ricevuta.`, "RIGA_CON_RICEVUTA");
}

router.put("/backoffice/compensi/dare-avere/righe/:id", async (req, res) => {
  const { id } = valida(UpdateRigaDareAvereParams, req.params);
  const b = valida(UpdateRigaDareAvereBody, req.body);
  const prima = await caricaRiga(id);
  await impedisciSeConRicevuta(id, "modificare");
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
  await impedisciSeConRicevuta(id, "eliminare");
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
