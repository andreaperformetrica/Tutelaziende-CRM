/** Import dei servizi da Excel (730, ISEE, NASPI, Pensionati). Solo admin e super admin. */
import express, { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  ConfermaImportazioneBody,
  ConfermaImportazioneParams,
  DeleteImportazioneParams,
  GetImportazioneParams,
  ListImportazioniQueryParams,
  UpdateServizioImportBody,
  UpdateServizioImportParams,
} from "@workspace/api-zod";
import { db, importazioniRigheTable, importazioniTable } from "@workspace/db";
import { HttpError } from "../lib/errori";
import {
  CODICI_SERVIZI,
  analizzaImportazione,
  caricaImportazione,
  costruisciConfigurazione,
  dettaglioImportazione,
  elencoImportazioni,
  elencoServizi,
  erroreDuplicato,
  estensioneDi,
  etichettaServizio,
  hashContenuto,
  importazioneConfermataDuplicata,
  leggiConfigurazione,
  mappaServizio,
  scriviConfigurazione,
  type Servizio,
} from "../lib/importazioni";
import { contestoDa, registraLog } from "../lib/log";
import { DIMENSIONE_MASSIMA_FILE, eliminaFile, salvaFile } from "../lib/storage";
import { ESTENSIONI_IMPORT, leggiTabella } from "../lib/tabella-file";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/backoffice/compensi/importazioni", richiediRuolo("super_admin", "admin"));

const corpoFile = express.raw({ type: () => true, limit: DIMENSIONE_MASSIMA_FILE });
const TIPO_FILE: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
};
const euroTesto = (c: number) => `€ ${(c / 100).toFixed(2).replace(".", ",")}`;

function controllaServizio(v: unknown): Servizio {
  if (typeof v !== "string" || !CODICI_SERVIZI.includes(v as Servizio)) {
    throw new HttpError(400, "Scegli il servizio da importare (730, ISEE, NASPI o Pensionati).", "DATI_NON_VALIDI", "servizio");
  }
  return v as Servizio;
}

