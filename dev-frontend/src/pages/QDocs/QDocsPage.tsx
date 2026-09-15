// Q docs — 워크스페이스 문서 페이지.
//
// 2026-05-03: 받은 서명 archive 를 /signatures/received 로 분리 (능동 vs 수동 정신 모델 분리).
// 이전 ?tab=received-signatures URL 은 /signatures/received 로 redirect (북마크 호환).

import React, { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PostsPage from '../../components/Docs/PostsPage';
import { panelShellHeight } from '../../components/Layout/PanelLayout';
import { useAuth } from '../../contexts/AuthContext';

const QDocsPage: React.FC = () => {
  const { t } = useTranslation('qdocs');
  const { user } = useAuth();
  const businessId = user?.business_id;
  const location = useLocation();
  const navigate = useNavigate();

  // 이전 받은 서명 탭 URL 호환 — 북마크/외부 링크 보호
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('tab') === 'received-signatures') {
      navigate('/signatures/received', { replace: true });
    }
  }, [location.search, navigate]);

  const scope = useMemo(
    () => (businessId ? { type: 'workspace' as const, businessId: Number(businessId) } : null),
    [businessId]
  );

  return (
    <FullHeight>
      {scope ? <PostsPage scope={scope} /> : <Fallback>{t('page.noWorkspace')}</Fallback>}
    </FullHeight>
  );
};

export default QDocsPage;

// ★ 2026-09-15 (Irene: "문서 메뉴에서 상단이 스크롤 따라 자꾸 들어가. 서브헤더는 고정이어야 하잖아.")
//   이 쪽은 **이미 올바른 높이로 잡힌 탭 스크롤 슬롯 안**에 들어간다. 그런데 100vh 는
//   크롬(탭바·모바일 헤더·상태바)을 모르고 **뷰포트 전체**를 주장해 그 크롬 높이만큼
//   슬롯을 넘는다. 실측(2026-09-15, 3폭): 슬롯 770 ← 내용 900(데스크탑) · 986 ← 1112(태블릿) ·
//   682 ← 788(폰). 넘친 만큼 **바깥 컨테이너가 스크롤**하고, 그러면 좌측 머리줄(AI·템플릿·+)과
//   우측 두 밴드가 **함께 위로 올라간다**. 각 패널이 자기 안에서 스크롤하지 못한다.
//   → 높이는 **슬롯이 정한다**(100%). 크롬 높이를 여기서 빼지 않는다 — 56px 같은 숫자는
//   기기마다 거짓이 된다(memory feedback_js_constant_cannot_be_responsive ·
//   CLAUDE.md "떠 있는 패널의 상단 기준선" — 기준선을 컴포넌트가 정하지 않는다).
const FullHeight = styled.div`
  /* 값을 여기 다시 적지 않는다 — 정본은 panelShellHeight 하나다. 베끼면 갈라진다
     (memory feedback_copied_component_drifts_extract_shell). Q Talk·Q mail·Q Task·Q Note 가
     같은 토큰을 쓴다. 그 토큰 주석에 이미 적혀 있다: "모바일 헤더(56px) 보정도
     MainLayout(padding-top:56px) 에서 처리하므로 -56px 불필요" — 여기서 또 빼면 이중 차감이다
     (그것이 폰에서 슬롯 682 에 내용 788 이 들어가던 원인이었다). */
  ${panelShellHeight}
  display: flex;
  flex-direction: column;
`;
const Fallback = styled.div`padding: 40px; text-align: center; color: #94A3B8; font-size: 0.8125rem;`;
