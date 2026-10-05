import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { CambiaPasswordBody, LoginBody } from "@workspace/api-zod";
import { db, utentiTable } from "@workspace/db";
import { HttpError, nonAutenticato } from "../lib/errori";
import { contestoDa, registraLog } from "../lib/log";
import { hashPassword, verificaPassword } from "../lib/password";
import {
  chiudiSessione,
  chiudiSessioniUtente,
  creaSessione,
  impostaCookie,
  rimuoviCookie,
  tokenDaRichiesta,
} from "../lib/sessioni";
import { costruisciSessione, utenteAutenticatoDaId } from "../lib/sessioneUtente";
import { valida } from "../lib/validazione";
import { richiediLogin } from "../middlewares/auth";

const router: IRouter = Router();

const MAX_TENTATIVI = 5;
const FINESTRA_MS = 15 * 60 * 1000;
const tentativi = new Map<string, number[]>();

function tentativiRecenti(chiave: string): number[] {
  const adesso = Date.now();
  const recenti = (tentativi.get(chiave) ?? []).filter((t) => adesso - t < FINESTRA_MS);
  if (recenti.length > 0) tentativi.set(chiave, recenti);
  else tentativi.delete(chiave);
  return recenti;
}

// Hash fittizio per rendere uguale il tempo di risposta con email sconosciuta.
const hashFinto = hashPassword("password-non-valida");

router.post("/auth/login", async (req, res) => {
  const { email: emailInput, password } = valida(LoginBody, req.body);
  const email = emailInput.trim().toLowerCase();
  const chiave = `${email}|${req.ip ?? ""}`;
  const ctxAnonimo = contestoDa(req);

  if (tentativiRecenti(chiave).length >= MAX_TENTATIVI) {
    await registraLog(db, ctxAnonimo, {
      azione: "auth.login_fallito",
      descrizione: `Accesso bloccato per troppi tentativi (${email})`,
      dettagli: { email, motivo: "troppi_tentativi" },
    });
    throw new HttpError(429, "Troppi tentativi di accesso. Riprova tra qualche minuto.", "TROPPI_TENTATIVI");
  }

  const [utente] = await db
    .select()
    .from(utentiTable)
    .where(sql`lower(${utentiTable.email}) = ${email}`)
    .limit(1);

  const valida_ = await verificaPassword(password, utente ? utente.passwordHash : await hashFinto);
  if (!utente || !utente.attivo || !valida_) {
    tentativi.set(chiave, [...tentativiRecenti(chiave), Date.now()]);
    await registraLog(db, ctxAnonimo, {
      azione: "auth.login_fallito",
      descrizione: `Accesso non riuscito per ${email}`,
      dettagli: { email, motivo: !utente ? "utente_sconosciuto" : !utente.attivo ? "utente_disattivato" : "password_errata" },
    });
    throw new HttpError(401, "Email o password non corretti.", "CREDENZIALI_NON_VALIDE");
  }

  tentativi.delete(chiave);
  const token = await creaSessione(utente.id);
  await db.update(utentiTable).set({ ultimoAccesso: sql`now()` }).where(eq(utentiTable.id, utente.id));
  const autenticato = await utenteAutenticatoDaId(utente.id);
  await registraLog(
    db,
    { utente: { id: utente.id, nome: `${utente.nome} ${utente.cognome}`, ruolo: utente.ruolo }, ip: req.ip ?? null },
    { azione: "auth.login", entita: "utente", entitaId: utente.id, descrizione: `Accesso di ${utente.nome} ${utente.cognome}` },
  );
  impostaCookie(res, token);
  res.json(await costruisciSessione(autenticato));
});

router.post("/auth/logout", async (req, res) => {
  const token = tokenDaRichiesta(req);
  if (token) await chiudiSessione(token);
  if (req.utente) {
    await registraLog(db, contestoDa(req), {
      azione: "auth.logout",
      entita: "utente",
      entitaId: req.utente.id,
      descrizione: `Uscita di ${req.utente.nome} ${req.utente.cognome}`,
    });
  }
  rimuoviCookie(res);
  res.status(204).end();
});

router.get("/auth/me", richiediLogin, async (req, res) => {
  if (!req.utente) throw nonAutenticato();
  res.json(await costruisciSessione(req.utente));
});

router.post("/auth/cambio-password", richiediLogin, async (req, res) => {
  const utenteCorrente = req.utente!;
  const { passwordAttuale, nuovaPassword } = valida(CambiaPasswordBody, req.body);
  const [riga] = await db.select().from(utentiTable).where(eq(utentiTable.id, utenteCorrente.id));
  if (!riga || !(await verificaPassword(passwordAttuale, riga.passwordHash))) {
    throw new HttpError(400, "La password attuale non e' corretta.", "PASSWORD_ATTUALE_ERRATA", "passwordAttuale");
  }
  if (passwordAttuale === nuovaPassword) {
    throw new HttpError(400, "La nuova password deve essere diversa da quella attuale.", "PASSWORD_UGUALE", "nuovaPassword");
  }
  const nuovoHash = await hashPassword(nuovaPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(utentiTable)
      .set({ passwordHash: nuovoHash, deveCambiarePassword: false, modificatoIl: sql`now()` })
      .where(eq(utentiTable.id, utenteCorrente.id));
    await chiudiSessioniUtente(utenteCorrente.id, tx);
    await registraLog(tx, contestoDa(req), {
      azione: "auth.cambio_password",
      entita: "utente",
      entitaId: utenteCorrente.id,
      descrizione: `${utenteCorrente.nome} ${utenteCorrente.cognome} ha cambiato la propria password`,
    });
  });
  const token = await creaSessione(utenteCorrente.id);
  impostaCookie(res, token);
  res.json(await costruisciSessione(await utenteAutenticatoDaId(utenteCorrente.id)));
});

export default router;
