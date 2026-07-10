# Design Proposal: Semi-Autonomous AI Agent Architecture

This document details the architecture for the platform's AI agent, balancing cost efficiency, safety, and capability.

---

## 1. Core Architecture: Semi-Autonomous (Proposal & Confirm)

Instead of choosing between a pure chatbot (read-only) and a fully autonomous agent (which can execute writes on its own), we utilize a **semi-autonomous hybrid model**.

### What is a UI Proposal Card?
A UI Proposal Card is a locally rendered, interactive frontend element generated dynamically from structured JSON payloads emitted by the AI.
1. **The Chat Input**: The user says, *"Set up a birthday dinner draft for tomorrow at 7 PM."*
2. **The JSON Payload**: The AI processes the request and executes a tool call, returning a structured JSON payload:
   ```json
   {
     "action": "propose_create_event",
     "data": {
       "title": "Birthday Dinner",
       "startsAt": "2026-07-11T19:00:00.000Z",
       "description": "Birthday celebration dinner."
     }
   }
   ```
3. **The Local UI Render**: The frontend intercepts this specific payload and renders a local UI form card inside the chat thread. This form has editable fields (Title, Start Time, Description) pre-populated with the AI's values.
4. **The User Gate (Confirm Button)**: The user inspects the card, adjusts any values if necessary, and clicks **"Confirm & Create Draft"**. Only upon this click does the frontend submit the write request to the backend API.

---

## 2. Why is AI Needed in this Process?

If the final action is a standard database write, why do we need an AI at all?
- **Intent Extraction & Parameterization**: Users do not write perfect database records. They type: *"I want to do a gathering this Friday night at NTU, maybe call it North Spine Social, base price 10 max 20 capacity 50."* The AI acts as a parser, extracting parameters, calculating dates (e.g. mapping "this Friday" to the correct ISO timestamp), and filling the schema.
- **Context-Aware Recommendations**: The AI can cross-reference the user's prompt against event trends, locations, or pricing elasticity rules (e.g. advising them on their hype threshold based on capacity) before generating the proposal card.
- **Conversion of Conversational Flow to Structured Actions**: It bridges the gap between natural language chat and rigid database forms, reducing user onboarding friction.

---

## 3. Minimizing Token Spend

To keep API token usage sustainable under rising LLM cost structures, we apply three strict constraints:

### A. Stateless Execution with Rolling History Summarization
Instead of sending the entire chat history back to the LLM on every turn (which increases token consumption quadratically):
- **Raw Buffer**: We only send the raw text of the last **5 turns**.
- **Summary Header**: Any turns older than 5 are passed through a lightweight summarizer once, and only the resulting paragraph summary is prepended to the prompt.

### B. UI Proposal Cards as a Cost-Reduction Barrier
Because the AI only needs to emit a **structured parameter card** instead of managing the entire write workflow itself:
1. The AI does not need to execute multi-step conversational validation ("Is this correct?", "What capacity?").
2. The user corrects mistakes in the local UI card form manually rather than typing back-and-forth messages, ending the conversation loop sooner and saving tokens.

### C. Client-Side Tool Filtering
Before invoking the LLM, client-side regex or classifiers check if the query is purely informational. If it matches common non-action patterns, we skip action-agent tools entirely, reducing the system prompt size and tool definitions sent to the LLM.
