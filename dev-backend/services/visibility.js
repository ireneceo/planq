// Visibility 4단계 매핑 헬퍼 (사이클 N+14)
// docs/VISIBILITY_VOCABULARY.md
//
// L1 (개인)        — uploader/owner 본인만
// L2 (팀 비공개)   — project_id 의 프로젝트 멤버
// L3 (워크스페이스) — same business 멤버 전체
// L4 (외부)        — share_token 발급, 공개 링크
//
// 자산별 컬럼이 다르므로 dispatch 헬퍼로 일관 매핑.
//   - File / ProjectNote — visibility 컬럼 (ENUM L1-L4)
//   - Post — 옛 visibility 컬럼 (ENUM internal/public) — 매핑 헬퍼로 L1-L4 변환
//   - KbDocument — scope 컬럼 (ENUM private/workspace/project/client) — 매핑 헬퍼로 L1-L4 변환
//   - Q Note Session (별도 SQLite) — visibility 컬럼 (TEXT L1-L4)
//
// L4 는 visibility 와 별개 — share_token 있고 shared_at NULL 아니면 L4 도 함께 active.

const LEVELS = ['L1', 'L2', 'L3', 'L4'];

function isValidLevel(level) {
  return typeof level === 'string' && LEVELS.includes(level);
}

// 자산 → visibility level 추출 (UI 표시·필터링용)
function getVisibilityLevel(asset) {
  if (!asset) return 'L3';
  // L4 (share_token 발급) 가 우선 — visibility 컬럼이 무엇이든 외부 공유 중
  if (asset.share_token && asset.shared_at) return 'L4';
  // 명시적 visibility 컬럼 (File / ProjectNote / Q Note Session 등)
  if (asset.visibility && isValidLevel(asset.visibility)) return asset.visibility;
  // KbDocument: scope ENUM 매핑
  if (asset.scope) {
    if (asset.scope === 'private') return 'L1';
    if (asset.scope === 'workspace') return 'L3';
    if (asset.scope === 'project' || asset.scope === 'client') return 'L2';
  }
  // Post (옛 visibility) — internal=L3 (워크스페이스 멤버), public=L4 (공유 token 없어도 인증 안 됨)
  if (asset.visibility === 'internal') return asset.project_id ? 'L2' : 'L3';
  if (asset.visibility === 'public') return 'L4';
  return 'L3'; // legacy default
}

// L2 선택 가능한지 — project_id 있어야 의미 있음
function canChooseL2(asset) {
  return !!(asset && asset.project_id);
}

// 현재 user 가 이 asset 을 볼 수 있는지 (visibility 기준)
// owner_id / project_id / business_id 를 asset 에서 추출.
async function canViewAsset({ asset, userId, businessId, sequelize }) {
  if (!asset) return false;
  const level = getVisibilityLevel(asset);
  // L4 (외부 token) — 별도 token 검증은 호출부에서. 본 함수는 인증된 사용자 기준.
  if (level === 'L4') return true;

  const ownerId = asset.owner_id || asset.user_id || asset.uploader_id || asset.created_by;
  if (ownerId === userId) return true;
  if (level === 'L1') return false;

  // L3: same business 멤버이면 OK
  if (level === 'L3') {
    if (!businessId) return false;
    if (!sequelize) return true; // 호출부가 이미 business 멤버 확인했다 가정
    const { BusinessMember } = require('../models');
    const bm = await BusinessMember.findOne({
      where: { user_id: userId, business_id: businessId },
    });
    return !!bm;
  }

  // L2: project 멤버
  if (level === 'L2') {
    const projectId = asset.project_id;
    if (!projectId) return false;
    if (!sequelize) return false;
    const { ProjectMember, ProjectClient } = require('../models');
    const pm = await ProjectMember.findOne({ where: { user_id: userId, project_id: projectId } });
    if (pm) return true;
    // KbDocument scope='client' 호환 — client_ids 안에 user 의 client 가 있으면 통과
    if (asset.scope === 'client' && Array.isArray(asset.client_ids)) {
      const pc = await ProjectClient.findOne({
        where: {
          project_id: projectId,
          contact_user_id: userId,
        },
      });
      return !!pc;
    }
    return false;
  }
  return false;
}

module.exports = {
  LEVELS,
  isValidLevel,
  getVisibilityLevel,
  canChooseL2,
  canViewAsset,
};
