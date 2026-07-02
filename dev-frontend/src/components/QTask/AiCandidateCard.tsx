// AI 업무 후보 카드 — AiTaskCreateModal(분해 모달)과 CueTaskBar(말 걸기 바) 공유.
// 제목·마감·예상시간·담당자 인라인 편집 + 모호한 업무명(⚠) 경고. 단일 진실 원천(DRY).
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect from '../Common/PlanQSelect';
import { CalendarIcon, ClockIcon } from '../Common/Icons';

export interface AiCandidate {
  idx: number;
  title: string;
  description?: string;
  estimated_hours: number;
  duration_days: number;
  start_offset_days: number;
  due_offset_days: number;
  priority: string;
  assignee_hint: string | null;
  assignee_name?: string | null; // #90 — LLM 이 추출한 이름 (매칭 실패 시 경고 표시용)
  assignee_user_id: number | null;
  depends_on_index: number | null;
  vague: boolean;
  selected: boolean;
}

export interface AiCardMember { user_id: number; name: string; }

// 날짜 헬퍼 (UTC 기준 — 표시용). 모달·바 공통 사용.
export function addDaysISO(baseISO: string, days: number): string {
  const d = new Date(baseISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function fmtMd(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[1])}/${Number(m[2])}` : iso;
}

interface Props {
  candidate: AiCandidate;
  members: AiCardMember[];
  baseDate: string;
  onChange: (patch: Partial<AiCandidate>) => void;
}

export default function AiCandidateCard({ candidate: c, members, baseDate, onChange }: Props) {
  const { t } = useTranslation('qtask');
  const dur = Math.max(1, c.due_offset_days - c.start_offset_days);
  const startDateStr = addDaysISO(baseDate, c.start_offset_days);
  const dueDateStr = addDaysISO(baseDate, c.due_offset_days);

  return (
    <Card $disabled={!c.selected}>
      <CardHeader>
        <Checkbox
          type="checkbox"
          checked={c.selected}
          onChange={e => onChange({ selected: e.target.checked })}
        />
        <TitleInput
          value={c.title}
          onChange={e => onChange({ title: e.target.value })}
          $vague={c.vague}
        />
        {c.vague && <VagueBadge title={t('ai.vagueHint', '결과물 명사가 빠진 것 같아요. 예: "디자인" → "메인 시안 작성"') as string}>⚠</VagueBadge>}
        <AssigneeInline>
          <PlanQSelect
            size="sm"
            isClearable
            placeholder={t('ai.assigneeUnassigned', '미배정') as string}
            value={c.assignee_user_id
              ? { value: String(c.assignee_user_id), label: members.find(m => m.user_id === c.assignee_user_id)?.name || `#${c.assignee_user_id}` }
              : null}
            onChange={(v) => {
              const val = (v as { value?: string })?.value;
              onChange({ assignee_user_id: val ? Number(val) : null });
            }}
            options={members.map(m => ({ value: String(m.user_id), label: m.name || `#${m.user_id}` }))}
          />
        </AssigneeInline>
      </CardHeader>
      {!c.assignee_user_id && c.assignee_name && (
        <UnmatchedWarn>
          {t('ai.assigneeUnmatched', '"{{name}}" 을(를) 멤버에서 찾지 못했어요 — 담당자를 직접 선택해 주세요. 그대로 확정하면 내 업무로 만들어집니다.', { name: c.assignee_name }) as string}
        </UnmatchedWarn>
      )}
      <CardMetaRow>
        <MetaItem>
          <MetaIcon><CalendarIcon size={13} /></MetaIcon>
          <DateRange>{fmtMd(startDateStr)} → {fmtMd(dueDateStr)}</DateRange>
          <DurEdit>(
            <DurInput type="number" min={1} max={90} value={dur}
              onChange={e => {
                const newDur = Math.max(1, Number(e.target.value) || 1);
                onChange({ due_offset_days: c.start_offset_days + newDur });
              }} />
            {t('ai.itemDays', '일')})
          </DurEdit>
        </MetaItem>
        <MetaItem>
          <MetaIcon><ClockIcon size={13} /></MetaIcon>
          <DurInput type="number" min={1} max={80} value={c.estimated_hours}
            onChange={e => onChange({ estimated_hours: Number(e.target.value) || 1 })} />
          <Unit>h</Unit>
        </MetaItem>
      </CardMetaRow>
    </Card>
  );
}

const Card = styled.div<{ $disabled: boolean }>`
  padding: 10px 12px;
  background: ${p => p.$disabled ? '#F8FAFC' : '#FFFFFF'};
  border: 1px solid ${p => p.$disabled ? '#E2E8F0' : '#CBD5E1'};
  border-radius: 8px;
  opacity: ${p => p.$disabled ? 0.6 : 1};
  display: flex; flex-direction: column; gap: 8px;
`;
const CardHeader = styled.div`display: flex; align-items: center; gap: 8px;`;
const Checkbox = styled.input`width: 16px; height: 16px; flex-shrink: 0; cursor: pointer;`;
const TitleInput = styled.input<{ $vague: boolean }>`
  flex: 1; min-width: 0;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  font-size: 14px; font-weight: 600; color: #0F172A;
  background: transparent;
  ${p => p.$vague && 'background: #FEF3C7; border-color: #FCD34D;'}
  &:focus { outline: none; border-color: #14B8A6; background: #FFFFFF; }
`;
const VagueBadge = styled.span`flex-shrink: 0; font-size: 14px; color: #B45309; cursor: help;`;
const UnmatchedWarn = styled.div`font-size: 12px; color: #B45309; background: #FFFBEB; border-radius: 6px; padding: 6px 10px; margin: 6px 0 0; line-height: 1.4;`;
const AssigneeInline = styled.div`
  flex-shrink: 0; min-width: 110px; max-width: 150px;
  margin-left: auto;
`;
const CardMetaRow = styled.div`
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding-left: 24px;
  font-size: 12px; color: #475569;
`;
const MetaItem = styled.div`display: inline-flex; align-items: center; gap: 4px;`;
const MetaIcon = styled.span`display: inline-flex; align-items: center; color: #94A3B8; flex-shrink: 0;`;
const DateRange = styled.span`color: #0F172A; font-weight: 600;`;
const DurEdit = styled.span`display: inline-flex; align-items: center; gap: 2px; color: #94A3B8; font-size: 11px;`;
const DurInput = styled.input`
  width: 38px; padding: 1px 3px;
  border: 1px solid #E2E8F0; border-radius: 4px;
  font-size: 11px; text-align: right;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const Unit = styled.span`color: #94A3B8; font-size: 11px;`;
