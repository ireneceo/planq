// 동료의 «워크스페이스 기본 명함» 보기 — 설계 docs/NAME_CARD_V2_DESIGN.md 결정 3 (Fable 2026-10-22)
//   드로어는 **하나** — 사람 팝오버 · 설정 > 멤버 상세 · 조직도가 같은 것을 연다(새로 그리지 않는다).
//   내용 = 같은 CardFace(공개 페이지·내 명함 미리보기와 같은 모양) + [연락처에 저장 .vcf] + 링크가 열려 있을 때만 [명함 페이지 열기].
//   기본 명함이 없으면 버튼을 그리지 않는 것은 부르는 쪽(useMemberCard 가 null) — 이 드로어는 열린 뒤 404 면 안내 문장만.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../Common/DetailDrawer';
import ActionButton from '../Common/ActionButton';
import CardFace from './CardFace';
import { useAuthedImageSrc } from '../../hooks/useAuthedImageSrc';
import { fetchMemberCard, memberCardPhotoUrl, downloadMemberVcf, type MemberCard } from '../../services/nameCards';

interface Props { businessId: number; userId: number | null; onClose: () => void }

const NameCardViewDrawer: React.FC<Props> = ({ businessId, userId, onClose }) => {
  const { t } = useTranslation('cards');
  const [data, setData] = useState<MemberCard | null | 'loading' | 'none'>('loading');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    setData('loading');
    fetchMemberCard(businessId, userId).then((d) => { if (alive) setData(d || 'none'); }).catch(() => { if (alive) setData('none'); });
    return () => { alive = false; };
  }, [businessId, userId]);
  const card = data && typeof data === 'object' ? data : null;
  const photo = useAuthedImageSrc(card && userId ? memberCardPhotoUrl(businessId, userId, card.card) : null);

  return (
    <DetailDrawer open={!!userId} onClose={onClose} ariaLabel={t('memberCard.aria') as string}>
      <DetailDrawer.Header onClose={onClose}><Title>{card ? card.card.name : t('memberCard.title')}</Title></DetailDrawer.Header>
      <DetailDrawer.Body>
        {data === 'loading' && <Muted aria-busy="true">…</Muted>}
        {data === 'none' && <Muted data-testid="member-card-none">{t('memberCard.none')}</Muted>}
        {card && <CardFace view={card.card} photoSrc={photo} testId="member-card-face" />}
      </DetailDrawer.Body>
      {card && userId && (
        <DetailDrawer.Footer>
          {card.url && (
            <ActionButton tone="secondary" size="md" data-testid="member-card-open"
              onClick={() => { window.open(card.url as string, '_blank', 'noopener'); }}>{t('card.openPage')}</ActionButton>
          )}
          <ActionButton tone="primary" size="md" loading={busy} disabled={busy} data-testid="member-card-vcf"
            onClick={() => void (async () => { setBusy(true); try { await downloadMemberVcf(businessId, userId, card.card.name); } finally { setBusy(false); } })()}>
            {t('saved.vcf')}
          </ActionButton>
        </DetailDrawer.Footer>
      )}
    </DetailDrawer>
  );
};
export default NameCardViewDrawer;

/** 이 사람에게 기본 명함이 있나 — 있을 때만 [명함 보기] 를 그린다(없으면 버튼 자체가 없다) */
export function useHasMemberCard(businessId: number | null | undefined, userId: number | null | undefined, enabled = true): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!enabled || !businessId || !userId) { setHas(false); return undefined; }
    let alive = true;
    fetchMemberCard(businessId, userId).then((d) => { if (alive) setHas(!!d); }).catch(() => { if (alive) setHas(false); });
    return () => { alive = false; };
  }, [businessId, userId, enabled]);
  return has;
}

const Title = styled.h2`margin: 0; font-size: 1rem; font-weight: 700; color: #0F172A; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Muted = styled.div`font-size: 0.875rem; color: #64748B; padding: 12px 0;`;

/** [명함 보기] — 그 사람에게 기본 명함이 있을 때만 그린다(멤버 상세 드로어처럼 렌더 함수 안에서 훅을 못 쓰는 곳용) */
export const MemberCardButton: React.FC<{ businessId: number; userId: number; onOpen: (userId: number) => void; known?: boolean }> = ({ businessId, userId, onOpen, known }) => {
  const { t } = useTranslation('cards');
  const has = useHasMemberCard(businessId, userId, known === undefined);
  if (!(known ?? has)) return null;
  return (
    <CardBtn type="button" onClick={() => onOpen(userId)} data-testid={`member-card-btn-${userId}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="8" cy="11" r="2" /><path d="M5 16c.6-1.4 1.8-2 3-2s2.4.6 3 2" /><line x1="14" y1="10" x2="19" y2="10" /><line x1="14" y1="14" x2="18" y2="14" /></svg>
      {t('memberCard.open')}
    </CardBtn>
  );
};
const CardBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 10px; border-radius: 8px;
  border: 1px solid #E2E8F0; background: #FFFFFF; color: #0F766E; font-size: 0.75rem; font-weight: 600; cursor: pointer; flex-shrink: 0;
  &:hover { border-color: #14B8A6; background: #F0FDFA; }
  @media (max-width: 640px) { min-height: 36px; }
`;
