import { Router, type IRouter } from "express";
import { and, asc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  CreateCollaboratoreBody,
  GetCollaboratoreParams,
  ImpostaPasswordProvvisoriaCollaboratoreBody,
  ImpostaPasswordProvvisoriaCollaboratoreParams,
  ListCollaboratoriQueryParams,
  UpdateCollaboratoreBody,
  UpdateCollaboratoreParams,
} from "@workspace/api-zod";
import { collaboratoriTable, db, personeTable, utentiTable } from "@workspace/db";
import { HttpError, nonAutorizzato, nonTrovato } from "../lib/errori";
import { contestoDa, differenze, registraLog } from "../lib/log";
import { CODICE_ITALIA } from "../lib/luoghi";
import { hashPassword } from "../lib/password";
import {
  controllaUnicitaPersona,
  erroreDuplicatoDb,
  normalizzaAnagrafica,
  type AnagraficaNormalizzata,
} from "../lib/persone";
import { chiudiSessioniUtente } from "../lib/sessioni";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();
const soloBackofficeScrittura = richiediRuolo("super_admin", "admin");

const capogruppo = alias(collaboratoriTable, "capogruppo");
const personaCapogruppo = alias(personeTable, "persona_capogruppo");

const colonne = {
  id: collaboratoriTable.id,
  utenteId: collaboratoriTable.utenteId,
  nome: personeTable.nome,
  cognome: personeTable.cognome,
  sesso: personeTable.sesso,
  dataNascita: personeTable.dataNascita,
  luogoNascitaCodice: personeTable.luogoNascitaCodice,
  luogoNascitaNome: personeTable.luogoNascitaNome,
  luogoNascitaProvincia: personeTable.luogoNascitaProvincia,
  luogoNascitaEstero: personeTable.luogoNascitaEstero,
  nazionalita: personeTable.nazionalita,
  nazionalitaNome: personeTable.nazionalitaNome,
  codiceFiscale: personeTable.codiceFiscale,
  email: utentiTable.email,
  telefono: personeTable.telefono,
  partitaIva: personeTable.partitaIva,
  cellulare: personeTable.cellulare,
  numeroSportello: collaboratoriTable.numeroSportello,
  tipologia: collaboratoriTable.tipologia,
  capogruppoId: collaboratoriTable.capogruppoId,
  capogruppoCognome: personaCapogruppo.cognome,
  capogruppoNome: personaCapogruppo.nome,
  numeroCollaboratori: sql<number>`(select count(*)::int from collaboratori as membro where membro.capogruppo_id = ${collaboratoriTable.id})`,
  attivo: utentiTable.attivo,
  deveCambiarePassword: utentiTable.deveCambiarePassword,
  ultimoAccesso: utentiTable.ultimoAccesso,
  creatoIl: collaboratoriTable.creatoIl,
  personaId: collaboratoriTable.personaId,
};

type RigaCollaboratore = Awaited<ReturnType<typeof selezionaCollaboratori>>[number];

function selezionaCollaboratori(where?: SQL) {
  return db
    .select(colonne)
    .from(collaboratoriTable)
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .innerJoin(utentiTable, eq(utentiTable.id, collaboratoriTable.utenteId))
    .leftJoin(capogruppo, eq(capogruppo.id, collaboratoriTable.capogruppoId))
    .leftJoin(personaCapogruppo, eq(personaCapogruppo.id, capogruppo.personaId))
    .where(where)
    .orderBy(asc(personeTable.cognome), asc(personeTable.nome));
}

function mappa(r: RigaCollaboratore) {
  const { capogruppoCognome, capogruppoNome, personaId: _personaId, ...resto } = r;
  return {
    ...resto,
    straniero: r.nazionalita !== CODICE_ITALIA,
    capogruppoNome: capogruppoCognome ? `${capogruppoCognome} ${capogruppoNome}` : null,
    ultimoAccesso: r.ultimoAccesso ? r.ultimoAccesso.toISOString() : null,
    creatoIl: r.creatoIl.toISOString(),
  };
}

