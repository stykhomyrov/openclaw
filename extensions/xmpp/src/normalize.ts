import { jid as parseJid } from "@xmpp/jid";
import type { XmppInboundMessage } from "./types.js";

const XMPP_TARGET_PATTERN = /^[^\s]+@[^\s]+$/u;

/**
 * Check if a JID is a MUC room (contains "conference" or "muc" in domain)
 * More accurate detection would require disco#info, but this is a good heuristic
 */
export function isRoomJid(jidString: string): boolean {
  try {
    const parsed = parseJid(jidString);
    const domain = parsed.domain.toLowerCase();
    return domain.includes("conference") || domain.includes("muc");
  } catch {
    return false;
  }
}

/**
 * Normalize a bare JID (strip resource)
 */
export function normalizeXmppBareJid(jidString: string): string {
  try {
    const parsed = parseJid(jidString);
    return parsed.bare().toString();
  } catch {
    return jidString.trim();
  }
}

/**
 * Normalize a JID for messaging targets
 */
export function normalizeXmppJid(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  let target = trimmed;
  const lowered = target.toLowerCase();

  // Strip protocol prefixes
  if (lowered.startsWith("xmpp:")) {
    target = target.slice("xmpp:".length).trim();
  }
  if (lowered.startsWith("room:")) {
    target = target.slice("room:".length).trim();
  }
  if (lowered.startsWith("user:")) {
    target = target.slice("user:".length).trim();
  }

  if (!target || !looksLikeXmppJid(target)) {
    return undefined;
  }

  // Normalize to bare JID for consistency
  try {
    const parsed = parseJid(target);
    return parsed.bare().toString();
  } catch {
    return undefined;
  }
}

/**
 * Normalize XMPP messaging target
 */
export function normalizeXmppMessagingTarget(raw: string): string | undefined {
  return normalizeXmppJid(raw);
}

/**
 * Check if a string looks like a valid JID
 */
export function looksLikeXmppJid(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }
  if (!XMPP_TARGET_PATTERN.test(trimmed)) {
    return false;
  }
  try {
    parseJid(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize an allowlist entry
 */
export function normalizeXmppAllowEntry(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (!value) {
    return "";
  }

  // Strip protocol prefixes
  if (value.startsWith("xmpp:")) {
    value = value.slice("xmpp:".length);
  }
  if (value.startsWith("user:")) {
    value = value.slice("user:".length);
  }
  if (value.startsWith("room:")) {
    value = value.slice("room:".length);
  }

  value = value.trim();

  // Normalize to bare JID
  if (value && value !== "*") {
    try {
      const parsed = parseJid(value);
      return parsed.bare().toString().toLowerCase();
    } catch {
      return value;
    }
  }

  return value;
}

/**
 * Normalize an array of allowlist entries
 */
export function normalizeXmppAllowlist(entries?: Array<string | number>): string[] {
  return (entries ?? []).map((entry) => normalizeXmppAllowEntry(String(entry))).filter(Boolean);
}

/**
 * Format sender ID from inbound message
 */
export function formatXmppSenderId(message: XmppInboundMessage): string {
  return message.senderJid;
}

/**
 * Build allowlist matching candidates from inbound message
 * Returns bare JID and full JID variants
 */
export function buildXmppAllowlistCandidates(message: XmppInboundMessage): string[] {
  const candidates = new Set<string>();

  // Add bare JID (most common match)
  if (message.senderBareJid) {
    candidates.add(message.senderBareJid.toLowerCase());
  }

  // Add full JID (for resource-specific matching)
  if (message.senderJid) {
    candidates.add(message.senderJid.toLowerCase());
  }

  // For MUC, also add nickname-based matching
  if (message.isGroup && message.senderNickname) {
    candidates.add(message.senderNickname.toLowerCase());
  }

  return [...candidates];
}

/**
 * Resolve allowlist match for a message
 */
export function resolveXmppAllowlistMatch(params: {
  allowFrom: string[];
  message: XmppInboundMessage;
}): { allowed: boolean; source?: string } {
  const allowFrom = new Set(
    params.allowFrom.map((entry) => entry.trim().toLowerCase()).filter(Boolean),
  );

  // Wildcard allows everyone
  if (allowFrom.has("*")) {
    return { allowed: true, source: "wildcard" };
  }

  const candidates = buildXmppAllowlistCandidates(params.message);
  for (const candidate of candidates) {
    if (allowFrom.has(candidate)) {
      return { allowed: true, source: candidate };
    }
  }

  return { allowed: false };
}