function erroreUnivoco(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

router.get("/backoffice/compensi/importazioni/servizi", async (_req, res) => {
  res.json(await elencoServizi());
});

router.put("/backoffice/compensi/importazioni/servizi/:servizio", async (req, res) => {
  const { servizio } = valida(UpdateServizioImportParams, req.params);
  const config = costruisciConfigurazione(valida(UpdateServizioImportBody, req.body));
  await db.transaction(async (tx) => {
    await scriviConfigurazione(tx, servizio, config);
    await registraLog(tx, contestoDa(req), {
      azione: "importazione.config",
      entita: "importazione_servizio",
      descrizione: `Import ${etichettaServizio(servizio)}: regola ${config.regola === "fisso" ? `fissa di ${euroTesto(config.valoreCentesimi)} per riga` : `a percentuale (${(config.valoreCentesimi / 100).toString().replace(".", ",")}%) della colonna «${config.colonnaImporto}»`}, collaboratore dalla colonna «${config.colonnaChiave}» (${config.tipoChiave})`,
      dettagli: { servizio, ...config },
    });
  });
  res.json(mappaServizio(servizio, await leggiConfigurazione(servizio)));
});

router.get("/backoffice/compensi/importazioni", async (req, res) => {
  const q = valida(ListImportazioniQueryParams, req.query);
  res.json(await elencoImportazioni({ servizio: q.servizio, anno: q.anno }));
});

/** Carica il file e crea l'anteprima. Corpo binario, fuori dal client generato. */
router.post("/backoffice/compensi/importazioni", corpoFile, async (req, res) => {
  const servizio = controllaServizio(req.query["servizio"]);
  const anno = Number(req.query["anno"]);
  if (!Number.isInteger(anno) || anno < 2000 || anno > 2100) throw new HttpError(400, "Indica l'anno di competenza.", "DATI_NON_VALIDI", "anno");
  const corpo = req.body;
  if (!Buffer.isBuffer(corpo) || corpo.length === 0) throw new HttpError(400, "Seleziona un file da caricare.", "FILE_MANCANTE");
  if (corpo.length > DIMENSIONE_MASSIMA_FILE) throw new HttpError(413, "Il file supera la dimensione massima di 15 MB.", "FILE_TROPPO_GRANDE");
  const nomeFile = String(req.query["nomeFile"] ?? "").replace(/[\\/\u0000-\u001f]/g, "_").trim().slice(0, 200);
  if (!nomeFile) throw new HttpError(400, "Nome del file mancante.", "FILE_MANCANTE");
  const estensione = estensioneDi(nomeFile);
  if (estensione === "xls") {
    throw new HttpError(400, "Il formato .xls (Excel 97-2003) non è supportato. Aprilo in Excel e salvalo come .xlsx, poi ricaricalo.", "FILE_FORMATO_NON_AMMESSO");
  }
  if (!(ESTENSIONI_IMPORT as readonly string[]).includes(estensione)) {
    throw new HttpError(400, "Formato non ammesso. Carica un file Excel .xlsx oppure un CSV.", "FILE_FORMATO_NON_AMMESSO");
  }
  const hash = hashContenuto(corpo);
  const duplicato = await importazioneConfermataDuplicata(servizio, hash);
  if (duplicato) throw erroreDuplicato(duplicato);
  // Si controlla subito che il file sia leggibile, cosi' un file rotto non lascia anteprime inutili.
  const tabella = await leggiTabella(corpo, estensione);
  if (tabella.righe.length === 0) throw new HttpError(400, "Il file contiene solo l'intestazione: non ci sono righe da importare.", "FILE_NON_VALIDO");
  const chiave = await salvaFile(corpo, TIPO_FILE[estensione]!);
  let vecchie: string[] = [];
  let id = 0;
  try {
    await db.transaction(async (tx) => {
      const precedenti = await tx
        .delete(importazioniTable)
        .where(and(eq(importazioniTable.servizio, servizio), eq(importazioniTable.hashFile, hash), eq(importazioniTable.stato, "anteprima")))
        .returning({ chiave: importazioniTable.chiaveFile });
      vecchie = precedenti.map((p) => p.chiave);
      const [nuova] = await tx
        .insert(importazioniTable)
        .values({ servizio, anno, nomeFile, hashFile: hash, chiaveFile: chiave, righeLette: tabella.righe.length, creatoDaUtenteId: req.utente!.id })
        .returning();
      id = nuova!.id;
      await registraLog(tx, contestoDa(req), {
        azione: "importazione.anteprima",
        entita: "importazione",
        entitaId: id,
        descrizione: `Caricato il file "${nomeFile}" per l'import ${etichettaServizio(servizio)} ${anno} (${tabella.righe.length} righe lette, in attesa di conferma)`,
        dettagli: { servizio, anno, nomeFile, righe: tabella.righe.length },
      });
    });
  } catch (err) {
    await eliminaFile(chiave, req.log);
    throw err;
  }
  for (const v of vecchie) await eliminaFile(v, req.log);
  res.status(201).json(await dettaglioImportazione(id));
});

router.get("/backoffice/compensi/importazioni/:id", async (req, res) => {
  const { id } = valida(GetImportazioneParams, req.params);
  res.json(await dettaglioImportazione(id));
});

router.post("/backoffice/compensi/importazioni/:id/conferma", async (req, res) => {
  const { id } = valida(ConfermaImportazioneParams, req.params);
  const { soloValide } = valida(ConfermaImportazioneBody, req.body);
  try {
    await db.transaction(async (tx) => {
      const [bloccata] = await tx.select().from(importazioniTable).where(eq(importazioniTable.id, id)).for("update");
      if (!bloccata) throw new HttpError(404, "Importazione non trovata.", "NON_TROVATO");
      if (bloccata.stato !== "anteprima") throw new HttpError(409, "Questa importazione è già stata confermata.", "IMPORT_GIA_CONFERMATO");
      const duplicato = await importazioneConfermataDuplicata(bloccata.servizio, bloccata.hashFile, tx);
      if (duplicato) throw erroreDuplicato(duplicato);
      const { config, analisi } = await analizzaImportazione(bloccata, tx);
      if (!analisi.configurazioneCompleta || !config) {
        throw new HttpError(400, analisi.messaggioConfigurazione ?? "Imposta la regola di calcolo prima di confermare.", "IMPORT_CONFIGURAZIONE_INCOMPLETA");
      }
      const valide = analisi.righe.filter((r) => r.errori.length === 0);
      const conErrori = analisi.righe.length - valide.length;
      if (conErrori > 0 && !soloValide) {
        throw new HttpError(409, `Ci sono ${conErrori} righe con errori. Correggi il file oppure scegli di importare solo le righe valide.`, "IMPORT_CON_ERRORI");
      }
      if (valide.length === 0) throw new HttpError(400, "Nessuna riga valida da importare.", "IMPORT_VUOTO");
      const totale = valide.reduce((t, r) => t + r.compensoCentesimi!, 0);
      for (let i = 0; i < valide.length; i += 500) {
        await tx.insert(importazioniRigheTable).values(
          valide.slice(i, i + 500).map((r) => ({
            importazioneId: id,
            numeroRiga: r.numeroRiga,
            collaboratoreId: r.collaboratoreId!,
            riferimento: r.riferimento ?? "",
            baseCentesimi: r.baseCentesimi,
            compensoCentesimi: r.compensoCentesimi!,
          })),
        );
      }
      await tx
        .update(importazioniTable)
        .set({
          stato: "confermata",
          configurazione: JSON.stringify(config),
          righeLette: analisi.righe.length,
          righeImportate: valide.length,
          totaleCentesimi: totale,
          confermatoIl: new Date(),
          confermatoDaUtenteId: req.utente!.id,
        })
        .where(eq(importazioniTable.id, id));
      await registraLog(tx, contestoDa(req), {
        azione: "importazione.conferma",
        entita: "importazione",
        entitaId: id,
        descrizione: `Confermato l'import ${etichettaServizio(bloccata.servizio)} ${bloccata.anno} dal file "${bloccata.nomeFile}": ${valide.length} righe importate${conErrori ? `, ${conErrori} scartate per errori` : ""}, totale ${euroTesto(totale)}`,
        dettagli: { servizio: bloccata.servizio, anno: bloccata.anno, righeImportate: valide.length, righeScartate: conErrori, totaleCentesimi: totale, ...config },
      });
    });
  } catch (err) {
    if (erroreUnivoco(err)) {
      const i = await caricaImportazione(id);
      const d = await importazioneConfermataDuplicata(i.servizio, i.hashFile);
      if (d) throw erroreDuplicato(d);
    }
    throw err;
  }
  res.json(await dettaglioImportazione(id));
});

router.delete("/backoffice/compensi/importazioni/:id", async (req, res) => {
  const { id } = valida(DeleteImportazioneParams, req.params);
  let chiave = "";
  await db.transaction(async (tx) => {
    const [i] = await tx.select().from(importazioniTable).where(eq(importazioniTable.id, id)).for("update");
    if (!i) throw new HttpError(404, "Importazione non trovata.", "NON_TROVATO");
    chiave = i.chiaveFile;
    await tx.delete(importazioniTable).where(eq(importazioniTable.id, id));
    const confermata = i.stato === "confermata";
    await registraLog(tx, contestoDa(req), {
      azione: confermata ? "importazione.annulla" : "importazione.scarta",
      entita: "importazione",
      entitaId: id,
      descrizione: confermata
        ? `Annullato l'import ${etichettaServizio(i.servizio)} ${i.anno} del file "${i.nomeFile}" (${i.righeImportate} righe, ${euroTesto(i.totaleCentesimi)} tolti dal dare/avere)`
        : `Scartata l'anteprima dell'import ${etichettaServizio(i.servizio)} ${i.anno} del file "${i.nomeFile}"`,
      dettagli: { servizio: i.servizio, anno: i.anno, nomeFile: i.nomeFile, righeImportate: i.righeImportate, totaleCentesimi: i.totaleCentesimi },
    });
  });
  await eliminaFile(chiave, req.log);
  res.status(204).end();
});

export default router;
