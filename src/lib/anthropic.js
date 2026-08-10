// Thin client for direct browser calls to the Anthropic Messages API.
//
// This is a bring-your-own-key (BYOK) setup for a static demo: the visitor
// pastes their own Anthropic API key, it's kept in sessionStorage (cleared
// when the tab closes), and every request goes straight from the browser to
// api.anthropic.com — never through any server we control. The
// "anthropic-dangerous-direct-browser-access" header is what opts a request
// into that pattern; it exists specifically so a key never has to touch a
// backend for prototypes like this one.
const MODEL = "claude-sonnet-5";
const STORAGE_KEY = "multiplayer-ai:anthropic-api-key";

export function getApiKey() {
  return sessionStorage.getItem(STORAGE_KEY) || "";
}

export function setApiKey(key) {
  if (key) sessionStorage.setItem(STORAGE_KEY, key);
  else sessionStorage.removeItem(STORAGE_KEY);
}

export async function callClaude({ system, messages, maxTokens = 400 }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("NO_API_KEY");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || `Claude API error (${res.status})`);
  }

  const data = await res.json();
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

export { MODEL };
