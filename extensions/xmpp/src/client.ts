import { client as createClient, xml } from "@xmpp/client";
import { makeXmppMessageId, parseDelayedDelivery, parseMessageCorrection, parseReplyTo } from "./protocol.js";

export type XmppClientOptions = {
  jid: string;
  password: string;
  resource?: string;
  host?: string;
  port?: number;
  tls?: boolean;
  autoJoinRooms?: string[];
  connectTimeoutMs?: number;
  abortSignal?: AbortSignal;
  onMessage?: (event: XmppMessageEvent) => void | Promise<void>;
  onPresence?: (event: XmppPresenceEvent) => void;
  onError?: (error: Error) => void;
  onOnline?: () => void;
  onOffline?: () => void;
};

export type XmppMessageEvent = {
  from: string;
  to: string;
  body: string;
  type: "chat" | "groupchat" | "normal" | "headline" | "error";
  id?: string;
  delay?: Date;
  replace?: string; // XEP-0308 message correction
  replyTo?: string; // XEP-0461 message reply
};

export type XmppPresenceEvent = {
  from: string;
  type?: "subscribe" | "subscribed" | "unsubscribe" | "unsubscribed" | "unavailable" | "probe" | "error";
  status?: string;
  show?: "away" | "chat" | "dnd" | "xa";
  priority?: number;
};

export type XmppClient = {
  jid: string;
  bareJid: string;
  isReady: () => boolean;
  sendMessage: (to: string, body: string, type?: "chat" | "groupchat") => Promise<string>;
  sendPresence: (options?: { type?: string; to?: string; status?: string; show?: string }) => Promise<void>;
  joinRoom: (roomJid: string, nickname?: string) => Promise<void>;
  leaveRoom: (roomJid: string, nickname?: string) => Promise<void>;
  sendChatState: (to: string, state: "composing" | "paused" | "active" | "inactive" | "gone") => Promise<void>;
  sendReceipt: (to: string, messageId: string) => Promise<void>;
  stop: () => Promise<void>;
};

/**
 * Connect to XMPP server and return client interface
 */
export async function connectXmppClient(options: XmppClientOptions): Promise<XmppClient> {
  // Extract domain from JID
  const [localpart, domain] = options.jid.split("@");
  if (!localpart || !domain) {
    throw new Error(`Invalid JID format: ${options.jid}`);
  }

  const resource = options.resource || "openclaw";

  // Create XMPP client
  const xmpp = createClient({
    service: options.host
      ? `xmpp${options.tls !== false ? "s" : ""}://${options.host}:${options.port || 5222}`
      : undefined,
    domain,
    resource,
    username: localpart,
    password: options.password,
  });

  let isOnline = false;
  let fullJid = "";

  // Handle stanzas
  xmpp.on("stanza", async (stanza) => {
    try {
      if (stanza.is("message")) {
        await handleMessageStanza(stanza, options.onMessage);
      } else if (stanza.is("presence")) {
        handlePresenceStanza(stanza, options.onPresence);
      }
    } catch (err) {
      if (options.onError) {
        options.onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  });

  // Handle errors
  xmpp.on("error", (err) => {
    if (options.onError) {
      options.onError(err);
    }
  });

  // Handle online event
  xmpp.on("online", async (address) => {
    isOnline = true;
    fullJid = address.toString();

    // Send initial presence
    await xmpp.send(xml("presence"));

    // Join MUC rooms
    if (options.autoJoinRooms) {
      for (const roomJid of options.autoJoinRooms) {
        try {
          await joinMucRoom(xmpp, roomJid, resource);
        } catch (err) {
          if (options.onError) {
            options.onError(new Error(`Failed to join room ${roomJid}: ${String(err)}`));
          }
        }
      }
    }

    if (options.onOnline) {
      options.onOnline();
    }
  });

  // Handle offline event
  xmpp.on("offline", () => {
    isOnline = false;
    if (options.onOffline) {
      options.onOffline();
    }
  });

  // Handle abort signal
  if (options.abortSignal) {
    options.abortSignal.addEventListener("abort", () => {
      xmpp.stop().catch(() => {});
    });
  }

  // Connect with timeout
  const connectPromise = xmpp.start();
  const timeoutMs = options.connectTimeoutMs || 15000;

  if (timeoutMs > 0) {
    await Promise.race([
      connectPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("XMPP connection timeout")), timeoutMs)
      ),
    ]);
  } else {
    await connectPromise;
  }

  // Return client interface
  return {
    jid: fullJid,
    bareJid: `${localpart}@${domain}`,
    isReady: () => isOnline,

    sendMessage: async (to, body, type = "chat") => {
      const id = makeXmppMessageId();
      await xmpp.send(
        xml("message", { to, type, id },
          xml("body", {}, body)
        )
      );
      return id;
    },

    sendPresence: async (opts = {}) => {
      const attrs: Record<string, string> = {};
      if (opts.type) attrs.type = opts.type;
      if (opts.to) attrs.to = opts.to;

      const children = [];
      if (opts.status) {
        children.push(xml("status", {}, opts.status));
      }
      if (opts.show) {
        children.push(xml("show", {}, opts.show));
      }

      await xmpp.send(xml("presence", attrs, ...children));
    },

    joinRoom: async (roomJid, nickname) => {
      await joinMucRoom(xmpp, roomJid, nickname || resource);
    },

    leaveRoom: async (roomJid, nickname) => {
      const occupantJid = `${roomJid}/${nickname || resource}`;
      await xmpp.send(xml("presence", { to: occupantJid, type: "unavailable" }));
    },

    sendChatState: async (to, state) => {
      // XEP-0085: Chat State Notifications
      await xmpp.send(
        xml("message", { to, type: "chat" },
          xml(state, { xmlns: "http://jabber.org/protocol/chatstates" })
        )
      );
    },

    sendReceipt: async (to, messageId) => {
      // XEP-0184: Message Delivery Receipts
      await xmpp.send(
        xml("message", { to },
          xml("received", { xmlns: "urn:xmpp:receipts", id: messageId })
        )
      );
    },

    stop: async () => {
      await xmpp.stop();
    },
  };
}

