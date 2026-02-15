import type { XmppAccountConfig, XmppRoomConfig } from "./types.js";
import type { XmppInboundMessage } from "./types.js";
import { normalizeXmppAllowlist, resolveXmppAllowlistMatch } from "./normalize.js";

export type XmppRoomMatch = {
  allowed: boolean;
  roomConfig?: XmppRoomConfig;
  wildcardConfig?: XmppRoomConfig;
  hasConfiguredRooms: boolean;
};

export type XmppGroupAccessGate = {
  allowed: boolean;
  reason: string;
};

/**
 * Resolve room configuration match
 * Returns config for specific room or wildcard, plus allowlist status
 */
export function resolveXmppRoomMatch(params: {
  rooms?: Record<string, XmppRoomConfig>;
  target: string;
}): XmppRoomMatch {
  const rooms = params.rooms ?? {};
  const hasConfiguredRooms = Object.keys(rooms).length > 0;

  // Direct match
  const direct = rooms[params.target];
  if (direct) {
    return {
      allowed: true,
      roomConfig: direct,
      wildcardConfig: rooms["*"],
      hasConfiguredRooms,
    };
  }

  // Case-insensitive match (JIDs are case-insensitive for local part)
  const targetLower = params.target.toLowerCase();
  const directKey = Object.keys(rooms).find((key) => key.toLowerCase() === targetLower);
  if (directKey) {
    const matched = rooms[directKey];
    if (matched) {
      return {
        allowed: true,
        roomConfig: matched,
        wildcardConfig: rooms["*"],
        hasConfiguredRooms,
      };
    }
  }

  // Wildcard match
  const wildcard = rooms["*"];
  if (wildcard) {
    return {
      allowed: true,
      wildcardConfig: wildcard,
      hasConfiguredRooms,
    };
  }

  return {
    allowed: false,
    hasConfiguredRooms,
  };
}

/**
 * Resolve group access gate
 * Determines if a group message should be allowed based on policy and room config
 */
export function resolveXmppGroupAccessGate(params: {
  groupPolicy: XmppAccountConfig["groupPolicy"];
  roomMatch: XmppRoomMatch;
}): XmppGroupAccessGate {
  const policy = params.groupPolicy ?? "allowlist";

  if (policy === "disabled") {
    return { allowed: false, reason: "groupPolicy=disabled" };
  }

  // Allowlist mode: require explicit room configuration
  if (policy === "allowlist") {
    if (!params.roomMatch.hasConfiguredRooms) {
      return {
        allowed: false,
        reason: "groupPolicy=allowlist and no rooms configured",
      };
    }
    if (!params.roomMatch.allowed) {
      return { allowed: false, reason: "not allowlisted" };
    }
  }

  // Check for explicit disables
  if (
    params.roomMatch.roomConfig?.enabled === false ||
    params.roomMatch.wildcardConfig?.enabled === false
  ) {
    return { allowed: false, reason: "disabled" };
  }

  return { allowed: true, reason: policy === "open" ? "open" : "allowlisted" };
}

/**
 * Resolve whether mention is required for a room
 */
export function resolveXmppRequireMention(params: {
  roomConfig?: XmppRoomConfig;
  wildcardConfig?: XmppRoomConfig;
}): boolean {
  if (params.roomConfig?.requireMention !== undefined) {
    return params.roomConfig.requireMention;
  }
  if (params.wildcardConfig?.requireMention !== undefined) {
    return params.wildcardConfig.requireMention;
  }
  // Default: require mention in MUC
  return true;
}

/**
 * Resolve mention gate
 * Determines if a group message should be processed based on mention requirements
 */
export function resolveXmppMentionGate(params: {
  isGroup: boolean;
  requireMention: boolean;
  wasMentioned: boolean;
  hasControlCommand: boolean;
  allowTextCommands: boolean;
  commandAuthorized: boolean;
}): { shouldSkip: boolean; reason: string } {
  if (!params.isGroup) {
    return { shouldSkip: false, reason: "direct" };
  }
  if (!params.requireMention) {
    return { shouldSkip: false, reason: "mention-not-required" };
  }
  if (params.wasMentioned) {
    return { shouldSkip: false, reason: "mentioned" };
  }
  if (params.hasControlCommand && params.allowTextCommands && params.commandAuthorized) {
    return { shouldSkip: false, reason: "authorized-command" };
  }
  return { shouldSkip: true, reason: "missing-mention" };
}

/**
 * Resolve if a sender is allowed in a group
 * Checks per-room and account-level allowlists
 */
export function resolveXmppGroupSenderAllowed(params: {
  groupPolicy: XmppAccountConfig["groupPolicy"];
  message: XmppInboundMessage;
  outerAllowFrom: string[];
  innerAllowFrom: string[];
}): boolean {
  const policy = params.groupPolicy ?? "allowlist";
  const inner = normalizeXmppAllowlist(params.innerAllowFrom);
  const outer = normalizeXmppAllowlist(params.outerAllowFrom);

  // Check room-specific allowlist first
  if (inner.length > 0) {
    return resolveXmppAllowlistMatch({ allowFrom: inner, message: params.message }).allowed;
  }

  // Fall back to account-level allowlist
  if (outer.length > 0) {
    return resolveXmppAllowlistMatch({ allowFrom: outer, message: params.message }).allowed;
  }

  // If no allowlists configured, allow in open mode
  return policy === "open";
}
