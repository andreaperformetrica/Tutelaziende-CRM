/**
 * Genera artifacts/api-server/src/data/luoghi.json: comuni italiani (attuali e soppressi) e stati esteri
 * con il codice catastale (Belfiore) usato nel calcolo del codice fiscale.
 *
 * Fonti:
 *  - ISTAT, Elenco-comuni-italiani.csv (comuni attuali, nomi corretti, sigla provincia, codice catastale)
 *  - pacchetto codice-fiscale-js (storico completo dei codici catastali, comuni soppressi e stati esteri Zxxx)
 *
 * Per aggiornare l'elenco: aggiornare la versione di codice-fiscale-js e rieseguire
 *   pnpm --filter @workspace/scripts run genera-luoghi
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ISTAT_URL = "https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.csv";
const radice = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const destinazione = path.join(radice, "artifacts/api-server/src/data/luoghi.json");

type VoceStorico = [codice: string, provincia: string, nome: string, flag: number];

function caricaStorico(): VoceStorico[] {
  const require = createRequire(import.meta.url);
  const pacchetto = path.dirname(require.resolve("codice-fiscale-js/package.json"));
  const sorgente = readFileSync(path.join(pacchetto, "src/lista-comuni.js"), "utf8");
  const corpo = sorgente.replace("export const COMUNI =", "").trim().replace(/;$/, "");
  return new Function(`return (${corpo});`)() as VoceStorico[];
}

const PARTICELLE = new Set([
  "di", "del", "della", "dei", "delle", "dello", "degli", "e", "ed", "in", "il", "la", "le", "lo",
  "nel", "nella", "sul", "sulla", "sopra", "sotto", "al", "alla", "a", "su", "con", "da", "dal",
  "dalla", "ai", "alle", "tra", "fra", "per",
]);

const ARTICOLI_ELISI = new Set(["d", "l", "dell", "nell", "all", "sull", "dall", "coll", "un"]);

function maiuscolaIniziale(parte: string): string {
  return parte
    .split("-")
    .map((p) => (p ? p[0]!.toUpperCase() + p.slice(1) : p))
    .join("-");
}

/** Converte "REGGIO NELL'EMILIA" in "Reggio nell'Emilia" (euristica per i nomi storici). */
function titolo(maiuscolo: string): string {
  return maiuscolo
    .toLowerCase()
    .split(" ")
    .map((parola, i) => {
      if (i > 0 && PARTICELLE.has(parola)) return parola;
      const [testa, ...resto] = parola.split("'");
      const primo = i > 0 && resto.length > 0 && ARTICOLI_ELISI.has(testa!) ? testa! : maiuscolaIniziale(testa!);
      return [primo, ...resto.map(maiuscolaIniziale)].join("'");
    })
    .join(" ");
}

function leggiIstat(testo: string) {
  const comuni = new Map<string, { nome: string; provincia: string; alias: Set<string> }>();
  for (const riga of testo.split("\n")) {
    const r = riga.replace(/\r$/, "");
    if (!/^\d{2};/.test(r)) continue;
    const c = r.split(";");
    const codice = c[19]?.trim();
    const nome = c[6]?.trim();
    if (!codice || !nome) continue;
    const alias = new Set<string>();
    for (const extra of [c[5], c[7]]) {
      for (const parte of (extra ?? "").split("/")) {
        const p = parte.trim();
        if (p && p !== nome) alias.add(p);
      }
    }
    comuni.set(codice, { nome, provincia: c[14]!.trim(), alias });
  }
  return comuni;
}

async function main() {
  const risposta = await fetch(ISTAT_URL);
  if (!risposta.ok) throw new Error(`Download ISTAT fallito: ${risposta.status}`);
  const testo = new TextDecoder("windows-1252").decode(await risposta.arrayBuffer());
  const istat = leggiIstat(testo);
  const storico = caricaStorico();

  const perCodice = new Map<string, VoceStorico[]>();
  for (const v of storico) {
    const lista = perCodice.get(v[0]) ?? [];
    lista.push(v);
    perCodice.set(v[0], lista);
  }

  const comuni: Array<[string, string, string, 0 | 1, string[]]> = [];
  const stati: Array<[string, string, 0 | 1]> = [];

  for (const [codice, voci] of perCodice) {
    const principale = voci.find((v) => v[3] === 1) ?? voci[0]!;
    if (principale[1] === "EE") {
      stati.push([codice, titolo(principale[2]), voci.some((v) => v[3] === 1) ? 1 : 0]);
      continue;
    }
    const attuale = istat.get(codice);
    const alias = new Set<string>();
    for (const v of voci) alias.add(titolo(v[2]));
    if (attuale) for (const a of attuale.alias) alias.add(a);
    const nome = attuale?.nome ?? titolo(principale[2]);
    alias.delete(nome);
    comuni.push([codice, nome, attuale?.provincia ?? principale[1], attuale ? 1 : 0, [...alias]]);
  }
  // Comuni ISTAT eventualmente assenti dallo storico del pacchetto
  for (const [codice, c] of istat) {
    if (!perCodice.has(codice)) comuni.push([codice, c.nome, c.provincia, 1, [...c.alias]]);
  }

  comuni.sort((a, b) => a[1].localeCompare(b[1], "it") || a[0].localeCompare(b[0]));
  stati.sort((a, b) => a[1].localeCompare(b[1], "it"));

  const attuali = comuni.filter((c) => c[3] === 1).length;
  writeFileSync(destinazione, JSON.stringify({ comuni, stati }));
  console.log(`Comuni: ${comuni.length} (attuali ${attuali}), stati: ${stati.length}`);
  console.log(`Scritto ${destinazione}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
