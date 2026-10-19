import { Router, type IRouter } from "express";
import { inArray } from "drizzle-orm";
import { ListAlertCollaboratoriQueryParams, UpdateConfigurazioneAlertBody } from "@workspace/api-zod";
import { db, tipiPraticaTable } from "@workspace/db";
import { contaAlertAperti, elencoAlert, leggiConfigurazioneAlert, ricalcolaAlert, salvaConfigurazioneAlert } from "../lib/alert";
import { HttpError } from "../lib/errori";
import { contestoDa, registraLog } from "../lib/log";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/backoffice/alert", richiediRuolo("super_admin", "admin"));

router.get("/backoffice/alert", async (req, res) => {
  const p = valida(ListAlertCollaboratoriQueryParams, req.query);
  res.json({ elementi: await elencoAlert(db, { stato: p.stato ?? "aperto" }), aperti: await contaAlertAperti() });
});

router.get("/backoffice/alert/conteggio", async (_req, res) => {
  res.json({ aperti: await contaAlertAperti() });
});

router.get("/backoffice/alert/configurazione", async (_req, res) => {
  res.json(await leggiConfigurazioneAlert());
});

router.put("/backoffice/alert/configurazione", async (req, res) => {
  const c = valida(UpdateConfigurazioneAlertBody, req.body);
  const ids = [...new Set([...c.inattivita.tipiIds, ...c.volume.tipiIds])];
  if (ids.length) {
    const esistenti = await db.select({ id: tipiPraticaTable.id }).from(tipiPraticaTable).where(inArray(tipiPraticaTable.id, ids));
    if (esistenti.length !== ids.length) throw new HttpError(400, "Uno dei tipi di pratica scelti non esiste più.", "DATI_NON_VALIDI", "tipiIds");
  }
  await db.transaction(async (tx) => {
    await salvaConfigurazioneAlert(tx, c);
    await registraLog(tx, contestoDa(req), {
      azione: "alert.configura",
      entita: "alert",
      descrizione: `Alert collaboratori: inattività ${c.inattivita.attiva ? `da ${c.inattivita.mesi} mesi` : "disattivata"}, volume ${c.volume.attiva ? `oltre ${c.volume.soglia} in ${c.volume.periodoGiorni} giorni` : "disattivato"}`,
      dettagli: { inattivita: c.inattivita, volume: c.volume },
    });
  });
  await ricalcolaAlert();
  res.json(await leggiConfigurazioneAlert());
});

export default router;
