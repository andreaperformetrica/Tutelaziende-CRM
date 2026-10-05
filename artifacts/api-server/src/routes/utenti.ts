import { Router, type IRouter } from "express";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
  CreateUtenteBody,
  GetUtenteParams,
  ImpostaPasswordProvvisoriaUtenteBody,
  ImpostaPasswordProvvisoriaUtenteParams,
  UpdateUtenteBody,
  UpdateUtenteParams,
} from "@workspace/api-zod";
import { db, utentiTable, type Utente } from "@workspace/db";
import { HttpError, nonAutorizzato, nonTrovato } from "../lib/errori";
import { contestoDa, differenze, registraLog } from "../lib/log";
import { hashPassword } from "../lib/password";
import { codiceErrorePg } from "../lib/postgres";
import { chiudiSessioniUtente } from "../lib/sessioni";
import { valida } from "../lib/validazione";
import { richiediRuolo } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/utenti", richiediRuolo("super_admin", "admin"));

const RUOLI_INTERNI = ["super_admin", "admin", "operatore"] as const;
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function etichettaRuolo(ruolo: string): string {
  return ruolo === "super_admin" ? "Super admin" : ruolo === "admin" ? "Admin" : ruolo === "operatore" ? "Operatore" : "Collaboratore";
}

function mappa(u: Utente) {
  return {
    id: u.id,
    email: u.email,
    nome: u.nome,
    cognome: u.cognome,
    ruolo: u.ruolo as (typeof RUOLI_INTERNI)[number],
    attivo: u.attivo,
    deveCambiarePassword: u.deveCambiarePassword,
    ultimoAccesso: u.ultimoAccesso ? u.ultimoAccesso.toISOString() : null,
    creatoIl: u.creatoIl.toISOString(),
  };
}

function normalizzaEmail(email: string): string {
  const e = email.trim().toLowerCase();
  if (!REGEX_EMAIL.test(e)) throw new HttpError(400, "Indirizzo email non valido.", "EMAIL_NON_VALIDA", "email");
  return e;
}

function ruoliGestibili(ruolo: string): readonly string[] {
  return ruolo === "super_admin" ? RUOLI_INTERNI : ["operatore"];
}

async function caricaGestibile(id: number, ruoloChiamante: string): Promise<Utente> {
  const [u] = await db
    .select()
    .from(utentiTable)
    .where(and(eq(utentiTable.id, id), inArray(utentiTable.ruolo, [...RUOLI_INTERNI])));
  if (!u) throw nonTrovato("Utente non trovato.");
  if (!ruoliGestibili(ruoloChiamante).includes(u.ruolo)) {
    throw nonAutorizzato("Puoi gestire solo gli utenti con ruolo Operatore.");
  }
  return u;
}

async function controllaEmailLibera(email: string, escludiId?: number) {
  const condizioni = [sql`lower(${utentiTable.email}) = ${email}`];
  if (escludiId !== undefined) condizioni.push(ne(utentiTable.id, escludiId));
  const [esistente] = await db
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .where(and(...condizioni))
    .limit(1);
  if (esistente) {
    throw new HttpError(409, "Esiste gia un utente con questo indirizzo email.", "EMAIL_DUPLICATA", "email");
  }
}

router.get("/utenti", async (req, res) => {
  const righe = await db
    .select()
    .from(utentiTable)
    .where(inArray(utentiTable.ruolo, [...ruoliGestibili(req.utente!.ruolo)] as (typeof RUOLI_INTERNI)[number][]))
    .orderBy(utentiTable.cognome, utentiTable.nome);
  res.json(righe.map(mappa));
});

