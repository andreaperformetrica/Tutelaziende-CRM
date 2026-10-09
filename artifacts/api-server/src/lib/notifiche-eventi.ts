/**
 * Eventi che generano notifiche. Ogni funzione va chiamata DENTRO la transazione dell'operazione
 * e restituisce gli id da passare a `recapitaInBackground` dopo il commit.
 *
 * Regola di riservatezza: nessun messaggio contiene il tipo di pratica ne' dati dell'assistito,
 * solo il numero della pratica e il link alla piattaforma.
 */
import { and, eq, inArray } from "drizzle-orm";
import { collaboratoriTable, personeTable, utentiTable } from "@workspace/db";
import type { Executor } from "./log";
import { formattaData } from "./eventi";
import { accodaNotifiche, type CanaleNotifica, type DestinatarioNotifica } from "./notifiche";

export type CanaleAvviso = "email" | "whatsapp" | "chiamata" | "entrambi" | "tutti";
const CANALI_AVVISO: Record<CanaleAvviso, CanaleNotifica[]> = {
  email: ["email"],
  whatsapp: ["whatsapp"],
  chiamata: ["chiamata"],
  entrambi: ["email", "whatsapp"],
  tutti: ["email", "whatsapp", "chiamata"],
};

type Ruolo = "super_admin" | "admin" | "operatore";
interface PraticaNotifica {
  id: number;
  numero: number;
  collaboratoreId: number;
}

interface Sede extends DestinatarioNotifica {
  sportello: string;
}

async function caricaSede(ex: Executor, collaboratoreId: number): Promise<Sede | null> {
  const [r] = await ex
    .select({
      utenteId: collaboratoriTable.utenteId,
      sportello: collaboratoriTable.numeroSportello,
      nome: personeTable.nome,
      emailPersona: personeTable.email,
      emailUtente: utentiTable.email,
      cellulare: personeTable.cellulare,
    })
    .from(collaboratoriTable)
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .innerJoin(utentiTable, eq(utentiTable.id, collaboratoriTable.utenteId))
    .where(eq(collaboratoriTable.id, collaboratoreId));
  if (!r) return null;
  return { utenteId: r.utenteId, nome: r.nome, email: r.emailPersona ?? r.emailUtente, cellulare: r.cellulare, sportello: r.sportello };
}

async function caricaBackoffice(ex: Executor, ruoli: Ruolo[]): Promise<DestinatarioNotifica[]> {
  const righe = await ex
    .select({ id: utentiTable.id, nome: utentiTable.nome, email: utentiTable.email })
    .from(utentiTable)
    .where(and(eq(utentiTable.attivo, true), inArray(utentiTable.ruolo, ruoli)))
    .orderBy(utentiTable.id);
  return righe.map((u) => ({ utenteId: u.id, nome: u.nome, email: u.email, cellulare: null }));
}

/** 1. Pratica inviata: alla sede che l'ha caricata (email e WhatsApp) e al back office (email). */
export async function notificaPraticaInviata(ex: Executor, p: PraticaNotifica): Promise<number[]> {
  const sede = await caricaSede(ex, p.collaboratoreId);
  const pratica = { id: p.id, numero: p.numero };
  const ids: number[] = [];
  if (sede) {
    ids.push(
      ...(await accodaNotifiche(ex, {
        evento: "pratica_inviata_sede",
        destinatari: [sede],
        canali: ["email", "whatsapp"],
        pratica,
        percorso: `/collaboratore/pratiche/${p.id}`,
        oggetto: `Pratica n. ${p.numero} inviata`,
        testoEmail: (d, link) => `Buongiorno ${d.nome},\n\nla pratica n. ${p.numero} è stata inviata all'ufficio.\n\nPuoi seguirla qui: ${link}`,
      })),
    );
  }
  ids.push(
    ...(await accodaNotifiche(ex, {
      evento: "pratica_inviata_backoffice",
      destinatari: await caricaBackoffice(ex, ["super_admin", "admin", "operatore"]),
      canali: ["email"],
      pratica,
      percorso: `/admin/pratiche/${p.id}`,
      oggetto: `Nuova pratica n. ${p.numero}`,
      testoEmail: (d, link) => `Buongiorno ${d.nome},\n\n${sede ? `la sede ${sede.sportello}` : "una sede"} ha inviato la pratica n. ${p.numero}.\n\nApri la pratica: ${link}`,
    })),
  );
  return ids;
}

