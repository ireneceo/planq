// AI 업무 후보 카드 — AiTaskCreateModal(분해 모달)과 CueTaskBar(말 걸기 바) 공유.
// 제목·마감·예상시간·담당자 인라인 편집 + 모호한 업무명(⚠) 경고. 단일 진실 원천(DRY).
import { useMemo } from 'react';
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
  /** 정기 루틴 — 'none' | 'daily' | 'weekly' | 'monthly'. 마감일이 첫 발생일이 된다. */
  recurrence?: string;
  /** #237 "완료로 추가" — 이미 끝난 일의 기록. 서버가 오늘 날짜로 넣고 반복은 끊는다(상호배타). */
  completed?: boolean;
  assignee_hint: string | null;
  assignee_name?: string | null; // #90 — LLM 이 추출한 이름 (매칭 실패 시 경고 표시용)
  /**
   * 운영 #263 — 서버가 **실제로 고른 멤버의 표시 이름**. assignee_name(LLM 추출 원문)과 다르다.
   *   화면의 멤버 목록은 맥락에 따라 좁다(프로젝트 화면 = 프로젝트 멤버만). 서버는 워크스페이스
   *   전체에서 고르므로, 그 차집합이 뽑히면 목록에서 id 로 이름을 못 찾아 `#2` 가 떴다.
   *   고른 쪽이 이름을 같이 보내 그 구멍을 없앤다.
   */
  assignee_display_name?: string | null;
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
  /** 프로젝트가 선택돼 있는가 — 담당자 미지정 시 서버가 프로젝트 기본담당자/PM 에게 배정한다.
   *  이 값에 따라 안내 문구가 달라져야 한다 (틀린 약속 금지). */
  hasProject?: boolean;
}

