// REST clients for the hosting services the Add Remote panel can browse.
// Pure apart from the injected fetch, so they are unit-tested with a fake (tests/hosting.test.ts).
import type {
  HostingAccount,
  HostingProvider,
  HostingRepo,
  HostingSignIn,
} from "../shared/types";

export type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<Response>;

/** What an account needs to call its API again later. Kept in the main process only. */
export interface Credentials {
  provider: HostingProvider;
  token: string;
  baseUrl: string;
  username?: string;
  organization?: string;
}

/** Stop paging after this many repositories. */
export const MAX_REPOS = 1000;

export const PROVIDER_NAMES: Record<HostingProvider, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  azure: "Azure DevOps",
  gitea: "Gitea",
};

const DEFAULT_ORIGIN: Record<HostingProvider, string> = {
  github: "https://github.com",
  gitlab: "https://gitlab.com",
  bitbucket: "https://bitbucket.org",
  azure: "https://dev.azure.com",
  gitea: "https://gitea.com",
};

/** `gitlab.example.com`, `https://gitlab.example.com/` → `https://gitlab.example.com`. */
export function normalizeOrigin(
  input: string | undefined,
  provider: HostingProvider,
): string {
  const raw = input?.trim();
  if (!raw) return DEFAULT_ORIGIN[provider];
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  return url.origin;
}

export function credentialsFor(req: HostingSignIn): Credentials {
  const token = req.token.trim();
  if (!token) throw new Error("A token is required");
  switch (req.provider) {
    case "github":
    case "gitlab":
    case "gitea":
      return {
        provider: req.provider,
        token,
        baseUrl: normalizeOrigin(req.baseUrl, req.provider),
      };
    case "bitbucket": {
      const username = req.username?.trim();
      if (!username)
        throw new Error(
          "Bitbucket needs your Atlassian account email or username",
        );
      return {
        provider: "bitbucket",
        token,
        baseUrl: DEFAULT_ORIGIN.bitbucket,
        username,
      };
    }
    case "azure": {
      const organization = req.organization
        ?.trim()
        .replace(/^https?:\/\/dev\.azure\.com\//i, "")
        .replace(/\/.*$/, "");
      if (!organization)
        throw new Error("Azure DevOps needs an organization name");
      return {
        provider: "azure",
        token,
        baseUrl: `${DEFAULT_ORIGIN.azure}/${organization}`,
        organization,
      };
    }
  }
}

function apiBase(c: Credentials): string {
  switch (c.provider) {
    case "github":
      return c.baseUrl === DEFAULT_ORIGIN.github
        ? "https://api.github.com"
        : `${c.baseUrl}/api/v3`;
    case "gitlab":
      return `${c.baseUrl}/api/v4`;
    case "bitbucket":
      return "https://api.bitbucket.org/2.0";
    case "azure":
      return c.baseUrl;
    case "gitea":
      return `${c.baseUrl}/api/v1`;
  }
}

function headers(c: Credentials): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "Lumiere-Git",
  };
  switch (c.provider) {
    case "github":
      h.Accept = "application/vnd.github+json";
      h.Authorization = `Bearer ${c.token}`;
      break;
    case "gitlab":
      h.Authorization = `Bearer ${c.token}`;
      break;
    case "bitbucket":
      h.Authorization = `Basic ${Buffer.from(`${c.username}:${c.token}`).toString("base64")}`;
      break;
    case "azure":
      h.Authorization = `Basic ${Buffer.from(`:${c.token}`).toString("base64")}`;
      break;
    case "gitea":
      h.Authorization = `token ${c.token}`;
      break;
  }
  return h;
}

