import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file) return Response.json({ error: "파일이 없습니다" }, { status: 400 });

    const buf = await file.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");

    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64,
            },
          },
          {
            type: "text",
            text: `이 PDF는 홈택스 거주자 사업소득 지급명세서입니다. 다음 정보를 JSON으로 추출하세요:
{
  "payer": "징수의무자 법인명 또는 상호 (예: 에즈금융서비스)",
  "gross": 지급총액 정수,
  "incomeTax": 소득세 정수,
  "localTax": 지방소득세 정수,
  "totalTax": 원천징수세액 계 정수,
  "year": 귀속연도 정수
}
콤마 없이 숫자만. JSON만 반환. 다른 설명 없이.`,
          },
        ],
      }],
    });

    const text = response.content[0]?.text || "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}") + 1;
    if (start < 0) return Response.json({ error: "파싱 실패", raw: text }, { status: 500 });

    const data = JSON.parse(text.slice(start, end));
    data.net = (data.gross || 0) - (data.totalTax || 0);

    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
