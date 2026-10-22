// 인사이트 글 SNS 발송 — 채널 목록 한 벌 (docs/SNS_PUBLISH_DESIGN.md §0·§3).
//   화면(채널 카드·글 패널 칸 순서)과 서버(소재 만들기·전이 판정)가 같은 목록을 읽는다.
//   mode 'auto' = 계정 연결 후 예약 자동 발송(단계 2) · 'semi' = 사람이 원고를 복사해 직접 올린다(반자동).
//   maxChars 는 각 채널 본문 상한(공식 한도보다 약간 보수적으로) — 넘으면 저장은 되지만 화면이 경고한다.

const CHANNELS = [
  { provider: 'linkedin', mode: 'auto', maxChars: 3000, kind: 'carousel', linkInBody: false },
  { provider: 'facebook', mode: 'auto', maxChars: 5000, kind: 'carousel', linkInBody: true },
  { provider: 'instagram', mode: 'auto', maxChars: 2200, kind: 'carousel', linkInBody: false },
  // Threads — Irene 10-21 «스레드 꼭 넣어줘»
  { provider: 'threads', mode: 'auto', maxChars: 500, kind: 'carousel', linkInBody: true },
  { provider: 'naver', mode: 'semi', maxChars: 20000, kind: 'carousel', linkInBody: true },
  { provider: 'kakao', mode: 'semi', maxChars: 1000, kind: 'image', linkInBody: true },
];

const BY_PROVIDER = Object.fromEntries(CHANNELS.map((c) => [c.provider, c]));

function channelOf(provider) { return BY_PROVIDER[provider] || null; }
function isSemi(provider) { return channelOf(provider)?.mode === 'semi'; }

/** 글 주소 + utm — **서버가 만든다**(화면이 보낸 링크를 그대로 쓰지 않는다, 우리 도메인만). */
function linkUrlFor(slug, provider) {
  const origin = String(process.env.APP_URL || 'https://planq.kr').replace(/\/+$/, '');
  const u = new URL(`${origin}/insights/${encodeURIComponent(slug)}/`);
  u.searchParams.set('utm_source', provider);
  u.searchParams.set('utm_medium', 'social');
  u.searchParams.set('utm_campaign', `insight_${slug}`.slice(0, 120));
  return u.toString();
}

module.exports = { CHANNELS, channelOf, isSemi, linkUrlFor };
