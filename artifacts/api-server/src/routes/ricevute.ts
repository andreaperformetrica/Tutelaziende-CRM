/** Ricevute dei collaboratori e pagamenti: creazione dal dare/avere, elenco, PDF, pagamento e bonifico allegato. */
import express, { Router, type IRouter, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { CreateRicevutaBody, DeleteRicevutaParams, GetRicevutaParams, ListRicevuteQueryParams, RegistraPagamentoRicevutaBody, RegistraPagamentoRicevutaParams } from "@workspace/api-zod";
import { db, ricevuteTable } from "@workspace/db";
import { ETICHETTA_METODO, centesimiDaEuro, controllaData } from "../lib/compensi";
import { salvaAllegatoPagamento } from "../lib/allegato-pagamento";
import { HttpError, nonTrovato } from "../lib/errori";
import { formattaData } from "../lib/eventi";
import { contestoDa, registraLog } from "../lib/log";
import { caricaRicevuta, creaRicevuta, dettaglioRicevuta, elencoRicevute } from "../lib/ricevute";
import { pdfRicevuta } from "../lib/ricevute-pdf";
import { DIMENSIONE_MASSIMA_FILE, eliminaFile, leggiFile } from "../lib/storage";
import { codiceErrorePg } from "../lib/postgres";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";
import { inviaFile } from "./tipi-pratica";

const router: IRouter = Router();
router.use("/backoffice/ricevute", richiediRuolo("super_admin", "admin", "operatore"));

const corpoFile = express.raw({ type: () => true, limit: DIMENSIONE_MASSIMA_FILE });
const euroTesto = (c: number) => `€ ${(c / 100).toFixed(2).replace(".", ",")}`;
const etichetta = (r: { numero: number; anno: number }) => `n. ${r.numero}/${r.anno}`;

function inviaPdf(res: Response, pdf: Buffer, nome: string) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", String(pdf.length));
  res.setHeader("Content-Disposition", `inline; filename="ricevuta.pdf"; filename*=UTF-8''${encodeURIComponent(nome)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.end(pdf);
}

router.get("/backoffice/ricevute", async (req, res) => {
  const q = valida(ListRicevuteQueryParams, req.query);
  res.json(
    await elencoRicevute({
      dal: q.dal ? controllaData(q.dal, "dal", "Data iniziale") : undefined,
      al: q.al ? controllaData(q.al, "al", "Data finale") : undefined,
      numero: q.numero,
      collaboratoreId: q.collaboratoreId,
      stato: q.stato,
    }),
  );
});

router.post("/backoffice/ricevute", async (req, res) => {
  const b = valida(CreateRicevutaBody, req.body);
  const importo = centesimiDaEuro(b.importoEuro, "importoEuro");
  let creata;
  try {
    creata = await db.transaction(async (tx) => {
      const c = await creaRicevuta(tx, {
        collaboratoreId: b.collaboratoreId,
        anno: b.anno,
        origineTipo: b.origineTipo,
        origineId: b.origineId,
        importoCentesimi: importo,
        aliquotaIva: b.aliquotaIva,
        dataRicevuta: b.dataRicevuta,
        utenteId: req.utente!.id,
      });
      await registraLog(tx, contestoDa(req), {
        azione: "ricevuta.crea",
        entita: "ricevuta",
        entitaId: c.id,
        descrizione: `Creata la ricevuta ${etichetta(c)} per conto di ${c.collaboratoreNome}: ${euroTesto(c.totaleCentesimi)} (${c.descrizione})`,
        dettagli: { collaboratoreId: b.collaboratoreId, annoDareAvere: b.anno, origineTipo: b.origineTipo, origineId: b.origineId, totaleCentesimi: c.totaleCentesimi },
      });
      return c;
    });
  } catch (err) {
    if (codiceErrorePg(err).code === "23505") {
      throw new HttpError(409, "Per questa riga del dare/avere esiste già una ricevuta.", "RICEVUTA_ESISTENTE");
    }
    throw err;
  }
  res.status(201).json(await dettaglioRicevuta(creata.id));
});

router.get("/backoffice/ricevute/:id", async (req, res) => {
  const { id } = valida(GetRicevutaParams, req.params);
  res.json(await dettaglioRicevuta(id));
});

router.get("/backoffice/ricevute/:id/pdf", async (req, res) => {
  const { id } = valida(GetRicevutaParams, req.params);
  const { pdf, nomeFile } = await pdfRicevuta(id);
  inviaPdf(res, pdf, nomeFile);
});

router.delete("/backoffice/ricevute/:id", async (req, res) => {
  const { id } = valida(DeleteRicevutaParams, req.params);
  await db.transaction(async (tx) => {
    const { r } = await caricaRicevuta(id);
    if (r.pagatoIl) throw new HttpError(409, "La ricevuta è già stata pagata e non si può eliminare.", "RICEVUTA_PAGATA");
    const d = await dettaglioRicevuta(id);
    if (!d.eliminabile) throw new HttpError(409, "Si può eliminare solo l'ultima ricevuta dell'anno, per non lasciare buchi nella numerazione.", "RICEVUTA_NON_ULTIMA");
    await tx.delete(ricevuteTable).where(eq(ricevuteTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "ricevuta.elimina",
      entita: "ricevuta",
      entitaId: id,
      descrizione: `Eliminata la ricevuta ${etichetta(r)} di ${d.ricevuta.collaboratoreNome} (${euroTesto(r.totaleCentesimi)}, non pagata)`,
      dettagli: { collaboratoreId: r.collaboratoreId, totaleCentesimi: r.totaleCentesimi },
    });
  });
  res.status(204).end();
});

router.post("/backoffice/ricevute/:id/pagamento", async (req, res) => {
  const { id } = valida(RegistraPagamentoRicevutaParams, req.params);
  const b = valida(RegistraPagamentoRicevutaBody, req.body);
  const data = controllaData(b.data, "data", "Data del pagamento");
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(ricevuteTable).where(eq(ricevuteTable.id, id)).for("update");
    if (!r) throw nonTrovato("Ricevuta non trovata.");
    if (r.pagatoIl) throw new HttpError(409, "Il pagamento di questa ricevuta è già stato registrato.", "RICEVUTA_PAGATA");
    if (data < r.dataRicevuta) throw new HttpError(400, "La data del pagamento non può essere precedente alla data della ricevuta.", "DATA_NON_VALIDA", "data");
    await tx.update(ricevuteTable).set({ pagatoIl: data, pagamentoMetodo: b.metodo, pagamentoRegistratoIl: new Date(), pagamentoUtenteId: req.utente!.id }).where(eq(ricevuteTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "ricevuta.pagamento",
      entita: "ricevuta",
      entitaId: id,
      descrizione: `Registrato il pagamento della ricevuta ${etichetta(r)}: ${euroTesto(r.totaleCentesimi)} il ${formattaData(data)} (${ETICHETTA_METODO[b.metodo]})`,
      dettagli: { collaboratoreId: r.collaboratoreId, data, metodo: b.metodo, totaleCentesimi: r.totaleCentesimi },
    });
  });
  res.json(await dettaglioRicevuta(id));
});

router.put("/backoffice/ricevute/:id/allegato", corpoFile, async (req, res) => {
  const { id } = valida(GetRicevutaParams, req.params);
  const { r } = await caricaRicevuta(id);
  if (!r.pagatoIl) throw new HttpError(409, "Registra prima il pagamento: poi potrai allegare il bonifico.", "RICEVUTA_NON_PAGATA");
  await salvaAllegatoPagamento(req, async (tx, a) => {
    const [att] = await tx.select({ chiave: ricevuteTable.allegatoChiave }).from(ricevuteTable).where(eq(ricevuteTable.id, id)).for("update");
    await tx
      .update(ricevuteTable)
      .set({ allegatoChiave: a.chiave, allegatoNome: a.nome, allegatoTipo: a.tipo, allegatoDimensione: a.dimensione, allegatoCaricatoIl: new Date() })
      .where(eq(ricevuteTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "ricevuta.allegato",
      entita: "ricevuta",
      entitaId: id,
      descrizione: `${att?.chiave ? "Sostituito" : "Allegato"} il documento "${a.nome}" al pagamento della ricevuta ${etichetta(r)}`,
      dettagli: { fileNome: a.nome, dimensione: a.dimensione },
    });
    return att?.chiave ?? null;
  });
  res.json(await dettaglioRicevuta(id));
});

router.get("/backoffice/ricevute/:id/allegato/file", async (req, res) => {
  const { id } = valida(GetRicevutaParams, req.params);
  const { r } = await caricaRicevuta(id);
  if (!r.allegatoChiave) throw nonTrovato("Nessun documento allegato al pagamento.");
  const { stream } = await leggiFile(r.allegatoChiave);
  inviaFile(res, stream, r.allegatoNome ?? "allegato", r.allegatoTipo ?? "application/octet-stream", r.allegatoDimensione ?? 0, req.query["anteprima"] === "1");
});

export default router;
