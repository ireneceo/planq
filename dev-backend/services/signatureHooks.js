// 서명 상태가 바뀐 뒤 따라오는 일 — 한 곳 (2026-10-15)
//   signatures.js(서명·거절) · signature_internal.js(우리 쪽 로그인 서명) 세 자리가 같은 함수를 부른다.
//   ① 거래 단계 재계산(projectStageEngine) ② 직원 계약서면 계약 signed_at(payrollContracts). 둘 다 실패해도 서명은 그대로다.
function afterSignatureChange(signatureRequestId) {
  require('./projectStageEngine').onSignatureChanged(signatureRequestId).catch(() => null);
  require('./payrollContracts').onSignatureChanged(signatureRequestId).catch(() => null);
}

module.exports = { afterSignatureChange };