async function getJson<T>(
  fetchFn: FetchFn,
  c: Credentials,
  url: string,
): Promise<{ body: T; res: Response }> {
  let res: Response;
  try {
    res = await fetchFn(url, { headers: headers(c) });
  } catch (e) {
    throw new Error(
      `Could not reach ${PROVIDER_NAMES[c.provider]}: ${(e as Error).message}`,
    );
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = "";
    try {
      const j = JSON.parse(text);
      detail =
        j.message ?? j.error?.message ?? j.error_description ?? j.error ?? "";
    } catch {
      /* not JSON */
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `${PROVIDER_NAMES[c.provider]} rejected the token (${res.status})${detail ? `: ${detail}` : ""}`,
      );
    }
    throw new Error(
      `${PROVIDER_NAMES[c.provider]} request failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  try {
    return { body: JSON.parse(text) as T, res };
  } catch {
    // Azure answers an invalid PAT with a 203 + HTML sign-in page.
    throw new Error(
      `${PROVIDER_NAMES[c.provider]} rejected the token (unexpected response)`,
    );
  }
}

/** Check the token and return who it belongs to. */
export async function verify(
  fetchFn: FetchFn,
  c: Credentials,
): Promise<Omit<HostingAccount, "persisted">> {
  const base = {
    provider: c.provider,
    baseUrl: c.baseUrl,
    organization: c.organization,
  };
  switch (c.provider) {
    case "github": {
      const { body: u } = await getJson<any>(fetchFn, c, `${apiBase(c)}/user`);
      return {
        ...base,
        login: u.login,
        displayName: u.name || u.login,
        avatarUrl: u.avatar_url ?? null,
      };
    }
    case "gitlab": {
      const { body: u } = await getJson<any>(fetchFn, c, `${apiBase(c)}/user`);
      return {
        ...base,
        login: u.username,
        displayName: u.name || u.username,
        avatarUrl: u.avatar_url ?? null,
      };
    }
    case "bitbucket": {
      const { body: u } = await getJson<any>(fetchFn, c, `${apiBase(c)}/user`);
      return {
        ...base,
        login: u.username ?? u.nickname ?? c.username!,
        displayName: u.display_name || u.username,
        avatarUrl: u.links?.avatar?.href ?? null,
      };
    }
    case "azure": {
      const { body } = await getJson<any>(
        fetchFn,
        c,
        `${apiBase(c)}/_apis/connectionData`,
      );
      const u = body.authenticatedUser ?? {};
      if (!u.id || u.id === "00000000-0000-0000-0000-000000000000")
        throw new Error("Azure DevOps rejected the token");
      const login =
        u.properties?.Account?.$value ??
        u.providerDisplayName ??
        c.organization!;
      return {
        ...base,
        login,
        displayName: u.providerDisplayName || login,
        avatarUrl: null,
      };
    }
    case "gitea": {
      const { body: u } = await getJson<any>(fetchFn, c, `${apiBase(c)}/user`);
      return {
        ...base,
        login: u.login,
        displayName: u.full_name || u.login,
        avatarUrl: u.avatar_url ?? null,
      };
    }
  }
}

/** Every repository the account can see, most recently active first where the API allows it. */
export async function listRepos(
  fetchFn: FetchFn,
  c: Credentials,
): Promise<HostingRepo[]> {
  const out: HostingRepo[] = [];
  const api = apiBase(c);
  switch (c.provider) {
    case "github": {
      for (let page = 1; out.length < MAX_REPOS; page++) {
        const { body } = await getJson<any[]>(
          fetchFn,
          c,
          `${api}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member&page=${page}`,
        );
        for (const r of body) {
          out.push({
            fullName: r.full_name,
            description: r.description ?? null,
            private: !!r.private,
            httpsUrl: r.clone_url,
            sshUrl: r.ssh_url ?? null,
            webUrl: r.html_url ?? null,
          });
        }
        if (body.length < 100) break;
      }
      break;
    }
    case "gitlab": {
      for (let page = 1; out.length < MAX_REPOS; page++) {
        const { body } = await getJson<any[]>(
          fetchFn,
          c,
          `${api}/projects?membership=true&simple=true&per_page=100&order_by=last_activity_at&page=${page}`,
        );
        for (const r of body) {
          out.push({
            fullName: r.path_with_namespace,
            description: r.description || null,
            private: r.visibility !== "public",
            httpsUrl: r.http_url_to_repo,
            sshUrl: r.ssh_url_to_repo ?? null,
            webUrl: r.web_url ?? null,
          });
        }
        if (body.length < 100) break;
      }
      break;
    }
    case "bitbucket": {
      let next: string | undefined =
        `${api}/repositories?role=member&pagelen=100&sort=-updated_on`;
      while (next && out.length < MAX_REPOS) {
        const { body }: { body: any } = await getJson<any>(fetchFn, c, next);
        for (const r of body.values ?? []) {
          const clone: { name: string; href: string }[] = r.links?.clone ?? [];
          const https = clone.find((l) => l.name === "https")?.href;
          if (!https) continue;
          out.push({
            fullName: r.full_name,
            description: r.description || null,
            private: !!r.is_private,
            // Clone links embed the account's own username; drop it so the URL is shareable.
            httpsUrl: https.replace(/^https:\/\/[^@/]+@/, "https://"),
            sshUrl: clone.find((l) => l.name === "ssh")?.href ?? null,
            webUrl: r.links?.html?.href ?? null,
          });
        }
        next = body.next;
      }
      break;
    }
    case "azure": {
      const { body } = await getJson<any>(
        fetchFn,
        c,
        `${api}/_apis/git/repositories?api-version=7.1`,
      );
      for (const r of body.value ?? []) {
        if (r.isDisabled) continue;
        out.push({
          fullName: `${r.project?.name ?? ""}/${r.name}`,
          description: r.project?.description || null,
          private: r.project?.visibility !== "public",
          httpsUrl: String(r.remoteUrl).replace(
            /^https:\/\/[^@/]+@/,
            "https://",
          ),
          sshUrl: r.sshUrl ?? null,
          webUrl: r.webUrl ?? null,
        });
      }
      out.sort((a, b) => a.fullName.localeCompare(b.fullName));
      break;
    }
    case "gitea": {
      // The server caps the page size (MAX_RESPONSE_ITEMS, 50 by default) and /user/repos has no
      // sort option, so page until an empty page or X-Total-Count, then sort by last update.
      const updated = new Map<HostingRepo, string>();
      for (let page = 1; out.length < MAX_REPOS; page++) {
        const { body, res } = await getJson<any[]>(
          fetchFn,
          c,
          `${api}/user/repos?limit=50&page=${page}`,
        );
        for (const r of body) {
          const repo: HostingRepo = {
            fullName: r.full_name,
            description: r.description || null,
            private: !!r.private,
            httpsUrl: r.clone_url,
            sshUrl: r.ssh_url || null,
            webUrl: r.html_url ?? null,
          };
          updated.set(repo, r.updated_at ?? "");
          out.push(repo);
        }
        const total = Number(res.headers.get("x-total-count"));
        if (!body.length || (total && out.length >= total)) break;
      }
      out.sort((a, b) => updated.get(b)!.localeCompare(updated.get(a)!));
      break;
    }
  }
  return out.slice(0, MAX_REPOS);
}

/** Where the user creates a token with the scopes this app needs. */
export function tokenPageUrl(
  provider: HostingProvider,
  baseUrl?: string,
  organization?: string,
): string {
  switch (provider) {
    case "github":
      return `${normalizeOrigin(baseUrl, "github")}/settings/tokens/new?scopes=repo,read:user&description=Lumiere%20Git`;
    case "gitlab":
      return `${normalizeOrigin(baseUrl, "gitlab")}/-/user_settings/personal_access_tokens?name=Lumiere%20Git&scopes=read_api,read_user,read_repository,write_repository`;
    case "bitbucket":
      return "https://id.atlassian.com/manage-profile/security/api-tokens";
    case "azure":
      return organization?.trim()
        ? `https://dev.azure.com/${encodeURIComponent(organization.trim())}/_usersSettings/tokens`
        : "https://aex.dev.azure.com/";
    case "gitea":
      return `${normalizeOrigin(baseUrl, "gitea")}/user/settings/applications`;
  }
}
