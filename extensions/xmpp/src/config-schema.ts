import {
  BlockStreamingCoalesceSchema,
  DmConfigSchema,
  DmPolicySchema,
  GroupPolicySchema,
  MarkdownConfigSchema,
  ToolPolicySchema,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk";
import { z } from "zod";

const XmppRoomSchema = z
  .object({
    requireMention: z.boolean().optional(),
    tools: ToolPolicySchema,
    toolsBySender: z.record(z.string(), ToolPolicySchema).optional(),
    skills: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    systemPrompt: z.string().optional(),
  })
  .strict();

export const XmppAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    jid: z.string().optional(), // Jabber ID (user@domain)
    password: z.string().optional(),
    passwordFile: z.string().optional(),
    resource: z.string().optional().default("openclaw"), // XMPP resource
    host: z.string().optional(), // Optional server override
    port: z.number().int().min(1).max(65535).optional(), // Default: 5222
    tls: z.boolean().optional().default(true), // Default: use TLS
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    rooms: z.record(z.string(), XmppRoomSchema.optional()).optional(), // MUC rooms
    autoJoinRooms: z.array(z.string()).optional(), // Rooms to auto-join
    mentionPatterns: z.array(z.string()).optional(),
    markdown: MarkdownConfigSchema,
    historyLimit: z.number().int().min(0).optional(),
    dmHistoryLimit: z.number().int().min(0).optional(),
    dms: z.record(z.string(), DmConfigSchema.optional()).optional(),
    textChunkLimit: z.number().int().positive().optional(),
    blockStreaming: z.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    responsePrefix: z.string().optional(),
    mediaMaxMb: z.number().positive().optional(),
  })
  .strict();

export const XmppAccountSchema = XmppAccountSchemaBase.superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.xmpp.dmPolicy="open" requires channels.xmpp.allowFrom to include "*"',
  });
});

export const XmppConfigSchema = XmppAccountSchemaBase.extend({
  accounts: z.record(z.string(), XmppAccountSchema.optional()).optional(),
}).superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.xmpp.dmPolicy="open" requires channels.xmpp.allowFrom to include "*"',
  });
});
