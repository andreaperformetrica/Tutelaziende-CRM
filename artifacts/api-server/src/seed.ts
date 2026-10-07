/**
 * Dati di prova (nomi e codici fiscali inventati). Eseguibile piu volte: salta quanto esiste gia.
 * Uso: pnpm --filter @workspace/api-server run seed
 */
import { eq, sql } from "drizzle-orm";
import { calcolaCodiceFiscale, normalizzaTelefono } from "@workspace/anagrafica";
import { assistitiTable, collaboratoriTable, db, pool, personeTable, utentiTable } from "@workspace/db";
import { trovaLuogo, trovaNazionalita } from "./lib/luoghi";
import { hashPassword } from "./lib/password";

const PASSWORD_PROVVISORIA = "Provvisoria2026!";

const interni = [
  { email: "super.admin@example.com", nome: "Alessandro", cognome: "Ferri", ruolo: "super_admin" },
  { email: "admin@example.com", nome: "Chiara", cognome: "Morelli", ruolo: "admin" },
  { email: "operatore1@example.com", nome: "Davide", cognome: "Conti", ruolo: "operatore" },
  { email: "operatore2@example.com", nome: "Sara", cognome: "Greco", ruolo: "operatore" },
] as const;

interface DatiCollaboratore {
  nome: string;
  cognome: string;
  sesso: "M" | "F";
  dataNascita: string;
  luogo: string;
  nazionalita: string;
  cellulare: string;
  sportello: string;
  tipologia: "CAF" | "PATRONATO";
  capogruppoSportello?: string;
}

const collaboratori: DatiCollaboratore[] = [
  { nome: "Marco", cognome: "Rossi", sesso: "M", dataNascita: "1975-03-12", luogo: "H501", nazionalita: "IT", cellulare: "3331000101", sportello: "101", tipologia: "CAF" },
  { nome: "Laura", cognome: "Bianchi", sesso: "F", dataNascita: "1982-07-25", luogo: "F205", nazionalita: "IT", cellulare: "3331000102", sportello: "102", tipologia: "PATRONATO", capogruppoSportello: "101" },
  { nome: "Paolo", cognome: "Neri", sesso: "M", dataNascita: "1968-11-02", luogo: "F839", nazionalita: "IT", cellulare: "3331000103", sportello: "103", tipologia: "CAF", capogruppoSportello: "101" },
  { nome: "Elena", cognome: "Popescu", sesso: "F", dataNascita: "1990-05-14", luogo: "Z129", nazionalita: "Z129", cellulare: "3331000104", sportello: "104", tipologia: "PATRONATO" },
];

interface DatiAssistito {
  nome: string;
  cognome: string;
  sesso: "M" | "F";
  dataNascita: string;
  luogo: string;
  nazionalita: string;
  cellulare: string;
  citta: string;
  indirizzo?: string;
  email?: string;
  sportello: string;
}

const assistiti: DatiAssistito[] = [
  { nome: "Giulia", cognome: "Verdi", sesso: "F", dataNascita: "1985-02-18", luogo: "H501", nazionalita: "IT", cellulare: "3342000001", citta: "Roma", indirizzo: "Via dei Mille 12", email: "giulia.verdi@example.com", sportello: "101" },
  { nome: "Antonio", cognome: "Russo", sesso: "M", dataNascita: "1959-09-30", luogo: "F839", nazionalita: "IT", cellulare: "3342000002", citta: "Napoli", sportello: "101" },
  { nome: "Francesca", cognome: "Gallo", sesso: "F", dataNascita: "1991-12-05", luogo: "F205", nazionalita: "IT", cellulare: "3342000003", citta: "Milano", indirizzo: "Corso Buenos Aires 40", sportello: "102" },
  { nome: "Luca", cognome: "Marino", sesso: "M", dataNascita: "1977-06-21", luogo: "L219", nazionalita: "IT", cellulare: "3342000004", citta: "Torino", sportello: "103" },
  { nome: "Ion", cognome: "Dumitru", sesso: "M", dataNascita: "1988-04-09", luogo: "Z129", nazionalita: "Z129", cellulare: "3342000005", citta: "Bologna", indirizzo: "Via Zamboni 7", sportello: "104" },
  { nome: "Maria", cognome: "Esposito", sesso: "F", dataNascita: "1949-01-27", luogo: "D612", nazionalita: "IT", cellulare: "3342000006", citta: "Firenze", sportello: "104" },
];

