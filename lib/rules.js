export const DEFAULT_RULES = [
  { keyword: "에즈", matchField: "memo", direction: "in", category: "보험수수료 수입", type: "income" },
  { keyword: "에즈금융서비스", matchField: "memo", direction: "out", category: "수수료비용", type: "expense" },
  { keyword: "에스케이텔레콤", category: "통신비", type: "expense" },
  { keyword: "skt", category: "통신비", type: "expense" },
  { keyword: "통신", category: "통신비", type: "expense" },
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
  { keyword: "ktx", category: "교통비", type: "expense" },
  { keyword: "코레일", category: "교통비", type: "expense" },
  { keyword: "카카오모빌리티", category: "교통비", type: "expense" },
  { keyword: "카카오택시", category: "교통비", type: "expense" },
  { keyword: "유덕인쇄사", category: "광고선전비", type: "expense" },
  { keyword: "인쇄", category: "광고선전비", type: "expense" },
  { keyword: "다이소", category: "소모품비", type: "expense" },
  { keyword: "국민연금", category: "개인지출", type: "exclude" },
  { keyword: "국민건강", category: "개인지출", type: "exclude" },
  { keyword: "주택금융공사", category: "개인지출", type: "exclude" },
  { keyword: "신한카드", matchField: "memo", direction: "out", category: "개인지출", type: "exclude" },
  { keyword: "쿠팡", category: "개인지출", type: "exclude" },
  { keyword: "배달의민족", category: "개인지출", type: "exclude" },
  { keyword: "병원", category: "개인지출", type: "exclude" },
  { keyword: "의원", category: "개인지출", type: "exclude" },
  { keyword: "약국", category: "개인지출", type: "exclude" },
  { keyword: "한의원", category: "개인지출", type: "exclude" },
  { keyword: "치과", category: "개인지출", type: "exclude" },
  { keyword: "안과", category: "개인지출", type: "exclude" },
  { keyword: "피부과", category: "개인지출", type: "exclude" },
  { keyword: "내과", category: "개인지출", type: "exclude" },
  { keyword: "외과", category: "개인지출", type: "exclude" },
];

export const CATEGORIES = [
  "보험수수료 수입", "기타사업소득",
  "차량유지비", "접대비", "광고선전비", "통신비",
  "수수료비용", "소모품비", "교육훈련비", "교통비",
  "개인지출", "미분류",
];

const RULES_KEY = "tax_rules";

export function loadRules() {
  try {
    const saved = localStorage.getItem(RULES_KEY);
    if (saved) return JSON.parse(saved);
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
