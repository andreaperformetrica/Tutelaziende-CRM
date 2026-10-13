import express, { Router, type IRouter } from "express";
import { count, eq, sql } from "drizzle-orm";
import {
  AssegnaMandatoBody,
  DeleteMandatoParams,
  ListAssegnazioniMandatoQueryParams,
  RimuoviAssegnazioneMandatoQueryParams,
  RinominaMandatoBody,
  RinominaMandatoParams,
} from "@workspace/api-zod";
import { assegnazioniMandatoTable, collaboratoriTable, db, mandatiTable, personeTable, utentiTable } from "@workspace/db";
import { pulisciNome } from "../lib/configurazione-pratiche";
import { HttpError, nonTrovato } from "../lib/errori";
import { contestoDa, registraLog } from "../lib/log";
import { CAMPI_MANDATO, controllaModello } from "../lib/mandato-compilato";
import { codiceErrorePg } from "../lib/postgres";
import { DIMENSIONE_MASSIMA_FILE, eliminaFile, leggiFile, salvaFile, validaFile } from "../lib/storage";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";
import { inviaFile } from "./tipi-pratica";

const router: IRouter = Router();
router.use(["/mandati", "/assegnazioni-mandato"], richiediRuolo("super_admin", "admin"));
const corpoFile = express.raw({ type: () => true, limit: DIMENSIONE_MASSIMA_FILE });

const DUPLICATO = new HttpError(409, "Esiste già un mandato con questo nome.", "NOME_DUPLICATO", "nome");

const assegnati = sql<number>`(select count(*)::int from ${assegnazioniMandatoTable} where ${assegnazioniMandatoTable.mandatoId} = ${mandatiTable.id})`;

function selezione() {
  return db
    .select({
      id: mandatiTable.id,
      nome: mandatiTable.nome,
      fileNome: mandatiTable.fileNome,
      fileTipo: mandatiTable.fileTipo,
      fileDimensione: mandatiTable.fileDimensione,
      caricatoIl: mandatiTable.caricatoIl,
      utenteNome: utentiTable.nome,
      utenteCognome: utentiTable.cognome,
      assegnati,
    })
    .from(mandatiTable)
    .leftJoin(utentiTable, eq(utentiTable.id, mandatiTable.caricatoDaUtenteId));
}

type Riga = Awaited<ReturnType<typeof selezione>>[number];
const mappa = (r: Riga) => ({
  id: r.id,
  nome: r.nome,
  fileNome: r.fileNome,
  fileTipo: r.fileTipo,
  dimensione: r.fileDimensione,
  caricatoIl: r.caricatoIl.toISOString(),
  caricatoDa: r.utenteCognome ? `${r.utenteCognome} ${r.utenteNome}` : null,
  collaboratoriAssegnati: r.assegnati,
});

