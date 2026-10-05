import type { NextFunction, Request, Response } from "express";
import { HttpError, nonAutenticato, nonAutorizzato } from "../lib/errori";
import { tokenDaRichiesta, utenteDaToken, type UtenteAutenticato } from "../lib/sessioni";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      utente?: UtenteAutenticato;
    }
  }
}

function hostPermessi(req: Request): Set<string> {
  const permessi = new Set<string>();
  const aggiungi = (v: string | undefined) => {
    if (v) for (const h of v.split(",")) permessi.add(h.trim().toLowerCase());
  };
  aggiungi(req.get("x-forwarded-host"));
  aggiungi(req.get("host"));
  aggiungi(process.env["REPLIT_DEV_DOMAIN"]);
  aggiungi(process.env["REPLIT_DOMAINS"]);
  return permessi;
}

/**
 * Protezione CSRF: i cookie di sessione sono SameSite=None, quindi le richieste che modificano dati
 * sono accettate solo se provengono dallo stesso sito dell'applicazione.
 */
export function controlloOrigine(req: Request, _res: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (origin) {
    let host: string;
    try {
      host = new URL(origin).host.toLowerCase();
    } catch {
      throw new HttpError(403, "Richiesta non consentita.", "ORIGINE_NON_VALIDA");
    }
    if (!hostPermessi(req).has(host)) {
      throw new HttpError(403, "Richiesta non consentita.", "ORIGINE_NON_VALIDA");
    }
  } else {
    const sito = req.get("sec-fetch-site");
    if (sito && sito !== "same-origin" && sito !== "none") {
      throw new HttpError(403, "Richiesta non consentita.", "ORIGINE_NON_VALIDA");
    }
  }
  next();
}

/** Carica l'utente dalla sessione (se presente) senza imporre il login. */
export async function caricaUtente(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = tokenDaRichiesta(req);
  if (token) {
    const utente = await utenteDaToken(token);
    if (utente) req.utente = utente;
  }
  next();
}

export function richiediLogin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.utente) throw nonAutenticato();
  next();
}

/**
 * Finche' la password provvisoria non e' stata cambiata, tutti gli endpoint tranne quelli di
 * sessione sono bloccati lato server.
 */
export function richiediPasswordCambiata(req: Request, _res: Response, next: NextFunction): void {
  if (req.utente?.deveCambiarePassword) {
    throw new HttpError(403, "Devi cambiare la password provvisoria prima di continuare.", "PASSWORD_DA_CAMBIARE");
  }
  next();
}

export function richiediRuolo(...ruoli: UtenteAutenticato["ruolo"][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.utente) throw nonAutenticato();
    if (!ruoli.includes(req.utente.ruolo)) throw nonAutorizzato();
    next();
  };
}
