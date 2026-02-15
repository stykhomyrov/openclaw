import type { RuntimeEnv } from "openclaw/plugin-sdk";
import type { CoreConfig, XmppInboundMessage } from "./types.js";
import { resolveXmppAccount } from "./accounts.js";
import { connectXmppClient, type XmppClient, type XmppMessageEvent } from "./client.js";
import { handleXmppInbound } from "./inbound.js";
import { normalizeXmppBareJid, isRoomJid } from "./normalize.js";
import { parseMucStanza } from "./muc.js";
import { makeXmppMessageId } from "./protocol.js";
import { getXmppRuntime } from "./runtime.js";

export type XmppMonitorOptions = {
  accountId?: string;
  config?: CoreConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  onMessage?: (message: XmppInboundMessage, client: XmppClient) => void | Promise<void>;
};

export function resolveXmppInboundTarget(params: {
  from: string;
  type: string;
}): {
  isGroup: boolean;
  target: string;
  senderJid: string;
  senderBareJid: string;
  senderNickname?: string;
  senderResource?: string;
} {
  const isGroup = params.type === "groupchat";

  if (isGroup) {
    // MUC groupchat: from = room@conference.domain/nickname
    const [roomJid, nickname] = params.from.split("/");
    return {
      isGroup: true,
      target: roomJid,
      senderJid: params.from,
      senderBareJid: roomJid,
      senderNickname: nickname,
    };
  }

  // Direct message: from = user@domain/resource
  const bareJid = normalizeXmppBareJid(params.from);
  const resource = params.from.includes("/") ? params.from.split("/")[1] : undefined;

  return {
    isGroup: false,
    target: bareJid,
    senderJid: params.from,
    senderBareJid: bareJid,
    senderResource: resource,
  };
}

export async function monitorXmppProvider(opts: XmppMonitorOptions): Promise<{ stop: () => void }> {
  const core = getXmppRuntime();
  const cfg = opts.config ?? (core.config.loadConfig() as CoreConfig);
  const account = resolveXmppAccount({
    cfg,
    accountId: opts.accountId,
  });

  const runtime: RuntimeEnv = opts.runtime ?? {
    log: (message: string) => core.logging.getChildLogger().info(message),
    error: (message: string) => core.logging.getChildLogger().error(message),
    exit: () => {
      throw new Error("Runtime exit not available");
    },
  };

  if (!account.configured) {
    throw new Error(
      `XMPP is not configured for account "${account.accountId}" (need jid and password in channels.xmpp).`,
    );
  }

  const logger = core.logging.getChildLogger({
    channel: "xmpp",
    accountId: account.accountId,
  });

  let client: XmppClient | null = null;

  client = await connectXmppClient({
    jid: account.jid,
    password: account.password,
    resource: account.resource,
    host: account.host,
    port: account.port,
    tls: account.tls,
    autoJoinRooms: account.config.autoJoinRooms,
    abortSignal: opts.abortSignal,
    onError: (error) => {
      logger.error(`[${account.accountId}] XMPP error: ${error.message}`);
    },
    onOnline: () => {
      logger.info(
        `[${account.accountId}] connected to XMPP as ${account.jid}${account.config.autoJoinRooms?.length ? ` (joined ${account.config.autoJoinRooms.length} rooms)` : ""}`
      );
    },
    onMessage: async (event: XmppMessageEvent) => {
      if (!client) {
        return;
      }

      // Skip messages from self (check bare JID)
      const fromBareJid = normalizeXmppBareJid(event.from);
      if (fromBareJid === account.bareJid) {
        return;
      }

      const inboundTarget = resolveXmppInboundTarget({
        from: event.from,
        type: event.type,
      });

      const message: XmppInboundMessage = {
        messageId: event.id || makeXmppMessageId(),
        target: inboundTarget.target,
        senderJid: inboundTarget.senderJid,
        senderBareJid: inboundTarget.senderBareJid,
        senderNickname: inboundTarget.senderNickname,
        senderResource: inboundTarget.senderResource,
        text: event.body,
        timestamp: event.delay ? event.delay.getTime() : Date.now(),
        isGroup: inboundTarget.isGroup,
        stanzaId: event.id,
      };

      core.channel.activity.record({
        channel: "xmpp",
        accountId: account.accountId,
        direction: "inbound",
        at: message.timestamp,
      });

      if (opts.onMessage) {
        await opts.onMessage(message, client);
        return;
      }

      await handleXmppInbound({
        message,
        account,
        config: cfg,
        runtime,
        client,
        statusSink: opts.statusSink,
      });
    },
  });

  logger.info(
    `[${account.accountId}] XMPP connection established as ${client.jid}`,
  );

  return {
    stop: () => {
      client?.stop();
      client = null;
    },
  };
}
