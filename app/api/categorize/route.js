import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function POST(request) {
  const { transactions } = await request.json();
  if (!transactions?.length) return Response.json({ results: [] });

  const results = [];

  for (const tx of transactions) {
    const desc = tx.source === "bank"
      ? `통장 거래: ${tx.memo || ""} / ${tx.in > 0 ? "입금" : "출금"} ${Math.max(tx.in || 0, tx.out || 0).toLocaleString()}원`
      : `카드 결제: ${tx.merchant || ""} / ${(tx.amount || 0).toLocaleString()}원`;

    try {
      const response = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 80,
        messages: [{
          role: "user",
          content: `보험설계사(GA 소속 개인사업자) 거래를 분류하세요.
거래: ${desc} | 날짜: ${tx.date}
카테고리: 보험수수료 수입, 기타사업소득, 차량유지비, 접대비, 광고선전비, 통신비, 수수료비용, 소모품비, 교육훈련비, 교통비, 개인지출, 미분류
JSON만: {"category":"카테고리명","type":"income|expense|exclude","confidence":"high|low"}`,
        }],
      });

      const text = response.content[0].text;
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}") + 1;
      if (start >= 0) {
        const parsed = JSON.parse(text.slice(start, end));
        results.push({
          id: tx.id,
          category: parsed.confidence === "low" ? "미분류" : parsed.category,
          type: parsed.confidence === "low" ? "unclassified" : parsed.type,
          method: parsed.confidence === "low" ? "ai_low" : "ai",
        });
        continue;
      }
    } catch {}

    results.push({ id: tx.id, category: "미분류", type: "unclassified", method: "unclassified" });
  }

  return Response.json({ results });
}
