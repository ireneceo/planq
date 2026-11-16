// AI 업무 후보 목록 — 요약 줄 + (프로젝트 일정이면) 단계별 묶음. AiTaskCreateModal 미리보기 전용.
// 2026-11-16 Irene «업무 하나가 너무 높고 … 더 심플하고 체계적인 프로페셔널한 업무 프로젝트 일정».
//   카드 자체는 AiCandidateCard(한 줄 행) 그대로 — 여기는 «어떻게 묶어 보이나» 만 정한다.
//   단계 = 사람이 고른 그룹(workstream_id) → AI 가 낸 단계 이름(workstream_hint) → «단계 없음» 순서로 읽는다
//   (확정 라우트가 배치하는 순서와 같다: 사람 > AI).
import { useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AiCandidateCard, { addDaysISO, fmtMd, type AiCandidate, type AiCardMember, type AiCardWorkstream } from './AiCandidateCard';

interface Props {
  candidates: AiCandidate[];
  members: AiCardMember[];
  baseDate: string;
  onChange: (idx: number, patch: Partial<AiCandidate>) => void;
  hasProject: boolean;
  workstreams: AiCardWorkstream[];
  onCreateGroup?: (title: string) => Promise<AiCardWorkstream | null>;
  /** 템플릿에서 시작한 목록 — «2번» 처럼 부를 번호를 붙인다 */
  numbered?: boolean;
  /** 단계별로 묶어 보인다(서버가 프로젝트 일정 모드로 처리했을 때) */
  grouped?: boolean;
  /** 단계 이름 중 아직 그룹이 아닌 것을 확정 때 그룹으로 만들지 */
  makeGroups?: boolean;
  onMakeGroupsChange?: (v: boolean) => void;
  /** 프로젝트 일정 모드가 최소 개수를 못 채웠다(서버 plan_shortfall) — 조용히 적게 보여주지 않는다 */
  planShortfall?: { expected: number; got: number } | null;
}

const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase();

/**
 * 확정 직전 — 선택된 후보의 단계 이름 중 아직 그룹이 아닌 것을 업무 그룹으로 만들고 그 id 를 후보에 싣는다.
 * 생성은 호출부가 준 create(= 기존 라우트 POST /projects/:id/workstreams)로만 — 소속·권한 검사를 물려받는다.
 * 못 만든 단계는 그대로 둔다(이름 힌트 → 서버 보수 매칭 → 미배치). 비교 규칙은 서버 matchWorkstream 과 같다(공백·대소문자 무시).
 */
export async function ensurePhaseGroups(
  selected: AiCandidate[], workstreams: AiCardWorkstream[], create: (title: string) => Promise<AiCardWorkstream | null>,
): Promise<AiCandidate[]> {
  const known = new Map(workstreams.map((w) => [norm(w.title), w.id]));
  const want: string[] = [];
  for (const c of selected) {
    if (c.workstream_id || !c.workstream_hint) continue;
    const k = norm(String(c.workstream_hint));
    if (!known.has(k) && !want.some((x) => norm(x) === k)) want.push(String(c.workstream_hint));
  }
  if (!want.length) return selected;
  for (const title of want) {   // 순서대로 — 그룹 순서가 일정 순서가 되게(병렬로 만들면 order_index 가 뒤섞인다)
    const made = await create(title);
    if (made) known.set(norm(title), made.id);
  }
  return selected.map((c) => (c.workstream_id || !c.workstream_hint
    ? c : { ...c, workstream_id: known.get(norm(String(c.workstream_hint))) ?? null }));
}

interface Section { key: string; title: string | null; isNew: boolean; items: Array<{ c: AiCandidate; n: number }>; }

export default function AiCandidateSections({
  candidates, members, baseDate, onChange, hasProject, workstreams, onCreateGroup,
  numbered = false, grouped = false, makeGroups = false, onMakeGroupsChange, planShortfall = null,
}: Props) {
  const { t } = useTranslation('qtask');

  const sections = useMemo<Section[]>(() => {
    const all = candidates.map((c, i) => ({ c, n: i + 1 }));
    if (!grouped) return [{ key: '_all', title: null, isNew: false, items: all }];
    const byKey = new Map<string, Section>();
    for (const it of all) {
      const picked = workstreams.find((w) => w.id === it.c.workstream_id);
      const name = picked?.title || (it.c.workstream_hint ? String(it.c.workstream_hint) : '');
      const key = name ? norm(name) : '_none';
      let s = byKey.get(key);
      if (!s) {
        const isNew = !!name && !picked && !workstreams.some((w) => norm(w.title) === key);
        s = { key, title: name || null, isNew, items: [] };
        byKey.set(key, s);
      }
      s.items.push(it);
    }
    // «단계 없음» 은 맨 뒤 — 나머지는 AI 가 낸 순서(= 일정 순서) 그대로
    const list = [...byKey.values()];
    return [...list.filter((s) => s.key !== '_none'), ...list.filter((s) => s.key === '_none')];
  }, [candidates, workstreams, grouped]);

  const selected = candidates.filter((c) => c.selected);
  const span = (items: AiCandidate[]) => {
    const dated = items.filter((c) => c.start_offset_days != null && c.due_offset_days != null);
    if (!dated.length) return '';
    const s = Math.min(...dated.map((c) => c.start_offset_days as number));
    const e = Math.max(...dated.map((c) => c.due_offset_days as number));
    return s === e ? fmtMd(addDaysISO(baseDate, s)) : `${fmtMd(addDaysISO(baseDate, s))} ~ ${fmtMd(addDaysISO(baseDate, e))}`;
  };
  const hours = (items: AiCandidate[]) => items.reduce((a, c) => a + (Number(c.estimated_hours) || 0), 0);
  const phaseCount = sections.filter((s) => s.title).length;
  const newGroupCount = sections.filter((s) => s.isNew && s.items.some((x) => x.c.selected)).length;

  const toggleSection = (s: Section, on: boolean) => { for (const { c } of s.items) if (c.selected !== on) onChange(c.idx, { selected: on }); };

  return (
    <Wrap>
      {planShortfall && (
        <ShortNote role="status">
          {t('ai.plan.shortfall', { expected: planShortfall.expected, got: planShortfall.got, defaultValue: '프로젝트 일정이 {{got}}개만 만들어졌어요(권장 {{expected}}개 이상) — [다시 만들기] 에 빠진 단계를 적어 주세요.' }) as string}
        </ShortNote>
      )}
      <SummaryRow data-testid="ai-plan-summary">
        <SummaryText>
          {t('ai.plan.summaryTasks', { n: selected.length, defaultValue: '업무 {{n}}개' })}
          {grouped && phaseCount > 0 && <> · {t('ai.plan.summaryPhases', { n: phaseCount, defaultValue: '단계 {{n}}개' })}</>}
          {span(selected) && <> · {span(selected)}</>}
          {hours(selected) > 0 && <> · {t('ai.plan.summaryHours', { n: hours(selected), defaultValue: '총 {{n}}시간' })}</>}
        </SummaryText>
        {grouped && hasProject && newGroupCount > 0 && onMakeGroupsChange && (
          <MakeGroups>
            <input type="checkbox" checked={makeGroups} onChange={(e) => onMakeGroupsChange(e.target.checked)} data-testid="ai-plan-make-groups" />
            {t('ai.plan.makeGroups', { n: newGroupCount, defaultValue: '단계 {{n}}개를 업무 그룹으로 만들기' })}
          </MakeGroups>
        )}
      </SummaryRow>
      {sections.map((s) => {
        const items = s.items.map((x) => x.c);
        const allOn = items.every((c) => c.selected);
        const someOn = items.some((c) => c.selected);
        return (
          <SectionBox key={s.key} data-testid={grouped ? 'ai-plan-section' : undefined}>
            {grouped && (
              <SectionHead>
                <input
                  type="checkbox"
                  checked={allOn}
                  ref={(el) => { if (el) el.indeterminate = someOn && !allOn; }}
                  onChange={(e) => toggleSection(s, e.target.checked)}
                  aria-label={t('ai.plan.selectPhase', { name: s.title || '', defaultValue: '{{name}} 전체 선택' }) as string}
                />
                <SectionTitle>{s.title || t('ai.plan.noPhase', '단계 없음')}</SectionTitle>
                {s.isNew && hasProject && <NewTag>{t('ai.plan.newGroup', '새 그룹')}</NewTag>}
                <SectionMeta>
                  {t('ai.plan.phaseCount', { n: items.length, defaultValue: '{{n}}개' })}
                  {span(items) && <> · {span(items)}</>}
                  {hours(items) > 0 && <> · {hours(items)}h</>}
                </SectionMeta>
              </SectionHead>
            )}
            <Rows>
              {s.items.map(({ c, n }) => (
                <AiCandidateCard
                  key={c.idx}
                  number={numbered ? n : undefined}
                  candidate={c}
                  members={members}
                  baseDate={baseDate}
                  onChange={(patch) => onChange(c.idx, patch)}
                  hasProject={hasProject}
                  workstreams={workstreams}
                  onCreateGroup={onCreateGroup}
                />
              ))}
            </Rows>
          </SectionBox>
        );
      })}
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const ShortNote = styled.div`font-size: 0.75rem; color: #B45309; background: #FFFBEB; padding: 8px 10px; border-radius: 6px;`;
const SummaryRow = styled.div`
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 8px 10px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
`;
const SummaryText = styled.div`font-size: 0.8125rem; font-weight: 600; color: #0F172A; font-variant-numeric: tabular-nums;`;
const MakeGroups = styled.label`
  margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
  font-size: 0.75rem; color: #475569; cursor: pointer;
  input { margin: 0; accent-color: #0F766E; cursor: pointer; }
`;
const SectionBox = styled.section`display: flex; flex-direction: column; gap: 4px;`;
const SectionHead = styled.div`
  display: flex; align-items: center; gap: 8px; padding: 2px 10px 2px 10px;
  input { margin: 0; flex-shrink: 0; cursor: pointer; accent-color: #0F766E; transform: scale(1.15); }
`;
const SectionTitle = styled.span`font-size: 0.8125rem; font-weight: 700; color: #0F766E; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const NewTag = styled.span`
  flex-shrink: 0; font-size: 0.6875rem; font-weight: 600; color: #0F766E; background: #F0FDFA;
  border: 1px solid #99F6E4; border-radius: 4px; padding: 0 5px;
`;
const SectionMeta = styled.span`margin-left: auto; flex-shrink: 0; font-size: 0.75rem; color: #64748B; font-variant-numeric: tabular-nums;`;
const Rows = styled.div`display: flex; flex-direction: column; gap: 4px;`;
