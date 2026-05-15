import { NextResponse } from 'next/server';

type InboundMessage = { role: 'user' | 'assistant'; content: string };

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { messages, sessionTitle, scope } = body as {
      messages?: InboundMessage[];
      sessionTitle?: string;
      scope?: string;
    };

    const validScope = scope === 'session' || scope === 'message';
    if (!validScope || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
    }

    const title    = (sessionTitle ?? 'Chat Session').trim();
    const now      = new Date();
    const dateStr  = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const isoDate  = now.toISOString();
    const msgCount = messages.length;

    let systemPrompt: string;
    let userMessage: string;

    if (scope === 'session') {
      const conversationText = messages
        .map(m => `${m.role === 'user' ? 'Operator' : 'Assistant'}: ${m.content}`)
        .join('\n\n---\n\n');

      systemPrompt = `You are an analyst summarizing a chat session about Dirty Labs' Amazon PPC and account performance. Your job is to produce a structured markdown summary that gives the operator everything they need to hand this session off to Claude or create a Linear ticket.

Produce the summary using EXACTLY this format — no additions, no omissions, no reordering:

# Chat Session Summary — ${title}
*Generated ${dateStr}*

## Overall thread
[1-2 sentences describing what this conversation was primarily about. Be specific — mention actual topics, campaigns, or metrics discussed.]

## Actionable findings

[For EACH finding that has a clear next action, repeat this block. If there are no actionable findings, write exactly: "No actionable findings in this session."]

### [Short, specific finding title — e.g. "Dish Campaign Overspend", "NTB Rate Below Target"]

**Trigger:** [What was asked or what the data showed that surfaced this finding]

**Finding:** [The specific conclusion — include numbers, ROAS, spend amounts, percentages]

**Recommended action:** [One specific, actionable next step the operator should take]

**Supporting context:**
- [Specific metric or number]
- [ASIN or product name if relevant]
- [Campaign name if relevant]
- [Date range if relevant]
- [Relevant comparison or benchmark]

**Suggested ticket metadata (hints only):**
- Project: Amazon Operations | Platform | Both
- Label hints: [e.g. "ppc", "budget", "campaign", "anomaly", "harvest", "ntb"]
- Priority hint: [Urgent / High / Medium / Low — based on language cues in conversation]

## Non-actionable insights
[Bullet list of analytical findings from this session that are informative but don't require an immediate action. Include specific numbers. If none, write "None noted."]

## Source
- Session title: ${title}
- Date: ${isoDate}
- Total messages exchanged: ${msgCount}

---

Rules:
- Be specific with every number — never round or generalize when the conversation contained exact figures
- "Actionable findings" = clear next step exists. "Non-actionable insights" = interesting but no clear action
- Extract findings from BOTH the operator's questions and the assistant's answers
- Do not invent information not present in the conversation
- Use the product short names from the conversation (e.g. "Dish Powder", "Laundry Detergent") rather than raw ASINs unless ASINs are needed
- If the conversation is exploratory with no clear findings, the Actionable findings section should say "No actionable findings in this session."`;

      userMessage = `Here is the full session to summarize:

Session: ${title}
Total messages: ${msgCount}

${conversationText}`;

    } else {
      // scope === 'message': last message is the target AI response, second-to-last is the user turn that prompted it.
      const contextMsgs  = messages.slice(Math.max(0, messages.length - 6), messages.length - 2);
      const exchangeMsgs = messages.slice(Math.max(0, messages.length - 2));

      const contextText = contextMsgs.length > 0
        ? contextMsgs.map(m => `${m.role === 'user' ? 'Operator' : 'Assistant'}: ${m.content}`).join('\n\n---\n\n')
        : '(This was the first exchange in the session.)';

      const exchangeText = exchangeMsgs
        .map(m => `${m.role === 'user' ? 'Operator' : 'Assistant'}: ${m.content}`)
        .join('\n\n---\n\n');

      systemPrompt = `You are an analyst extracting a focused actionable summary from a specific exchange in a Dirty Labs Amazon PPC chat session. The TARGET EXCHANGE is the assistant response that contained actionable findings, plus the operator message that prompted it.

Produce the summary using EXACTLY this format — no additions, no omissions:

# Captured Finding — ${title}
*Captured ${dateStr}*

## Context
[1 sentence describing what the operator was asking about when this finding surfaced.]

## Actionable findings

### [Short, specific finding title — e.g. "Dish Campaign Overspend", "NTB Rate Below Target"]

**Trigger:** [What was asked or what the data showed that surfaced this finding]

**Finding:** [The specific conclusion — include numbers, ROAS, spend amounts, percentages]

**Recommended action:** [One specific, actionable next step the operator should take]

**Supporting context:**
- [Specific metric or number]
- [ASIN or product name if relevant]
- [Campaign name if relevant]
- [Date range if relevant]
- [Relevant comparison or benchmark]

**Suggested ticket metadata (hints only):**
- Project: Amazon Operations | Platform | Both
- Label hints: [e.g. "ppc", "budget", "campaign", "anomaly", "harvest", "ntb"]
- Priority hint: [Urgent / High / Medium / Low — based on urgency language in the exchange]

## Source
- Session title: ${title}
- Date: ${isoDate}
- Messages in session: ${msgCount}

---

Rules:
- Focus ONLY on the target exchange — do not summarise prior context turns
- Use prior context only for grounding — it does not generate additional findings
- Be specific with every number
- Extract findings from BOTH the operator's question and the assistant's answer
- Do not invent information not present in the exchange`;

      userMessage = `Prior conversation context (for grounding only — do not summarise):

${contextText}

---

TARGET EXCHANGE to capture:

${exchangeText}`;
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 4096,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Anthropic API error ${res.status}`, detail: errText },
        { status: 502 },
      );
    }

    const data = await res.json() as { content: Array<{ type: string; text: string }> };
    const summary = (data.content ?? [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    return NextResponse.json({ summary, generated_at: isoDate });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
