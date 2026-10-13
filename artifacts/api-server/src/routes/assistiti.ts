import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  AssociaAssistitoACollaboratoreBody,
  AssociaAssistitoACollaboratoreParams,
  CreateAssistitoBody,
  GetAssistitoParams,
  ListAssistitiQueryParams,
  UpdateAssistitoBody,
  UpdateAssistitoParams,
} from "@workspace/api-zod";
import { assistitiTable, db, personeTable } from "@workspace/db";
import {
  caricaAssistitoVisibile,
  controllaDestinazione,
  condizioneRicerca,
  condizioneVisibilita,
  contaAssistiti,
  controllaDuplicatiAssistito,
  mappaAssistito,
  riassegnaInTransazione,
  selezionaAssistiti,
} from "../lib/assistiti";
import { HttpError, nonAutorizzato } from "../lib/errori";
import { contestoDa, differenze, registraLog } from "../lib/log";
import { erroreDuplicatoDb, normalizzaAnagrafica, type AnagraficaNormalizzata } from "../lib/persone";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();
const soloCollaboratore = richiediRuolo("collaboratore");
const soloBackofficeScrittura = richiediRuolo("super_admin", "admin");

function pulisciCitta(valore: string): string {
  const c = valore.trim();
  if (!c) throw new HttpError(400, "La città è obbligatoria.", "DATI_NON_VALIDI", "citta");
  return c;
}

function pulisciIndirizzo(valore: string): string {
  const i = valore.replace(/\s+/g, " ").trim();
  if (!i) throw new HttpError(400, "L'indirizzo è obbligatorio.", "DATI_NON_VALIDI", "indirizzo");
  return i;
}

function pulisciCap(valore: string): string {
  const c = valore.trim();
  if (!/^\d{5}$/.test(c)) throw new HttpError(400, "Il CAP deve essere di 5 cifre.", "DATI_NON_VALIDI", "cap");
  return c;
}

function pulisciProvincia(valore: string): string {
  const p = valore.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(p)) throw new HttpError(400, "La provincia deve essere indicata con la sigla di 2 lettere (es. RM).", "DATI_NON_VALIDI", "provincia");
  return p;
}

interface Residenza { citta: string; indirizzo: string; cap: string; provincia: string }

function pulisciResidenza(d: { citta: string; indirizzo: string; cap: string; provincia: string }): Residenza {
  return { citta: pulisciCitta(d.citta), indirizzo: pulisciIndirizzo(d.indirizzo), cap: pulisciCap(d.cap), provincia: pulisciProvincia(d.provincia) };
}

const ETICHETTE_CAMPI: Record<string, string> = {
  nome: "nome",
  cognome: "cognome",
  sesso: "sesso",
  dataNascita: "data di nascita",
  luogoNascitaCodice: "luogo di nascita",
  nazionalita: "nazionalita",
  codiceFiscale: "codice fiscale",
  cellulare: "cellulare",
  email: "email",
  partitaIva: "partita IVA",
  citta: "citta",
  provincia: "provincia",
  cap: "CAP",
  indirizzo: "indirizzo",
};

function piatto(a: Record<string, unknown>, res: { citta: string; indirizzo: string | null; cap: string | null; provincia: string | null }): Record<string, unknown> {
  const r: Record<string, unknown> = { citta: res.citta, indirizzo: res.indirizzo, cap: res.cap, provincia: res.provincia };
  for (const k of Object.keys(ETICHETTE_CAMPI)) if (!(k in r)) r[k] = a[k] ?? null;
  return r;
}

router.get("/assistiti", async (req, res) => {
  const p = valida(ListAssistitiQueryParams, req.query);
  const pagina = p.pagina ?? 1;
  const perPagina = p.perPagina ?? 50;
  const where = and(
    condizioneVisibilita(req),
    condizioneRicerca(p.q),
    p.collaboratoreId !== undefined ? eq(assistitiTable.collaboratoreId, p.collaboratoreId) : undefined,
  );
  const [totale, righe] = await Promise.all([
    contaAssistiti(where),
    selezionaAssistiti(where)
      .limit(perPagina)
      .offset((pagina - 1) * perPagina),
  ]);
  res.json({ elementi: righe.map((r) => mappaAssistito(r, req)), totale, pagina, perPagina });
});

router.get("/assistiti/:id", async (req, res) => {
  const { id } = valida(GetAssistitoParams, req.params);
  res.json(mappaAssistito(await caricaAssistitoVisibile(req, id), req));
});

