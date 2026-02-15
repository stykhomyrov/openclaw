/**
 * Presence tracking and roster management
 */

import type { XmppPresenceEvent } from "./client.js";
import { normalizeXmppBareJid } from "./normalize.js";

export type PresenceState = {
  jid: string; // Bare JID
  available: boolean;
  status?: string;
  show?: "away" | "chat" | "dnd" | "xa";
  priority?: number;
  lastSeen?: number;
};

/**
 * Track presence for contacts
 */
export class PresenceTracker {
  private presences = new Map<string, PresenceState>();

  /**
   * Handle incoming presence event
   */
  handlePresence(event: XmppPresenceEvent): void {
    const bareJid = normalizeXmppBareJid(event.from);

    if (event.type === "unavailable") {
      this.presences.set(bareJid, {
        jid: bareJid,
        available: false,
        lastSeen: Date.now(),
      });
    } else if (!event.type || event.type === "probe") {
      // Available presence (no type or probe)
      this.presences.set(bareJid, {
        jid: bareJid,
        available: true,
        status: event.status,
        show: event.show,
        priority: event.priority,
      });
    }
    // Ignore subscription-related types (subscribe, subscribed, etc.) for now
  }

  /**
   * Check if a JID is currently available
   */
  isAvailable(jid: string): boolean {
    const bareJid = normalizeXmppBareJid(jid);
    return this.presences.get(bareJid)?.available ?? false;
  }

  /**
   * Get presence state for a JID
   */
  getPresence(jid: string): PresenceState | undefined {
    const bareJid = normalizeXmppBareJid(jid);
    return this.presences.get(bareJid);
  }

  /**
   * Get all tracked presences
   */
  getAllPresences(): PresenceState[] {
    return Array.from(this.presences.values());
  }

  /**
   * Clear all presences (on disconnect)
   */
  clear(): void {
    this.presences.clear();
  }
}