const intero = (v: unknown, nome: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Parametro "${nome}" non valido.`, "DATI_NON_VALIDI", nome);
  return n;
};

async function caricaMandato(id: number) {
  const [m] = await db.select().from(mandatiTable).where(eq(mandatiTable.id, id));
  if (!m) throw nonTrovato("Mandato non trovato.");
  return m;
}

async function caricaCollaboratore(id: number) {
  const [c] = await db
    .select({ id: collaboratoriTable.id, cognome: personeTable.cognome, nome: personeTable.nome, sportello: collaboratoriTable.numeroSportello })
    .from(collaboratoriTable)
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .where(eq(collaboratoriTable.id, id));
  if (!c) throw nonTrovato("Collaboratore non trovato.");
  return c;
}

const chiEIl = (c: { cognome: string; nome: string; sportello: string }) => `${c.cognome} ${c.nome} (sportello ${c.sportello})`;

async function mandatoMappato(id: number) {
  const [r] = await selezione().where(eq(mandatiTable.id, id));
  return mappa(r!);
}

router.get("/mandati", async (_req, res) => {
  const righe = await selezione().orderBy(sql`lower(${mandatiTable.nome})`);
  res.json(righe.map(mappa));
});

/** Il modello deve essere un Word e i campi @gruppo.nome devono essere tra quelli che il sistema sa compilare. */
async function validaModello(file: { nome: string; buffer: Buffer }) {
  if (!/\.docx$/i.test(file.nome)) {
    throw new HttpError(400, "Il mandato deve essere un documento Word (.docx) con i campi da compilare.", "FILE_FORMATO_NON_AMMESSO");
  }
  const { trovati, sconosciuti } = await controllaModello(file.buffer);
  if (sconosciuti.length) {
    throw new HttpError(400, `Il modello contiene campi che non conosco: ${sconosciuti.join(", ")}. Campi ammessi: ${CAMPI_MANDATO.map((c) => `@${c}`).join(", ")}.`, "FILE_NON_VALIDO");
  }
  if (!trovati.length) {
    throw new HttpError(400, "Nel modello non c'è nessun campo da compilare (per esempio @cliente.cognome).", "FILE_NON_VALIDO");
  }
}

router.get("/mandati/:id/file", async (req, res) => {
  const m = await caricaMandato(intero(req.params["id"], "id"));
  const { stream } = await leggiFile(m.fileChiave);
  inviaFile(res, stream, m.fileNome, m.fileTipo, m.fileDimensione);
});

/** Aggiunge un mandato (modello Word) alla raccolta. */
router.post("/mandati/file", corpoFile, async (req, res) => {
  const file = validaFile(req.query["nomeFile"], req.body);
  await validaModello(file);
  const nome = pulisciNome(req.query["nome"] ?? file.nome.replace(/\.[^.]+$/, ""), "Il nome del mandato", 100);
  const chiave = await salvaFile(file.buffer, file.tipo);
  try {
    const id = await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(mandatiTable)
        .values({
          nome, fileChiave: chiave, fileNome: file.nome, fileTipo: file.tipo, fileDimensione: file.dimensione,
          caricatoDaUtenteId: req.utente!.id,
        })
        .returning({ id: mandatiTable.id });
      await registraLog(tx, contestoDa(req), {
        azione: "mandato.carica",
        entita: "mandato",
        entitaId: m!.id,
        descrizione: `Caricato il mandato "${nome}" (${file.nome})`,
        dettagli: { nome, fileNome: file.nome, dimensione: file.dimensione },
      });
      return m!.id;
    });
    res.status(201).json(await mandatoMappato(id));
  } catch (err) {
    await eliminaFile(chiave, req.log);
    if (codiceErrorePg(err).code === "23505") throw DUPLICATO;
    throw err;
  }
});

/** Sostituisce il file di un mandato: il cambio vale per tutti i collaboratori a cui e' assegnato. */
router.put("/mandati/:id/file", corpoFile, async (req, res) => {
  const m = await caricaMandato(intero(req.params["id"], "id"));
  const file = validaFile(req.query["nomeFile"], req.body);
  await validaModello(file);
  const chiave = await salvaFile(file.buffer, file.tipo);
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(mandatiTable)
        .set({
          fileChiave: chiave, fileNome: file.nome, fileTipo: file.tipo, fileDimensione: file.dimensione,
          caricatoIl: new Date(), caricatoDaUtenteId: req.utente!.id,
        })
        .where(eq(mandatiTable.id, m.id));
      const [n] = await tx.select({ n: count() }).from(assegnazioniMandatoTable).where(eq(assegnazioniMandatoTable.mandatoId, m.id));
      await registraLog(tx, contestoDa(req), {
        azione: "mandato.sostituisci",
        entita: "mandato",
        entitaId: m.id,
        descrizione: `Sostituito il file del mandato "${m.nome}": ${m.fileNome} con ${file.nome}; vale per ${n?.n ?? 0} ${n?.n === 1 ? "collaboratore" : "collaboratori"}`,
        dettagli: { precedente: m.fileNome, fileNome: file.nome, dimensione: file.dimensione, collaboratoriAssegnati: n?.n ?? 0 },
      });
    });
  } catch (err) {
    await eliminaFile(chiave, req.log);
    throw err;
  }
  await eliminaFile(m.fileChiave, req.log);
  res.json(await mandatoMappato(m.id));
});

router.patch("/mandati/:id", async (req, res) => {
  const { id } = valida(RinominaMandatoParams, req.params);
  const b = valida(RinominaMandatoBody, req.body);
  const m = await caricaMandato(id);
  const nome = pulisciNome(b.nome, "Il nome del mandato", 100);
  try {
    await db.transaction(async (tx) => {
      await tx.update(mandatiTable).set({ nome }).where(eq(mandatiTable.id, id));
      await registraLog(tx, contestoDa(req), {
        azione: "mandato.rinomina",
        entita: "mandato",
        entitaId: id,
        descrizione: `Rinominato il mandato "${m.nome}" in "${nome}"`,
        dettagli: { prima: m.nome, dopo: nome },
      });
    });
  } catch (err) {
    if (codiceErrorePg(err).code === "23505") throw DUPLICATO;
    throw err;
  }
  res.json(await mandatoMappato(id));
});

router.delete("/mandati/:id", async (req, res) => {
  const { id } = valida(DeleteMandatoParams, req.params);
  const m = await caricaMandato(id);
  const [n] = await db.select({ n: count() }).from(assegnazioniMandatoTable).where(eq(assegnazioniMandatoTable.mandatoId, id));
  const inUso = new HttpError(
    409,
    `Il mandato è assegnato a ${n?.n ?? 0} ${n?.n === 1 ? "collaboratore" : "collaboratori"}: assegna un altro mandato prima di eliminarlo.`,
    "MANDATO_IN_USO",
  );
  if ((n?.n ?? 0) > 0) throw inUso;
  try {
    await db.transaction(async (tx) => {
      await tx.delete(mandatiTable).where(eq(mandatiTable.id, id));
      await registraLog(tx, contestoDa(req), {
        azione: "mandato.elimina",
        entita: "mandato",
        entitaId: id,
        descrizione: `Eliminato il mandato "${m.nome}" (${m.fileNome})`,
        dettagli: { nome: m.nome, fileNome: m.fileNome },
      });
    });
  } catch (err) {
    if (codiceErrorePg(err).code === "23503") {
      throw new HttpError(409, "Il mandato è stato usato in pratiche già inviate e non può essere eliminato.", "MANDATO_IN_USO");
    }
    throw err;
  }
  await eliminaFile(m.fileChiave, req.log);
  res.status(204).end();
});

const mappaAssegnazione = (a: typeof assegnazioniMandatoTable.$inferSelect) => ({
  collaboratoreId: a.collaboratoreId,
  mandatoId: a.mandatoId,
});

router.get("/assegnazioni-mandato", async (req, res) => {
  const p = valida(ListAssegnazioniMandatoQueryParams, req.query);
  const righe = await db
    .select()
    .from(assegnazioniMandatoTable)
    .where(p.collaboratoreId ? eq(assegnazioniMandatoTable.collaboratoreId, p.collaboratoreId) : undefined);
  res.json(righe.map(mappaAssegnazione));
});

async function mandatoAssegnato(collaboratoreId: number) {
  const [r] = await db
    .select({ id: mandatiTable.id, nome: mandatiTable.nome })
    .from(assegnazioniMandatoTable)
    .innerJoin(mandatiTable, eq(mandatiTable.id, assegnazioniMandatoTable.mandatoId))
    .where(eq(assegnazioniMandatoTable.collaboratoreId, collaboratoreId));
  return r;
}

/** Assegna a un collaboratore il mandato della sua sede; se ne ha gia' uno, lo cambia. Vale per tutti i tipi di pratica. */
router.put("/assegnazioni-mandato", async (req, res) => {
  const b = valida(AssegnaMandatoBody, req.body);
  const coll = await caricaCollaboratore(b.collaboratoreId);
  const m = await caricaMandato(b.mandatoId);
  const prima = await mandatoAssegnato(coll.id);
  const a = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(assegnazioniMandatoTable)
      .values({ collaboratoreId: coll.id, mandatoId: m.id })
      .onConflictDoUpdate({ target: [assegnazioniMandatoTable.collaboratoreId], set: { mandatoId: m.id, assegnatoIl: new Date() } })
      .returning();
    if (!prima || prima.id !== m.id) {
      await registraLog(tx, contestoDa(req), {
        azione: "mandato.assegna",
        entita: "mandato",
        entitaId: m.id,
        descrizione: prima
          ? `Cambiato il mandato di ${chiEIl(coll)}: da "${prima.nome}" a "${m.nome}"`
          : `Assegnato il mandato "${m.nome}" a ${chiEIl(coll)}`,
        dettagli: { collaboratoreId: coll.id, mandatoId: m.id, precedenteMandatoId: prima?.id ?? null },
      });
    }
    return r!;
  });
  res.json(mappaAssegnazione(a));
});

router.delete("/assegnazioni-mandato", async (req, res) => {
  const p = valida(RimuoviAssegnazioneMandatoQueryParams, req.query);
  const coll = await caricaCollaboratore(p.collaboratoreId);
  const prima = await mandatoAssegnato(coll.id);
  if (!prima) throw nonTrovato("A questo collaboratore non è assegnato nessun mandato.");
  await db.transaction(async (tx) => {
    await tx.delete(assegnazioniMandatoTable).where(eq(assegnazioniMandatoTable.collaboratoreId, coll.id));
    await registraLog(tx, contestoDa(req), {
      azione: "mandato.rimuovi",
      entita: "mandato",
      entitaId: prima.id,
      descrizione: `Tolto il mandato "${prima.nome}" a ${chiEIl(coll)}`,
      dettagli: { collaboratoreId: coll.id, mandatoId: prima.id },
    });
  });
  res.status(204).end();
});

export default router;
