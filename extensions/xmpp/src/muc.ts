/**
 * Multi-User Chat (MUC) utilities - XEP-0045
 */

export type MucStanzaInfo = {
  isGroupChat: boolean;
  roomJid?: string;
  senderNickname?: string;
  senderFullJid?: string;
};

/**
 * Parse MUC information from a stanza
 * Groupchat messages come from room@conference.domain/nickname
 */
export function parseMucStanza(stanza: any): MucStanzaInfo {
  const from = stanza.attrs.from;
  const type = stanza.attrs.type;

  if (type === "groupchat" && from) {
    const [roomJid, nickname] = from.split("/");
    return {
      isGroupChat: true,
      roomJid,
      senderNickname: nickname,
      senderFullJid: from,
    };
  }

  return { isGroupChat: false };
}

/**
 * Check if a JID is a room occupant JID (room@conference.domain/nickname)
 */
export function isOccupantJid(jid: string): boolean {
  return jid.includes("/");
}

/**
 * Extract room JID from occupant JID
 */
export function getRoomJidFromOccupant(occupantJid: string): string {
  const [roomJid] = occupantJid.split("/");
  return roomJid;
}

/**
 * Extract nickname from occupant JID
 */
export function getNicknameFromOccupant(occupantJid: string): string | undefined {
  const parts = occupantJid.split("/");
  return parts[1];
}
