/** Gestione delle pratiche nel back office: elenco, scheda, cronologia. */
import type { Request } from "express";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  assistitiTable,
  collaboratoriTable,
  commentiPraticaTable,
  db,
  documentiPraticaTable,
  eventiPraticaTable,
  personeTable,
  praticheTable,
  utentiTable,
} from "@workspace/db";
import { mappaAssistito, selezionaAssistiti } from "./assistiti";
import { nonTrovato } from "./errori";
import { mandatoDellaPratica, mappaCategorieAllegato, mappaDocumentoPratica, selezionaPratiche, type RigaPratica } from "./pratiche";

const utenteAutore = alias(utentiTable, "utente_autore_bo");

export const NOME_STATO_BOZZA = "bozza";

export const ETICHETTA_CANALE = { email: "email", whatsapp: "WhatsApp", chiamata: "chiamata", entrambi: "email e WhatsApp", tutti: "email, WhatsApp e chiamata" } as const;

/** Vero se il collaboratore ha fatto qualcosa a cui il back office non ha ancora risposto. */
export const aggiornataSql = sql`(${praticheTable.ultimaAttivitaCollaboratoreIl} is not null and (${praticheTable.ultimaAttivitaBackofficeIl} is null or ${praticheTable.ultimaAttivitaCollaboratoreIl} > ${praticheTable.ultimaAttivitaBackofficeIl}))`;

export function eAggiornata(r: Pick<RigaPratica, "ultimaAttivitaCollaboratoreIl" | "ultimaAttivitaBackofficeIl">): boolean {
  const c = r.ultimaAttivitaCollaboratoreIl;
  const b = r.ultimaAttivitaBackofficeIl;
  return c !== null && (b === null || c > b);
}

function gestore(r: RigaPratica) {
  return r.gestitaDaUtenteId && r.gestoreCognome ? { id: r.gestitaDaUtenteId, nome: r.gestoreNome ?? "", cognome: r.gestoreCognome } : null;
}

export function mappaRiepilogoBackoffice(r: RigaPratica) {
  return {
    id: r.id,
    numero: r.numero!,
    assistito: { id: r.assistitoId, nome: r.assNome, cognome: r.assCognome, codiceFiscale: r.assCf },
    collaboratore: { id: r.collaboratoreId, nome: r.collNome, cognome: r.collCognome, numeroSportello: r.collSportello },
    citta: r.assCitta,
    dataRichiesta: r.inviataIl!.toISOString(),
    stato: { id: r.statoId!, nome: r.statoNome, chiuso: r.statoChiuso },
    tipo: { id: r.tipoPraticaId, nome: r.tipoNome },
    gestitaDa: gestore(r),
    aggiornata: eAggiornata(r),
  };
}

/** Pratica inviata (le bozze sono private del collaboratore e non esistono per il back office). */
export async function caricaPraticaInviata(id: number): Promise<RigaPratica> {
  const [r] = await selezionaPratiche(and(eq(praticheTable.id, id), isNotNull(praticheTable.inviataIl)));
  if (!r) throw nonTrovato("Pratica non trovata.");
  return r;
}

export const descrizionePraticaBo = (p: { numero: number | null; assCognome: string; assNome: string; tipoNome: string }) =>
  `n. ${p.numero}: ${p.tipoNome} di ${p.assCognome} ${p.assNome}`;

