import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import utentiRouter from "./utenti";
import collaboratoriRouter from "./collaboratori";
import luoghiRouter from "./luoghi";
import logRouter from "./log";
import { caricaUtente, controlloOrigine, richiediLogin, richiediPasswordCambiata } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);

// Da qui in poi: controllo origine (CSRF) e utente di sessione.
router.use(controlloOrigine);
router.use(caricaUtente);
router.use(authRouter);

// Tutto il resto richiede il login e la password gia' cambiata.
router.use(richiediLogin, richiediPasswordCambiata);
router.use(utentiRouter);
router.use(collaboratoriRouter);
router.use(luoghiRouter);
router.use(logRouter);

export default router;
