import { prisma } from '@/lib/db/prisma';

export class AiNotConfiguredError extends Error {}

const PROMPT_INSTRUCTIONS =
  'You are helping someone understand a document before they sign it electronically. ' +
  'Summarize, in plain language and a few short paragraphs, what a signer needs to know: ' +
  'what the document is, any obligations or commitments it creates, key dates, dollar amounts, ' +
  'and anything unusual or risky. Do not include legal disclaimers about not being a lawyer — ' +
  'just summarize the content clearly.';

export async function summarizeText(text: string): Promise<string> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  if (settings?.anthropicApiKey) {
    return summarizeWithAnthropic(text, settings.anthropicApiKey);
  }
  if (settings?.openaiApiKey) {
    return summarizeWithOpenAI(text, settings.openaiApiKey);
  }
  throw new AiNotConfiguredError('No AI provider is configured. Add an API key in Settings.');
}

async function summarizeWithAnthropic(text: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: `${PROMPT_INSTRUCTIONS}\n\nDocument text:\n\n${text}` }],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Anthropic API request failed (${response.status}): ${body.slice(0, 500)}`);
  }
  const data = await response.json();
  const content = data.content?.[0]?.text;
  if (typeof content !== 'string') {
    throw new Error('Anthropic API returned an unexpected response shape');
  }
  return content;
}

async function summarizeWithOpenAI(text: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: PROMPT_INSTRUCTIONS },
        { role: 'user', content: `Document text:\n\n${text}` },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI API request failed (${response.status}): ${body.slice(0, 500)}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('OpenAI API returned an unexpected response shape');
  }
  return content;
}
