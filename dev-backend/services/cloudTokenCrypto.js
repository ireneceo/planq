// services/cloudTokenCrypto.js — 워크스페이스 클라우드 토큰(business_cloud_tokens) 저장 암호화.
//
// 왜 필요한가
//   개인 연동(external_connections)은 처음부터 AES-256-GCM 으로 저장했는데, 워크스페이스 연동은
//   **평문 TEXT** 였다. 같은 제품 안에서 같은 종류의 비밀에 두 기준이 있었다.
//   Google OAuth 검증(2026-08) 준비 중 실측으로 드러났다.
//
// 옛 행 호환 (백필 없이)
//   기존 행은 평문이다. 읽기 시 복호화를 시도하고, 실패하면 **평문으로 간주**해 그대로 쓴다.
//   그 순간 암호문으로 다시 저장한다(지연 백필) — 쓰기측을 먼저 고쳤으므로 같은 결손이
//   다시 쌓이지 않는다 (memory feedback_backfill_needs_write_side_fix).
//   ★ 평문 오인 위험은 없다: Google 토큰은 `ya29.` / `1//` 로 시작하고 `.` `/` `_` `-` 를 포함해
//     base64 디코딩 후 GCM 인증 태그 검증을 통과할 수 없다. 통과하면 그건 실제 암호문이다.
'use strict';

const { encrypt, decrypt } = require('./encryption');

/** 저장값 → 평문. 옛 평문 행은 그대로 돌려준다. 두 번째 값은 "다시 저장이 필요한가". */
function readSecret(stored) {
  if (!stored) return { value: null, needsRewrite: false };
  const plain = decrypt(stored);
  if (plain) return { value: plain, needsRewrite: false };
  // 복호화 실패 = 옛 평문 행 (또는 키 불일치). 값은 살리고 재저장 대상으로 표시한다.
  return { value: stored, needsRewrite: true };
}

/** 평문 → 저장값. */
function writeSecret(plain) {
  return plain ? encrypt(plain) : null;
}

/**
 * BusinessCloudToken 행에서 access/refresh 를 평문으로 꺼낸다.
 * 옛 평문 행이면 **그 자리에서 암호문으로 재저장**한다(best-effort — 실패해도 읽기는 성공).
 */
async function readTokenPair(row) {
  const a = readSecret(row.access_token);
  const r = readSecret(row.refresh_token);
  if (a.needsRewrite || r.needsRewrite) {
    try {
      const patch = {};
      if (a.needsRewrite && a.value) patch.access_token = writeSecret(a.value);
      if (r.needsRewrite && r.value) patch.refresh_token = writeSecret(r.value);
      if (Object.keys(patch).length) await row.update(patch);
    } catch (e) {
      console.warn('[cloudTokenCrypto] 지연 재저장 실패(읽기는 계속):', e.message);
    }
  }
  return { accessToken: a.value, refreshToken: r.value };
}

/**
 * 연결 해제 시 Google 쪽 토큰을 revoke 한다 (best-effort).
 *
 * 여태 워크스페이스 해제는 DB 행만 지웠다 — 사용자의 Google 계정 "액세스 권한" 목록에는
 * PlanQ 가 그대로 남아, 해제했는데 해제되지 않은 것처럼 보였다. 개인 연동은 처음부터
 * revoke 했으므로 같은 제품 안에서 기준이 둘이었다.
 * refresh token 을 revoke 하면 그 승인(grant) 전체가 해제된다 — 그래서 refresh 를 우선 쓴다.
 * 실패해도 행 삭제는 진행한다(사용자 입장에서 해제는 되어야 한다). 실패는 로그로 남긴다.
 */
async function revokeCloudToken(row) {
  try {
    if (!row) return false;
    const { accessToken, refreshToken } = await readTokenPair(row);
    const token = refreshToken || accessToken;
    if (!token) return false;
    const { google } = require('googleapis');
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    await client.revokeToken(token);
    return true;
  } catch (e) {
    console.warn('[cloudTokenCrypto] revoke 실패(해제는 계속):', e.message);
    return false;
  }
}

module.exports = { readSecret, writeSecret, readTokenPair, revokeCloudToken };