async function dettaglio(id: number) {
  const [riga] = await selezionaCollaboratori(eq(collaboratoriTable.id, id));
  if (!riga) throw nonTrovato("Collaboratore non trovato.");
  const membri = await selezionaCollaboratori(eq(collaboratoriTable.capogruppoId, id));
  return {
    ...mappa(riga),
    membri: membri.map((m) => ({
      id: m.id,
      nome: m.nome,
      cognome: m.cognome,
      numeroSportello: m.numeroSportello,
      tipologia: m.tipologia,
      attivo: m.attivo,
    })),
  };
}

/** Un collaboratore vede solo se stesso e, se capogruppo, i collaboratori del proprio gruppo. */
async function controllaAccessoLettura(req: Express.Request, id: number): Promise<void> {
  const u = req.utente!;
  if (u.ruolo !== "collaboratore") return;
  if (u.collaboratoreId === id) return;
  const [r] = await db
    .select({ capogruppoId: collaboratoriTable.capogruppoId })
    .from(collaboratoriTable)
    .where(eq(collaboratoriTable.id, id));
  if (!r) throw nonTrovato("Collaboratore non trovato.");
  if (u.collaboratoreId !== null && r.capogruppoId === u.collaboratoreId) return;
  throw nonAutorizzato("Puoi consultare solo i tuoi dati e quelli del tuo gruppo.");
}

async function controllaCapogruppo(capogruppoId: number | null | undefined, selfId?: number): Promise<void> {
  if (capogruppoId === null || capogruppoId === undefined) return;
  const campo = "capogruppoId";
  if (selfId !== undefined && capogruppoId === selfId) {
    throw new HttpError(400, "Un collaboratore non puo essere capogruppo di se stesso.", "CAPOGRUPPO_NON_VALIDO", campo);
  }
  const [c] = await db
    .select({ id: collaboratoriTable.id, capogruppoId: collaboratoriTable.capogruppoId, attivo: utentiTable.attivo })
    .from(collaboratoriTable)
    .innerJoin(utentiTable, eq(utentiTable.id, collaboratoriTable.utenteId))
    .where(eq(collaboratoriTable.id, capogruppoId));
  if (!c) throw new HttpError(400, "Il capogruppo scelto non esiste.", "CAPOGRUPPO_NON_VALIDO", campo);
  if (!c.attivo) {
    throw new HttpError(400, "Il capogruppo scelto e' disattivato.", "CAPOGRUPPO_NON_VALIDO", campo);
  }
  if (c.capogruppoId !== null) {
    throw new HttpError(
      400,
      "Il collaboratore scelto appartiene a sua volta a un gruppo: un capogruppo non puo avere un capogruppo.",
      "CAPOGRUPPO_NON_VALIDO",
      campo,
    );
  }
  if (selfId !== undefined) {
    const [haMembri] = await db
      .select({ id: collaboratoriTable.id })
      .from(collaboratoriTable)
      .where(eq(collaboratoriTable.capogruppoId, selfId))
      .limit(1);
    if (haMembri) {
      throw new HttpError(
        400,
        "Questo collaboratore e' capogruppo di altri collaboratori e non puo appartenere a un gruppo.",
        "CAPOGRUPPO_NON_VALIDO",
        campo,
      );
    }
  }
}

