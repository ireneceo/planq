// 업무 만들기 폼의 «산출물» 줄 (docs/TASK_DELIVERABLES_DESIGN.md §6.2) — 설명 바로 아래 전폭, «업무»·«요청하기» 두 모드 모두.
//   TaskCreateForm(800줄 한도 근처)에 인라인하지 않고 여기 한 벌 — 고를 목록(사전+기본 목록)도 여기서 읽는다.
//   고른 값은 폼이 제출 본문 `output_kind_ids` 로 싣는다(만든 뒤 PUT 따로 없음 — 생성 트랜잭션 안에서 연결).
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import OutputKindPicker from './OutputKindPicker';
import { useTaskOutputKindDict } from './useTaskOutputKindDict';
import { useAuth } from '../../contexts/AuthContext';
import type { OutputKindLite } from './outputKindLabel';

interface Props {
  bizId: number | null;
  value: OutputKindLite[];
  onChange: (next: OutputKindLite[]) => void;
}

const TaskCreateOutputKinds: React.FC<Props> = ({ bizId, value, onChange }) => {
  const { t } = useTranslation('qtask');
  const { user } = useAuth();
  // 고객은 산출물을 고르지 않는다(설계 §3.2·§6.2) — 칸을 그리지 않고 사전 API(고객 403)도 치지 않는다.
  //   판정은 업무 상세 드로어와 같은 술어(이 워크스페이스에서의 내 역할).
  const isClient = (user?.workspaces || []).find((w) => w.business_id === bizId)?.role === 'client';
  const dict = useTaskOutputKindDict(bizId, !isClient);
  if (isClient) return null;
  return (
    <Row data-field="outputs">
      <Label>{t('outputs.label', '산출물')}</Label>
      <OutputKindPicker bizId={bizId} rows={dict.rows} pendingPresets={dict.pendingPresets} value={value}
        onChange={onChange} onDictAdd={dict.add} testId="task-add-outputs" />
      <Hint>{t('outputs.clientHint', '고객이 보는 업무에서는 산출물 이름이 고객에게도 보입니다')}</Hint>
    </Row>
  );
};

export default TaskCreateOutputKinds;

const Row = styled.div`display:flex;flex-direction:column;gap:3px;min-width:0;`;
const Label = styled.label`font-size:0.6875rem;color:#64748B;font-weight:600;`;
const Hint = styled.div`font-size:0.6875rem;color:#94A3B8;`;
