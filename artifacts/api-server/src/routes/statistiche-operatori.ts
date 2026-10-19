import { Readable } from "node:stream";
import { Router, type IRouter } from "express";
import ExcelJS from "exceljs";
import { GetStatisticheOperatoriQueryParams } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { contestoDa, registraLog } from "../lib/log";
import { calcolaStatistiche, periodoStatistiche } from "../lib/statistiche-operatori";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";
import { inviaFile } from "./tipi-pratica";

const router: IRouter = Router();
router.use("/backoffice/statistiche-operatori", richiediRuolo("super_admin"));

const gg = (iso: string) => iso.split("-").reverse().join("/");

router.get("/backoffice/statistiche-operatori", async (req, res) => {
  const q = valida(GetStatisticheOperatoriQueryParams, req.query);
  const { dal, al } = periodoStatistiche(q.dal, q.al);
  res.json({ dal, al, righe: await calcolaStatistiche(dal, al) });
});

/** Esportazione in Excel (file: fuori dalla descrizione OpenAPI, come l'elenco pratiche). */
router.get("/backoffice/statistiche-operatori/esporta", async (req, res) => {
  const q = valida(GetStatisticheOperatoriQueryParams, req.query);
  const { dal, al } = periodoStatistiche(q.dal, q.al);
  const righe = await calcolaStatistiche(dal, al);
  const wb = new ExcelJS.Workbook();
  const foglio = wb.addWorksheet("Statistiche operatori");
  foglio.addRow([`Periodo: dal ${gg(dal)} al ${gg(al)}`]).font = { bold: true };
  foglio.addRow([]);
  foglio.columns = [
    { key: "operatore", width: 30 },
    { key: "prese", width: 18 },
    { key: "lavorate", width: 12 },
    { key: "chiuse", width: 12 },
    { key: "tempo", width: 22 },
    { key: "commenti", width: 18 },
  ];
  const intestazione = foglio.addRow(["Operatore", "Prese in carico", "Lavorate", "Chiuse", "Tempo medio (ore)", "Commenti inviati"]);
  intestazione.font = { bold: true };
  for (const r of righe) foglio.addRow([`${r.cognome} ${r.nome}`, r.preseInCarico, r.lavorate, r.chiuse, r.tempoMedioOre, r.commentiInviati]);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  await registraLog(db, contestoDa(req), {
    azione: "statistiche.esporta",
    entita: "statistiche",
    descrizione: `Esportazione in Excel delle statistiche operatori (dal ${gg(dal)} al ${gg(al)})`,
    dettagli: { dal, al, righe: righe.length },
  });
  inviaFile(res, Readable.from(buffer), `Statistiche operatori ${gg(dal).replace(/\//g, "-")} - ${gg(al).replace(/\//g, "-")}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer.length);
});

export default router;