router.post("/utenti", async (req, res) => {
  const dati = valida(CreateUtenteBody, req.body);
  if (!ruoliGestibili(req.utente!.ruolo).includes(dati.ruolo)) {
    throw nonAutorizzato("Puoi creare solo utenti con ruolo Operatore.");
  }
  const email = normalizzaEmail(dati.email);
  await controllaEmailLibera(email);
  const passwordHash = await hashPassword(dati.passwordProvvisoria);
  try {
    const creato = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(utentiTable)
        .values({
          email,
          nome: dati.nome.trim(),
          cognome: dati.cognome.trim(),
          ruolo: dati.ruolo,
          passwordHash,
          deveCambiarePassword: true,
        })
        .returning();
      await registraLog(tx, contestoDa(req), {
        azione: "utente.crea",
        entita: "utente",
        entitaId: u!.id,
        descrizione: `Creato l'utente interno ${u!.cognome} ${u!.nome} (${etichettaRuolo(u!.ruolo)}, ${u!.email})`,
        dettagli: { ruolo: u!.ruolo, email: u!.email },
      });
      return u!;
    });
    res.status(201).json(mappa(creato));
  } catch (err) {
    if (codiceErrorePg(err).code === "23505") {
      throw new HttpError(409, "Esiste gia un utente con questo indirizzo email.", "EMAIL_DUPLICATA", "email");
    }
    throw err;
  }
});

router.get("/utenti/:id", async (req, res) => {
  const { id } = valida(GetUtenteParams, req.params);
  res.json(mappa(await caricaGestibile(id, req.utente!.ruolo)));
});

router.put("/utenti/:id", async (req, res) => {
  const { id } = valida(UpdateUtenteParams, req.params);
  const dati = valida(UpdateUtenteBody, req.body);
  const chiamante = req.utente!;
  const attuale = await caricaGestibile(id, chiamante.ruolo);
  if (!ruoliGestibili(chiamante.ruolo).includes(dati.ruolo)) {
    throw nonAutorizzato("Puoi assegnare solo il ruolo Operatore.");
  }
  if (id === chiamante.id && (!dati.attivo || dati.ruolo !== attuale.ruolo)) {
    throw new HttpError(400, "Non puoi disattivare te stesso o cambiare il tuo ruolo.", "MODIFICA_SU_SE_STESSO");
  }
  const email = normalizzaEmail(dati.email);
  await controllaEmailLibera(email, id);
  const nuovo = {
    email,
    nome: dati.nome.trim(),
    cognome: dati.cognome.trim(),
    ruolo: dati.ruolo,
    attivo: dati.attivo,
  };
  try {
    const aggiornato = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(utentiTable)
        .set({ ...nuovo, modificatoIl: sql`now()` })
        .where(eq(utentiTable.id, id))
        .returning();
      if (!nuovo.attivo) await chiudiSessioniUtente(id, tx);
      const diff = differenze(attuale as unknown as Record<string, unknown>, u as unknown as Record<string, unknown>, {
        email: "email",
        nome: "nome",
        cognome: "cognome",
        ruolo: "ruolo",
        attivo: "stato attivo",
      });
      await registraLog(tx, contestoDa(req), {
        azione: "utente.modifica",
        entita: "utente",
        entitaId: id,
        descrizione: `Modificato l'utente interno ${u!.cognome} ${u!.nome}${diff.elenco.length ? `: ${diff.elenco.join(", ")}` : " (nessuna variazione)"}`,
        dettagli: { prima: diff.prima, dopo: diff.dopo },
      });
      return u!;
    });
    res.json(mappa(aggiornato));
  } catch (err) {
    if (codiceErrorePg(err).code === "23505") {
      throw new HttpError(409, "Esiste gia un utente con questo indirizzo email.", "EMAIL_DUPLICATA", "email");
    }
    throw err;
  }
});

router.post("/utenti/:id/password-provvisoria", async (req, res) => {
  const { id } = valida(ImpostaPasswordProvvisoriaUtenteParams, req.params);
  const { passwordProvvisoria } = valida(ImpostaPasswordProvvisoriaUtenteBody, req.body);
  const attuale = await caricaGestibile(id, req.utente!.ruolo);
  const passwordHash = await hashPassword(passwordProvvisoria);
  const aggiornato = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(utentiTable)
      .set({ passwordHash, deveCambiarePassword: true, modificatoIl: sql`now()` })
      .where(eq(utentiTable.id, id))
      .returning();
    await chiudiSessioniUtente(id, tx);
    await registraLog(tx, contestoDa(req), {
      azione: "utente.password_provvisoria",
      entita: "utente",
      entitaId: id,
      descrizione: `Impostata una nuova password provvisoria per ${attuale.cognome} ${attuale.nome}`,
    });
    return u!;
  });
  res.json(mappa(aggiornato));
});

export default router;
