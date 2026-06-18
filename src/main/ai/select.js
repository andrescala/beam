// Pure provider-selection rule. No Electron / preferences imports so it is unit
// testable. Prefer Gemini (free tier) when its key is present.
export function selectProvider({ claudeKey, geminiKey } = {}) {
  if (geminiKey) return 'gemini'
  if (claudeKey) return 'claude'
  return null
}
