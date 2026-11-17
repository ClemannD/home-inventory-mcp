/**
 * Passkeys (WebAuthn) for sign-in. Each member adds their own from Settings
 * after signing in with an email code. Sign-in uses discoverable credentials,
 * so the authenticator picks the passkey and no email is typed.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON
} from "@simplewebauthn/server";
import type { PasskeyInfo } from "../../shared/api";
import { all, first, iso, run } from "../db";
import { appName, type Env } from "../env";
import { base64UrlToBytes, bytesToBase64Url, randomToken } from "./crypto";
import { userById, type UserRow } from "./users";
import type { CodeResult } from "./codes";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** The host the page was served from, which passkeys are bound to. */
export interface RelyingParty {
  readonly rpID: string;
  readonly origin: string;
}

export const relyingParty = (url: URL): RelyingParty => ({ rpID: url.hostname, origin: url.origin });

const ok = <T>(value: T): CodeResult<T> => ({ ok: true, value });
const failed = (status: number, error: string): CodeResult<never> => ({ ok: false, status, error });

const parseTransports = (raw: string | null): AuthenticatorTransport[] | undefined =>
  raw ? (JSON.parse(raw) as AuthenticatorTransport[]) : undefined;

const utf8 = (value: string): Uint8Array<ArrayBuffer> => {
  const encoded = new TextEncoder().encode(value);
  const out = new Uint8Array(new ArrayBuffer(encoded.length));
  out.set(encoded);
  return out;
};

const putChallenge = async (env: Env, kind: "login" | "register", challenge: string, userId: string | null): Promise<string> => {
  const id = randomToken(18);
  await run(
    env.DB,
    "INSERT INTO challenges (id, kind, challenge, user_id, expires_at) VALUES (?, ?, ?, ?, ?)",
    id,
    kind,
    challenge,
    userId,
    Date.now() + CHALLENGE_TTL_MS
  );
  return id;
};

/** Single use: the row is deleted whether or not it is still valid. */
const takeChallenge = async (
  env: Env,
  id: string,
  kind: "login" | "register"
): Promise<{ challenge: string; userId: string | null } | undefined> => {
  const row = await first<{ challenge: string; user_id: string | null; expires_at: number }>(
    env.DB,
    "DELETE FROM challenges WHERE id = ? AND kind = ? RETURNING challenge, user_id, expires_at",
    id,
    kind
  );
  if (!row || row.expires_at < Date.now()) return undefined;
  return { challenge: row.challenge, userId: row.user_id };
};

interface PasskeyRow {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  name: string | null;
  created_at: number;
  last_used_at: number | null;
}

// Sign-in ----------------------------------------------------------------------

export const loginOptions = async (
  env: Env,
  rp: RelyingParty
): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> => {
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "preferred" });
  return { challengeId: await putChallenge(env, "login", options.challenge, null), options };
};

export const loginVerify = async (
  env: Env,
  rp: RelyingParty,
  challengeId: string,
  response: AuthenticationResponseJSON
): Promise<CodeResult<UserRow>> => {
  const pending = await takeChallenge(env, challengeId, "login");
  if (!pending) return failed(400, "Sign-in expired. Try again.");
  const row = await first<PasskeyRow>(env.DB, "SELECT * FROM passkeys WHERE id = ?", response.id);
  if (!row) return failed(401, "This passkey isn't registered here.");
  let verified;
  try {
    const transports = parseTransports(row.transports);
    verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: row.id,
        publicKey: base64UrlToBytes(row.public_key),
        counter: row.counter,
        ...(transports ? { transports } : {})
      },
      requireUserVerification: false
    });
  } catch (e) {
    return failed(401, e instanceof Error ? e.message : "Passkey verification failed.");
  }
  if (!verified.verified) return failed(401, "Passkey verification failed.");
  await run(env.DB, "UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?", verified.authenticationInfo.newCounter, Date.now(), row.id);
  const user = await userById(env, row.user_id);
  return user ? ok(user) : failed(401, "This passkey's member was removed.");
};

// Adding a passkey (signed in) -------------------------------------------------

export const registerOptions = async (
  env: Env,
  rp: RelyingParty,
  user: UserRow
): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> => {
  const existing = await all<{ id: string; transports: string | null }>(env.DB, "SELECT id, transports FROM passkeys WHERE user_id = ?", user.id);
  const options = await generateRegistrationOptions({
    rpName: appName(env),
    rpID: rp.rpID,
    userName: user.email,
    userID: utf8(user.id),
    userDisplayName: user.name || user.email,
    attestationType: "none",
    excludeCredentials: existing.map((c) => {
      const transports = parseTransports(c.transports);
      return { id: c.id, ...(transports ? { transports } : {}) };
    }),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" }
  });
  return { challengeId: await putChallenge(env, "register", options.challenge, user.id), options };
};

export const registerVerify = async (
  env: Env,
  rp: RelyingParty,
  user: UserRow,
  challengeId: string,
  response: RegistrationResponseJSON,
  name: string | null
): Promise<CodeResult<PasskeyInfo>> => {
  const pending = await takeChallenge(env, challengeId, "register");
  if (!pending || pending.userId !== user.id) return failed(400, "Setup expired. Try again.");
  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false
    });
  } catch (e) {
    return failed(400, e instanceof Error ? e.message : "Passkey registration failed.");
  }
  if (!verified.verified) return failed(400, "Passkey registration failed.");
  const cred = verified.registrationInfo.credential;
  const now = Date.now();
  await run(
    env.DB,
    "INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    cred.id,
    user.id,
    bytesToBase64Url(cred.publicKey),
    cred.counter,
    cred.transports ? JSON.stringify(cred.transports) : null,
    name,
    now
  );
  return ok({ id: cred.id, name, created_at: iso(now)!, last_used_at: null });
};

export const listPasskeys = async (env: Env, userId: string): Promise<PasskeyInfo[]> =>
  (await all<PasskeyRow>(env.DB, "SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at", userId)).map((p) => ({
    id: p.id,
    name: p.name,
    created_at: iso(p.created_at)!,
    last_used_at: iso(p.last_used_at)
  }));

export const deletePasskey = async (env: Env, userId: string, id: string): Promise<boolean> =>
  (await run(env.DB, "DELETE FROM passkeys WHERE id = ? AND user_id = ?", id, userId)).meta.changes > 0;
