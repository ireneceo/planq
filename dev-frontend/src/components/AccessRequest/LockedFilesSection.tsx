// Q file 검색의 «볼 권한이 없는 파일» 칸 — 검색어가 있을 때만 서버에 묻는다(services/lockedDiscovery · 설정이 꺼져 있으면 빈 목록).
//   목록·폴더 건수에는 넣지 않는다(설계 §2 «표면: 검색 두 곳만»). 늦게 온 옛 응답은 버린다.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LockedResultRow from './LockedResultRow';
import { fetchLocked, type LockedItem } from '../../services/accessRequests';

const LockedFilesSection: React.FC<{ businessId: number | null | undefined; query: string }> = ({ businessId, query }) => {
  const { t } = useTranslation('common');
  const [items, setItems] = useState<LockedItem[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (!q || !businessId) { setItems([]); return; }
    const my = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const d = await fetchLocked(businessId, q, ['file']);
        if (my === seq.current) setItems(d.files || []);
      } catch { if (my === seq.current) setItems([]); }
    }, 250);
    return () => clearTimeout(timer);
  }, [businessId, query]);
  if (!items.length || !businessId) return null;
  return (
    <Wrap data-testid="docs-locked">
      <Title>{t('accessRequest.lockedGroup', '볼 권한이 없는 자료') as string}</Title>
      {items.map((it) => <LockedResultRow key={it.id} businessId={businessId} item={it} query={query} />)}
    </Wrap>
  );
};

export default LockedFilesSection;

const Wrap = styled.div` margin-top: 16px; padding-top: 12px; border-top: 1px dashed #E2E8F0; `;
const Title = styled.div` font-size: 0.75rem; font-weight: 700; color: #94A3B8; padding: 0 12px 4px; `;
