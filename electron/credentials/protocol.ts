// Pure pieces of the git credential-helper protocol (gitcredentials(7)), tested in tests/credentials.test.ts.
import type { HostingProvider } from "../shared/types";

/** The key=value attributes git sends a helper on stdin, and that the helper answers with. */
export type CredentialFields = Record<string, string>;

export function parseCredential(text: string): CredentialFields {
  const out: CredentialFields = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    // Multi-valued keys (`capability[]`, `wwwauth[]`) aren't needed here; the last one wins.
    out[line.slice(0, i)] = line.slice(i + 1).replace(/\r$/, "");
  }
  return out;
}

export function formatCredential(fields: CredentialFields): string {
  let out = "";
  for (const [k, v] of Object.entries(fields)) {
    // Newlines or NULs would break the protocol; git would reject them anyway.
    if (/[\n\0]/.test(k) || /[\n\0]/.test(v)) continue;
    out += `${k}=${v}\n`;
  }
  return out;
}

/** `protocol=https`, `host=github.com` → `https://github.com`. */
export function credentialOrigin(fields: CredentialFields): string {
  return `${fields.protocol ?? "https"}://${fields.host ?? ""}`;
}

/** Stable key for one saved credential. */
export function credentialKey(
  fields: CredentialFields,
  username = fields.username ?? "",
): string {
  return `${credentialOrigin(fields)}#${username}`;
}

export interface HostingMatch {
  provider: HostingProvider;
  baseUrl: string;
  login: string;
}

/** Username git should send with a hosting token over HTTPS. */
export function tokenUsername(a: HostingMatch): string {
  switch (a.provider) {
    case "github":
    case "gitea":
      return a.login;
    case "gitlab":
      return "oauth2";
    case "bitbucket":
      // Atlassian API tokens authenticate git over HTTPS with this fixed username.
      return "x-bitbucket-api-token-auth";
    case "azure":
      return "pat";
  }
}

/** The signed-in hosting account that can answer a credential request, if any. */
export function matchHosting<T extends HostingMatch>(
  fields: CredentialFields,
  accounts: T[],
): T | undefined {
  if (fields.protocol !== "https" || !fields.host) return undefined;
  return accounts.find((a) => {
    let url: URL;
    try {
      url = new URL(a.baseUrl);
    } catch {
      return false;
    }
    if (url.protocol !== "https:" || url.host !== fields.host) return false;
    // A username in the remote URL must be one the token accepts. Bitbucket checks it; the others ignore it.
    if (
      a.provider === "bitbucket" &&
      fields.username &&
      fields.username !== tokenUsername(a)
    )
      return false;
    return true;
  });
}
