/**
 * Dati di prova (nomi e codici fiscali inventati). Eseguibile piu volte: salta quanto esiste gia.
 * Uso: pnpm --filter @workspace/api-server run seed
 */
import { eq, sql } from "drizzle-orm";
import { calcolaCodiceFiscale, normalizzaTelefono } from "@workspace/anagrafica";
import { collaboratoriTable, db, pool, personeTable, utentiTable } from "@workspace/db";
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
  console.log(`Password provvisoria di tutti gli utenti di prova: ${PASSWORD_PROVVISORIA}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
