import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
  getChatChannelMeta,
  PAIRING_APPROVED_MESSAGE,
  setAccountEnabledInConfigSection,
  deleteAccountFromConfigSection,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";
import type { CoreConfig, XmppProbe } from "./types.js";
import {
  listXmppAccountIds,
  resolveDefaultXmppAccountId,
  resolveXmppAccount,
  type ResolvedXmppAccount,
} from "./accounts.js";
import { XmppConfigSchema } from "./config-schema.js";
import { monitorXmppProvider } from "./monitor.js";
import {
  normalizeXmppMessagingTarget,
  looksLikeXmppJid,
  isRoomJid,
  normalizeXmppAllowEntry,
} from "./normalize.js";
import { xmppOnboardingAdapter } from "./onboarding.js";
import { resolveXmppRoomMatch, resolveXmppRequireMention } from "./policy.js";
import { probeXmpp } from "./probe.js";
import { getXmppRuntime } from "./runtime.js";
import { sendMessageXmpp } from "./send.js";

const meta = getChatChannelMeta("xmpp");

function normalizePairingTarget(raw: string): string {
  const normalized = normalizeXmppAllowEntry(raw);
  if (!normalized) {
    return "";
  }
  return normalized.split("/")[0]?.trim() ?? ""; // Strip resource
}

export const xmppPlugin: ChannelPlugin<ResolvedXmppAccount, XmppProbe> = {
  id: "xmpp",
  meta: {
    ...meta,
    quickstartAllowFrom: true,
  },
  onboarding: xmppOnboardingAdapter,
  pairing: {
    idLabel: "xmppJid",
    normalizeAllowEntry: (entry) => normalizeXmppAllowEntry(entry),
    notifyApproval: async ({ id }) => {
      const target = normalizePairingTarget(id);
      if (!target) {
        throw new Error(`invalid XMPP pairing id: ${id}`);
      }
      await sendMessageXmpp(target, PAIRING_APPROVED_MESSAGE);
    },
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    blockStreaming: true,
    edit: true,
    reply: true,
  },
  reload: { configPrefixes: ["channels.xmpp"] },
  configSchema: buildChannelConfigSchema(XmppConfigSchema),
  config: {
    listAccountIds: (cfg) => listXmppAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) => resolveXmppAccount({ cfg: cfg as CoreConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultXmppAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "xmpp",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "xmpp",
        accountId,
        clearBaseFields: [
          "jid",
          "password",
          "passwordFile",
          "resource",
          "host",
          "port",
          "tls",
          "autoJoinRooms",
        ],
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      jid: account.jid,
      enabled: account.enabled,
      configured: account.configured,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      resolveXmppAccount({ cfg: cfg as CoreConfig, accountId }).config.allowFrom ?? [],
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom.map((entry) => normalizeXmppAllowEntry(String(entry))).filter(Boolean),
  },
  security: {
    resolveDmPolicy: ({ account, accountId, cfg }) => {
      const useAccountPath = Boolean((cfg as CoreConfig).channels?.xmpp?.accounts?.[accountId]);
      const basePath = useAccountPath
        ? `channels.xmpp.accounts.${accountId}.`
        : "channels.xmpp.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: `${basePath}allowFrom`,
        approveHint: formatPairingApproveHint("xmpp"),
        normalizeEntry: (raw) => normalizeXmppAllowEntry(raw),
      };
    },
    collectWarnings: ({ account }) => {
      const warnings: string[] = [];
      if (account.config.groupPolicy === "open") {
        warnings.push(
          'XMPP rooms: groupPolicy="open" allows all rooms. Prefer groupPolicy="allowlist" with rooms config.'
        );
      }
      if (!account.tls) {
        warnings.push("XMPP TLS is disabled; credentials sent in plaintext.");
      }
      return warnings;
    },
  },
  groups: {
    resolveRequireMention: ({ cfg, accountId, groupId }) => {
      const account = resolveXmppAccount({ cfg: cfg as CoreConfig, accountId });
      if (!groupId) return true;
      const match = resolveXmppRoomMatch({ rooms: account.config.rooms, target: groupId });
      return resolveXmppRequireMention({
        roomConfig: match.roomConfig,
        wildcardConfig: match.wildcardConfig,
      });
    },
    resolveToolPolicy: ({ cfg, accountId, groupId }) => {
      const account = resolveXmppAccount({ cfg: cfg as CoreConfig, accountId });
      if (!groupId) return undefined;
      const match = resolveXmppRoomMatch({ rooms: account.config.rooms, target: groupId });
      return match.roomConfig?.tools ?? match.wildcardConfig?.tools;
    },
  },
  messaging: {
    normalizeTarget: normalizeXmppMessagingTarget,
    targetResolver: {
      looksLikeId: looksLikeXmppJid,
      hint: "<user@domain|room@conference.domain>",
    },
  },
  resolver: {
    resolveTargets: async ({ inputs, kind }) => {
      return inputs.map((input) => {
        const normalized = normalizeXmppMessagingTarget(input);
        if (!normalized) {
          return { input, resolved: false, note: "invalid XMPP JID" };
        }

        if (kind === "group") {
          return {
            input,
            resolved: isRoomJid(normalized),
            id: normalized,
            name: normalized,
            note: isRoomJid(normalized) ? undefined : "not a room JID",
          };
        }

        return {
          input,
          resolved: !isRoomJid(normalized),
          id: normalized,
          name: normalized,
          note: isRoomJid(normalized) ? "expected user JID" : undefined,
        };
      });
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveXmppAccount({ cfg: cfg as CoreConfig, accountId });
      const ids = new Set<string>();

      for (const entry of account.config.allowFrom ?? []) {
        const normalized = normalizeXmppAllowEntry(String(entry));
        if (normalized && normalized !== "*") {
          ids.add(normalized);
        }
      }

      return Array.from(ids)
        .filter((id) => (query ? id.includes(query) : true))
        .slice(0, limit || undefined)
        .map((id) => ({ kind: "user", id }));
    },
    listGroups: async ({ cfg, accountId, query, limit }) => {
      const account = resolveXmppAccount({ cfg: cfg as CoreConfig, accountId });
      const roomIds = new Set<string>();

      for (const room of account.config.autoJoinRooms ?? []) {
        roomIds.add(room);
      }
      for (const room of Object.keys(account.config.rooms ?? {})) {
        if (room !== "*") {
          roomIds.add(room);
        }
      }

      return Array.from(roomIds)
        .filter((id) => (query ? id.includes(query) : true))
        .slice(0, limit || undefined)
        .map((id) => ({ kind: "group", id, name: id }));
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => getXmppRuntime().channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "markdown",
    textChunkLimit: 10000,
    sendText: async ({ to, text, accountId, replyToId }) => {
      const result = await sendMessageXmpp(to, text, { accountId, replyTo: replyToId });
      return { channel: "xmpp", ...result };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, replyToId }) => {
      const combined = mediaUrl ? `${text}\n\n${mediaUrl}` : text;
      const result = await sendMessageXmpp(to, combined, { accountId, replyTo: replyToId });
      return { channel: "xmpp", ...result };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    probeAccount: async ({ cfg, account, timeoutMs }) =>
      probeXmpp(cfg as CoreConfig, { accountId: account.accountId, timeoutMs }),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      jid: account.jid,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
      probe,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.configured) {
        throw new Error(`XMPP not configured for account "${account.accountId}"`);
      }

      ctx.log?.info(`Starting XMPP provider for ${account.jid}`);

      const { stop } = await monitorXmppProvider({
        accountId: account.accountId,
        config: ctx.cfg as CoreConfig,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
      });

      return { stop };
    },
  },
};
