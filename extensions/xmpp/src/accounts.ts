import { readFileSync } from "node:fs";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import type { CoreConfig, XmppAccountConfig } from "./types.js";
import { normalizeXmppBareJid } from "./normalize.js";

const TRUTHY_ENV = new Set(["true", "1", "yes", "on"]);

export type ResolvedXmppAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  configured: boolean;
  jid: string; // Bare JID (user@domain)
  bareJid: string; // Same as jid
  resource: string;
  host: string;
  port: number;
  tls: boolean;
  password: string;
  passwordSource: "env" | "passwordFile" | "config" | "none";
  config: XmppAccountConfig;
};

function parseTruthy(value?: string): boolean {
  if (!value) {
    return false;
  }
  return TRUTHY_ENV.has(value.trim().toLowerCase());
}

function parseIntEnv(value?: string): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return undefined;
  }
  return parsed;
}

function parseListEnv(value?: string): string[] | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = value
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

function listConfiguredAccountIds(cfg: CoreConfig): string[] {
  const accounts = cfg.channels?.xmpp?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }
  const ids = new Set<string>();
  for (const key of Object.keys(accounts)) {
    if (key.trim()) {
      ids.add(normalizeAccountId(key));
    }
  }
  return [...ids];
}

function resolveAccountConfig(cfg: CoreConfig, accountId: string): XmppAccountConfig | undefined {
  const accounts = cfg.channels?.xmpp?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  const direct = accounts[accountId] as XmppAccountConfig | undefined;
  if (direct) {
    return direct;
  }
  const normalized = normalizeAccountId(accountId);
  const matchKey = Object.keys(accounts).find((key) => normalizeAccountId(key) === normalized);
  return matchKey ? (accounts[matchKey] as XmppAccountConfig | undefined) : undefined;
}

function mergeXmppAccountConfig(cfg: CoreConfig, accountId: string): XmppAccountConfig {
  const { accounts: _ignored, ...base } = (cfg.channels?.xmpp ?? {}) as XmppAccountConfig & {
    accounts?: unknown;
  };
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  const merged: XmppAccountConfig = { ...base, ...account };
  return merged;
}

function resolvePassword(accountId: string, merged: XmppAccountConfig) {
  // Environment variable password (for default account only)
  if (accountId === DEFAULT_ACCOUNT_ID) {
    const envPassword = process.env.XMPP_PASSWORD?.trim();
    if (envPassword) {
      return { password: envPassword, source: "env" as const };
    }
  }

  // Password file
  if (merged.passwordFile?.trim()) {
    try {
      const filePassword = readFileSync(merged.passwordFile.trim(), "utf-8").trim();
      if (filePassword) {
        return { password: filePassword, source: "passwordFile" as const };
      }
    } catch {
      // Ignore unreadable files; status will surface missing configuration
    }
  }

  // Direct config password
  const configPassword = merged.password?.trim();
  if (configPassword) {
    return { password: configPassword, source: "config" as const };
  }

  return { password: "", source: "none" as const };
}

export function listXmppAccountIds(cfg: CoreConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultXmppAccountId(cfg: CoreConfig): string {
  const ids = listXmppAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

export function resolveXmppAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedXmppAccount {
  const hasExplicitAccountId = Boolean(params.accountId?.trim());
  const baseEnabled = params.cfg.channels?.xmpp?.enabled !== false;

  const resolve = (accountId: string) => {
    const merged = mergeXmppAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;

    // TLS (default true)
    const tls =
      typeof merged.tls === "boolean"
        ? merged.tls
        : accountId === DEFAULT_ACCOUNT_ID && process.env.XMPP_TLS
          ? parseTruthy(process.env.XMPP_TLS)
          : true;

    // Port (default based on TLS)
    const envPort =
      accountId === DEFAULT_ACCOUNT_ID ? parseIntEnv(process.env.XMPP_PORT) : undefined;
    const port = merged.port ?? envPort ?? (tls ? 5222 : 5222);

    // Auto-join rooms from environment
    const envRooms =
      accountId === DEFAULT_ACCOUNT_ID ? parseListEnv(process.env.XMPP_ROOMS) : undefined;

    // JID
    const jid = (
      merged.jid?.trim() ||
      (accountId === DEFAULT_ACCOUNT_ID ? process.env.XMPP_JID?.trim() : "") ||
      ""
    ).trim();

    // Normalize to bare JID
    const bareJid = jid ? normalizeXmppBareJid(jid) : "";

    // Resource (default: "openclaw")
    const resource = (merged.resource?.trim() || "openclaw").trim();

    // Host (optional override)
    const host = (
      merged.host?.trim() ||
      (accountId === DEFAULT_ACCOUNT_ID ? process.env.XMPP_HOST?.trim() : "") ||
      ""
    ).trim();

    // Password resolution
    const passwordResolution = resolvePassword(accountId, merged);

    const config: XmppAccountConfig = {
      ...merged,
      autoJoinRooms: merged.autoJoinRooms ?? envRooms,
      tls,
      port,
      host,
      jid,
      resource,
    };

    return {
      accountId,
      enabled,
      name: merged.name?.trim() || undefined,
      configured: Boolean(jid && passwordResolution.password),
      jid: bareJid,
      bareJid,
      resource,
      host: host || bareJid.split("@")[1] || "", // Extract domain from JID if no host override
      port,
      tls,
      password: passwordResolution.password,
      passwordSource: passwordResolution.source,
      config,
    } satisfies ResolvedXmppAccount;
  };

  const normalized = normalizeAccountId(params.accountId);
  const primary = resolve(normalized);
  if (hasExplicitAccountId) {
    return primary;
  }
  if (primary.configured) {
    return primary;
  }

  // Fallback to default account if primary not configured
  const fallbackId = resolveDefaultXmppAccountId(params.cfg);
  if (fallbackId === primary.accountId) {
    return primary;
  }
  const fallback = resolve(fallbackId);
  if (!fallback.configured) {
    return primary;
  }
  return fallback;
}

export function listEnabledXmppAccounts(cfg: CoreConfig): ResolvedXmppAccount[] {
  return listXmppAccountIds(cfg)
    .map((accountId) => resolveXmppAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
