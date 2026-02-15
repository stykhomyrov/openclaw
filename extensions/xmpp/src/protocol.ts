import { randomUUID } from "node:crypto";

/**
 * Generate a unique message ID for XMPP stanzas
 */
export function makeXmppMessageId(): string {
  return randomUUID();
}

/**
 * Sanitize message body for XMPP
 * XMPP allows newlines in message bodies unlike IRC
 */
export function sanitizeXmppBody(text: string): string {
  return text.trim();
}

/**
 * Parse XEP-0203 delayed delivery timestamp from stanza
 */
export function parseDelayedDelivery(stanza: any): Date | undefined {
  const delay = stanza.getChild("delay", "urn:xmpp:delay");
  if (delay?.attrs?.stamp) {
    return new Date(delay.attrs.stamp);
  }
  return undefined;
}

/**
 * Parse XEP-0308 message correction (replace) from stanza
 */
export function parseMessageCorrection(stanza: any): string | undefined {
  const replace = stanza.getChild("replace", "urn:xmpp:message-correct:0");
  return replace?.attrs?.id;
}

/**
 * Parse XEP-0461 message reply reference from stanza
 */
export function parseReplyTo(stanza: any): string | undefined {
  const reply = stanza.getChild("reply", "urn:xmpp:reply:0");
  return reply?.attrs?.to;
}