/**
 * Join a MUC room.
 * After joining, submit an empty owner config form to ensure the room is
 * unlocked (handles the "201 room created" case where the room stays locked
 * until the creator accepts a configuration).
 */
async function joinMucRoom(xmpp: any, roomJid: string, nickname: string): Promise<void> {
  const occupantJid = `${roomJid}/${nickname}`;
  await xmpp.send(
    xml("presence", { to: occupantJid },
      xml("x", { xmlns: "http://jabber.org/protocol/muc" })
    )
  );

  // Small delay so the server can process the join before we send the config.
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Accept default room config (no-op if already configured, unlocks if new).
  await xmpp.send(
    xml("iq", { to: roomJid, type: "set", id: `cfg-${Date.now()}` },
      xml("query", { xmlns: "http://jabber.org/protocol/muc#owner" },
        xml("x", { xmlns: "jabber:x:data", type: "submit" })
      )
    )
  );
}

/**
 * Handle incoming message stanzas
 */
async function handleMessageStanza(
  stanza: any,
  onMessage?: (event: XmppMessageEvent) => void | Promise<void>
): Promise<void> {
  const type = (stanza.attrs.type || "normal") as XmppMessageEvent["type"];
  const from = stanza.attrs.from;
  const to = stanza.attrs.to;
  const id = stanza.attrs.id;
  const body = stanza.getChildText("body");

  if (!body || !from || !onMessage) {
    return;
  }

  // Parse XEPs
  const delay = parseDelayedDelivery(stanza);
  const replace = parseMessageCorrection(stanza);
  const replyTo = parseReplyTo(stanza);

  const event: XmppMessageEvent = {
    from,
    to,
    body,
    type,
    id,
    delay,
    replace,
    replyTo,
  };

  await onMessage(event);
}

/**
 * Handle incoming presence stanzas
 */
function handlePresenceStanza(
  stanza: any,
  onPresence?: (event: XmppPresenceEvent) => void
): void {
  if (!onPresence) {
    return;
  }

  const from = stanza.attrs.from;
  const type = stanza.attrs.type;
  const status = stanza.getChildText("status");
  const show = stanza.getChildText("show");
  const priorityText = stanza.getChildText("priority");
  const priority = priorityText ? parseInt(priorityText, 10) : undefined;

  const event: XmppPresenceEvent = {
    from,
    type,
    status,
    show: show as any,
    priority,
  };

  onPresence(event);
}
