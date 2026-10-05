import { Router, type IRouter } from "express";
import { CercaLuoghiQueryParams } from "@workspace/api-zod";
import { cercaLuoghi, elencoNazionalita } from "../lib/luoghi";
import { valida } from "../lib/validazione";

const router: IRouter = Router();

router.get("/luoghi", (req, res) => {
  const { q, tipo } = valida(CercaLuoghiQueryParams, req.query);
  res.json(cercaLuoghi(q, tipo));
});

router.get("/nazionalita", (_req, res) => {
  res.json(elencoNazionalita());
});

export default router;
