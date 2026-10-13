import express, { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { CreateNewsBody, DeleteNewsParams, UpdateNewsBody, UpdateNewsParams } from "@workspace/api-zod";
import { db, newsAllegatiTable, newsTable, utentiTable } from "@workspace/db";
import { HttpError, nonTrovato } from "../lib/errori";
import { contestoDa, registraLog } from "../lib/log";
import { DIMENSIONE_MASSIMA_FILE, eliminaFile, leggiFile, salvaFile, validaFile } from "../lib/storage";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";
import { inviaFile } from "./tipi-pratica";

const router: IRouter = Router();

const MAX_TITOLO = 120;
const MAX_TESTO = 5000;
const MAX_ALLEGATI = 10;
const corpoFile = express.raw({ type: () => true, limit: DIMENSIONE_MASSIMA_FILE });
const BACKOFFICE = richiediRuolo("super_admin", "admin", "operatore");

const ordine = [desc(newsTable.inEvidenza), desc(newsTable.creataIl), desc(newsTable.id)];

const selezione = () =>
  db
    .select({ n: newsTable, autoreNome: utentiTable.nome, autoreCognome: utentiTable.cognome })
    .from(newsTable)
    .leftJoin(utentiTable, eq(utentiTable.id, newsTable.autoreUtenteId));

type Riga = Awaited<ReturnType<typeof selezione>>[number];

type Allegato = { id: number; nome: string; tipo: string; dimensione: number };

/** Allegati di piu' notizie, raggruppati per notizia. */
async function allegatiDi(ids: number[]): Promise<Map<number, Allegato[]>> {
  const mappa = new Map<number, Allegato[]>();
  if (!ids.length) return mappa;
  const righe = await db.select().from(newsAllegatiTable).where(inArray(newsAllegatiTable.newsId, ids)).orderBy(asc(newsAllegatiTable.id));
  for (const a of righe) {
    const l = mappa.get(a.newsId) ?? [];
    l.push({ id: a.id, nome: a.nome, tipo: a.tipo, dimensione: a.dimensione });
    mappa.set(a.newsId, l);
  }
  return mappa;
}

const mappaBackoffice = ({ n, autoreNome, autoreCognome }: Riga, allegati: Allegato[]) => ({
  allegati,
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
  const allegati = await allegatiDi(righe.map((n) => n.id));
  res.json(righe.map((n) => ({ id: n.id, titolo: n.titolo, testo: n.testo, inEvidenza: n.inEvidenza, pubblicataIl: n.creataIl.toISOString(), allegati: allegati.get(n.id) ?? [] })));
});

router.get("/backoffice/news", BACKOFFICE, async (_req, res) => {
  const righe = await selezione().orderBy(...ordine);
  const allegati = await allegatiDi(righe.map((r) => r.n.id));
  res.json(righe.map((r) => mappaBackoffice(r, allegati.get(r.n.id) ?? [])));
});

/** Scheda completa (con allegati) di una notizia, per rispondere dopo una modifica. */
async function scheda(id: number) {
  const r = await carica(id);
  return mappaBackoffice(r, (await allegatiDi([id])).get(id) ?? []);
}

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
  res.status(201).json(await scheda(id));
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
  res.json(await scheda(id));
});

router.delete("/backoffice/news/:id", BACKOFFICE, async (req, res) => {
  const { id } = valida(DeleteNewsParams, req.params);
  const { n } = await carica(id);
  const files = await db.select({ chiave: newsAllegatiTable.chiave }).from(newsAllegatiTable).where(eq(newsAllegatiTable.newsId, id));
  await db.transaction(async (tx) => {
    await tx.delete(newsTable).where(eq(newsTable.id, id));
    await registraLog(tx, contestoDa(req), {
      azione: "news.elimina",
      entita: "news",
      entitaId: id,
      descrizione: `Eliminata la notizia "${n.titolo}"`,
      dettagli: { titolo: n.titolo, allegati: files.length },
    });
  });
  for (const f of files) await eliminaFile(f.chiave, req.log);
  res.status(204).end();
});

