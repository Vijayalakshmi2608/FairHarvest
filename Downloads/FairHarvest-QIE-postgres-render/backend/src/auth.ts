import { randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { getAddress, verifyMessage } from "ethers";
import type { Store } from "./db.js";
import type { AppConfig } from "./config.js";
import { now } from "./db.js";

export async function issueNonce(store: Store, config: AppConfig, rawAddress: string) {
  const address = getAddress(rawAddress);
  const nonce = randomBytes(24).toString("hex");
  const expiresAt = now() + config.AUTH_NONCE_TTL_SECONDS;
  await store.query(`INSERT INTO auth_nonces(address, nonce, expires_at, used) VALUES($1,$2,$3,FALSE)
    ON CONFLICT(address) DO UPDATE SET nonce=EXCLUDED.nonce, expires_at=EXCLUDED.expires_at, used=FALSE`, [address.toLowerCase(), nonce, expiresAt]);
  return { address, nonce, message: `FairHarvest login nonce: ${nonce}`, expiresAt };
}

export function requireWallet(store: Store) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const suppliedAddress = String(req.header("x-qie-address") || "");
      const signature = String(req.header("x-qie-signature") || "");
      const message = String(req.header("x-qie-message") || "");
      const address = getAddress(suppliedAddress);
      const result = await store.query<{ nonce: string; expires_at: string; used: boolean }>("SELECT nonce, expires_at, used FROM auth_nonces WHERE address=$1", [address.toLowerCase()]);
      const row = result.rows[0];
      if (!row || row.used || Number(row.expires_at) < now() || message !== `FairHarvest login nonce: ${row.nonce}`) return res.status(401).json({ error: "wallet authentication required" });
      if (getAddress(verifyMessage(message, signature)) !== address) return res.status(401).json({ error: "invalid wallet signature" });
      await store.query("UPDATE auth_nonces SET used=TRUE WHERE address=$1", [address.toLowerCase()]);
      res.locals.walletAddress = address;
      return next();
    } catch { return res.status(401).json({ error: "invalid wallet authentication" }); }
  };
}
