import express, { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { ListMandatiQueryParams } from "@workspace/api-zod";
import { collaboratoriTable, db, mandatiTable, personeTable, tipiPraticaTable, utentiTable } from "@workspace/db";
import { HttpError, nonTrovato } from "../lib/errori";
import { contestoDa, registraLog } from "../lib/log";
import { codiceErrorePg } from "../lib/postgres";
import { DIMENSIONE_MASSIMA_FILE, eliminaFile, leggiFile, salvaFile, validaFile } from "../lib/storage";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";
import { inviaFile } from "./tipi-pratica";

const router: IRouter = Router();
router.use("/mandati", richiediRuolo("super_admin", "admin"));
const corpoFile = express.raw({ type: () => true, limit: DIMENSIONE_MASSIMA_FILE });

function selezione() {
  return db
    .select({
      id: mandatiTable.id,
      collaboratoreId: mandatiTable.collaboratoreId,
      tipoPraticaId: mandatiTable.tipoPraticaId,
      fileChiave: mandatiTable.fileChiave,
      fileNome: mandatiTable.fileNome,
      fileTipo: mandatiTable.fileTipo,
      fileDimensione: mandatiTable.fileDimensione,
      caricatoIl: mandatiTable.caricatoIl,
      utenteNome: utentiTable.nome,
      utenteCognome: utentiTable.cognome,
    })
    .from(mandatiTable)
    .leftJoin(utentiTable, eq(utentiTable.id, mandatiTable.caricatoDaUtenteId));
}

type Riga = Awaited<ReturnType<typeof selezione>>[number];
const mappa = (r: Riga) => ({
  id: r.id,
  collaboratoreId: r.collaboratoreId,
  tipoPraticaId: r.tipoPraticaId,
  fileNome: r.fileNome,
  fileTipo: r.fileTipo,
  dimensione: r.fileDimensione,
  caricatoIl: r.caricatoIl.toISOString(),
  caricatoDa: r.utenteCognome ? `${r.utenteCognome} ${r.utenteNome}` : null,
});

const intero = (v: unknown, nome: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Parametro "${nome}" non valido.`, "DATI_NON_VALIDI", nome);
  return n;
};

router.get("/mandati", async (req, res) => {
  const p = valida(ListMandatiQueryParams, req.query);
  const condizioni = [
    ...(p.collaboratoreId ? [eq(mandatiTable.collaboratoreId, p.collaboratoreId)] : []),
    ...(p.tipoPraticaId ? [eq(mandatiTable.tipoPraticaId, p.tipoPraticaId)] : []),
  ];
  const righe = await selezione().where(condizioni.length ? and(...condizioni) : undefined);
  res.json(righe.map(mappa));
});

router.get("/mandati/:id/file", async (req, res) => {
  const [m] = await db.select().from(mandatiTable).where(eq(mandatiTable.id, intero(req.params["id"], "id")));
  if (!m) throw nonTrovato("Mandato non trovato.");
  const { stream } = await leggiFile(m.fileChiave);
  inviaFile(res, stream, m.fileNome, m.fileTipo, m.fileDimensione);
});

/**
 * Carica o sostituisce il mandato di un collaboratore per un tipo di pratica. La sostituzione riguarda solo
 * quella coppia: gli altri collaboratori non cambiano.
 */
router.put("/mandati/file", corpoFile, async (req, res) => {
  const collaboratoreId = intero(req.query["collaboratoreId"], "collaboratoreId");
  const tipoPraticaId = intero(req.query["tipoPraticaId"], "tipoPraticaId");
  const [coll] = await db
    .select({ cognome: personeTable.cognome, nome: personeTable.nome, sportello: collaboratoriTable.numeroSportello })
    .from(collaboratoriTable)
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .where(eq(collaboratoriTable.id, collaboratoreId));
  if (!coll) throw nonTrovato("Collaboratore non trovato.");
  const [tipo] = await db.select().from(tipiPraticaTable).where(eq(tipiPraticaTable.id, tipoPraticaId));
  if (!tipo) throw nonTrovato("Tipo di pratica non trovato.");
  const file = validaFile(req.query["nomeFile"], req.body);
  const [esistente] = await db
    .select()
    .from(mandatiTable)
    .where(and(eq(mandatiTable.collaboratoreId, collaboratoreId), eq(mandatiTable.tipoPraticaId, tipoPraticaId)));
  const chiave = await salvaFile(file.buffer, file.tipo);
  const valori = {
    fileChiave: chiave, fileNome: file.nome, fileTipo: file.tipo, fileDimensione: file.dimensione,
    caricatoIl: new Date(), caricatoDaUtenteId: req.utente!.id,
  };
  const chi = `${coll.cognome} ${coll.nome} (sportello ${coll.sportello})`;
  let id: number;
  try {
    id = await db.transaction(async (tx) => {
      let mandatoId: number;
      if (esistente) {
        await tx.update(mandatiTable).set(valori).where(eq(mandatiTable.id, esistente.id));
        mandatoId = esistente.id;
      } else {
        const [n] = await tx.insert(mandatiTable).values({ collaboratoreId, tipoPraticaId, ...valori }).returning({ id: mandatiTable.id });
        mandatoId = n!.id;
      }
      await registraLog(tx, contestoDa(req), {
        azione: esistente ? "mandato.sostituisci" : "mandato.carica",
        entita: "mandato",
        entitaId: mandatoId,
        descrizione: esistente
          ? `Sostituito il mandato "${tipo.nome}" di ${chi}: ${esistente.fileNome} con ${file.nome}`
          : `Caricato il mandato "${tipo.nome}" per ${chi}: ${file.nome}`,
        dettagli: { collaboratoreId, tipoPraticaId, fileNome: file.nome, dimensione: file.dimensione, precedente: esistente?.fileNome ?? null },
      });
      return mandatoId;
    });
  } catch (err) {
    await eliminaFile(chiave, req.log);
    if (codiceErrorePg(err).code === "23505") {
      throw new HttpError(409, "Il mandato è stato caricato nel frattempo da un altro utente. Riprova.", "MANDATO_CONCORRENTE");
    }
    throw err;
  }
  if (esistente) await eliminaFile(esistente.fileChiave, req.log);
  const [r] = await selezione().where(eq(mandatiTable.id, id));
  res.status(esistente ? 200 : 201).json(mappa(r!));
});

export default router;
