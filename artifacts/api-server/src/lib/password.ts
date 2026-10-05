import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const LUNGHEZZA = 64;

function derivaChiave(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, LUNGHEZZA, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, chiave) => {
      if (err) reject(err);
      else resolve(chiave);
    });
  });
}

/** Formato: scrypt$N$r$p$salt(base64)$hash(base64). Le password non sono mai salvate in chiaro. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const chiave = await derivaChiave(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${chiave.toString("base64")}`;
}

export async function verificaPassword(password: string, hash: string): Promise<boolean> {
  const parti = hash.split("$");
  if (parti.length !== 6 || parti[0] !== "scrypt") return false;
  const [, n, r, p, salt, atteso] = parti as [string, string, string, string, string, string];
  const attesoBuf = Buffer.from(atteso, "base64");
  const chiave = await derivaChiave(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
  return chiave.length === attesoBuf.length && timingSafeEqual(chiave, attesoBuf);
}
