// services/todo/common.js — 확인필요(todo) 수집기들의 공용 조각. **단일 원천.**
//
// routes/dashboard.js 가 god-file 임계(라우트 500줄 · 래칫 +15%)에 닿아 수집기를 꺼내기 시작했다.
// 꺼낼 때 상한·시각 변환이 복사되면 버킷마다 다른 값이 되고, 그 차이는 **숫자로만** 드러난다
// (사용자에겐 "왜 숫자가 안 맞지" 로 보인다). 그래서 여기 한 곳에 둔다.

/** 한 버킷이 모으는 최대 항목 수. 목록 상한이며 **집계를 자르는 값이 아니다.** */
const COLLECT_LIMIT = 120;

/** Date|string → ISO. 깨진 값은 null (화면에서 Invalid Date 를 만들지 않는다) */
function safeToIso(dt) {
  if (!dt) return null;
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

module.exports = { COLLECT_LIMIT, safeToIso };
