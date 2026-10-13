import { Router, type IRouter } from "express";
import { avvisiCollaboratore } from "../lib/avvisi";
import { mioCollaboratoreId } from "../lib/pratiche";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();

/** Novita' della home del collaboratore: solo lettura, calcolate dai dati esistenti. */
router.get("/avvisi", richiediRuolo("collaboratore"), async (req, res) => {
  res.json(await avvisiCollaboratore(mioCollaboratoreId(req)));
});

export default router;
