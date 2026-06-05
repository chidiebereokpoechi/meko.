// Password hashing via Bun's native argon2id (memory-hard, the current OWASP default). Hash
// embeds its own salt + params, so verification needs only the stored string.

export function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: "argon2id" });
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return Bun.password.verify(plain, hash);
}