/** 2. Nuovo commento dell'operatore: alla sede, sul canale scelto dall'operatore. */
export async function notificaCommentoUfficio(ex: Executor, p: PraticaNotifica, canale: CanaleAvviso): Promise<number[]> {
  const sede = await caricaSede(ex, p.collaboratoreId);
  if (!sede) return [];
  return accodaNotifiche(ex, {
    evento: "commento_ufficio",
    destinatari: [sede],
    canali: CANALI_AVVISO[canale],
    pratica: { id: p.id, numero: p.numero },
    percorso: `/collaboratore/pratiche/${p.id}`,
    oggetto: `Aggiornamento sulla pratica n. ${p.numero}`,
    testoEmail: (d, link) => `Buongiorno ${d.nome},\n\nc'è un aggiornamento sulla pratica n. ${p.numero}.\n\nAccedi alla piattaforma: ${link}`,
  });
}

/** 3. Risposta del collaboratore: all'operatore che ha in carico la pratica (se nessuno la gestisce, non parte nulla). */
export async function notificaRispostaSede(ex: Executor, p: PraticaNotifica, gestitaDaUtenteId: number | null): Promise<number[]> {
  if (gestitaDaUtenteId === null) return [];
  const [operatore] = (await caricaBackoffice(ex, ["super_admin", "admin", "operatore"])).filter((u) => u.utenteId === gestitaDaUtenteId);
  if (!operatore) return [];
  const sede = await caricaSede(ex, p.collaboratoreId);
  return accodaNotifiche(ex, {
    evento: "risposta_sede",
    destinatari: [operatore],
    canali: ["email"],
    pratica: { id: p.id, numero: p.numero },
    percorso: `/admin/pratiche/${p.id}`,
    oggetto: `Nuova risposta sulla pratica n. ${p.numero}`,
    testoEmail: (d, link) => `Buongiorno ${d.nome},\n\n${sede ? `la sede ${sede.sportello}` : "la sede"} ha risposto sulla pratica n. ${p.numero}, che hai in carico.\n\nApri la pratica: ${link}`,
  });
}

/** 4. Persona già registrata da un altro collaboratore: agli admin. Non cita i dati della persona. */
export async function notificaAnagraficaDuplicata(ex: Executor, collaboratoreId: number): Promise<number[]> {
  const sede = await caricaSede(ex, collaboratoreId);
  return accodaNotifiche(ex, {
    evento: "assistito_duplicato",
    destinatari: await caricaBackoffice(ex, ["super_admin", "admin"]),
    canali: ["email"],
    percorso: "/admin/segnalazioni",
    oggetto: "Nuova segnalazione: anagrafica già registrata",
    testoEmail: (d, link) =>
      `Buongiorno ${d.nome},\n\n${sede ? `la sede ${sede.sportello}` : "una sede"} ha tentato di registrare un'anagrafica già presente in piattaforma. È stata aperta una segnalazione.\n\nApri le segnalazioni: ${link}`,
  });
}

/** 5. Invito a un evento: alle sedi invitate (email e WhatsApp). Solo titolo, data, orario e luogo, nessun dato sensibile. */
export async function notificaInvitoEvento(
  ex: Executor,
  evento: { id: number; titolo: string; data: string; oraInizio: string; luogo: string },
  collaboratoriIds: number[],
): Promise<number[]> {
  const ids: number[] = [];
  const data = formattaData(evento.data);
  for (const cid of collaboratoriIds) {
    const sede = await caricaSede(ex, cid);
    if (!sede) continue;
    ids.push(
      ...(await accodaNotifiche(ex, {
        evento: "evento_invito",
        destinatari: [sede],
        canali: ["email", "whatsapp"],
        whatsappEvento: { titolo: evento.titolo, data },
        percorso: `/collaboratore/eventi/${evento.id}`,
        oggetto: `Invito: ${evento.titolo}`,
        testoEmail: (d, link) =>
          `Buongiorno ${d.nome},\n\nsei invitato all'evento "${evento.titolo}" del ${data} alle ${evento.oraInizio}, presso ${evento.luogo}.\n\nConferma la partecipazione e inserisci i partecipanti qui: ${link}`,
      })),
    );
  }
  return ids;
}

/** Estratto pratiche chiuse inviato alla sede per email, con il PDF in allegato (nessun dato degli assistiti nel testo). */
export async function accodaEstrattoInviato(ex: Executor, estratto: { id: number; collaboratoreId: number; dataEstratto: string }): Promise<number[]> {
  const sede = await caricaSede(ex, estratto.collaboratoreId);
  if (!sede) return [];
  const [a, m, g] = estratto.dataEstratto.split("-");
  const data = `${g}/${m}/${a}`;
  return accodaNotifiche(ex, {
    evento: "estratto_inviato",
    destinatari: [sede],
    canali: ["email"],
    estrattoId: estratto.id,
    percorso: "/",
    oggetto: `Estratto pratiche chiuse del ${data}`,
    testoEmail: (d) => `Buongiorno ${d.nome},\n\nin allegato trovi l'estratto delle pratiche chiuse del ${data}.`,
  });
}
