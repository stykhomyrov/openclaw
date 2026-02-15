import type {
  BlockStreamingCoalesceConfig,
  DmConfig,
  DmPolicy,
  GroupPolicy,
  GroupToolPolicyBySenderConfig,
  GroupToolPolicyConfig,
  MarkdownConfig,
  OpenClawConfig,
} from "openclaw/plugin-sdk";

export type XmppRoomConfig = {
  requireMention?: boolean;
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
  skills?: string[];
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  systemPrompt?: string;
};

export type XmppAccountConfig = {
  name?: string;
  enabled?: boolean;
  jid?: string; // Jabber ID (user@domain)
  password?: string;
  passwordFile?: string;
  resource?: string; // XMPP resource (default: "openclaw")
  host?: string; // Optional server override
  port?: number; // Default: 5222
  tls?: boolean; // Default: true
  dmPolicy?: DmPolicy;
  allowFrom?: Array<string | number>;
  groupPolicy?: GroupPolicy;
  groupAllowFrom?: Array<string | number>;
  rooms?: Record<string, XmppRoomConfig>; // MUC rooms configuration
  autoJoinRooms?: string[]; // Rooms to auto-join on connect
  mentionPatterns?: string[];
  markdown?: MarkdownConfig;
  historyLimit?: number;
  dmHistoryLimit?: number;
  dms?: Record<string, DmConfig>;
  textChunkLimit?: number;
  blockStreaming?: boolean;
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
  responsePrefix?: string;
  mediaMaxMb?: number;
};

export type XmppConfig = XmppAccountConfig & {
  accounts?: Record<string, XmppAccountConfig>;
};

export type CoreConfig = OpenClawConfig & {
  channels?: OpenClawConfig["channels"] & {
    xmpp?: XmppConfig;
  };
};

export type XmppInboundMessage = {
  messageId: string;
  /** Conversation peer id: room JID for MUC, sender bare JID for DMs. */
  target: string;
  /** Raw stanza target. */
  rawTarget?: string;
  /** Full JID (user@domain/resource) */
  senderJid: string;
  /** Bare JID (user@domain) */
  senderBareJid: string;
  /** Resource part (if present) */
  senderResource?: string;
  /** MUC nickname (for groupchat) */
  senderNickname?: string;
  text: string;
  timestamp: number;
  isGroup: boolean;
  /** Stanza ID (for receipts/corrections) */
  stanzaId?: string;
};

export type XmppProbe = {
  ok: boolean;
  jid: string;
  host: string;
  port: number;
  tls: boolean;
  latencyMs?: number;
  error?: string;
  /** Server features discovered via disco#info */
  features?: string[];
};
