import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// 카테고리별 분류 기준 (AI 프롬프트용)
const CATEGORY_GUIDE = `
카테고리 분류 기준 (보험설계사 FC / GA 소속 개인사업자):

차량유지비: 주유소·주유, 주차비, 고속도로·통행료, 렌트카, 자동차세·차량보험
교통비: 버스·지하철·택시, KTX·기차, 항공권(제주항공·대한항공 등), 출장 숙박(Agoda·Airbnb·호텔)
통신비: 휴대폰·인터넷 통신요금 (KT·SKT·LG유플러스)
광고선전비: 명함·인쇄물·판촉물 제작비
수수료비용: 세무사·회계사 비용, 법무사비용, 은행 이체수수료, 등기열람료, GA 관련 수수료
소모품비: 사무용품, 문구, 업무 관련 도서·자료·통계자료
교육훈련비: 연수비, 세미나 참가비, 교육비
임대료: 사무실 월세·관리비 (※ 아파트 관리비는 개인지출)
접대비: 고객·영업 상대방과의 식사·카페 (반드시 2인 이상, 업무 목적 확실한 경우만)
기타사업소득: 보험 외 사업소득, 프리랜서 수입
보험수수료 수입: 보험 GA 수수료 입금
개인지출: 개인 보험료(생명·손해·실손), 병원·약국·의료비, 생활비(도시가스·전기·수도), 마트·편의점 장보기, 개인 쇼핑, 배달앱
미분류: 위 기준으로 판단 불가한 경우

⚠ 다음은 반드시 미분류:
- 식당·카페 (접대 증빙이 메모에 명시된 경우 외)
- 편의점(GS25·CU·세븐일레븐 등)
- 카카오페이·네이버페이·토스 등 간편결제 (실제 내역 불명)
- 사람 이름으로의 이체 (급여인지 개인이체인지 불명)
- 대형마트·슈퍼마켓 (식료품/생활용품 구분 불가)
- 정체 불명 업체명
⚠ confidence=low 이면 미분류로 처리됩니다. 확실하지 않으면 low 로 설정하세요.
`.trim();

export async function POST(request) {
  const { transactions } = await request.json();
  if (!transactions?.length) return Response.json({ results: [] });

  const results = [];

  for (const tx of transactions) {
    const isBank = tx.source === "bank";
    const direction = isBank ? (tx.in > 0 ? "입금" : "출금") : "카드결제";
    const amount = Math.max(tx.in || 0, tx.out || 0, tx.amount || 0);
    const name = tx.memo || tx.merchant || "";

    const desc = isBank
      ? `통장 ${direction}: "${name}" / ${amount.toLocaleString()}원`
      : `카드결제: "${name}" / ${amount.toLocaleString()}원`;

    try {
      const response = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 100,
        messages: [{
          role: "user",
          content: `${CATEGORY_GUIDE}

거래: ${desc} | 날짜: ${tx.date}

JSON만 반환: {"category":"카테고리명","type":"income|expense|exclude","confidence":"high|low"}`,
        }],
      });

      const text = response.content[0].text;
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}") + 1;
      if (start >= 0) {
        const parsed = JSON.parse(text.slice(start, end));
        const isLow = parsed.confidence === "low";
        results.push({
          id: tx.id,
          category: isLow ? "미분류" : (parsed.category || "미분류"),
          type: isLow ? "unclassified" : (parsed.type || "expense"),
          method: isLow ? "ai_low" : "ai",
        });
        continue;
      }
    } catch {}

    results.push({ id: tx.id, category: "미분류", type: "unclassified", method: "unclassified" });
  }

  return Response.json({ results });
}
