import { Router, type IRouter } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { CreateCategoriaAllegatoBody, DeleteCategoriaAllegatoParams, UpdateCategoriaAllegatoBody, UpdateCategoriaAllegatoParams } from "@workspace/api-zod";
import { categorieAllegatoTable, db, documentiPraticaTable } from "@workspace/db";
import { pulisciNome } from "../lib/configurazione-pratiche";
import { HttpError, nonTrovato } from "../lib/errori";
import { contestoDa, registraLog } from "../lib/log";
import { codiceErrorePg } from "../lib/postgres";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();

const DUPLICATO = new HttpError(409, "Esiste già una categoria con questo nome.", "NOME_DUPLICATO", "nome");
const mappa = (c: typeof categorieAllegatoTable.$inferSelect) => ({ id: c.id, nome: c.nome });

async function carica(id: number) {
  const [c] = await db.select().from(categorieAllegatoTable).where(eq(categorieAllegatoTable.id, id));
  if (!c) throw nonTrovato("Categoria non trovata.");
  return c;
}

/** Le categorie servono a tutto il back office (menu dell'allegato); le modifiche sono dell'admin. */
router.get("/categorie-allegato", richiediRuolo("super_admin", "admin", "operatore"), async (_req, res) => {
  const righe = await db.select().from(categorieAllegatoTable).orderBy(sql`lower(${categorieAllegatoTable.nome})`, asc(categorieAllegatoTable.id));
  res.json(righe.map(mappa));
});

router.post("/categorie-allegato", richiediRuolo("super_admin", "admin"), async (req, res) => {
  const b = valida(CreateCategoriaAllegatoBody, req.body);
  const nome = pulisciNome(b.nome, "Il nome della categoria", 60);
  try {
    const c = await db.transaction(async (tx) => {
      const [r] = await tx.insert(categorieAllegatoTable).values({ nome }).returning();
      await registraLog(tx, contestoDa(req), {
        azione: "categoria_allegato.crea",
        entita: "categoria_allegato",
        entitaId: r!.id,
        descrizione: `Creata la categoria di allegato "${nome}"`,
        dettagli: { nome },
      });
      return r!;
    });
    res.status(201).json(mappa(c));
  } catch (err) {
    if (codiceErrorePg(err).code === "23505") throw DUPLICATO;
    throw err;
  }
});

router.put("/categorie-allegato/:id", richiediRuolo("super_admin", "admin"), async (req, res) => {
  const { id } = valida(UpdateCategoriaAllegatoParams, req.params);
  const b = valida(UpdateCategoriaAllegatoBody, req.body);
  const nome = pulisciNome(b.nome, "Il nome della categoria", 60);
  const prima = await carica(id);
  try {
    await db.transaction(async (tx) => {
      await tx.update(categorieAllegatoTable).set({ nome }).where(eq(categorieAllegatoTable.id, id));
      await registraLog(tx, contestoDa(req), {
        azione: "categoria_allegato.modifica",
        entita: "categoria_allegato",
        entitaId: id,
        descrizione: `Rinominata la categoria di allegato "${prima.nome}" in "${nome}"`,
        dettagli: { prima: prima.nome, dopo: nome },
      });
    });
  } catch (err) {
    if (codiceErrorePg(err).code === "23505") throw DUPLICATO;
    throw err;
  }
  res.json(mappa(await carica(id)));
});

router.delete("/categorie-allegato/:id", richiediRuolo("super_admin", "admin"), async (req, res) => {
  const { id } = valida(DeleteCategoriaAllegatoParams, req.params);
  const c = await carica(id);
  const [uso] = await db.select({ n: sql<number>`count(*)::int` }).from(documentiPraticaTable).where(eq(documentiPraticaTable.categoriaId, id));
  if ((uso?.n ?? 0) > 0) {
    throw new HttpError(409, `La categoria è usata da ${uso!.n} ${uso!.n === 1 ? "allegato" : "allegati"} e non può essere eliminata.`, "CATEGORIA_IN_USO");
  }
  await db.transaction(async (tx) => {
    await tx.delete(categorieAllegatoTable).where(eq(categorieAllegatoTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "categoria_allegato.elimina",
      entita: "categoria_allegato",
      entitaId: id,
      descrizione: `Eliminata la categoria di allegato "${c.nome}"`,
    });
  });
  res.status(204).end();
});

export default router;