/** Scheda completa per il back office. */
export async function dettaglioBackoffice(req: Request, id: number) {
  const p = await caricaPraticaInviata(id);
  const [ass] = await selezionaAssistiti(eq(assistitiTable.id, p.assistitoId));
  const [coll] = await db
    .select({ tipologia: collaboratoriTable.tipologia, email: personeTable.email, cellulare: personeTable.cellulare })
    .from(collaboratoriTable)
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .where(eq(collaboratoriTable.id, p.collaboratoreId));
  const mandato = await mandatoDellaPratica(p);
  const categorie = await mappaCategorieAllegato();
  const documenti = await db
    .select({ d: documentiPraticaTable, nome: utenteAutore.nome, cognome: utenteAutore.cognome })
    .from(documentiPraticaTable)
    .leftJoin(utenteAutore, eq(utenteAutore.id, documentiPraticaTable.caricatoDaUtenteId))
    .where(eq(documentiPraticaTable.praticaId, id))
    .orderBy(asc(documentiPraticaTable.id));
  const commenti = await db
    .select({ c: commentiPraticaTable, nome: utentiTable.nome, cognome: utentiTable.cognome, ruolo: utentiTable.ruolo })
    .from(commentiPraticaTable)
    .innerJoin(utentiTable, eq(utentiTable.id, commentiPraticaTable.utenteId))
    .where(eq(commentiPraticaTable.praticaId, id))
    .orderBy(asc(commentiPraticaTable.creatoIl), asc(commentiPraticaTable.id));
  const eventi = await db
    .select({ e: eventiPraticaTable, nome: utentiTable.nome, cognome: utentiTable.cognome })
    .from(eventiPraticaTable)
    .innerJoin(utentiTable, eq(utentiTable.id, eventiPraticaTable.utenteId))
    .where(eq(eventiPraticaTable.praticaId, id))
    .orderBy(asc(eventiPraticaTable.creatoIl), asc(eventiPraticaTable.id));

  const nomeColl = `${p.collCognome} ${p.collNome}`;
  const cron: { id: string; tipo: "invio" | "presa_in_carico" | "cambio_stato" | "allegato" | "commento"; creatoIl: Date; autore: string; descrizione: string }[] = [
    { id: "invio", tipo: "invio", creatoIl: p.inviataIl!, autore: nomeColl, descrizione: `Pratica inviata dal collaboratore (n. ${p.numero})` },
  ];
  for (const { e, nome, cognome } of eventi) {
    cron.push({
      id: `evento-${e.id}`,
      tipo: e.tipo,
      creatoIl: e.creatoIl,
      autore: `${cognome} ${nome}`,
      descrizione:
        e.tipo === "presa_in_carico"
          ? `Presa in carico${e.da ? ` (prima era in carico a ${e.da})` : ""}`
          : `Stato cambiato da "${e.da ?? "—"}" a "${e.a}"`,
    });
  }
  for (const { d, nome, cognome } of documenti) {
    if (!d.dopoInvio && !d.daBackoffice) continue;
    cron.push({
      id: `documento-${d.id}`,
      tipo: "allegato",
      creatoIl: d.caricatoIl,
      autore: cognome ? `${cognome} ${nome}` : "—",
      descrizione: d.daBackoffice
        ? `Allegato dell'ufficio: "${d.nome}"${d.categoriaId ? ` (${categorie.get(d.categoriaId) ?? "categoria eliminata"})` : ""}`
        : `Allegato aggiunto dal collaboratore: "${d.nome}"`,
    });
  }
  // Il primo commento coincide con il messaggio iniziale scritto all'invio: gia' mostrato nella scheda.
  const primo = commenti[0];
  const saltaId = primo && primo.ruolo === "collaboratore" && primo.c.testo === p.messaggio ? primo.c.id : null;
  for (const { c, nome, cognome, ruolo } of commenti) {
    if (c.id === saltaId) continue;
    cron.push({
      id: `commento-${c.id}`,
      tipo: "commento",
      creatoIl: c.creatoIl,
      autore: `${cognome} ${nome}`,
      descrizione:
        ruolo === "collaboratore"
          ? "Commento del collaboratore"
          : `Commento dell'ufficio${c.canaleAvviso ? ` (avviso alla sede: ${ETICHETTA_CANALE[c.canaleAvviso]})` : ""}`,
    });
  }
  cron.sort((a, b) => b.creatoIl.getTime() - a.creatoIl.getTime());

  const mappati = documenti.map(({ d, nome, cognome }) => mappaDocumentoPratica(d, nome, cognome, categorie));
  const u = req.utente!;
  return {
    id: p.id,
    numero: p.numero!,
    stato: { id: p.statoId!, nome: p.statoNome, chiuso: p.statoChiuso },
    tipo: { id: p.tipoPraticaId, nome: p.tipoNome },
    assistito: mappaAssistito(ass!, req),
    collaboratore: {
      id: p.collaboratoreId,
      nome: p.collNome,
      cognome: p.collCognome,
      numeroSportello: p.collSportello,
      tipologia: coll?.tipologia ?? "",
      email: coll?.email ?? null,
      cellulare: coll?.cellulare ?? "",
    },
    mandato: mandato ? { id: mandato.id, nome: mandato.nome, fileNome: mandato.fileNome, dimensione: mandato.dimensione } : null,
    documenti: mappati.filter((d) => !d.daUfficio),
    allegatiUfficio: mappati.filter((d) => d.daUfficio),
    messaggio: p.messaggio,
    commenti: commenti.map(({ c, nome, cognome, ruolo }) => ({
      id: c.id,
      testo: c.testo,
      autore: `${cognome} ${nome}`,
      ruolo,
      creatoIl: c.creatoIl.toISOString(),
      canaleAvviso: c.canaleAvviso ?? null,
      mio: c.utenteId === u.id,
    })),
    cronologia: cron.map((x) => ({ id: x.id, tipo: x.tipo, creatoIl: x.creatoIl.toISOString(), autore: x.autore, descrizione: x.descrizione })),
    inviataIl: p.inviataIl!.toISOString(),
    gestitaDa: gestore(p),
    aggiornata: eAggiornata(p),
    mieInCarico: p.gestitaDaUtenteId === u.id,
    puoEliminare: u.ruolo === "super_admin",
  };
}
