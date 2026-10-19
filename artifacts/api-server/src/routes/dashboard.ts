import { Router, type IRouter } from "express";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  assistitiTable,
  commentiPraticaTable,
  db,
  personeTable,
  praticheTable,
  statiPraticaTable,
  tipiPraticaTable,
  utentiTable,
} from "@workspace/db";
import { scadenzeInCarico } from "../lib/scadenze";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/backoffice/dashboard", richiediRuolo("super_admin", "admin", "operatore"));

const ELENCO_MAX = 6;
const aperta = sql`coalesce(${statiPraticaTable.chiuso}, false) = false`;

/** Riepilogo di lavoro dell'utente: pratiche in carico, nuove da prendere, commenti senza risposta, scadenze vicine. */
router.get("/backoffice/dashboard", async (req, res) => {
  const io = req.utente!.id;

  const [inCarico] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(praticheTable)
    .leftJoin(statiPraticaTable, eq(statiPraticaTable.id, praticheTable.statoId))
    .where(and(eq(praticheTable.gestitaDaUtenteId, io), isNotNull(praticheTable.inviataIl), aperta));

  const nuoveWhere = and(isNull(praticheTable.gestitaDaUtenteId), isNotNull(praticheTable.inviataIl), aperta);
  const [nuove] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(praticheTable)
    .leftJoin(statiPraticaTable, eq(statiPraticaTable.id, praticheTable.statoId))
    .where(nuoveWhere);
  const nuoveRighe = await db
    .select({
      id: praticheTable.id,
      numero: praticheTable.numero,
      data: praticheTable.inviataIl,
      tipoNome: tipiPraticaTable.nome,
      nome: personeTable.nome,
      cognome: personeTable.cognome,
    })
    .from(praticheTable)
    .innerJoin(tipiPraticaTable, eq(tipiPraticaTable.id, praticheTable.tipoPraticaId))
    .innerJoin(assistitiTable, eq(assistitiTable.id, praticheTable.assistitoId))
    .innerJoin(personeTable, eq(personeTable.id, assistitiTable.personaId))
    .leftJoin(statiPraticaTable, eq(statiPraticaTable.id, praticheTable.statoId))
    .where(nuoveWhere)
    .orderBy(asc(praticheTable.inviataIl), asc(praticheTable.id))
    .limit(ELENCO_MAX);

  // Pratiche in carico a me il cui ultimo commento e' di un collaboratore: aspettano una risposta dell'ufficio.
  const ultimoCommento = db
    .select({ praticaId: commentiPraticaTable.praticaId, maxId: sql<number>`max(${commentiPraticaTable.id})`.as("max_id") })
    .from(commentiPraticaTable)
    .groupBy(commentiPraticaTable.praticaId)
    .as("ultimo");
  const senzaRispostaBase = db
    .select({
      id: praticheTable.id,
      numero: praticheTable.numero,
      data: commentiPraticaTable.creatoIl,
      tipoNome: tipiPraticaTable.nome,
      nome: personeTable.nome,
      cognome: personeTable.cognome,
    })
    .from(praticheTable)
    .innerJoin(ultimoCommento, eq(ultimoCommento.praticaId, praticheTable.id))
    .innerJoin(commentiPraticaTable, eq(commentiPraticaTable.id, ultimoCommento.maxId))
    .innerJoin(utentiTable, eq(utentiTable.id, commentiPraticaTable.utenteId))
    .innerJoin(tipiPraticaTable, eq(tipiPraticaTable.id, praticheTable.tipoPraticaId))
    .innerJoin(assistitiTable, eq(assistitiTable.id, praticheTable.assistitoId))
    .innerJoin(personeTable, eq(personeTable.id, assistitiTable.personaId))
    .leftJoin(statiPraticaTable, eq(statiPraticaTable.id, praticheTable.statoId))
    .where(and(eq(praticheTable.gestitaDaUtenteId, io), isNotNull(praticheTable.inviataIl), aperta, eq(utentiTable.ruolo, "collaboratore")))
    .orderBy(asc(commentiPraticaTable.creatoIl));
  const senzaRisposta = await senzaRispostaBase;

  const scadenze = await scadenzeInCarico(io);
  const comeVista = (r: { id: number; numero: number | null; data: Date | null; tipoNome: string; nome: string; cognome: string }) => ({
    id: r.id,
    numero: r.numero!,
    assistito: `${r.cognome} ${r.nome}`.toUpperCase(),
    tipoNome: r.tipoNome,
    data: (r.data ?? new Date()).toISOString(),
    dettaglio: null,
  });
  res.json({
    inCarico: inCarico?.n ?? 0,
    nuove: nuove?.n ?? 0,
    commentiSenzaRisposta: senzaRisposta.length,
    scadenze: scadenze.length,
    nuoveElenco: nuoveRighe.map(comeVista),
    commentiElenco: senzaRisposta.slice(0, ELENCO_MAX).map(comeVista),
    scadenzeElenco: scadenze.slice(0, ELENCO_MAX),
  });
});

export default router;
