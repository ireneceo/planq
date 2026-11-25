// 설정 › 권한 — «제한 자료를 검색에서 잠금으로 보이기» (2026-11-25, Irene «권고대로» · docs/FILE_SEARCH_DISCOVERY_DESIGN.md §2)
//   기본 꺼짐(지금과 같음). 대표·관리자만 바꾼다(서버 routes/access_requests.js PUT settings 가 다시 본다).
//   켜면 멤버 검색에 볼 권한 없는 프로젝트·지정 멤버 파일·문서가 이름·올린 사람만 잠금으로 보이고 열람을 요청할 수 있다.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AutoSaveField from '../Common/AutoSaveField';
import { Switch, SwitchKnob } from '../Common/switchShell';
import { fetchDiscoverySetting, saveDiscoverySetting, forgetDiscoverySetting } from '../../services/accessRequests';

const RestrictedDiscoverySection: React.FC<{ businessId: number; isOwner: boolean }> = ({ businessId, isOwner }) => {
  const { t } = useTranslation('common');
  const [on, setOn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const onRef = useRef(false);
  onRef.current = on;
  useEffect(() => {
    let alive = true;
    fetchDiscoverySetting(businessId).then((d) => { if (alive) { setOn(d.restricted_discoverable); setLoaded(true); } }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [businessId]);
  const persist = async () => {
    const next = onRef.current;
    try { await saveDiscoverySetting(businessId, next); forgetDiscoverySetting(businessId); }
    catch (e) { setOn(!next); throw e; }   // 래퍼가 ! 뱃지를 띄우려면 던진다
  };
  return (
    <Card data-testid="perm-restricted-discoverable">
      <Title id="perm-discoverable-label">{t('accessRequest.settings.title') as string}</Title>
      <Desc>{t('accessRequest.settings.desc') as string}</Desc>
      <Row>
        <InboxLink to="/access-requests">{t('accessRequest.settings.inboxLink') as string} →</InboxLink>
        <AutoSaveField key={`perm-discoverable-${businessId}`} type="toggle" onSave={persist}>
          <Switch type="button" role="switch" aria-checked={on} aria-labelledby="perm-discoverable-label"
            data-testid="perm-restricted-discoverable-switch" $on={on} disabled={!isOwner || !loaded}
            onClick={() => setOn((v) => !v)}>
            <SwitchKnob $on={on} />
          </Switch>
        </AutoSaveField>
      </Row>
    </Card>
  );
};

export default RestrictedDiscoverySection;

const Card = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px 20px; margin-top: 16px;
  display: flex; flex-direction: column; gap: 10px;   /* 같은 화면의 기본 청구 담당·상담 유입 카드와 같은 값 */
`;
const Title = styled.div` font-size: 0.9375rem; font-weight: 700; color: #0f172a; `;
const Desc = styled.div` font-size: 0.8125rem; color: #64748b; line-height: 1.5; `;
const Row = styled.div` display: flex; align-items: center; justify-content: space-between; gap: 12px; `;
const InboxLink = styled(Link)` font-size: 0.8125rem; font-weight: 600; color: #0F766E; text-decoration: none; &:hover { text-decoration: underline; } `;
