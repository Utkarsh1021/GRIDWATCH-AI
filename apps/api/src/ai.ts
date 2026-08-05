import type { Incident } from '@gridwatch/domain';
import { env } from './config.js';

export async function generateBrief(incident: Incident): Promise<string | null> {
  if (!env.aiApiKey) return null;

  const { coords, pincode, affected_households, affected_pole_ids, confidence, type, scope, from_pole, to_pole } = incident;

  const prompt = `You are the control-room assistant for a distribution utility.
An incident was localized from pole liveness telemetry (NOT by you - the location is given).
Write a SHORT plain-language field brief (under 200 words) plus a 3-5 item checklist for a lineman.
Be honest about uncertainty. Do NOT invent facts. Structure:
- What happened
- Where (span/area, coords, PIN)
- Scale (affected poles and households)
- What to check in the field
- Confidence framing
Type: ${type}, scope: ${scope}, conf: ${confidence}
from: ${from_pole ?? 'N/A'}, to: ${to_pole ?? 'N/A'}
coords: ${coords ? `${coords.lat},${coords.lon}` : 'N/A'}, PIN: ${pincode ?? 'unknown'}
affected poles: ${affected_pole_ids.length}, households: ${affected_households}`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.aiApiKey}` },
      body: JSON.stringify({
        model: env.aiModel,
        messages: [
          { role: 'system', content: 'You write concise, honest, actionable field briefs. No invented facts.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    return content ?? null;
  } catch {
    return null;
  }
}