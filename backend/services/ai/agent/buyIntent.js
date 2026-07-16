// Shared vocabulary for "is this a purchase REQUEST, or a QUESTION about purchasing?".
// Two layers ask this: eventGraph's looksLikePurchase (which branch to route to) and
// listReplies' matchBuyIntent (whether to intercept before the LLM runs at all). They
// used to keep private copies and drifted apart — the graph learned to spot a question
// while the earlier short-circuit did not, so "can i buy tickets for X after 1 august?"
// was parsed as a purchase for an event literally named "X after 1 august". One word-list.
//
// Dependency-free on purpose: listReplies.js is a light module, and importing eventGraph
// would drag @langchain/langgraph into its test process for two regexes.

// A message that OPENS with an interrogative — "can i buy tickets for X after 1 august?".
export const INTERROGATIVE_LEAD_RX = /^(?:can|could|is|are|do|does|did|will|would|am|when|what|which|who|how|may)\b/i;
// A trailing question mark. Used ONLY by eventGraph — see isBuyQuestion below.
export const TRAILING_QUESTION_RX = /\?\s*$/;
// …except a purchase politely phrased as a question ("can you help me buy 2 tickets?").
export const REQUEST_RX = /^(can|could|would|will)\s+(you|u)\b|\b(help me|please)\b/i;

// True for a QUESTION about buying that isn't itself a polite request to buy.
//
// Keyed on the LEADING interrogative only, deliberately NOT on a trailing "?" — the two
// layers differ here and must keep differing. "buy tickets for Gymming for newbies?" is an
// imperative with a stray "?": a real purchase, whose typo'd event name matchBuyIntent has
// to intercept before the model invents one. eventGraph applies TRAILING_QUESTION_RX on top
// of this because misrouting a question there is harmless (every branch can still answer),
// whereas intercepting one here replaces the answer with a canned "cannot find" reply.
export function isBuyQuestion(text) {
  const t = String(text ?? '').trim();
  return !!t && INTERROGATIVE_LEAD_RX.test(t) && !REQUEST_RX.test(t);
}
