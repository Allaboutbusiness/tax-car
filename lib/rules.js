export const DEFAULT_RULES = [
  // ── 수입 ─────────────────────────────────────────────────
  { keyword: "에즈", matchField: "memo", direction: "in", category: "보험수수료 수입", type: "income" },
  { keyword: "에즈금융서비스", matchField: "memo", direction: "out", category: "수수료비용", type: "expense" },

  // ── 통신비 ───────────────────────────────────────────────
  { keyword: "에스케이텔레콤", category: "통신비", type: "expense" },
  { keyword: "skt", category: "통신비", type: "expense" },
  { keyword: "통신", category: "통신비", type: "expense" },
  { keyword: "kt ", category: "통신비", type: "expense" },
  { keyword: "kt통신", category: "통신비", type: "expense" },
  { keyword: "lg유플러스", category: "통신비", type: "expense" },
  { keyword: "인터넷요금", category: "통신비", type: "expense" },

  // ── 차량유지비 ───────────────────────────────────────────
  { keyword: "고속도로", category: "차량유지비", type: "expense" },
  { keyword: "순환도로", category: "차량유지비", type: "expense" },
  { keyword: "도로공사", category: "차량유지비", type: "expense" },
  { keyword: "터널", category: "차량유지비", type: "expense" },
  { keyword: "대교", category: "차량유지비", type: "expense" },
  { keyword: "주차", category: "차량유지비", type: "expense" },
  { keyword: "주유", category: "차량유지비", type: "expense" },
  { keyword: "쏘카", category: "차량유지비", type: "expense" },
  { keyword: "렌트카", category: "차량유지비", type: "expense" },
  { keyword: "자동차세", category: "차량유지비", type: "expense" },
  { keyword: "아이파킹", category: "차량유지비", type: "expense" },
  { keyword: "아마노코리아", category: "차량유지비", type: "expense" },  // 주차관리 월정기권
  { keyword: "주유소", category: "차량유지비", type: "expense" },
  { keyword: "sk에너지", category: "차량유지비", type: "expense" },
  { keyword: "gs칼텍스", category: "차량유지비", type: "expense" },
  { keyword: "현대오일뱅크", category: "차량유지비", type: "expense" },
  { keyword: "s-oil", category: "차량유지비", type: "expense" },
  { keyword: "에쓰오일", category: "차량유지비", type: "expense" },
  { keyword: "자동차보험", category: "차량유지비", type: "expense" },
  { keyword: "차량보험", category: "차량유지비", type: "expense" },

  // ── 교통비 ───────────────────────────────────────────────
  { keyword: "ktx", category: "교통비", type: "expense" },
  { keyword: "코레일", category: "교통비", type: "expense" },
  { keyword: "카카오모빌리티", category: "교통비", type: "expense" },
  { keyword: "카카오택시", category: "교통비", type: "expense" },
  { keyword: "후불버스", category: "교통비", type: "expense" },
  { keyword: "후불지하철", category: "교통비", type: "expense" },
  { keyword: "후불교통", category: "교통비", type: "expense" },
  { keyword: "후불유통", category: "교통비", type: "expense" },
  { keyword: "삼성페이_후불", category: "교통비", type: "expense" },
  { keyword: "제주항공", category: "교통비", type: "expense" },
  { keyword: "진에어", category: "교통비", type: "expense" },
  { keyword: "대한항공", category: "교통비", type: "expense" },
  { keyword: "아시아나", category: "교통비", type: "expense" },
  { keyword: "에어서울", category: "교통비", type: "expense" },
  { keyword: "이스타항공", category: "교통비", type: "expense" },
  { keyword: "에어부산", category: "교통비", type: "expense" },
  { keyword: "에어로케이", category: "교통비", type: "expense" },
  { keyword: "agoda", category: "교통비", type: "expense" },     // 출장 숙박
  { keyword: "airbnb", category: "교통비", type: "expense" },   // 출장 숙박
  { keyword: "에어비앤비", category: "교통비", type: "expense" },
  { keyword: "티머니", category: "교통비", type: "expense" },
  { keyword: "t머니", category: "교통비", type: "expense" },

  // ── 광고선전비 ───────────────────────────────────────────
  { keyword: "유덕인쇄사", category: "광고선전비", type: "expense" },
  { keyword: "인쇄", category: "광고선전비", type: "expense" },
  { keyword: "명함", category: "광고선전비", type: "expense" },

  // ── 소모품비 ─────────────────────────────────────────────
  { keyword: "다이소", category: "소모품비", type: "expense" },
  { keyword: "한국무역통계", category: "소모품비", type: "expense" }, // TRASS 통계자료
  { keyword: "교보문고", category: "소모품비", type: "expense" },
  { keyword: "yes24", category: "소모품비", type: "expense" },
  { keyword: "알라딘", category: "소모품비", type: "expense" },
  { keyword: "영풍문고", category: "소모품비", type: "expense" },
  { keyword: "반디앤루니스", category: "소모품비", type: "expense" },
  { keyword: "사무용품", category: "소모품비", type: "expense" },
  { keyword: "문구", category: "소모품비", type: "expense" },

  // ── 수수료비용 ───────────────────────────────────────────
  { keyword: "세무회계", category: "수수료비용", type: "expense" },
  { keyword: "세무법인", category: "수수료비용", type: "expense" },
  { keyword: "법원행정처", category: "수수료비용", type: "expense" }, // 인터넷등기소 열람료

  // ── 개인지출(제외) ───────────────────────────────────────
  { keyword: "국민연금", category: "개인지출", type: "exclude" },
  { keyword: "국민건강", category: "개인지출", type: "exclude" },
  { keyword: "주택금융공사", category: "개인지출", type: "exclude" },
  { keyword: "신한카드", matchField: "memo", direction: "out", category: "개인지출", type: "exclude" },
  { keyword: "쿠팡", category: "개인지출", type: "exclude" },
  { keyword: "배달의민족", category: "개인지출", type: "exclude" },
  // 의료
  { keyword: "병원", category: "개인지출", type: "exclude" },
  { keyword: "의원", category: "개인지출", type: "exclude" },
  { keyword: "약국", category: "개인지출", type: "exclude" },
  { keyword: "한의원", category: "개인지출", type: "exclude" },
  { keyword: "치과", category: "개인지출", type: "exclude" },
  { keyword: "안과", category: "개인지출", type: "exclude" },
  { keyword: "피부과", category: "개인지출", type: "exclude" },
  { keyword: "내과", category: "개인지출", type: "exclude" },
  { keyword: "외과", category: "개인지출", type: "exclude" },
  { keyword: "성형외과", category: "개인지출", type: "exclude" },
  // 보험료 (개인 보험 — 차량보험 제외)
  { keyword: "db생명", category: "개인지출", type: "exclude" },
  { keyword: "db손해", category: "개인지출", type: "exclude" },
  { keyword: "abl생명", category: "개인지출", type: "exclude" },
  { keyword: "한화손해보험", category: "개인지출", type: "exclude" },
  { keyword: "한화생명", category: "개인지출", type: "exclude" },
  { keyword: "삼성생명", category: "개인지출", type: "exclude" },
  { keyword: "삼성화재", category: "개인지출", type: "exclude" },
  { keyword: "교보생명", category: "개인지출", type: "exclude" },
  { keyword: "메리츠화재", category: "개인지출", type: "exclude" },
  { keyword: "현대해상", category: "개인지출", type: "exclude" },
  { keyword: "롯데손해", category: "개인지출", type: "exclude" },
  { keyword: "흥국화재", category: "개인지출", type: "exclude" },
  { keyword: "흥국생명", category: "개인지출", type: "exclude" },
  { keyword: "미래에셋생명", category: "개인지출", type: "exclude" },
  // 생활비
  { keyword: "도시가스", category: "개인지출", type: "exclude" },
  { keyword: "한국전력", category: "개인지출", type: "exclude" },
  { keyword: "복지포인트", category: "개인지출", type: "exclude" },
  { keyword: "아파트관리비", category: "개인지출", type: "exclude" },
  { keyword: "관리비", matchField: "memo", category: "개인지출", type: "exclude" },
];