async function seedAssistiti() {
  for (const a of assistiti) {
    const luogo = trovaLuogo(a.luogo);
    const naz = trovaNazionalita(a.nazionalita);
    const cellulare = normalizzaTelefono(a.cellulare);
    if (!luogo || !naz || !cellulare) throw new Error(`Dati non validi per l'assistito ${a.cognome}`);
    const codiceFiscale = calcolaCodiceFiscale({ nome: a.nome, cognome: a.cognome, sesso: a.sesso, dataNascita: a.dataNascita, codiceLuogo: luogo.codice });
    if (!codiceFiscale) throw new Error(`Codice fiscale non calcolabile per ${a.cognome}`);
    const [esiste] = await db.select({ id: personeTable.id }).from(personeTable).where(eq(personeTable.codiceFiscale, codiceFiscale));
    if (esiste) continue;
    const [collab] = await db.select({ id: collaboratoriTable.id }).from(collaboratoriTable).where(eq(collaboratoriTable.numeroSportello, a.sportello));
    if (!collab) throw new Error(`Sportello ${a.sportello} inesistente: esegui prima il seed dei collaboratori`);
    await db.transaction(async (tx) => {
      const [persona] = await tx
        .insert(personeTable)
        .values({
          nome: a.nome, cognome: a.cognome, sesso: a.sesso, dataNascita: a.dataNascita,
          luogoNascitaCodice: luogo.codice, luogoNascitaNome: luogo.nome, luogoNascitaProvincia: luogo.provincia,
          luogoNascitaEstero: luogo.tipo === "stato", nazionalita: naz.codice, nazionalitaNome: naz.nome,
          codiceFiscale, email: a.email ?? null, cellulare,
        })
        .returning({ id: personeTable.id });
      await tx.insert(assistitiTable).values({ personaId: persona!.id, collaboratoreId: collab.id, citta: a.citta, indirizzo: a.indirizzo ?? null });
    });
    console.log(`Creato assistito ${a.cognome} ${a.nome} (${codiceFiscale}, sportello ${a.sportello})`);
  }
}

async function main() {
  const passwordHash = await hashPassword(PASSWORD_PROVVISORIA);

  for (const u of interni) {
    const [esiste] = await db.select({ id: utentiTable.id }).from(utentiTable).where(sql`lower(${utentiTable.email}) = ${u.email}`);
    if (esiste) continue;
    await db.insert(utentiTable).values({ ...u, passwordHash, deveCambiarePassword: true });
    console.log(`Creato utente interno ${u.email} (${u.ruolo})`);
  }

  for (const c of collaboratori) {
    const email = `${c.nome}.${c.cognome}@example.com`.toLowerCase();
    const [esiste] = await db.select({ id: collaboratoriTable.id }).from(collaboratoriTable).where(eq(collaboratoriTable.numeroSportello, c.sportello));
    if (esiste) continue;
    const luogo = trovaLuogo(c.luogo);
    const naz = trovaNazionalita(c.nazionalita);
    const cellulare = normalizzaTelefono(c.cellulare);
    if (!luogo || !naz || !cellulare) throw new Error(`Dati non validi per ${c.cognome}`);
    const codiceFiscale = calcolaCodiceFiscale({
      nome: c.nome,
      cognome: c.cognome,
      sesso: c.sesso,
      dataNascita: c.dataNascita,
      codiceLuogo: luogo.codice,
    });
    if (!codiceFiscale) throw new Error(`Codice fiscale non calcolabile per ${c.cognome}`);
    let capogruppoId: number | null = null;
    if (c.capogruppoSportello) {
      const [cg] = await db.select({ id: collaboratoriTable.id }).from(collaboratoriTable).where(eq(collaboratoriTable.numeroSportello, c.capogruppoSportello));
      capogruppoId = cg?.id ?? null;
    }
    await db.transaction(async (tx) => {
      const [utente] = await tx
        .insert(utentiTable)
        .values({ email, nome: c.nome, cognome: c.cognome, ruolo: "collaboratore", passwordHash, deveCambiarePassword: true })
        .returning({ id: utentiTable.id });
      const [persona] = await tx
        .insert(personeTable)
        .values({
          nome: c.nome,
          cognome: c.cognome,
          sesso: c.sesso,
          dataNascita: c.dataNascita,
          luogoNascitaCodice: luogo.codice,
          luogoNascitaNome: luogo.nome,
          luogoNascitaProvincia: luogo.provincia,
          luogoNascitaEstero: luogo.tipo === "stato",
          nazionalita: naz.codice,
          nazionalitaNome: naz.nome,
          codiceFiscale,
          email,
          cellulare,
        })
        .returning({ id: personeTable.id });
      await tx.insert(collaboratoriTable).values({
        utenteId: utente!.id,
        personaId: persona!.id,
        numeroSportello: c.sportello,
        tipologia: c.tipologia,
        capogruppoId,
      });
    });
    console.log(`Creato collaboratore ${c.cognome} ${c.nome} (${email}, ${codiceFiscale})`);
  }
  await seedAssistiti();
  console.log(`Password provvisoria di tutti gli utenti di prova: ${PASSWORD_PROVVISORIA}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
