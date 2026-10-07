import { eq } from "drizzle-orm";
import { db, finestreBloccoTable, impostazioniTable, statiPraticaTable } from "@workspace/db";

const MARCATORE = "configurazione_pratiche_iniziale";

/** Stati iniziali: tutti modificabili dall'admin. Chiusa positivamente, Da pagare e Pagata contano come chiuse. */
const STATI_INIZIALI = [
  { nome: "Bozza", chiuso: false },
  { nome: "Inviata", chiuso: false },
  { nome: "In lavorazione", chiuso: false },
  { nome: "Inviata INPS", chiuso: false },
  { nome: "Chiusa positivamente", chiuso: true },
  { nome: "Da pagare", chiuso: true },
  { nome: "Pagata", chiuso: true },
];

/**
 * Inserisce una sola volta stati e orari iniziali. Il marcatore evita di ripristinarli dopo che l'admin
 * li ha modificati o eliminati. Eseguibile piu volte e in sicurezza.
 */
export async function inizializzaConfigurazionePratiche(): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [gia] = await tx.select().from(impostazioniTable).where(eq(impostazioniTable.chiave, MARCATORE));
    if (gia) return false;
    await tx.insert(statiPraticaTable).values(STATI_INIZIALI.map((s, i) => ({ ...s, ordine: i + 1 }))).onConflictDoNothing();
    // Blocco da venerdi 18:00 a lunedi 09:00 (Europe/Rome).
    await tx.insert(finestreBloccoTable).values({ giornoInizio: 5, minutoInizio: 18 * 60, giornoFine: 1, minutoFine: 9 * 60, attiva: true });
    await tx.insert(impostazioniTable).values({ chiave: MARCATORE, valore: new Date().toISOString() });
    return true;
  });
}
