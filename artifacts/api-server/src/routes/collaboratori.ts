import { randomInt } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  CreateCollaboratoreBody,
  DeleteCollaboratoreParams,
  GetCollaboratoreParams,
  ImpostaPasswordProvvisoriaCollaboratoreBody,
  ImpostaPasswordProvvisoriaCollaboratoreParams,
  ListCollaboratoriQueryParams,
  ReinviaCredenzialiCollaboratoreParams,
  ImpostaRuoloCapogruppoBody,
  ImpostaRuoloCapogruppoParams,
  AggiungiMembriGruppoBody,
  AggiungiMembriGruppoParams,
  UpdateCollaboratoreBody,
  UpdateCollaboratoreParams,
} from "@workspace/api-zod";
import { assegnazioniMandatoTable, collaboratoriTable, db, eventiInvitiTable, eventiPartecipantiTable, personeTable, utentiTable } from "@workspace/db";
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
import { inviaCredenzialiCollaboratore } from "../lib/email-credenziali";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();
const soloBackofficeScrittura = richiediRuolo("super_admin", "admin");
const soloSuperAdmin = richiediRuolo("super_admin");

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
  eCapogruppo: collaboratoriTable.eCapogruppo,
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
  const { capogruppoCognome, capogruppoNome, personaId: _personaId, eCapogruppo, ...resto } = r;
  return {
    ...resto,
    capogruppo: eCapogruppo || r.numeroCollaboratori > 0,
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
    const [segnato] = await db
      .select({ e: collaboratoriTable.eCapogruppo })
      .from(collaboratoriTable)
      .where(eq(collaboratoriTable.id, selfId));
    if (haMembri || segnato?.e) {
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
    const creato = await db.transaction(async (tx) => {
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
      return { id: collaboratore!.id, utenteId: utente!.id };
    });
    void inviaCredenzialiCollaboratore({
      utenteId: creato.utenteId,
      nome: anagrafica.nome,
      cognome: anagrafica.cognome,
      email: anagrafica.email!,
      password: dati.passwordProvvisoria,
    });
    res.status(201).json(await dettaglio(creato.id));
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

/** Rende un collaboratore capogruppo anche prima di avere un gruppo, oppure gli toglie il ruolo (solo se il gruppo e' vuoto). */
router.put("/collaboratori/:id/capogruppo", soloBackofficeScrittura, async (req, res) => {
  const { id } = valida(ImpostaRuoloCapogruppoParams, req.params);
  const { capogruppo: voluto } = valida(ImpostaRuoloCapogruppoBody, req.body);
  const [c] = await selezionaCollaboratori(eq(collaboratoriTable.id, id));
  if (!c) throw nonTrovato("Collaboratore non trovato.");
  const nome = `${c.cognome} ${c.nome}`;
  if (voluto) {
    if (c.capogruppoId !== null) {
      throw new HttpError(409, "Questo collaboratore appartiene a un gruppo: toglilo dal gruppo prima di renderlo capogruppo.", "CAPOGRUPPO_NON_VALIDO");
    }
    if (!c.attivo) throw new HttpError(409, "Il collaboratore è disattivato: riattivalo prima di renderlo capogruppo.", "COLLABORATORE_DISATTIVATO");
  } else if (c.numeroCollaboratori > 0) {
    throw new HttpError(409, "Il gruppo ha ancora dei collaboratori: toglili dal gruppo prima di rimuovere il ruolo di capogruppo.", "GRUPPO_NON_VUOTO");
  }
  if (c.eCapogruppo !== voluto) {
    await db.transaction(async (tx) => {
      await tx.update(collaboratoriTable).set({ eCapogruppo: voluto }).where(eq(collaboratoriTable.id, id));
      await registraLog(tx, contestoDa(req), {
        azione: "collaboratore.ruolo_capogruppo",
        entita: "collaboratore",
        entitaId: id,
        descrizione: voluto ? `${nome} è stato reso capogruppo` : `Tolto il ruolo di capogruppo a ${nome}`,
      });
    });
  }
  res.json(await dettaglio(id));
});

/** Inserisce collaboratori nel gruppo di un capogruppo. */
router.post("/collaboratori/:id/membri", soloBackofficeScrittura, async (req, res) => {
  const { id } = valida(AggiungiMembriGruppoParams, req.params);
  const { collaboratoreIds } = valida(AggiungiMembriGruppoBody, req.body);
  const [c] = await selezionaCollaboratori(eq(collaboratoriTable.id, id));
  if (!c) throw nonTrovato("Collaboratore non trovato.");
  if (!(c.eCapogruppo || c.numeroCollaboratori > 0)) throw new HttpError(409, "Prima rendi capogruppo questo collaboratore.", "CAPOGRUPPO_NON_VALIDO");
  if (!c.attivo) throw new HttpError(409, "Il capogruppo è disattivato.", "COLLABORATORE_DISATTIVATO");
  const ids = [...new Set(collaboratoreIds)];
  if (ids.includes(id)) throw new HttpError(400, "Un collaboratore non può far parte del proprio gruppo.", "CAPOGRUPPO_NON_VALIDO");
  const scelti = await selezionaCollaboratori(inArray(collaboratoriTable.id, ids));
  if (scelti.length !== ids.length) throw new HttpError(400, "Uno dei collaboratori scelti non esiste.", "CAPOGRUPPO_NON_VALIDO");
  for (const m of scelti) {
    const nome = `${m.cognome} ${m.nome}`;
    if (m.capogruppoId === id) throw new HttpError(409, `${nome} fa già parte di questo gruppo.`, "CAPOGRUPPO_NON_VALIDO");
    if (m.capogruppoId !== null) throw new HttpError(409, `${nome} appartiene già a un altro gruppo.`, "CAPOGRUPPO_NON_VALIDO");
    if (m.eCapogruppo || m.numeroCollaboratori > 0) throw new HttpError(409, `${nome} è a sua volta capogruppo e non può entrare in un gruppo.`, "CAPOGRUPPO_NON_VALIDO");
  }
  await db.transaction(async (tx) => {
    await tx.update(collaboratoriTable).set({ capogruppoId: id }).where(inArray(collaboratoriTable.id, ids));
    const ctx = contestoDa(req);
    for (const m of scelti) {
      await registraLog(tx, ctx, {
        azione: "collaboratore.capogruppo",
        entita: "collaboratore",
        entitaId: m.id,
        descrizione: `Assegnato il capogruppo (${c.cognome} ${c.nome}) a ${m.cognome} ${m.nome}`,
        dettagli: { prima: { capogruppoId: null }, dopo: { capogruppoId: id } },
      });
    }
  });
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

const ALFABETO_PASSWORD = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const nuovaPasswordCasuale = () => Array.from({ length: 12 }, () => ALFABETO_PASSWORD[randomInt(ALFABETO_PASSWORD.length)]).join("");

/** Nuova password provvisoria casuale, impostata e inviata per email al collaboratore. Solo super admin. */
router.post("/collaboratori/:id/reinvia-credenziali", soloSuperAdmin, async (req, res) => {
  const { id } = valida(ReinviaCredenzialiCollaboratoreParams, req.params);
  const [c] = await selezionaCollaboratori(eq(collaboratoriTable.id, id));
  if (!c) throw nonTrovato("Collaboratore non trovato.");
  if (!c.attivo) throw new HttpError(409, "Il collaboratore è disattivato: riattivalo prima di inviargli le credenziali.", "COLLABORATORE_DISATTIVATO");
  const password = nuovaPasswordCasuale();
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx
      .update(utentiTable)
      .set({ passwordHash, deveCambiarePassword: true, modificatoIl: sql`now()` })
      .where(eq(utentiTable.id, c.utenteId));
    await chiudiSessioniUtente(c.utenteId, tx);
    await registraLog(tx, contestoDa(req), {
      azione: "collaboratore.reinvia_credenziali",
      entita: "collaboratore",
      entitaId: id,
      descrizione: `Reinviate le credenziali (nuova password provvisoria) al collaboratore ${c.cognome} ${c.nome}`,
    });
  });
  res.json(await inviaCredenzialiCollaboratore({ utenteId: c.utenteId, nome: c.nome, cognome: c.cognome, email: c.email, password }));
});

/** Elimina un collaboratore solo se non ha dati collegati (assistiti, pratiche, compensi, orari registrati agli eventi, gruppo). */
router.delete("/collaboratori/:id", soloSuperAdmin, async (req, res) => {
  const { id } = valida(DeleteCollaboratoreParams, req.params);
  const [c] = await selezionaCollaboratori(eq(collaboratoriTable.id, id));
  if (!c) throw nonTrovato("Collaboratore non trovato.");
  const r = await db.execute<{ assistiti: number; pratiche: number; segnalazioni: number; compensi: number; membri: number; orari: number }>(sql`
    select
      (select count(*)::int from assistiti where collaboratore_id = ${id}) as assistiti,
      (select count(*)::int from pratiche where collaboratore_id = ${id}) as pratiche,
      (select count(*)::int from segnalazioni_duplicati where richiedente_collaboratore_id = ${id}) as segnalazioni,
      ((select count(*)::int from estratti where collaboratore_id = ${id})
        + (select count(*)::int from compensi_righe where collaboratore_id = ${id})
        + (select count(*)::int from importazioni_righe where collaboratore_id = ${id})) as compensi,
      (select count(*)::int from collaboratori where capogruppo_id = ${id}) as membri,
      (select count(*)::int from eventi_partecipanti where collaboratore_id = ${id} and (entrata_il is not null or uscita_il is not null)) as orari`);
  const d = r.rows[0]!;
  const motivi = [
    d.assistiti > 0 && `${d.assistiti} assistiti`,
    d.pratiche > 0 && `${d.pratiche} pratiche`,
    d.segnalazioni > 0 && `${d.segnalazioni} segnalazioni`,
    d.compensi > 0 && "compensi o estratti",
    d.membri > 0 && `${d.membri} collaboratori nel suo gruppo`,
    d.orari > 0 && "orari registrati agli eventi",
  ].filter(Boolean);
  if (motivi.length > 0) {
    throw new HttpError(409, `Non si può eliminare ${c.cognome} ${c.nome}: ha dati collegati (${motivi.join(", ")}). Puoi disattivarlo.`, "DATI_COLLEGATI");
  }
  try {
    await db.transaction(async (tx) => {
      await tx.delete(eventiPartecipantiTable).where(eq(eventiPartecipantiTable.collaboratoreId, id));
      await tx.delete(eventiInvitiTable).where(eq(eventiInvitiTable.collaboratoreId, id));
      await tx.delete(assegnazioniMandatoTable).where(eq(assegnazioniMandatoTable.collaboratoreId, id));
      await chiudiSessioniUtente(c.utenteId, tx);
      const [riga] = await tx.select({ personaId: collaboratoriTable.personaId }).from(collaboratoriTable).where(eq(collaboratoriTable.id, id));
      await tx.delete(collaboratoriTable).where(eq(collaboratoriTable.id, id));
      await tx.delete(utentiTable).where(eq(utentiTable.id, c.utenteId));
      await tx.delete(personeTable).where(eq(personeTable.id, riga!.personaId));
      await registraLog(tx, contestoDa(req), {
        azione: "collaboratore.elimina",
        entita: "collaboratore",
        entitaId: id,
        descrizione: `Eliminato il collaboratore ${c.cognome} ${c.nome} (sportello ${c.numeroSportello})`,
        dettagli: { codiceFiscale: c.codiceFiscale, email: c.email, numeroSportello: c.numeroSportello, tipologia: c.tipologia },
      });
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23503" || (err as { cause?: { code?: string } }).cause?.code === "23503") {
      throw new HttpError(409, `Non si può eliminare ${c.cognome} ${c.nome}: ha dati collegati. Puoi disattivarlo.`, "DATI_COLLEGATI");
    }
    throw err;
  }
  res.status(204).end();
});

export default router;
