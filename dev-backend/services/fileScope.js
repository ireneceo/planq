// services/fileScope.js — "이 프로젝트/폴더가 이 워크스페이스 것인가" 의 **단일 판정**.
//
// routes/files.js 업로드는 이걸 검사했는데 새로 낸 문(POST /api/drive/import)은 안 했다.
// 같은 문이 둘로 갈라져 한쪽만 막히는 상태였다(Fable 사후 감사 2026-09-07).
//   biz 3 멤버가 `project_id`(biz 5) 를 주면 200 이 나고 행이 `{business_id:3, project_id:57}` 로 남았다.
//   목록 쿼리가 business_id 를 붙여서 새어 나가진 않았지만, 데이터가 거짓이 된다.
const { Project, FileFolder } = require('../models');

/** 프로젝트가 이 워크스페이스 소속인가. projectId 가 없으면 통과. */
async function isProjectInBusiness(projectId, businessId) {
  if (!projectId) return true;
  const p = await Project.findOne({ where: { id: projectId, business_id: businessId }, attributes: ['id'] });
  return !!p;
}

/** 폴더가 이 워크스페이스(그리고 주어졌다면 그 프로젝트) 것인가. folderId 가 없으면 통과. */
async function isFolderInBusiness(folderId, businessId, projectId) {
  if (!folderId) return true;
  const f = await FileFolder.findOne({
    where: { id: folderId, business_id: businessId, ...(projectId ? { project_id: projectId } : {}) },
    attributes: ['id'],
  });
  return !!f;
}

module.exports = { isProjectInBusiness, isFolderInBusiness };
