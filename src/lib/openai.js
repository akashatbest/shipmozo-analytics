// Azure OpenAI helpers
// Uses Azure AI Foundry endpoint (not api.openai.com)

const ENDPOINT   = import.meta.env.VITE_AZURE_OPENAI_ENDPOINT?.replace(/\/$/, '')
const API_KEY    = import.meta.env.VITE_AZURE_OPENAI_KEY
const DEPLOYMENT = import.meta.env.VITE_AZURE_OPENAI_DEPLOYMENT
const API_VERSION = import.meta.env.VITE_AZURE_OPENAI_API_VERSION

export const SYSTEM_PROMPT = `You are a senior logistics data analyst at Shipmozo, an Indian shipping aggregator. You have access to live shipping data covering couriers (Delhivery, Bluedart, DTDC, Amazon, XpressBees, Ekart, Shadow Fax), zones (A=local through E=farthest), and ~5,000 sellers.

When answering:
- Be specific and quantitative — reference actual numbers from the data provided
- Connect findings to business impact in rupees
- Name specific sellers, couriers, and zones when recommending actions
- Format responses clearly with bullet points or short paragraphs
- Keep answers concise — 3-5 focused points is better than a wall of text
- If the data doesn't cover what was asked, say so clearly`

async function callAI(messages) {
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': API_KEY },
    body: JSON.stringify({ messages, temperature: 0.3, max_tokens: 1000 }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Azure OpenAI ${res.status}: ${err}`)
  }
  const json = await res.json()
  return json.choices[0].message.content
}

// Multi-turn chat — pass full history as [{role, content}]
export async function chatWithHistory(history, dataContext) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    // Inject data as a system-level context block
    ...(dataContext ? [{ role: 'system', content: `LIVE DATA CONTEXT:\n\n${dataContext}` }] : []),
    ...history,
  ]
  return callAI(messages)
}

export async function generateMonthlyBrief(context) {
  return callAI([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Write a ~400 word diagnostic narrative for this month's shipping data. Lead with the most critical finding.\n\n${JSON.stringify(context, null, 2)}` },
  ])
}

export async function explainAnomaly(anomaly, context) {
  return callAI([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Explain this anomaly and its business impact:\n${anomaly}\n\nData:\n${JSON.stringify(context, null, 2)}` },
  ])
}

// Legacy export used in older code
export async function askAnything(question, context) {
  return callAI([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Context:\n${JSON.stringify(context, null, 2)}\n\nQuestion: ${question}` },
  ])
}