async function controllaSportelloEEmail(sportello: string, email: string, escludi?: { collaboratoreId: number; utenteId: number }) {
  const [perSportello] = await db
    .select({ id: collaboratoriTable.id })
    .from(collaboratoriTable)
    .where(
      and(
        eq(collaboratoriTable.numeroSportello, sportello),
        escludi ? ne(collaboratoriTable.id, escludi.collaboratoreId) : undefined,
      ),
    )
    .limit(1);
  if (perSportello) {
    throw new HttpError(409, `Il numero di sportello ${sportello} e' gia assegnato a un altro collaboratore.`, "SPORTELLO_DUPLICATO", "numeroSportello");
  }
  const [perEmail] = await db
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .where(and(sql`lower(${utentiTable.email}) = ${email}`, escludi ? ne(utentiTable.id, escludi.utenteId) : undefined))
    .limit(1);
  if (perEmail) {
    throw new HttpError(409, "Esiste gia un utente con questo indirizzo email.", "EMAIL_DUPLICATA", "email");
  }
}

function pulisciSportello(valore: string): string {
  const s = valore.trim();
  if (!s) throw new HttpError(400, "Il numero di sportello e' obbligatorio.", "DATI_NON_VALIDI", "numeroSportello");
  return s;
}

router.get("/collaboratori", async (req, res) => {
  const p = valida(ListCollaboratoriQueryParams, req.query);
  const u = req.utente!;
  const condizioni: (SQL | undefined)[] = [];

  if (u.ruolo === "collaboratore") {
    condizioni.push(
      or(eq(collaboratoriTable.id, u.collaboratoreId ?? -1), eq(collaboratoriTable.capogruppoId, u.collaboratoreId ?? -1)),
    );
  }
  if (p.q?.trim()) {
    const termine = `%${p.q.trim().replace(/[%_\\]/g, "\\$&")}%`;
    condizioni.push(
      or(
        ilike(personeTable.nome, termine),
        ilike(personeTable.cognome, termine),
        ilike(sql`${personeTable.cognome} || ' ' || ${personeTable.nome}`, termine),
        ilike(sql`${personeTable.nome} || ' ' || ${personeTable.cognome}`, termine),
        ilike(personeTable.codiceFiscale, termine),
        ilike(personeTable.cellulare, termine),
        ilike(personeTable.email, termine),
        ilike(collaboratoriTable.numeroSportello, termine),
      ),
    );
  }
  if (p.tipologia) condizioni.push(eq(collaboratoriTable.tipologia, p.tipologia));
  if (p.capogruppoId !== undefined) condizioni.push(eq(collaboratoriTable.capogruppoId, p.capogruppoId));
  if (p.stato === "disattivati") condizioni.push(eq(utentiTable.attivo, false));
  else if (p.stato !== "tutti") condizioni.push(eq(utentiTable.attivo, true));

  const righe = await selezionaCollaboratori(and(...condizioni));
  res.json(righe.map(mappa));
});

router.get("/collaboratori/:id", async (req, res) => {
  const { id } = valida(GetCollaboratoreParams, req.params);
  await controllaAccessoLettura(req, id);
  res.json(await dettaglio(id));
});