router.post("/assistiti", soloCollaboratore, async (req, res) => {
  const dati = valida(CreateAssistitoBody, req.body);
  const anagrafica = normalizzaAnagrafica(dati, { emailObbligatoria: false });
  const residenza = pulisciResidenza(dati);
  const { citta, indirizzo } = residenza;
  const u = req.utente!;

  await controllaDuplicatiAssistito(req, anagrafica, { citta, indirizzo }, "creare");

  let id: number;
  try {
    id = await db.transaction(async (tx) => {
      const [persona] = await tx.insert(personeTable).values(anagrafica).returning({ id: personeTable.id });
      const [assistito] = await tx
        .insert(assistitiTable)
        .values({ personaId: persona!.id, collaboratoreId: u.collaboratoreId!, ...residenza, creatoDaUtenteId: u.id })
        .returning({ id: assistitiTable.id });
      await registraLog(tx, contestoDa(req), {
        azione: "assistito.crea",
        entita: "assistito",
        entitaId: assistito!.id,
        descrizione: `Creato l'assistito ${anagrafica.cognome} ${anagrafica.nome} (codice fiscale ${anagrafica.codiceFiscale}) per il collaboratore n. ${u.collaboratoreId}`,
        dettagli: { codiceFiscale: anagrafica.codiceFiscale, collaboratoreId: u.collaboratoreId, citta },
      });
      return assistito!.id;
    });
  } catch (err) {
    // Concorrenza: un'altra richiesta ha inserito la stessa persona dopo il controllo.
    if (erroreDuplicatoDb(err)) {
      await controllaDuplicatiAssistito(req, anagrafica, { citta, indirizzo }, "creare");
    }
    throw err;
  }
  res.status(201).json(mappaAssistito(await caricaAssistitoVisibile(req, id), req));
});

router.put("/assistiti/:id", soloCollaboratore, async (req, res) => {
  const { id } = valida(UpdateAssistitoParams, req.params);
  const dati = valida(UpdateAssistitoBody, req.body);
  const prima = await caricaAssistitoVisibile(req, id);
  const u = req.utente!;
  if (prima.collaboratoreId !== u.collaboratoreId) {
    throw nonAutorizzato("Puoi modificare solo i tuoi assistiti.");
  }
  const anagrafica: AnagraficaNormalizzata = normalizzaAnagrafica(dati, { emailObbligatoria: false });
  const residenza = pulisciResidenza(dati);
  const { citta, indirizzo } = residenza;

  await controllaDuplicatiAssistito(req, anagrafica, { citta, indirizzo }, "modificare", prima.personaId);

  const diff = differenze(piatto(prima, prima), piatto(anagrafica, residenza), ETICHETTE_CAMPI);
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(personeTable)
        .set({ ...anagrafica, modificatoIl: sql`now()` })
        .where(eq(personeTable.id, prima.personaId));
      await tx.update(assistitiTable).set({ ...residenza, modificatoIl: sql`now()` }).where(eq(assistitiTable.id, id));
      if (diff.elenco.length > 0) {
        await registraLog(tx, contestoDa(req), {
          azione: "assistito.modifica",
          entita: "assistito",
          entitaId: id,
          descrizione: `Modificato l'assistito ${anagrafica.cognome} ${anagrafica.nome}: ${diff.elenco.join(", ")}`,
          dettagli: { prima: diff.prima, dopo: diff.dopo },
        });
      }
    });
  } catch (err) {
    if (erroreDuplicatoDb(err)) {
      await controllaDuplicatiAssistito(req, anagrafica, { citta, indirizzo }, "modificare", prima.personaId);
    }
    throw err;
  }
  res.json(mappaAssistito(await caricaAssistitoVisibile(req, id), req));
});

router.post("/assistiti/:id/collaboratore", soloBackofficeScrittura, async (req, res) => {
  const { id } = valida(AssociaAssistitoACollaboratoreParams, req.params);
  const { collaboratoreId } = valida(AssociaAssistitoACollaboratoreBody, req.body);
  const prima = await caricaAssistitoVisibile(req, id);
  if (prima.collaboratoreId === collaboratoreId) {
    throw new HttpError(400, "L'assistito è già associato a questo collaboratore.", "DATI_NON_VALIDI", "collaboratoreId");
  }
  await controllaDestinazione(collaboratoreId);
  await db.transaction((tx) => riassegnaInTransazione(tx, req, prima, collaboratoreId));
  res.json(mappaAssistito(await caricaAssistitoVisibile(req, id), req));
});

export default router;
