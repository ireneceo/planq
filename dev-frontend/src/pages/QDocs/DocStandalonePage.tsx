// DocStandalonePage — 문서 하나만 보이는 분리 창 (/doc-popout?post=:id)
//
// 2026-11-04 Irene «업무상세에서 문서 첨부한거 열면 팝업인데 다 잘려서 볼 수가 없어. 그냥 새창팝업으로 열려야 하는 거 아니야?
//   작은 팝업 형태는 안될 것 같아.» — 앱 안 미리보기(PostPreviewModal)는 760px 상자라 표·넓은 본문이 잘리고 버튼도 없었다.
// 새 화면을 그리지 않는다 — 문서 상세와 **같은 화면**(PostsPage 고정 모드 = 프로젝트 «메뉴에 추가한 문서» 탭과 같은 길)을
//   사이드바·탭 없이 창 하나에 얹는다(utils/docWindow.openDocWindow 가 연다). 권한은 서버 문서 조회가 그대로 판정한다.
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PostsPage from '../../components/Docs/PostsPage';
import { fetchPost } from '../../services/posts';
import { markPopoutWindow } from '../../utils/popout';
import { useAppShellLock } from '../../hooks/useAppShellLock';

const DocStandalonePage: React.FC = () => {
  useAppShellLock();
  const { t } = useTranslation('qtalk');
  const [sp] = useSearchParams();
  const postId = Number(sp.get('post')) || 0;
  const [where, setWhere] = useState<{ businessId: number; projectId: number | null } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.body.dataset.popout = '1';
    markPopoutWindow();
    return () => { delete document.body.dataset.popout; };
  }, []);

  useEffect(() => {
    if (!postId) { setFailed(true); return; }
    let alive = true;
    fetchPost(postId)
      .then((d) => {
        if (!alive) return;
        if (!d) { setFailed(true); return; }
        document.title = d.title || (t('docPopout.windowTitle', 'PlanQ 문서') as string);
        setWhere({ businessId: d.business_id, projectId: d.project_id ?? null });
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [postId, t]);

  if (failed) return <Shell><Center>{t('docPopout.notFound', '이 문서를 볼 수 없습니다. 삭제됐거나 볼 권한이 없어요.') as string}</Center></Shell>;
  if (!where) return <Shell><Center>{t('docPopout.loading', '문서를 불러오는 중…') as string}</Center></Shell>;
  return (
    <Shell data-testid="doc-popout">
      <PostsPage
        scope={where.projectId
          ? { type: 'project', businessId: where.businessId, projectId: where.projectId }
          : { type: 'workspace', businessId: where.businessId }}
        pinnedPostId={postId}
      />
    </Shell>
  );
};

export default DocStandalonePage;

const Shell = styled.div`
  /* 팝아웃 창 공통 — 높이는 --vvh 하나로(QTaskStandalonePage 와 같은 이유) */
  height: 100vh;
  height: 100dvh;
  height: var(--vvh, 100dvh);
  width: 100vw;
  overflow: hidden;
  background: #FFFFFF;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding-top: var(--pq-safe-top, 0px);
`;
const Center = styled.div`
  flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px;
  color: #64748B; font-size: 0.875rem; text-align: center;
`;
