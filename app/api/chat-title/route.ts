import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { firstUserMessage, firstAssistantResponse } = body as {
      firstUserMessage?: string;
      firstAssistantResponse?: string;
    };

    if (!firstUserMessage?.trim()) {
      return NextResponse.json({ title: 'New session' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ title: 'New session' });
    }

    const snippet = (firstAssistantResponse ?? '').slice(0, 500);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 20,
        system:
          'Generate a short, descriptive 2-4 word title for this chat session about Dirty Labs PPC and Amazon account management. The title should make it easy for the operator to identify this conversation later. Examples: Q1 Performance Review, Dish Campaign Audit, NTB Strategy Discussion, April Anomalies, Buy Box Investigation. Return only the title text — no quotes, no punctuation at the end, no explanation.',
        messages: [
          {
            role: 'user',
            content: `User asked: ${firstUserMessage.slice(0, 300)}\n\nAssistant responded: ${snippet}`,
          },
        ],
      }),
    });

    if (!res.ok) return NextResponse.json({ title: 'New session' });

    const data = await res.json() as { content: Array<{ type: string; text: string }> };
    const raw = (data.content ?? [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()
      .replace(/^["'`]|["'`]$/g, '')
      .replace(/[.!?,]$/, '')
      .slice(0, 40);

    return NextResponse.json({ title: raw || 'New session' });
  } catch {
    // Always return 200 — failed title generation is silent, not an error.
    return NextResponse.json({ title: 'New session' });
  }
}
