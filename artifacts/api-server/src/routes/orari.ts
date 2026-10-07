import { Router, type IRouter } from "express";
import { UpdateOrariCaricamentoBody } from "@workspace/api-zod";
import { db, finestreBloccoTable } from "@workspace/db";
import { HttpError } from "../lib/errori";
import { contestoDa, registraLog } from "../lib/log";
import { calcolaStatoInvio, leggiFasce, minutiDaOra, oraDaMinuti, type Fascia } from "../lib/orari";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/orari-caricamento", richiediRuolo("super_admin", "admin"));

const NOMI_GIORNO = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"];
const testo = (f: Fascia) =>
  `${f.attiva ? "" : "(disattivata) "}da ${NOMI_GIORNO[f.giornoInizio - 1]} ${oraDaMinuti(f.minutoInizio)} a ${NOMI_GIORNO[f.giornoFine - 1]} ${oraDaMinuti(f.minutoFine)}`;

async function risposta() {
  const righe = await leggiFasce();
  const stato = calcolaStatoInvio(righe);
  return {
    fasce: righe.map((f) => ({
      id: f.id,
      giornoInizio: f.giornoInizio,
      oraInizio: oraDaMinuti(f.minutoInizio),
      giornoFine: f.giornoFine,
      oraFine: oraDaMinuti(f.minutoFine),
      attiva: f.attiva,
    })),
    stato: {
      consentito: stato.consentito,
      adesso: stato.adesso.toISOString(),
      bloccatoFinoA: stato.bloccatoFinoA ? stato.bloccatoFinoA.toISOString() : null,
    },
  };
}

router.get("/orari-caricamento", async (_req, res) => {
  res.json(await risposta());
});

router.put("/orari-caricamento", async (req, res) => {
  const { fasce } = valida(UpdateOrariCaricamentoBody, req.body);
  if (fasce.length > 50) throw new HttpError(400, "Sono ammesse al massimo 50 fasce.", "DATI_NON_VALIDI", "fasce");
  const nuove: Fascia[] = fasce.map((f, i) => {
    const mi = minutiDaOra(f.oraInizio);
    const mf = minutiDaOra(f.oraFine);
    if (mi === null || mf === null) {
      throw new HttpError(400, `Fascia ${i + 1}: gli orari devono essere nel formato HH:MM.`, "DATI_NON_VALIDI", "fasce");
    }
    if (f.giornoInizio === f.giornoFine && mi === mf) {
      throw new HttpError(400, `Fascia ${i + 1}: inizio e fine coincidono.`, "DATI_NON_VALIDI", "fasce");
    }
    return { giornoInizio: f.giornoInizio, minutoInizio: mi, giornoFine: f.giornoFine, minutoFine: mf, attiva: f.attiva };
  });
  const prima = await leggiFasce();
  await db.transaction(async (tx) => {
    await tx.delete(finestreBloccoTable);
    if (nuove.length) await tx.insert(finestreBloccoTable).values(nuove);
    await registraLog(tx, contestoDa(req), {
      azione: "orari.modifica",
      entita: "orari",
      descrizione: nuove.length
        ? `Orari di caricamento: invio pratiche bloccato ${nuove.map(testo).join("; ")}`
        : "Orari di caricamento: nessuna fascia di blocco, invio sempre consentito",
      dettagli: { prima: prima.map(testo), dopo: nuove.map(testo) },
    });
  });
  res.json(await risposta());
});

export default router;
