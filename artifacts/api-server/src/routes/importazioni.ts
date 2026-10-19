/** Import dei compensi da Excel (730, ISEE, NASPI). Solo admin e super admin. */
import express, { Router, type IRouter } from "express";
import { and, desc, eq, gt, or, sql } from "drizzle-orm";
import { ConfermaImportazioneBody, ConfermaImportazioneParams, DeleteImportazioneParams, GetImportazioneParams, ListImportazioniQueryParams } from "@workspace/api-zod";
import { db, importazioniRigheTable, importazioniTable, ricevuteTable } from "@workspace/db";
import { HttpError } from "../lib/errori";
import {
  CODICI_SERVIZI,
  analizzaImportazione,
  analizzaTabella,
  caricaImportazione,
  dettaglioImportazione,
  elencoImportazioni,
  erroreDuplicato,
  errorePeriodoEsistente,
  estensioneDi,
  hashContenuto,
  importazioneConfermataDuplicata,
  importazionePeriodoEsistente,
  titoloImport,
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
const euroTesto = (c: number) => `€ ${(c / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const annoCorrente = () => Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric" }).format(new Date()));

function controllaServizio(v: unknown): Servizio {
  if (typeof v !== "string" || !CODICI_SERVIZI.includes(v as Servizio)) {
    throw new HttpError(400, "Scegli il tipo di import (730, ISEE o NASPI).", "DATI_NON_VALIDI", "servizio");
  }
  return v as Servizio;
}

function controllaAnno(v: unknown, campo: string, messaggio: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) throw new HttpError(400, messaggio, "DATI_NON_VALIDI", campo);
  return n;
}

function erroreUnivoco(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

router.get("/backoffice/compensi/importazioni", async (req, res) => {
  const q = valida(ListImportazioniQueryParams, req.query);
  res.json(await elencoImportazioni({ servizio: q.servizio, anno: q.anno }));
});

/** Carica il file e crea l'anteprima. Corpo binario, fuori dal client generato. */
router.post("/backoffice/compensi/importazioni", corpoFile, async (req, res) => {
  const servizio = controllaServizio(req.query["servizio"]);
  const anno = controllaAnno(req.query["anno"], "anno", servizio === "mod730" ? "Indica l'anno di riferimento del 730." : "Indica l'anno.");
  let trimestre: number | null = null;
  if (servizio === "isee") {
    trimestre = Number(req.query["trimestre"]);
    if (![1, 2, 3, 4].includes(trimestre)) throw new HttpError(400, "Indica il trimestre (1, 2, 3 o 4).", "DATI_NON_VALIDI", "trimestre");
  }
  const periodoGrezzo = servizio === "naspi" ? String(req.query["periodo"] ?? "").trim() : "";
  if (periodoGrezzo.length > 60) throw new HttpError(400, "Il periodo può avere al massimo 60 caratteri.", "DATI_NON_VALIDI", "periodo");
  const periodo = periodoGrezzo || null;
  const annoDareAvere =
    servizio === "mod730" && req.query["annoDareAvere"] ? controllaAnno(req.query["annoDareAvere"], "annoDareAvere", "Indica l'anno del dare e avere.") : servizio === "mod730" ? annoCorrente() : anno;

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
  const dati = { servizio, anno, trimestre, periodo };
  const hash = hashContenuto(corpo);
  const duplicato = await importazioneConfermataDuplicata(hash);
  if (duplicato) throw erroreDuplicato(duplicato);
  const esistente = await importazionePeriodoEsistente(dati);
  if (esistente) throw errorePeriodoEsistente(esistente);
  // Si controlla subito che il file sia leggibile e abbia le colonne giuste, cosi' un file sbagliato non lascia anteprime inutili.
  const tabella = await leggiTabella(corpo, estensione);
  if (tabella.righe.length === 0) throw new HttpError(400, "Il file contiene solo l'intestazione: non ci sono righe da importare.", "FILE_NON_VALIDO");
  await analizzaTabella(tabella, servizio, anno);
  const chiave = await salvaFile(corpo, TIPO_FILE[estensione]!);
  let vecchie: string[] = [];
  let id = 0;
  try {
    await db.transaction(async (tx) => {
      const precedenti = await tx
        .delete(importazioniTable)
        .where(and(eq(importazioniTable.hashFile, hash), eq(importazioniTable.stato, "anteprima")))
        .returning({ chiave: importazioniTable.chiaveFile });
      vecchie = precedenti.map((p) => p.chiave);
      const [nuova] = await tx
        .insert(importazioniTable)
        .values({ ...dati, annoDareAvere, nomeFile, hashFile: hash, chiaveFile: chiave, righeLette: tabella.righe.length, creatoDaUtenteId: req.utente!.id })
        .returning();
      id = nuova!.id;
      await registraLog(tx, contestoDa(req), {
        azione: "importazione.anteprima",
        entita: "importazione",
        entitaId: id,
        descrizione: `Caricato il file "${nomeFile}" per l'import ${titoloImport(dati)} (${tabella.righe.length} righe lette, in attesa di conferma)`,
        dettagli: { ...dati, annoDareAvere, nomeFile, righe: tabella.righe.length },
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
      // Le conferme NASPI si calcolano una alla volta: la differenza dipende da quella precedente.
      await tx.execute(sql`select pg_advisory_xact_lock(73001)`);
      const [bloccata] = await tx.select().from(importazioniTable).where(eq(importazioniTable.id, id)).for("update");
      if (!bloccata) throw new HttpError(404, "Importazione non trovata.", "NON_TROVATO");
      if (bloccata.stato !== "anteprima") throw new HttpError(409, "Questa importazione è già stata confermata.", "IMPORT_GIA_CONFERMATO");
      const duplicato = await importazioneConfermataDuplicata(bloccata.hashFile, tx);
      if (duplicato) throw erroreDuplicato(duplicato);
      const esistente = await importazionePeriodoEsistente(bloccata, tx);
      if (esistente) throw errorePeriodoEsistente(esistente);
      const analisi = await analizzaImportazione(bloccata, tx);
      const valide = analisi.righe.filter((r) => r.esito !== "errore");
      const conErrori = analisi.righe.length - valide.length;
      if (conErrori > 0 && !soloValide) {
        throw new HttpError(409, `Ci sono ${conErrori} righe con errori. Correggi il file oppure scegli di importare solo le righe valide.`, "IMPORT_CON_ERRORI");
      }
      if (valide.length === 0) throw new HttpError(400, "Nessuna riga valida da importare.", "IMPORT_VUOTO");
      const totale = valide.reduce((t, r) => t + (r.compensoCentesimi ?? 0), 0);
      const negative = valide.filter((r) => r.esito === "avviso").length;
      const riferimenti = valide.filter((r) => r.esito === "riferimento").length;
      for (let i = 0; i < valide.length; i += 500) {
        await tx.insert(importazioniRigheTable).values(
          valide.slice(i, i + 500).map((r) => ({
            importazioneId: id,
            numeroRiga: r.numeroRiga,
            collaboratoreId: r.collaboratoreId!,
            riferimento: r.sportello ?? "",
            sedeFile: r.sedeFile,
            baseCentesimi: bloccata.servizio === "naspi" ? r.importoCentesimi : null,
            precedenteCentesimi: r.precedenteCentesimi,
            compensoCentesimi: r.compensoCentesimi ?? 0,
          })),
        );
      }
      await tx
        .update(importazioniTable)
        .set({ stato: "confermata", righeLette: analisi.righe.length, righeImportate: valide.length, totaleCentesimi: totale, confermatoIl: new Date(), confermatoDaUtenteId: req.utente!.id })
        .where(eq(importazioniTable.id, id));
      await registraLog(tx, contestoDa(req), {
        azione: "importazione.conferma",
        entita: "importazione",
        entitaId: id,
        descrizione:
          `Importato ${titoloImport(bloccata)} dal file "${bloccata.nomeFile}": ${analisi.righe.length} righe lette, ${valide.length} importate` +
          `${conErrori ? `, ${conErrori} scartate per errori` : ""}${negative ? `, ${negative} con differenza negativa non pagata` : ""}${riferimenti ? `, ${riferimenti} nuovi riferimenti` : ""}, totale da pagare ${euroTesto(totale)}`,
        dettagli: {
          servizio: bloccata.servizio,
          anno: bloccata.anno,
          trimestre: bloccata.trimestre,
          periodo: bloccata.periodo,
          annoDareAvere: bloccata.annoDareAvere,
          nomeFile: bloccata.nomeFile,
          righeLette: analisi.righe.length,
          righeImportate: valide.length,
          righeScartate: conErrori,
          differenzeNegative: negative,
          totaleCentesimi: totale,
        },
      });
    });
  } catch (err) {
    if (erroreUnivoco(err)) {
      const i = await caricaImportazione(id);
      const d = await importazioneConfermataDuplicata(i.hashFile);
      if (d) throw erroreDuplicato(d);
      const p = await importazionePeriodoEsistente(i);
      if (p) throw errorePeriodoEsistente(p);
    }
    throw err;
  }
  res.json(await dettaglioImportazione(id));
});

