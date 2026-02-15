import {
  createReplyPrefixOptions,
  logInboundDrop,
  resolveControlCommandGate,
  type OpenClawConfig,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";
import type { ResolvedXmppAccount } from "./accounts.js";
import type { CoreConfig, XmppInboundMessage } from "./types.js";
import type { XmppClient } from "./client.js";
import { normalizeXmppAllowlist, resolveXmppAllowlistMatch } from "./normalize.js";
import {
  resolveXmppMentionGate,
  resolveXmppGroupAccessGate,
  resolveXmppRoomMatch,
  resolveXmppGroupSenderAllowed,
  resolveXmppRequireMention,
} from "./policy.js";
import { getXmppRuntime } from "./runtime.js";
import { sendMessageXmpp } from "./send.js";

const CHANNEL_ID = "xmpp" as const;

const escapeXmppRegexLiteral = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function deliverXmppReply(params: {
  payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string; replyToId?: string };
  target: string;
  accountId: string;
  client?: XmppClient;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
}) {
  const text = params.payload.text ?? "";
  const mediaList = params.payload.mediaUrls?.length
    ? params.payload.mediaUrls
    : params.payload.mediaUrl
      ? [params.payload.mediaUrl]
      : [];

  if (!text.trim() && mediaList.length === 0) {
    return;
  }

  const mediaBlock = mediaList.length
    ? mediaList.map((url) => `Attachment: ${url}`).join("\n")
    : "";
  const combined = text.trim()
    ? mediaBlock
      ? `${text.trim()}\n\n${mediaBlock}`
      : text.trim()
    : mediaBlock;

  if (params.client) {
    const messageType = params.target.includes("@conference.") || params.target.includes("@muc.")
      ? "groupchat"
      : "chat";
    await params.client.sendMessage(params.target, combined, messageType);
  } else {
    await sendMessageXmpp(params.target, combined, {
      accountId: params.accountId,
      replyTo: params.payload.replyToId,
    });
  }
  params.statusSink?.({ lastOutboundAt: Date.now() });
}

