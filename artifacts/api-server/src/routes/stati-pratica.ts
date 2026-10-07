import { Router, type IRouter } from "express";
import { asc, eq, sql } from "drizzle-orm";
import {
  CreateStatoPraticaBody,
  DeleteStatoPraticaParams,
  OrdinaStatiPraticaBody,
  UpdateStatoPraticaBody,
  UpdateStatoPraticaParams,
} from "@workspace/api-zod";
import { db, statiPraticaTable } from "@workspace/db";
import { controllaOrdine, pulisciNome } from "../lib/configurazione-pratiche";
import { HttpError, nonTrovato } from "../lib/errori";
import { contestoDa, registraLog } from "../lib/log";
import { codiceErrorePg } from "../lib/postgres";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();
router.use(["/stati-pratica", "/stati-pratica-ordine"], richiediRuolo("super_admin", "admin"));

const DUPLICATO = new HttpError(409, "Esiste già uno stato con questo nome.", "NOME_DUPLICATO", "nome");
const mappa = (s: typeof statiPraticaTable.$inferSelect) => ({ id: s.id, nome: s.nome, ordine: s.ordine, chiuso: s.chiuso });
const elenco = () => db.select().from(statiPraticaTable).orderBy(asc(statiPraticaTable.ordine), asc(statiPraticaTable.id));

async function carica(id: number) {
  const [s] = await db.select().from(statiPraticaTable).where(eq(statiPraticaTable.id, id));
  if (!s) throw nonTrovato("Stato non trovato.");
  return s;
}

router.get("/stati-pratica", async (_req, res) => {
  res.json((await elenco()).map(mappa));
});

router.post("/stati-pratica", async (req, res) => {
  const b = valida(CreateStatoPraticaBody, req.body);
  const nome = pulisciNome(b.nome, "Il nome dello stato", 60);
  try {
    const id = await db.transaction(async (tx) => {
      const [m] = await tx.select({ max: sql<number>`coalesce(max(${statiPraticaTable.ordine}), 0)::int` }).from(statiPraticaTable);
      const [s] = await tx
        .insert(statiPraticaTable)
        .values({ nome, chiuso: b.chiuso, ordine: (m?.max ?? 0) + 1 })
        .returning({ id: statiPraticaTable.id });
      await registraLog(tx, contestoDa(req), {
        azione: "stato_pratica.crea",
        entita: "stato_pratica",
        entitaId: s!.id,
        descrizione: `Creato lo stato pratica "${nome}"${b.chiuso ? " (conta come chiusa)" : ""}`,
        dettagli: { nome, chiuso: b.chiuso },
      });
      return s!.id;
    });
    res.status(201).json(mappa(await carica(id)));
  } catch (err) {
    if (codiceErrorePg(err).code === "23505") throw DUPLICATO;
    throw err;
  }
});

router.put("/stati-pratica-ordine", async (req, res) => {
  const { ids } = valida(OrdinaStatiPraticaBody, req.body);
  const attuali = await elenco();
  controllaOrdine(ids, attuali.map((s) => s.id));
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries()) await tx.update(statiPraticaTable).set({ ordine: i + 1 }).where(eq(statiPraticaTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "stato_pratica.ordina",
      entita: "stato_pratica",
      descrizione: "Riordinati gli stati pratica",
      dettagli: { ordine: ids },
    });
  });
  res.json((await elenco()).map(mappa));
});

router.put("/stati-pratica/:id", async (req, res) => {
  const { id } = valida(UpdateStatoPraticaParams, req.params);
  const b = valida(UpdateStatoPraticaBody, req.body);
  const nome = pulisciNome(b.nome, "Il nome dello stato", 60);
  const s = await carica(id);
  try {
    await db.transaction(async (tx) => {
      await tx.update(statiPraticaTable).set({ nome, chiuso: b.chiuso }).where(eq(statiPraticaTable.id, id));
      const modifiche = [
        ...(s.nome !== nome ? [`rinominato in "${nome}"`] : []),
        ...(s.chiuso !== b.chiuso ? [b.chiuso ? "ora conta come chiusa" : "non conta più come chiusa"] : []),
      ];
      await registraLog(tx, contestoDa(req), {
        azione: "stato_pratica.modifica",
        entita: "stato_pratica",
        entitaId: id,
        descrizione: `Stato pratica "${s.nome}": ${modifiche.length ? modifiche.join(", ") : "salvato senza modifiche"}`,
        dettagli: { prima: { nome: s.nome, chiuso: s.chiuso }, dopo: { nome, chiuso: b.chiuso } },
      });
    });
  } catch (err) {
    if (codiceErrorePg(err).code === "23505") throw DUPLICATO;
    throw err;
  }
  res.json(mappa(await carica(id)));
});

router.delete("/stati-pratica/:id", async (req, res) => {
  const { id } = valida(DeleteStatoPraticaParams, req.params);
  const s = await carica(id);
  // Quando esisteranno le pratiche, qui va bloccata l'eliminazione di uno stato in uso.
  await db.transaction(async (tx) => {
    await tx.delete(statiPraticaTable).where(eq(statiPraticaTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "stato_pratica.elimina",
      entita: "stato_pratica",
      entitaId: id,
      descrizione: `Eliminato lo stato pratica "${s.nome}"`,
      dettagli: { nome: s.nome, chiuso: s.chiuso },
    });
  });
  res.status(204).end();
});

export default router;