export default function AiCandidateCard({ candidate: c, members, baseDate, onChange, hasProject = false }: Props) {
  const { t } = useTranslation('qtask');
  // 정기 루틴 선택지 — raw <select> 금지 규칙에 따라 PlanQSelect 로 그린다 (health-check 항목).
  // 운영 #263 — 담당자 이름 해석의 단일 규칙.
  //   ① 이 화면 멤버 목록 → ② 서버가 고르며 실어 보낸 표시 이름 → ③ 사람 말 폴백.
  //   날 id(`#2`)는 어떤 경우에도 내보내지 않는다 — 사용자에게 숫자는 아무 뜻이 없다.
  const unknownLabel = t('ai.assigneeUnknown', '알 수 없는 담당자') as string;
  const assigneeLabel = (uid: number) =>
    members.find(m => m.user_id === uid)?.name || c.assignee_display_name || unknownLabel;
  // 서버가 고른 사람이 이 화면 목록 밖이면 옵션에도 넣는다(보이는 것 = 고를 수 있는 것).
  const assigneeOptions = useMemo(() => {
    const opts = members.map(m => ({ value: String(m.user_id), label: m.name || unknownLabel }));
    if (c.assignee_user_id && !members.some(m => m.user_id === c.assignee_user_id)) {
      opts.unshift({ value: String(c.assignee_user_id), label: c.assignee_display_name || unknownLabel });
    }
    return opts;
  }, [members, c.assignee_user_id, c.assignee_display_name, unknownLabel]);

  const recurOptions = useMemo(() => ([
    { value: 'none', label: t('ai.recurNone', '반복 없음') as string },
    { value: 'daily', label: t('ai.recurDaily', '매일') as string },
    { value: 'weekly', label: t('ai.recurWeekly', '매주') as string },
    { value: 'monthly', label: t('ai.recurMonthly', '매월') as string },
  ]), [t]);
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
            placeholder={hasProject
              ? t('ai.assigneeProjectDefault', '프로젝트 기본 담당자') as string
              : t('ai.assigneeUnassigned', '미배정') as string}
            /* 운영 #263 — "담당자로 내가 안나오고 이상한 1, 2 라고 표시되는데."
               목록에 없는 id 가 오면 여태 `#2` 같은 날 id 를 그렸다. 사용자에게 숫자는 아무 뜻이 없다.
               (근본 원인인 "후보 풀 ≠ 표시 목록" 은 routes/tasks.js 에서 기준을 맞춰 막았고,
                여기는 그래도 어긋났을 때의 마지막 방어선이다 — 숫자 대신 사람 말로.) */
            value={c.assignee_user_id
              ? { value: String(c.assignee_user_id), label: assigneeLabel(c.assignee_user_id) }
              : null}
            onChange={(v) => {
              const val = (v as { value?: string })?.value;
              onChange({ assignee_user_id: val ? Number(val) : null });
            }}
            /* ★ 값만 있고 옵션에 없으면 react-select 는 라벨은 그려도 **다시 고를 수가 없다**
               (드롭다운을 열면 그 사람이 목록에 없다). 서버가 고른 사람이 이 화면 목록 밖이면
               옵션에도 끼워 넣는다 — 보이는 것과 고를 수 있는 것을 같게. */
            options={assigneeOptions}
          />
        </AssigneeInline>
      </CardHeader>
      {!c.assignee_user_id && c.assignee_name && (
        <UnmatchedWarn>
          {hasProject
            ? t('ai.assigneeUnmatchedProject', '"{{name}}" 을(를) 멤버에서 찾지 못했어요 — 담당자를 직접 선택해 주세요. 그대로 확정하면 프로젝트 기본 담당자에게 배정됩니다.', { name: c.assignee_name }) as string
            : t('ai.assigneeUnmatched', '"{{name}}" 을(를) 멤버에서 찾지 못했어요 — 담당자를 직접 선택해 주세요. 그대로 확정하면 내 업무로 만들어집니다.', { name: c.assignee_name }) as string}
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
        {/* 정기 루틴 — AI 가 "매일/매주/매월" 을 잡아내면 여기서 확인·수정한다.
            여태 후보에 반복 개념이 없어서 "매일 …" 이라고 써도 일회성으로만 생성됐다.
            ★ 완료로 추가일 때는 감춘다 — 완료된 일에 다음 회차는 없고(서버가 null 로 끊는다),
              보이는 채로 두면 화면이 저장되지 않을 값을 약속하게 된다. */}
        {!c.completed && (
          <MetaItem>
            <RecurWrap>
              <PlanQSelect
                size="sm"
                value={recurOptions.find(o => o.value === (c.recurrence || 'none')) || recurOptions[0]}
                onChange={(v) => onChange({ recurrence: String((v as { value?: string })?.value || 'none') })}
                options={recurOptions}
                aria-label={t('ai.recurrenceLabel', '반복') as string}
              />
            </RecurWrap>
          </MetaItem>
        )}
        {/* #237 — "완료로 추가". AI 가 오해했으면 사람이 여기서 정정한다. */}
        <MetaItem as="label">
          <DoneCheck
            type="checkbox"
            checked={!!c.completed}
            onChange={e => onChange({ completed: e.target.checked })}
          />
          <DoneLbl>{t('ai.completedAdd', '완료로 추가')}</DoneLbl>
        </MetaItem>
      </CardMetaRow>
      {c.completed && (
        <DoneHint>{t('ai.completedHint', '이미 끝낸 일로 오늘 날짜에 기록됩니다 — 반복은 적용되지 않아요')}</DoneHint>
      )}
    </Card>
  );
}

const RecurWrap = styled.div`min-width: 104px;`;
const DoneCheck = styled.input`width: 15px; height: 15px; flex-shrink: 0; cursor: pointer; accent-color: #0F766E; margin: 0;`;
const DoneLbl = styled.span`font-size: 12px; color: #475569; cursor: pointer;`;
const DoneHint = styled.div`font-size: 11px; color: #64748B; padding: 0 2px;`;
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