export const CATEGORIES = [
  "보험수수료 수입", "기타사업소득",
  "차량유지비", "접대비", "광고선전비", "통신비",
  "수수료비용", "소모품비", "교육훈련비", "교통비",
  "임대료",
  "개인지출", "미분류",
];

const RULES_KEY = "tax_rules";

export function loadRules() {
  try {
    const saved = localStorage.getItem(RULES_KEY);
    if (saved) {
      const savedRules = JSON.parse(saved);
      // DEFAULT_RULES 중 저장된 규칙에 없는 것을 앞에 추가 (업데이트 자동 반영)
      const savedKeySet = new Set(savedRules.map(r => r.keyword.toLowerCase() + (r.direction || "") + (r.matchField || "")));
      const newDefaults = DEFAULT_RULES.filter(r => !savedKeySet.has(r.keyword.toLowerCase() + (r.direction || "") + (r.matchField || "")));
      return [...newDefaults, ...savedRules];
    }
  } catch {}
  return [...DEFAULT_RULES];
}

export function saveRules(rules) {
  localStorage.setItem(RULES_KEY, JSON.stringify(rules));
}

export function addRule(rules, keyword, category, type, direction) {
  const existing = rules.findIndex(r => r.keyword.toLowerCase() === keyword.toLowerCase());
  const rule = { keyword: keyword.toLowerCase(), category, type, ...(direction ? { direction } : {}) };
  if (existing >= 0) {
    const updated = [...rules];
    updated[existing] = rule;
    return updated;
  }
  return [...rules, rule];
}

export function applyRules(tx, rules) {
  const searchText = (tx.memo || tx.merchant || "").toLowerCase();
  const direction = tx.source === "bank" ? (tx.in > 0 ? "in" : "out") : "out";

  for (const rule of rules) {
    if (!rule.keyword || !searchText.includes(rule.keyword.toLowerCase())) continue;
    if (rule.matchField === "memo" && tx.source === "card") continue;
    if (rule.direction && rule.direction !== direction) continue;
    return { category: rule.category, type: rule.type, method: "rule" };
  }
  return null;
}
