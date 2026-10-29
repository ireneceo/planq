// 폴더 응답 — **화이트리스트 한 벌** (#469 · Fable 설계 판정 «반드시 고칠 것 A»).
//
//   폴더 행을 통째로(toJSON) 내보내면 공유 칸이 늘어난 날부터 `share_token` 이 멤버 전원(프로젝트 폴더는 고객까지)에게 간다 —
//   토큰이 곧 공개 링크다. 그래서 목록·생성·이름 변경 응답이 모두 이 함수를 거친다(열거식으로 지우지 않고 남길 것만 남긴다).
//   멤버: 공유 상태(share_on·만료·비밀번호 여부·발급자) · 고객: 공유 칸 없음(고객이 알 일이 아니다 — 판정 9).
'use strict';

const BASE = ['id', 'business_id', 'project_id', 'parent_id', 'name', 'sort_order', 'created_by', 'gdrive_folder_id', 'created_at', 'updated_at'];

function serializeFolder(folder, { client = false, extra = null } = {}) {
  if (!folder) return folder;
  const src = typeof folder.get === 'function' ? folder.get({ plain: true }) : folder;
  const out = {};
  for (const k of BASE) if (src[k] !== undefined) out[k] = src[k];
  if (out.created_at === undefined && src.createdAt !== undefined) out.created_at = src.createdAt;
  if (out.updated_at === undefined && src.updatedAt !== undefined) out.updated_at = src.updatedAt;
  if (!client) {
    out.share_on = !!src.share_token;
    out.share_expires_at = src.share_token ? (src.share_expires_at || null) : null;
    out.share_password_set = !!(src.share_token && src.share_password_hash);
    out.shared_by = src.share_token ? (src.shared_by || null) : null;
  }
  if (extra) Object.assign(out, extra);
  return out;
}

module.exports = { serializeFolder };
