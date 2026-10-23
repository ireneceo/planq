// 한국 사업자등록번호 체크섬 검증 — 형식(10자리)만으로는 오타를 못 잡아 owner 가 홈택스 헛걸음.
// 가중치 [1,3,7,1,3,7,1,3,5] + 9번째 자리 보정. 공개 증빙 신청(routes/invoices.js)·사업자등록증 읽기(services/bizRegRead)가 같이 쓴다.
function isValidKrBizNo(taxId) {
  const d = String(taxId || '').replace(/[^0-9]/g, '');
  if (d.length !== 10) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * w[i];
  sum += Math.floor((Number(d[8]) * 5) / 10);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(d[9]);
}

/** 숫자 10자리 → 123-45-67890 */
function formatKrBizNo(taxId) {
  const d = String(taxId || '').replace(/[^0-9]/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d;
}

module.exports = { isValidKrBizNo, formatKrBizNo };
