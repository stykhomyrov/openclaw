import type { XmppClient } from "./client.js";
import type { CoreConfig } from "./types.js";
import { resolveXmppAccount } from "./accounts.js";
import { connectXmppClient } from "./client.js";
import { normalizeXmppMessagingTarget, isRoomJid } from "./normalize.js";
import { makeXmppMessageId } from "./protocol.js";
import { getXmppRuntime } from "./runtime.js";

type SendXmppOptions = {
  accountId?: string;
  replyTo?: string;
  target?: string;
  client?: XmppClient;
};

export type SendXmppResult = {
  messageId: string;
  target: string;
};

function resolveTarget(to: string, opts?: SendXmppOptions): string {
  const fromArg = normalizeXmppMessagingTarget(to);
  if (fromArg) {
    return fromArg;
  }
  const fromOpt = normalizeXmppMessagingTarget(opts?.target ?? "");
  if (fromOpt) {
    return fromOpt;
  }
  throw new Error(`Invalid XMPP target: ${to}`);
}

export async function sendMessageXmpp(
  to: string,
  text: string,
  opts: SendXmppOptions = {},
): Promise<SendXmppResult> {
  const runtime = getXmppRuntime();
  const cfg = runtime.config.loadConfig() as CoreConfig;
  const account = resolveXmppAccount({
    cfg,
    accountId: opts.accountId,
  });

  if (!account.configured) {
    throw new Error(
      `XMPP is not configured for account "${account.accountId}" (need jid and password in channels.xmpp).`,
    );
  }

  const target = resolveTarget(to, opts);
  const tableMode = runtime.channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "xmpp",
    accountId: account.accountId,
  });
  const prepared = runtime.channel.text.convertMarkdownTables(text.trim(), tableMode);
  const payload = opts.replyTo ? `${prepared}\n\n[reply:${opts.replyTo}]` : prepared;

  if (!payload.trim()) {
    throw new Error("Message must be non-empty for XMPP sends");
  }

  // Determine message type (groupchat for MUC rooms, chat for direct messages)
  const messageType = isRoomJid(target) ? "groupchat" : "chat";

  const client = opts.client;
  let messageId: string;

  if (client?.isReady()) {
    messageId = await client.sendMessage(target, payload, messageType);
  } else {
    // Create transient client for one-off sends
    const transient = await connectXmppClient({
      jid: account.jid,
      password: account.password,
      resource: account.resource,
      host: account.host,
      port: account.port,
      tls: account.tls,
      connectTimeoutMs: 12000,
    });
    messageId = await transient.sendMessage(target, payload, messageType);
    await transient.stop();
  }

  runtime.channel.activity.record({
    channel: "xmpp",
    accountId: account.accountId,
    direction: "outbound",
  });

  return {
    messageId: messageId || makeXmppMessageId(),
    target,
  };
}
