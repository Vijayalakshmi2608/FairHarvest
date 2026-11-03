import { randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { getAddress, verifyMessage } from "ethers";
import type { Store } from "./db.js";
import type { AppConfig } from "./config.js";
import { now } from "./db.js";

export function issueNonce(store: Store, config: AppConfig, rawAddress: string) {
  const address = getAddress(rawAddress);
  const nonce = randomBytes(24).toString("hex");
  const expiresAt = now() + config.AUTH_NONCE_TTL_SECONDS;
  store.prepare("INSERT INTO auth_nonces(address, nonce, expires_at, used) VALUES(?,?,?,0) ON CONFLICT(address) DO UPDATE SET nonce=excluded.nonce, expires_at=excluded.expires_at, used=0").run(address.toLowerCase(), nonce, expiresAt);
  return { address, nonce, message: `FairHarvest login nonce: ${nonce}`, expiresAt };
}

export function requireWallet(store: Store) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const suppliedAddress = String(req.header("x-qie-address") || "");
      const signature = String(req.header("x-qie-signature") || "");
      const message = String(req.header("x-qie-message") || "");
      const address = getAddress(suppliedAddress);
      const row = store.prepare("SELECT nonce, expires_at, used FROM auth_nonces WHERE address = ?").get(address.toLowerCase()) as { nonce: string; expires_at: number; used: number } | undefined;
      if (!row || row.used || row.expires_at < now() || message !== `FairHarvest login nonce: ${row.nonce}`) return res.status(401).json({ error: "wallet authentication required" });
      if (getAddress(verifyMessage(message, signature)) !== address) return res.status(401).json({ error: "invalid wallet signature" });
      store.prepare("UPDATE auth_nonces SET used=1 WHERE address=?").run(address.toLowerCase());
      res.locals.walletAddress = address;
      next();
    } catch { return res.status(401).json({ error: "invalid wallet authentication" }); }
  };
}