// ---------------------------------------------------------------------------------------------
// Allegati: caricamento e cancellazione dal back office, scarico anche per i collaboratori
// ---------------------------------------------------------------------------------------------

const intero = (v: unknown, nome: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Parametro "${nome}" non valido.`, "DATI_NON_VALIDI", nome);
  return n;
};

router.post("/backoffice/news/:id/allegati", BACKOFFICE, corpoFile, async (req, res) => {
  const id = intero(req.params["id"], "id");
  const { n } = await carica(id);
  const [{ totale }] = await db.select({ totale: sql<number>`count(*)::int` }).from(newsAllegatiTable).where(eq(newsAllegatiTable.newsId, id)) as [{ totale: number }];
  if (totale >= MAX_ALLEGATI) throw new HttpError(400, `Una notizia può avere al massimo ${MAX_ALLEGATI} allegati.`, "TROPPI_ALLEGATI");
  const file = validaFile(req.query["nomeFile"], req.body);
  const chiave = await salvaFile(file.buffer, file.tipo);
  try {
    await db.transaction(async (tx) => {
      const [a] = await tx.insert(newsAllegatiTable).values({ newsId: id, nome: file.nome, tipo: file.tipo, dimensione: file.dimensione, chiave }).returning({ id: newsAllegatiTable.id });
      await registraLog(tx, contestoDa(req), {
        azione: "news.allegato_aggiungi",
        entita: "news",
        entitaId: id,
        descrizione: `Aggiunto l'allegato "${file.nome}" alla notizia "${n.titolo}"`,
        dettagli: { allegatoId: a!.id, fileNome: file.nome, dimensione: file.dimensione },
      });
    });
  } catch (err) {
    await eliminaFile(chiave, req.log);
    throw err;
  }
  res.status(201).json(await scheda(id));
});

router.delete("/backoffice/news/:id/allegati/:allegatoId", BACKOFFICE, async (req, res) => {
  const id = intero(req.params["id"], "id");
  const allegatoId = intero(req.params["allegatoId"], "allegatoId");
  const { n } = await carica(id);
  const [a] = await db.select().from(newsAllegatiTable).where(and(eq(newsAllegatiTable.id, allegatoId), eq(newsAllegatiTable.newsId, id)));
  if (!a) throw nonTrovato("Allegato non trovato.");
  await db.transaction(async (tx) => {
    await tx.delete(newsAllegatiTable).where(eq(newsAllegatiTable.id, allegatoId));
    await registraLog(tx, contestoDa(req), {
      azione: "news.allegato_elimina",
      entita: "news",
      entitaId: id,
      descrizione: `Eliminato l'allegato "${a.nome}" dalla notizia "${n.titolo}"`,
      dettagli: { allegatoId, fileNome: a.nome },
    });
  });
  await eliminaFile(a.chiave, req.log);
  res.json(await scheda(id));
});

async function scaricaAllegato(req: express.Request, res: express.Response, soloPubblicate: boolean) {
  const id = intero(req.params["id"], "id");
  const allegatoId = intero(req.params["allegatoId"], "allegatoId");
  const { n } = await carica(id);
  if (soloPubblicate && !n.pubblicata) throw nonTrovato("Notizia non trovata.");
  const [a] = await db.select().from(newsAllegatiTable).where(and(eq(newsAllegatiTable.id, allegatoId), eq(newsAllegatiTable.newsId, id)));
  if (!a) throw nonTrovato("Allegato non trovato.");
  const { stream } = await leggiFile(a.chiave);
  inviaFile(res, stream, a.nome, a.tipo, a.dimensione);
}

router.get("/backoffice/news/:id/allegati/:allegatoId/file", BACKOFFICE, (req, res) => scaricaAllegato(req, res, false));
router.get("/news/:id/allegati/:allegatoId/file", richiediRuolo("collaboratore"), (req, res) => scaricaAllegato(req, res, true));

export default router;
