import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { CreateNewsBody, DeleteNewsParams, UpdateNewsBody, UpdateNewsParams } from "@workspace/api-zod";
import { db, newsTable, utentiTable } from "@workspace/db";
import { HttpError, nonTrovato } from "../lib/errori";
import { contestoDa, registraLog } from "../lib/log";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();

const MAX_TITOLO = 120;
const MAX_TESTO = 5000;
const BACKOFFICE = richiediRuolo("super_admin", "admin", "operatore");

const ordine = [desc(newsTable.inEvidenza), desc(newsTable.creataIl), desc(newsTable.id)];

const selezione = () =>
  db
    .select({ n: newsTable, autoreNome: utentiTable.nome, autoreCognome: utentiTable.cognome })
    .from(newsTable)
    .leftJoin(utentiTable, eq(utentiTable.id, newsTable.autoreUtenteId));

type Riga = Awaited<ReturnType<typeof selezione>>[number];

const mappaBackoffice = ({ n, autoreNome, autoreCognome }: Riga) => ({
  id: n.id,
  titolo: n.titolo,
  testo: n.testo,
  pubblicata: n.pubblicata,
  inEvidenza: n.inEvidenza,
  creataIl: n.creataIl.toISOString(),
  modificataIl: n.modificataIl.toISOString(),
  autore: autoreCognome ? `${autoreCognome} ${autoreNome}` : null,
});

function pulisci(b: { titolo: string; testo: string }) {
  const titolo = b.titolo.replace(/\s+/g, " ").trim();
  const testo = b.testo.replace(/\r\n/g, "\n").trim();
  if (!titolo) throw new HttpError(400, "Il titolo è obbligatorio.", "DATI_NON_VALIDI", "titolo");
  if (titolo.length > MAX_TITOLO) throw new HttpError(400, `Il titolo può avere al massimo ${MAX_TITOLO} caratteri.`, "DATI_NON_VALIDI", "titolo");
  if (!testo) throw new HttpError(400, "Il testo è obbligatorio.", "DATI_NON_VALIDI", "testo");
  if (testo.length > MAX_TESTO) throw new HttpError(400, `Il testo può avere al massimo ${MAX_TESTO} caratteri.`, "DATI_NON_VALIDI", "testo");
  return { titolo, testo };
}

async function carica(id: number) {
  const [r] = await selezione().where(eq(newsTable.id, id));
  if (!r) throw nonTrovato("Notizia non trovata.");
  return r;
}

/** Home del collaboratore: solo le notizie pubblicate. */
router.get("/news", richiediRuolo("collaboratore"), async (_req, res) => {
  const righe = await db.select().from(newsTable).where(eq(newsTable.pubblicata, true)).orderBy(...ordine).limit(30);
  res.json(righe.map((n) => ({ id: n.id, titolo: n.titolo, testo: n.testo, inEvidenza: n.inEvidenza, pubblicataIl: n.creataIl.toISOString() })));
});

router.get("/backoffice/news", BACKOFFICE, async (_req, res) => {
  res.json((await selezione().orderBy(...ordine)).map(mappaBackoffice));
});

router.post("/backoffice/news", BACKOFFICE, async (req, res) => {
  const b = valida(CreateNewsBody, req.body);
  const { titolo, testo } = pulisci(b);
  const id = await db.transaction(async (tx) => {
    const [n] = await tx.insert(newsTable).values({ titolo, testo, pubblicata: b.pubblicata, inEvidenza: b.inEvidenza, autoreUtenteId: req.utente!.id }).returning({ id: newsTable.id });
    await registraLog(tx, contestoDa(req), {
      azione: "news.crea",
      entita: "news",
      entitaId: n!.id,
      descrizione: `Creata la notizia "${titolo}"${b.pubblicata ? "" : " (bozza)"}`,
      dettagli: { titolo, pubblicata: b.pubblicata, inEvidenza: b.inEvidenza },
    });
    return n!.id;
  });
  res.status(201).json(mappaBackoffice(await carica(id)));
});

router.put("/backoffice/news/:id", BACKOFFICE, async (req, res) => {
  const { id } = valida(UpdateNewsParams, req.params);
  const b = valida(UpdateNewsBody, req.body);
  const { titolo, testo } = pulisci(b);
  const { n: prima } = await carica(id);
  await db.transaction(async (tx) => {
    await tx.update(newsTable).set({ titolo, testo, pubblicata: b.pubblicata, inEvidenza: b.inEvidenza, modificataIl: new Date() }).where(eq(newsTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "news.modifica",
      entita: "news",
      entitaId: id,
      descrizione: `Modificata la notizia "${titolo}"`,
      dettagli: { titolo, pubblicata: { prima: prima.pubblicata, dopo: b.pubblicata }, inEvidenza: { prima: prima.inEvidenza, dopo: b.inEvidenza }, testoModificato: prima.testo !== testo },
    });
  });
  res.json(mappaBackoffice(await carica(id)));
});

router.delete("/backoffice/news/:id", BACKOFFICE, async (req, res) => {
  const { id } = valida(DeleteNewsParams, req.params);
  const { n } = await carica(id);
  await db.transaction(async (tx) => {
    await tx.delete(newsTable).where(eq(newsTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "news.elimina",
      entita: "news",
      entitaId: id,
      descrizione: `Eliminata la notizia "${n.titolo}"`,
      dettagli: { titolo: n.titolo },
    });
  });
  res.status(204).end();
});

export default router;
