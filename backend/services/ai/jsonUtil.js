// Robustly parse a JSON object out of an LLM text response. Providers may wrap
// JSON in ```json fences or add stray prose, so we strip fences and, failing a
// direct parse, extract the first balanced {...} or [...] span. Returns null on
// failure rather than throwing, so callers can degrade gracefully.
export function parseJson(text) {
  if (text == null) return null;
  const raw = String(text).trim();
  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  for (const candidate of [unfenced, raw]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // fall through to span extraction
    }
  }

  const start = unfenced.search(/[[{]/);
  if (start === -1) return null;
  const open = unfenced[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < unfenced.length; i += 1) {
    const ch = unfenced[i];
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(unfenced.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
