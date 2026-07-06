const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ID_LABEL_RE = new RegExp(`\\s*\\((?:event\\s*)?(?:draft\\s*)?id\\s*:\\s*${UUID_RE}\\)`, 'gi');
const SHORT_ID_LABEL_RE = /\s*\((?:event\s*)?(?:draft\s*)?id\s*:\s*[A-Za-z0-9_-]{2,}\)/gi;
const INLINE_LABEL_RE = new RegExp(`\\b(?:eventId|draftId|event\\s+id|draft\\s+id|id)\\s*[:#-]?\\s*${UUID_RE}\\b`, 'gi');
const STANDALONE_UUID_RE = new RegExp(`\\b${UUID_RE}\\b`, 'gi');

export function sanitizeAiReply(text) {
  return String(text ?? '')
    .replace(ID_LABEL_RE, '')
    .replace(SHORT_ID_LABEL_RE, '')
    .replace(INLINE_LABEL_RE, '')
    .replace(STANDALONE_UUID_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
