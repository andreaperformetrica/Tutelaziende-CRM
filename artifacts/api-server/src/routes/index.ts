import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import utentiRouter from "./utenti";
import collaboratoriRouter from "./collaboratori";
import assistitiRouter from "./assistiti";
import segnalazioniRouter from "./segnalazioni";
import tipiPraticaRouter from "./tipi-pratica";
import mandatiRouter from "./mandati";
import praticheRouter from "./pratiche";
import praticheBackofficeRouter from "./pratiche-backoffice";
import statiPraticaRouter from "./stati-pratica";
import orariRouter from "./orari";
import luoghiRouter from "./luoghi";
import logRouter from "./log";
import notificheRouter from "./notifiche";
import eventiBackofficeRouter from "./eventi-backoffice";
import eventiRouter from "./eventi";
import compensiRouter from "./compensi";
import newsRouter from "./news";
import avvisiRouter from "./avvisi";
import importazioniRouter from "./importazioni";
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
router.use(assistitiRouter);
router.use(segnalazioniRouter);
router.use(tipiPraticaRouter);
router.use(mandatiRouter);
router.use(praticheRouter);
router.use(praticheBackofficeRouter);
router.use(statiPraticaRouter);
router.use(orariRouter);
router.use(luoghiRouter);
router.use(logRouter);
router.use(notificheRouter);
router.use(eventiBackofficeRouter);
router.use(eventiRouter);
router.use(compensiRouter);
router.use(importazioniRouter);
router.use(newsRouter);
router.use(avvisiRouter);

export default router;