router.post("/collaboratori", soloBackofficeScrittura, async (req, res) => {
  const dati = valida(CreateCollaboratoreBody, req.body);
  const anagrafica = normalizzaAnagrafica(dati);
  const sportello = pulisciSportello(dati.numeroSportello);
  await controllaUnicitaPersona(anagrafica);
  await controllaSportelloEEmail(sportello, anagrafica.email!);
  await controllaCapogruppo(dati.capogruppoId);
  const passwordHash = await hashPassword(dati.passwordProvvisoria);

  try {
    const id = await db.transaction(async (tx) => {
      const [utente] = await tx
        .insert(utentiTable)
        .values({
          email: anagrafica.email!,
          nome: anagrafica.nome,
          cognome: anagrafica.cognome,
          ruolo: "collaboratore",
          passwordHash,
          deveCambiarePassword: true,
        })
        .returning({ id: utentiTable.id });
      const [persona] = await tx.insert(personeTable).values(anagrafica).returning({ id: personeTable.id });
      const [collaboratore] = await tx
        .insert(collaboratoriTable)
        .values({
          utenteId: utente!.id,
          personaId: persona!.id,
          numeroSportello: sportello,
          tipologia: dati.tipologia,
          capogruppoId: dati.capogruppoId ?? null,
        })
        .returning({ id: collaboratoriTable.id });
      await registraLog(tx, contestoDa(req), {
        azione: "collaboratore.crea",
        entita: "collaboratore",
        entitaId: collaboratore!.id,
        descrizione: `Creato il collaboratore ${anagrafica.cognome} ${anagrafica.nome} (sportello ${sportello}, ${dati.tipologia})`,
        dettagli: { codiceFiscale: anagrafica.codiceFiscale, numeroSportello: sportello, tipologia: dati.tipologia },
      });
      if (dati.capogruppoId) {
        await registraLog(tx, contestoDa(req), {
          azione: "collaboratore.capogruppo",
          entita: "collaboratore",
          entitaId: collaboratore!.id,
          descrizione: `Assegnato il capogruppo (collaboratore n. ${dati.capogruppoId}) a ${anagrafica.cognome} ${anagrafica.nome}`,
          dettagli: { capogruppoId: dati.capogruppoId },
        });
      }
      return collaboratore!.id;
    });
    res.status(201).json(await dettaglio(id));
  } catch (err) {
    throw erroreDuplicatoDb(err) ?? err;
  }
});

function piatto(a: AnagraficaNormalizzata, extra: { numeroSportello: string; tipologia: string }): Record<string, unknown> {
  return {
    nome: a.nome,
    cognome: a.cognome,
    sesso: a.sesso,
    dataNascita: a.dataNascita,
    luogoNascitaCodice: a.luogoNascitaCodice,
    nazionalita: a.nazionalita,
    codiceFiscale: a.codiceFiscale,
    email: a.email,
    telefono: a.telefono ?? null,
    partitaIva: a.partitaIva ?? null,
    cellulare: a.cellulare,
    ...extra,
  };
}

const ETICHETTE_CAMPI: Record<string, string> = {
  nome: "nome",
  cognome: "cognome",
  sesso: "sesso",
  dataNascita: "data di nascita",
  luogoNascitaCodice: "luogo di nascita",
  nazionalita: "nazionalita",
  codiceFiscale: "codice fiscale",
  email: "email",
  telefono: "telefono",
  partitaIva: "partita IVA",
  cellulare: "cellulare",
  numeroSportello: "numero di sportello",
  tipologia: "tipologia",
};

