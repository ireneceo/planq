// Q Note 요약 → 문서 저장 — 저장할 때 공개 범위를 고른다 (Irene 2026-10-29 «회의록 같은 거 여기 남을 거라서» · 권고 A).
//   저장된 문서는 업무·댓글·수정요청 첨부의 «기존 파일·문서 검색» 으로 붙인다. 노트 자체(사적 공간)는 그대로 — 문서는 사본이다.
//   기본 선택 = 노트의 지금 공개 범위(L1 이면 «나만 보기»). 외부(L4)·특정 멤버는 저장 뒤 문서에서 고른다.
import React from 'react';
import { useTranslation } from 'react-i18next';
import VisibilityChangeModal from '../../components/Common/VisibilityChangeModal';
import { saveSummaryAsDoc } from '../../utils/qnoteSummaryDoc';

interface Props {
  open: boolean;
  businessId: number;
  session: { title?: string | null; visibility?: string | null; project_id?: number | null; summary_key_points?: string[] | null; summary_full?: string | null };
  projects: Array<{ id: number; name: string }>;
  onSaved: () => void;
  onError: (msg: string) => void;
  onClose: () => void;
}

const SummaryDocSaveModal: React.FC<Props> = ({ open, businessId, session, projects, onSaved, onError, onClose }) => {
  const { t } = useTranslation('qnote');
  const cur = ['L1', 'L2', 'L3'].includes(session.visibility || '') ? session.visibility as 'L1' | 'L2' | 'L3' : 'L1';
  return (
    <VisibilityChangeModal
      open={open}
      current={cur}
      currentProjectId={session.project_id ?? null}
      canChooseL2
      projects={projects}
      hide={{ L2_members: true, L4: true }}
      title={t('page.summary.saveDocVisTitle', '문서로 저장') as string}
      hint={t('page.summary.saveDocVisHint', '저장한 문서를 누가 볼 수 있는지 고르세요. 업무·댓글 첨부에서 이 문서를 붙일 수 있습니다.') as string}
      confirmLabel={t('page.summary.saveDoc', '문서로 저장') as string}
      onConfirm={async ({ level, projectId }) => {
        try {
          await saveSummaryAsDoc({
            businessId,
            title: `${session.title || 'Q Note'} — ${t('page.summary.title')}`,
            keyPoints: session.summary_key_points || [],
            full: session.summary_full || '',
            labels: { keyPoints: t('page.summary.keyPointsLabel') as string, full: t('page.summary.fullLabel') as string },
            vlevel: level === 'L4' ? 'L1' : level,
            projectId: projectId ?? null,
          });
          onSaved();
        } catch (e) {
          onError((e as Error).message || (t('page.summary.saveDocFailed') as string));
          throw e;  // 창이 닫히지 않게 — 다시 시도할 수 있다
        }
      }}
      onClose={onClose}
    />
  );
};

export default SummaryDocSaveModal;