export async function handleXmppInbound(params: {
  message: XmppInboundMessage;
  account: ResolvedXmppAccount;
  config: CoreConfig;
  runtime: RuntimeEnv;
  client?: XmppClient;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { message, account, config, runtime, client, statusSink } = params;
  const core = getXmppRuntime();

  const rawBody = message.text?.trim() ?? "";
  if (!rawBody) {
    return;
  }

  statusSink?.({ lastInboundAt: message.timestamp });

  const senderDisplay = message.isGroup
    ? `${message.senderNickname}@${message.target}`
    : message.senderBareJid;

  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const defaultGroupPolicy = config.channels?.defaults?.groupPolicy;
  const groupPolicy = account.config.groupPolicy ?? defaultGroupPolicy ?? "allowlist";

  const configAllowFrom = normalizeXmppAllowlist(account.config.allowFrom);
  const configGroupAllowFrom = normalizeXmppAllowlist(account.config.groupAllowFrom);
  const storeAllowFrom = await core.channel.pairing.readAllowFromStore(CHANNEL_ID).catch(() => []);
  const storeAllowList = normalizeXmppAllowlist(storeAllowFrom);

  const roomMatch = resolveXmppRoomMatch({
    rooms: account.config.rooms,
    target: message.target,
  });

  // Group access gate
  if (message.isGroup) {
    const groupAccess = resolveXmppGroupAccessGate({ groupPolicy, roomMatch });
    if (!groupAccess.allowed) {
      runtime.log?.(`xmpp: drop room ${message.target} (${groupAccess.reason})`);
      return;
    }
  }

  const directRoomAllowFrom = normalizeXmppAllowlist(roomMatch.roomConfig?.allowFrom);
  const wildcardRoomAllowFrom = normalizeXmppAllowlist(roomMatch.wildcardConfig?.allowFrom);
  const roomAllowFrom =
    directRoomAllowFrom.length > 0 ? directRoomAllowFrom : wildcardRoomAllowFrom;

  const effectiveAllowFrom = [...configAllowFrom, ...storeAllowList].filter(Boolean);
  const effectiveGroupAllowFrom = [...configGroupAllowFrom, ...storeAllowList].filter(Boolean);

  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config as OpenClawConfig,
    surface: CHANNEL_ID,
  });
  const useAccessGroups = config.commands?.useAccessGroups !== false;
  const senderAllowedForCommands = resolveXmppAllowlistMatch({
    allowFrom: message.isGroup ? effectiveGroupAllowFrom : effectiveAllowFrom,
    message,
  }).allowed;
  const hasControlCommand = core.channel.text.hasControlCommand(rawBody, config as OpenClawConfig);
  const commandGate = resolveControlCommandGate({
    useAccessGroups,
    authorizers: [
      {
        configured: (message.isGroup ? effectiveGroupAllowFrom : effectiveAllowFrom).length > 0,
        allowed: senderAllowedForCommands,
      },
    ],
    allowTextCommands,
    hasControlCommand,
  });
  const commandAuthorized = commandGate.commandAuthorized;

  // Group sender allowlist check
  if (message.isGroup) {
    const senderAllowed = resolveXmppGroupSenderAllowed({
      groupPolicy,
      message,
      outerAllowFrom: effectiveGroupAllowFrom,
      innerAllowFrom: roomAllowFrom,
    });
    if (!senderAllowed) {
      runtime.log?.(`xmpp: drop group sender ${senderDisplay} (policy=${groupPolicy})`);
      return;
    }
  } else {
    // DM policy enforcement
    if (dmPolicy === "disabled") {
      runtime.log?.(`xmpp: drop DM sender=${senderDisplay} (dmPolicy=disabled)`);
      return;
    }
    if (dmPolicy !== "open") {
      const dmAllowed = resolveXmppAllowlistMatch({
        allowFrom: effectiveAllowFrom,
        message,
      }).allowed;
      if (!dmAllowed) {
        if (dmPolicy === "pairing") {
          const { code, created } = await core.channel.pairing.upsertPairingRequest({
            channel: CHANNEL_ID,
            id: message.senderBareJid.toLowerCase(),
            meta: { name: message.senderBareJid },
          });
          if (created) {
            try {
              const reply = core.channel.pairing.buildPairingReply({
                channel: CHANNEL_ID,
                idLine: `Your XMPP JID: ${message.senderBareJid}`,
                code,
              });
              await deliverXmppReply({
                payload: { text: reply },
                target: message.senderBareJid,
                accountId: account.accountId,
                client,
                statusSink,
              });
            } catch (err) {
              runtime.error?.(`xmpp: pairing reply failed for ${senderDisplay}: ${String(err)}`);
            }
          }
        }
        runtime.log?.(`xmpp: drop DM sender ${senderDisplay} (dmPolicy=${dmPolicy})`);
        return;
      }
    }
  }

  // Block unauthorized control commands in groups
  if (message.isGroup && commandGate.shouldBlock) {
    logInboundDrop({
      log: (line) => runtime.log?.(line),
      channel: CHANNEL_ID,
      reason: "control command (unauthorized)",
      target: senderDisplay,
    });
    return;
  }

  // Mention detection
  const mentionRegexes = core.channel.mentions.buildMentionRegexes(config as OpenClawConfig);
  const botJid = account.jid;
  const botLocalpart = botJid.split("@")[0];
  const explicitMentionRegex = botLocalpart
    ? new RegExp(`\\b${escapeXmppRegexLiteral(botLocalpart)}\\b[:,]?`, "i")
    : null;
  const wasMentioned =
    core.channel.mentions.matchesMentionPatterns(rawBody, mentionRegexes) ||
    (explicitMentionRegex ? explicitMentionRegex.test(rawBody) : false);

  const requireMention = message.isGroup
    ? resolveXmppRequireMention({
        roomConfig: roomMatch.roomConfig,
        wildcardConfig: roomMatch.wildcardConfig,
      })
    : false;

  const mentionGate = resolveXmppMentionGate({
    isGroup: message.isGroup,
    requireMention,
    wasMentioned,
    hasControlCommand,
    allowTextCommands,
    commandAuthorized,
  });
  if (mentionGate.shouldSkip) {
    runtime.log?.(`xmpp: drop room ${message.target} (${mentionGate.reason})`);
    return;
  }

  // Route to agent
  const peerId = message.target;
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config as OpenClawConfig,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: message.isGroup ? "group" : "direct",
      id: peerId,
    },
  });

  const fromLabel = message.isGroup ? message.target : senderDisplay;
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config as OpenClawConfig);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "XMPP",
    from: fromLabel,
    timestamp: message.timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const groupSystemPrompt = roomMatch.roomConfig?.systemPrompt?.trim() || undefined;

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: message.isGroup ? `xmpp:room:${message.target}` : `xmpp:${message.senderBareJid}`,
    To: `xmpp:${peerId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: message.isGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: message.senderNickname || message.senderBareJid,
    SenderId: message.senderBareJid,
    GroupSubject: message.isGroup ? message.target : undefined,
    GroupSystemPrompt: message.isGroup ? groupSystemPrompt : undefined,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    WasMentioned: message.isGroup ? wasMentioned : undefined,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `xmpp:${peerId}`,
    CommandAuthorized: commandAuthorized,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`xmpp: failed updating session meta: ${String(err)}`);
    },
  });

  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config as OpenClawConfig,
    agentId: route.agentId,
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config as OpenClawConfig,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: async (payload) => {
        await deliverXmppReply({
          payload: payload as {
            text?: string;
            mediaUrls?: string[];
            mediaUrl?: string;
            replyToId?: string;
          },
          target: peerId,
          accountId: account.accountId,
          client,
          statusSink,
        });
      },
      onError: (err, info) => {
        runtime.error?.(`xmpp ${info.kind} reply failed: ${String(err)}`);
      },
    },
    replyOptions: {
      skillFilter: roomMatch.roomConfig?.skills,
      onModelSelected,
      disableBlockStreaming:
        typeof account.config.blockStreaming === "boolean"
          ? !account.config.blockStreaming
          : undefined,
    },
  });
}
