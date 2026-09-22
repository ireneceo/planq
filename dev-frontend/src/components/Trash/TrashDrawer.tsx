// TrashDrawer — PlanQ 의 **휴지통은 하나다** (2026-09-22).
//
// Irene: *"휴지통 여기 저기 있는 거 제대로 통일되서 사용되는 거 맞아? 휴지통이 분산되어 있는 거 이상한데."*
//   여태 파일 휴지통(Q file·프로젝트>파일)과 문서·정보 휴지통(Q docs)이 **서랍 두 개·버튼 두 모양**이었고,
//   Q info 에는 여는 문조차 없었다(정보를 지우면 Q docs 에서만 되살릴 수 있었다).
//   → 서랍은 이것 하나, 여는 버튼은 TrashButton 하나. 어디서 열든 같은 화면이고
//     **그 메뉴의 칸이 먼저 선택된 채** 열린다(Q file → 파일, Q docs → 문서, Q info → 정보).
//
// 서버의 보관·복원은 그대로다 — 파일은 /api/files/:biz/trash, 문서·정보는 /api/content-trash/:biz.
// 목록은 칸 컴포넌트(FileTrashPanel · ContentTrashPanel)가 그대로 그린다. 여기서 다시 그리지 않는다.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../Common/DetailDrawer';
import { SegmentedToggle, SegmentedBtn } from '../Common/segmentedToggle';
import FileTrashPanel from './FileTrashPanel';
import ContentTrashPanel from './ContentTrashPanel';

export type TrashTab = 'all' | 'file' | 'doc' | 'info';

interface Props {
  open: boolean;
  businessId: number;
  /** 파일 칸을 이 프로젝트로 좁힌다(프로젝트>파일 탭에서 열 때) */
  projectId?: number;
  /** 열릴 때 먼저 선택되는 칸 — 연 메뉴를 따른다 */
  initialTab: TrashTab;
  onClose: () => void;
  /** 복원/영구삭제 후 바깥 목록을 다시 그리게 한다 */
  onChanged: () => void;
}

const TABS: TrashTab[] = ['all', 'file', 'doc', 'info'];

const TrashDrawer: React.FC<Props> = ({ open, businessId, projectId, initialTab, onClose, onChanged }) => {
  const { t } = useTranslation('common');
  const [tab, setTab] = useState<TrashTab>(initialTab);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);

  // 열 때마다 연 메뉴의 칸으로 — 지난번에 보던 칸이 남으면 «Q info 에서 눌렀는데 파일이 뜬다» 가 된다
  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);

  // 보관기간은 요금제 한 값이다(두 서버 응답이 같은 정책을 읽는다). 먼저 온 값을 쓴다.
  const onRetention = useCallback((d: number | null) => { if (d != null) setRetentionDays(d); }, []);

  const showFile = tab === 'all' || tab === 'file';
  const contentKinds: Array<'post' | 'kb'> = tab === 'doc' ? ['post'] : tab === 'info' ? ['kb'] : ['post', 'kb'];
  const showContent = tab !== 'file';
  const label = (k: TrashTab) => t(`trash.tab.${k}`, { defaultValue: { all: '전체', file: '파일', doc: '문서', info: '정보' }[k] }) as string;

  return (
    <DetailDrawer open={open} onClose={onClose} ariaLabel={t('trash.title', { defaultValue: '휴지통' }) as string}>
      <DetailDrawer.Header onClose={onClose}>
        <div>
          <HeadTitle>{t('trash.title', { defaultValue: '휴지통' })}</HeadTitle>
          {retentionDays != null && (
            <HeadHint>{t('trash.retention', { count: retentionDays, defaultValue: '삭제 후 {{count}}일 안에는 되돌릴 수 있어요. 지나면 자동으로 비워집니다.' }) as string}</HeadHint>
          )}
        </div>
      </DetailDrawer.Header>
      <DetailDrawer.Body>
        <TabRow>
          <SegmentedToggle role="tablist" aria-label={t('trash.title', { defaultValue: '휴지통' }) as string}>
            {TABS.map((k) => (
              <SegmentedBtn key={k} type="button" role="tab" aria-selected={tab === k}
                $active={tab === k} data-testid={`trash-tab-${k}`} onClick={() => setTab(k)}>
                {label(k)}
              </SegmentedBtn>
            ))}
          </SegmentedToggle>
        </TabRow>

        {showFile && (
          <Section>
            {tab === 'all' && <SectionTitle>{label('file')}</SectionTitle>}
            <FileTrashPanel active={open && showFile} businessId={businessId} projectId={projectId}
              showEmpty={tab === 'file'} onChanged={onChanged} onRetention={onRetention} />
          </Section>
        )}
        {showContent && (
          <Section>
            {tab === 'all' && <SectionTitle>{t('trash.sectionContent', { defaultValue: '문서·정보' })}</SectionTitle>}
            <ContentTrashPanel active={open && showContent} businessId={businessId} kinds={contentKinds}
              onChanged={onChanged} onRetention={onRetention} />
          </Section>
        )}
      </DetailDrawer.Body>
    </DetailDrawer>
  );
};

export default TrashDrawer;

const HeadTitle = styled.div`font-size: 1rem; font-weight: 700; color: #0F172A;`;
const HeadHint = styled.div`font-size: 0.75rem; color: #64748B; margin-top: 2px;`;
// ★ flex-shrink: 0 — DetailDrawer.Body 는 세로 flex 다. overflow 를 준 자식은 min-height 가 0 이 되어
//   목록이 길면 **0px 로 눌려 탭이 한 픽셀도 안 그려졌다**(2026-09-22 실측: rect 는 52×26 인데 부모 h=0,
//   클릭이 본문에 떨어졌다). 가로 넘침은 폰에서 알약이 안 들어갈 때만 생기므로 스크롤은 유지한다.
const TabRow = styled.div`flex-shrink: 0; margin-bottom: 12px; overflow-x: auto;`;
const Section = styled.section`flex-shrink: 0; & + & { margin-top: 20px; }`;
const SectionTitle = styled.div`
  font-size: 0.75rem; font-weight: 700; color: #64748B;
  padding-bottom: 6px; margin-bottom: 8px; border-bottom: 1px solid #E2E8F0;
`;