router.put("/collaboratori/:id", soloBackofficeScrittura, async (req, res) => {
  const { id } = valida(UpdateCollaboratoreParams, req.params);
  const dati = valida(UpdateCollaboratoreBody, req.body);
  const [prima] = await selezionaCollaboratori(eq(collaboratoriTable.id, id));
  if (!prima) throw nonTrovato("Collaboratore non trovato.");

  const anagrafica = normalizzaAnagrafica(dati);
  const sportello = pulisciSportello(dati.numeroSportello);
  await controllaUnicitaPersona(anagrafica, prima.personaId);
  await controllaSportelloEEmail(sportello, anagrafica.email!, { collaboratoreId: id, utenteId: prima.utenteId });
  const nuovoCapogruppo = dati.capogruppoId ?? null;
  if (nuovoCapogruppo !== prima.capogruppoId) await controllaCapogruppo(nuovoCapogruppo, id);

  const vecchiaAnagrafica = piatto(
    {
      nome: prima.nome,
      cognome: prima.cognome,
      sesso: prima.sesso,
      dataNascita: prima.dataNascita,
      luogoNascitaCodice: prima.luogoNascitaCodice,
      codiceFiscale: prima.codiceFiscale,
      nazionalita: prima.nazionalita,
      email: prima.email,
      telefono: prima.telefono,
      partitaIva: prima.partitaIva,
      cellulare: prima.cellulare,
    } as AnagraficaNormalizzata,
    { numeroSportello: prima.numeroSportello, tipologia: prima.tipologia },
  );
  const nuovaAnagrafica = piatto(anagrafica, { numeroSportello: sportello, tipologia: dati.tipologia });
  const diff = differenze(vecchiaAnagrafica, nuovaAnagrafica, ETICHETTE_CAMPI);
  const nomeCompleto = `${anagrafica.cognome} ${anagrafica.nome}`;

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(personeTable)
        .set({ ...anagrafica, modificatoIl: sql`now()` })
        .where(eq(personeTable.id, prima.personaId));
      await tx
        .update(utentiTable)
        .set({
          email: anagrafica.email!,
          nome: anagrafica.nome,
          cognome: anagrafica.cognome,
          attivo: dati.attivo,
          modificatoIl: sql`now()`,
        })
        .where(eq(utentiTable.id, prima.utenteId));
      await tx
        .update(collaboratoriTable)
        .set({ numeroSportello: sportello, tipologia: dati.tipologia, capogruppoId: nuovoCapogruppo })
        .where(eq(collaboratoriTable.id, id));
      if (!dati.attivo) await chiudiSessioniUtente(prima.utenteId, tx);

      const ctx = contestoDa(req);
      if (diff.elenco.length > 0) {
        await registraLog(tx, ctx, {
          azione: "collaboratore.modifica",
          entita: "collaboratore",
          entitaId: id,
          descrizione: `Modificato il collaboratore ${nomeCompleto}: ${diff.elenco.join(", ")}`,
          dettagli: { prima: diff.prima, dopo: diff.dopo },
        });
      }
      if (prima.attivo !== dati.attivo) {
        await registraLog(tx, ctx, {
          azione: dati.attivo ? "collaboratore.riattiva" : "collaboratore.disattiva",
          entita: "collaboratore",
          entitaId: id,
          descrizione: `${dati.attivo ? "Riattivato" : "Disattivato"} il collaboratore ${nomeCompleto}`,
        });
      }
      if (prima.capogruppoId !== nuovoCapogruppo) {
        await registraLog(tx, ctx, {
          azione: "collaboratore.capogruppo",
          entita: "collaboratore",
          entitaId: id,
          descrizione:
            nuovoCapogruppo === null
              ? `Rimosso il capogruppo a ${nomeCompleto}`
              : `Assegnato il capogruppo (collaboratore n. ${nuovoCapogruppo}) a ${nomeCompleto}`,
          dettagli: { prima: { capogruppoId: prima.capogruppoId }, dopo: { capogruppoId: nuovoCapogruppo } },
        });
      }
    });
  } catch (err) {
    throw erroreDuplicatoDb(err) ?? err;
  }
  res.json(await dettaglio(id));
});

router.post("/collaboratori/:id/password-provvisoria", soloBackofficeScrittura, async (req, res) => {
  const { id } = valida(ImpostaPasswordProvvisoriaCollaboratoreParams, req.params);
  const { passwordProvvisoria } = valida(ImpostaPasswordProvvisoriaCollaboratoreBody, req.body);
  const [c] = await selezionaCollaboratori(eq(collaboratoriTable.id, id));
  if (!c) throw nonTrovato("Collaboratore non trovato.");
  const passwordHash = await hashPassword(passwordProvvisoria);
  await db.transaction(async (tx) => {
    await tx
      .update(utentiTable)
      .set({ passwordHash, deveCambiarePassword: true, modificatoIl: sql`now()` })
      .where(eq(utentiTable.id, c.utenteId));
    await chiudiSessioniUtente(c.utenteId, tx);
    await registraLog(tx, contestoDa(req), {
      azione: "collaboratore.password_provvisoria",
      entita: "collaboratore",
      entitaId: id,
      descrizione: `Impostata una nuova password provvisoria per il collaboratore ${c.cognome} ${c.nome}`,
    });
  });
  res.json(await dettaglio(id));
});

export default router;