router.delete("/backoffice/compensi/importazioni/:id", async (req, res) => {
  const { id } = valida(DeleteImportazioneParams, req.params);
  let chiave = "";
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73001)`);
    const [i] = await tx.select().from(importazioniTable).where(eq(importazioniTable.id, id)).for("update");
    if (!i) throw new HttpError(404, "Importazione non trovata.", "NON_TROVATO");
    const confermata = i.stato === "confermata";
    if (confermata) {
      const [ricevuta] = await tx
        .select({ numero: ricevuteTable.numero, anno: ricevuteTable.anno })
        .from(ricevuteTable)
        .where(and(eq(ricevuteTable.origineTipo, "importazione"), eq(ricevuteTable.origineId, id)));
      if (ricevuta) {
        throw new HttpError(409, `Esiste la ricevuta n. ${ricevuta.numero}/${ricevuta.anno} su questa importazione: eliminala prima di annullare l'import.`, "IMPORT_CON_RICEVUTA");
      }
      if (i.servizio === "naspi") {
        const [successiva] = await tx
          .select({ id: importazioniTable.id })
          .from(importazioniTable)
          .where(
            and(
              eq(importazioniTable.servizio, "naspi"),
              eq(importazioniTable.anno, i.anno),
              eq(importazioniTable.stato, "confermata"),
              or(gt(importazioniTable.confermatoIl, i.confermatoIl!), and(eq(importazioniTable.confermatoIl, i.confermatoIl!), gt(importazioniTable.id, id))),
            ),
          )
          .orderBy(desc(importazioniTable.id))
          .limit(1);
        if (successiva) {
          throw new HttpError(409, `Si può annullare solo l'ultima importazione NASPI dell'anno: la n. ${successiva.id} è successiva e calcola le differenze da questa.`, "IMPORT_NASPI_NON_ULTIMA");
        }
      }
    }
    chiave = i.chiaveFile;
    await tx.delete(importazioniTable).where(eq(importazioniTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: confermata ? "importazione.annulla" : "importazione.scarta",
      entita: "importazione",
      entitaId: id,
      descrizione: confermata
        ? `Annullato l'import ${titoloImport(i)} del file "${i.nomeFile}" (${i.righeImportate} righe, ${euroTesto(i.totaleCentesimi)} tolti dal dare/avere)`
        : `Scartata l'anteprima dell'import ${titoloImport(i)} del file "${i.nomeFile}"`,
      dettagli: { servizio: i.servizio, anno: i.anno, trimestre: i.trimestre, nomeFile: i.nomeFile, righeImportate: i.righeImportate, totaleCentesimi: i.totaleCentesimi },
    });
  });
  await eliminaFile(chiave, req.log);
  res.status(204).end();
});

export default router;
