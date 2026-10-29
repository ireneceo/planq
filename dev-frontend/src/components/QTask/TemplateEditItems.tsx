// 업무 템플릿 수정 — 항목 목록 (TemplateSelectModal 에서 떼어 냄, 2026-10-29 · docs/TASK_TEMPLATE_DETAIL_DESIGN.md §4)
//   Irene: «날짜가 죄다 그냥 똑같이 들어가면 어떻게 해? 수정도 하기 어렵게..»
//   D+숫자 입력 대신 «예시 시작일» 기준 실제 날짜(시작·마감)를 고른다 — 저장 때 «첫날부터 며칠째» 로 바뀐다.
//   여러 항목을 골라 한꺼번에 밀기 · 날짜 없음 · 설명·본문·주요·분류·중요도 편집. 태그·결과물 액션은 읽기 칩.
import { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import SingleDateField from '../Common/SingleDateField';
import RichEditor from '../Common/RichEditor';
import PlanQSelect from '../Common/PlanQSelect';
import { addDaysStr } from '../../utils/timezones';
import { type TemplateItem, hasDate, daysBetween } from './templateItem';

interface Props {
  items: TemplateItem[];
  onChange: (next: TemplateItem[] | ((prev: TemplateItem[]) => TemplateItem[])) => void;
  groupNames: string[];
  loading: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function TemplateEditItems({ items, onChange, groupNames, loading }: Props) {
  const { t } = useTranslation('qtask');
  const [sampleStart, setSampleStart] = useState<string>(today());
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [shiftDays, setShiftDays] = useState<string>('1');
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  const update = (idx: number, patch: Partial<TemplateItem>) =>
    onChange(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const remove = (idx: number) => {
    onChange(prev => prev.filter((_, i) => i !== idx));
    setPicked(new Set());
  };
  const move = (idx: number, dir: -1 | 1) => onChange(prev => {
    const next = [...prev];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return prev;
    [next[idx], next[target]] = [next[target], next[idx]];
    return next;
  });
  const add = () => onChange(prev => {
    const lastEnd = prev.filter(hasDate).reduce((m, it) => Math.max(m, (it.start_offset_days as number) + (it.duration_days ?? 0)), -1);
    return [...prev, {
      id: -Date.now(), order_index: prev.length, title: '',
      start_offset_days: lastEnd + 1, duration_days: 0, estimated_hours: null, role_hint: null,
    }];
  });

  // 날짜 ↔ 오프셋 — 예시 시작일을 첫날(D+0)로 본다.
  const startOf = (it: TemplateItem) => addDaysStr(sampleStart, it.start_offset_days as number);
  const dueOf = (it: TemplateItem) => addDaysStr(sampleStart, (it.start_offset_days as number) + (it.duration_days ?? 0));
  const setStart = (idx: number, it: TemplateItem, d: string) => {
    if (!d) return;
    // 시작을 옮기면 기간을 지킨다(마감도 같이 움직인다)
    update(idx, { start_offset_days: daysBetween(sampleStart, d), duration_days: it.duration_days ?? 0 });
  };
  const setDue = (idx: number, it: TemplateItem, d: string) => {
    if (!d) return;
    update(idx, { duration_days: Math.max(0, daysBetween(sampleStart, d) - (it.start_offset_days as number)) });
  };
  const toggleNoDate = (idx: number, it: TemplateItem) => update(idx, hasDate(it)
    ? { start_offset_days: null, duration_days: null }
    : { start_offset_days: 0, duration_days: 0 });

  const togglePick = (idx: number) => setPicked(prev => {
    const n = new Set(prev);
    if (n.has(idx)) n.delete(idx); else n.add(idx);
    return n;
  });
  const shift = () => {
    const by = Number(shiftDays);
    if (!Number.isInteger(by) || by === 0 || picked.size === 0) return;
    const bad = items.some((it, i) => picked.has(i) && hasDate(it) && (it.start_offset_days as number) + by < 0);
    if (bad) { setShiftError(t('tpl.shiftNegative', '첫날보다 앞으로는 당길 수 없어요.') as string); return; }
    setShiftError(null);
    onChange(prev => prev.map((it, i) => (picked.has(i) && hasDate(it) ? { ...it, start_offset_days: (it.start_offset_days as number) + by } : it)));
  };

  const priorityOptions = ['urgent', 'high', 'normal', 'low'].map(k => ({ value: k, label: t(`importance.${k}`) as string }));

  return (
    <Wrap>
      <SampleRow>
        <SampleLabel>{t('tpl.sampleStart', '예시 시작일')}</SampleLabel>
        <SingleDateField value={sampleStart} onChange={(d) => setSampleStart(d || today())} size="sm" />
      </SampleRow>
      <Hint>{t('tpl.sampleStartHint', '이 날을 첫날로 보고 날짜를 고르세요. 저장하면 «첫날부터 며칠째» 로 바뀌어, 적용할 때 고른 시작일에 맞춰 들어가요.')}</Hint>

      <ItemsHead>
        <HeadLabel>{t('tpl.itemsLabel', '일정 항목')} ({items.length})</HeadLabel>
        <SmallBtn type="button" onClick={add} data-testid="tpl-edit-add">+ {t('tpl.itemAdd', '항목 추가')}</SmallBtn>
      </ItemsHead>
      {picked.size > 0 && (
        <ShiftBar data-testid="tpl-edit-shift">
          <span>{t('tpl.shiftSelected', '선택한 {{n}}개를', { n: picked.size })}</span>
          <NumInput type="number" value={shiftDays} onChange={e => setShiftDays(e.target.value)} aria-label={t('tpl.shiftHint', '앞으로 당기려면 음수(예: -2)') as string} />
          <span>{t('tpl.shiftDays', '일')}</span>
          <SmallBtn type="button" onClick={shift}>{t('tpl.shiftApply', '밀기')}</SmallBtn>
          <ShiftHint>{shiftError || t('tpl.shiftHint', '앞으로 당기려면 음수(예: -2)')}</ShiftHint>
        </ShiftBar>
      )}
      {loading && <Muted>{t('tpl.loading', '템플릿 불러오는 중...')}</Muted>}
      <datalist id="tpl-group-list">
        {groupNames.map(g => <option key={g} value={g} />)}
      </datalist>
      <List>
        {items.map((it, idx) => {
          const dated = hasDate(it);
          const expanded = open.has(idx);
          return (
            <Row key={it.id ?? idx} data-testid="tpl-edit-item">
              <TopRow>
                <Pick type="checkbox" checked={picked.has(idx)} onChange={() => togglePick(idx)} aria-label={t('tpl.itemSelect', '선택') as string} />
                <Num>{idx + 1}</Num>
                <TitleInput value={it.title} onChange={e => update(idx, { title: e.target.value })}
                  placeholder={t('tpl.itemTitlePh', '결과물 명사로 끝나도록 (예: 시안 작성)') as string} />
                <IconBtn type="button" onClick={() => move(idx, -1)} disabled={idx === 0} title={t('tpl.itemUp', '위로') as string}>↑</IconBtn>
                <IconBtn type="button" onClick={() => move(idx, 1)} disabled={idx === items.length - 1} title={t('tpl.itemDown', '아래로') as string}>↓</IconBtn>
                <RemoveBtn type="button" onClick={() => remove(idx)} title={t('tpl.itemRemove', '삭제') as string}>✕</RemoveBtn>
              </TopRow>
              <MetaRow>
                {dated ? (
                  <>
                    <Field>
                      <Meta>{t('tpl.itemStart', '시작')}</Meta>
                      <SingleDateField value={startOf(it)} onChange={(d) => setStart(idx, it, d)} size="sm" />
                    </Field>
                    <Field>
                      <Meta>{t('tpl.itemDue', '마감')}</Meta>
                      <SingleDateField value={dueOf(it)} minDate={startOf(it)} onChange={(d) => setDue(idx, it, d)} size="sm" />
                    </Field>
                  </>
                ) : <NoDate>{t('tpl.itemNoDate', '날짜 없음')}</NoDate>}
                <CheckLabel>
                  <input type="checkbox" checked={!dated} onChange={() => toggleNoDate(idx, it)} />
                  {t('tpl.itemNoDate', '날짜 없음')}
                </CheckLabel>
                <CheckLabel>
                  <input type="checkbox" checked={!!it.is_milestone} onChange={e => update(idx, { is_milestone: e.target.checked })} />
                  {t('tpl.itemMilestone', '주요 업무')}
                </CheckLabel>
                <MoreBtn type="button" onClick={() => setOpen(prev => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; })}>
                  {expanded ? t('tpl.itemLess', '접기') : t('tpl.itemMore', '자세히')}
                  {it.body ? ` · ${t('tpl.hasBody', '본문')}` : ''}
                </MoreBtn>
              </MetaRow>
              <MetaRow>
                <Field>
                  <Meta>{t('tpl.itemEst', '예상')}</Meta>
                  <NumInput type="number" min={0} value={it.estimated_hours ?? ''}
                    onChange={e => update(idx, { estimated_hours: e.target.value ? Number(e.target.value) : null })} />
                  <Unit>h</Unit>
                </Field>
                <Field $flex>
                  <Meta>{t('tpl.itemRole', '역할')}</Meta>
                  <TextInput type="text" value={it.role_hint || ''} onChange={e => update(idx, { role_hint: e.target.value || null })}
                    placeholder={t('tpl.itemRolePh', '예: 디자이너') as string} />
                </Field>
                <Field $flex>
                  <Meta>{t('tpl.itemGroup', '추진과제')}</Meta>
                  {/* draft-exempt: 템플릿 편집 폼의 짧은 이름 칸 — [저장] 으로 항목 전체와 함께 보낸다 */}
                  <TextInput type="text" list="tpl-group-list" value={it.workstream_title || ''} maxLength={200}
                    onChange={e => update(idx, { workstream_title: e.target.value || null })} placeholder={t('tpl.itemGroupPh', '없음') as string} />
                </Field>
              </MetaRow>
              {(it.tag_names?.length || it.action_items?.length) ? (
                <MetaRow>
                  {(it.tag_names || []).map(n => <Chip key={n}>#{n}</Chip>)}
                  {it.action_items?.length ? <Chip>{t('tpl.actionsChip', '결과물 액션 {{n}}', { n: it.action_items.length })}</Chip> : null}
                </MetaRow>
              ) : null}
              {expanded && (
                <Detail>
                  <Field>
                    <Meta>{t('tpl.itemPriority', '중요도')}</Meta>
                    <PriorityBox>
                      <PlanQSelect size="sm" value={priorityOptions.find(o => o.value === (it.priority || 'normal')) || null}
                        onChange={(v) => update(idx, { priority: (v as { value?: string })?.value || 'normal' })} options={priorityOptions} />
                    </PriorityBox>
                    <Meta>{t('tpl.itemCategory', '분류')}</Meta>
                    <TextInput type="text" value={it.category || ''} maxLength={100} onChange={e => update(idx, { category: e.target.value || null })} />
                  </Field>
                  <Meta>{t('tpl.itemDesc', '설명')}</Meta>
                  {/* draft-exempt: 템플릿 편집 폼 — [저장] 으로 항목 전체와 함께 보낸다 */}
                  <Textarea rows={3} value={it.description || ''} onChange={e => update(idx, { description: e.target.value || null })} />
                  <Meta>{t('tpl.itemBody', '본문 (결과물·실행 지침)')}</Meta>
                  <RichEditor value={it.body || ''} onChange={(html: string) => update(idx, { body: html || null })} minHeight={120} />
                </Detail>
              )}
            </Row>
          );
        })}
        {items.length === 0 && !loading && <Muted>{t('tpl.itemsEmpty', '항목이 없습니다. [+ 항목 추가] 버튼으로 추가하세요.')}</Muted>}
      </List>
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const SampleRow = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const SampleLabel = styled.span`font-size: 0.75rem; font-weight: 600; color: #0F172A;`;
const HeadLabel = styled.span`font-size: 0.75rem; font-weight: 600; color: #0F172A;`;
const Hint = styled.div`font-size: 0.6875rem; color: #94A3B8;`;
const Muted = styled.div`padding: 16px; text-align: center; color: #94A3B8; font-size: 0.75rem;`;
const ItemsHead = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px;`;
const SmallBtn = styled.button`
  padding: 4px 8px; font-size: 0.6875rem; font-weight: 600;
  border-radius: 4px; cursor: pointer;
  background: #FFFFFF; color: #475569; border: 1px solid #E2E8F0;
  &:hover { opacity: 0.85; }
`;
const ShiftBar = styled.div`
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 6px 8px; background: #F0FDFA; border-radius: 6px;
  font-size: 0.75rem; color: #0F766E;
`;
const ShiftHint = styled.span`font-size: 0.6875rem; color: #64748B;`;
const List = styled.div`
  display: flex; flex-direction: column; gap: 6px;
  max-height: 420px; overflow-y: auto;
  padding: 4px; background: #F8FAFC; border-radius: 8px;
`;
const Row = styled.div`
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 6px;
`;
const TopRow = styled.div`display: flex; align-items: center; gap: 6px;`;
const Pick = styled.input`flex-shrink: 0; cursor: pointer;`;
const Num = styled.div`
  width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  background: #F0FDFA; color: #0F766E; border-radius: 4px; font-size: 0.6875rem; font-weight: 700; flex-shrink: 0;
`;
const TitleInput = styled.input`
  flex: 1; min-width: 0; padding: 5px 8px; font-size: 0.8125rem; font-weight: 600; color: #0F172A;
  border: 1px solid transparent; border-radius: 4px; background: transparent;
  &:focus { outline: none; border-color: #14B8A6; background: #FFFFFF; }
`;
const IconBtn = styled.button`
  width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 4px; color: #64748B; cursor: pointer; font-size: 0.6875rem;
  &:hover:not(:disabled) { color: #0F766E; border-color: #14B8A6; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;
const RemoveBtn = styled(IconBtn)`&:hover { color: #DC2626; border-color: #DC2626; }`;
const MetaRow = styled.div`display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-left: 50px;
  @media (max-width: 640px) { padding-left: 0; }
`;
const Field = styled.div<{ $flex?: boolean }>`
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  ${p => p.$flex && 'flex: 1; min-width: 120px;'}
`;
const Meta = styled.span`color: #64748B; font-size: 0.6875rem;`;
const Unit = styled.span`color: #94A3B8; font-size: 0.6875rem;`;
const NoDate = styled.span`font-size: 0.75rem; color: #94A3B8;`;
const CheckLabel = styled.label`display: inline-flex; align-items: center; gap: 4px; font-size: 0.6875rem; color: #475569; cursor: pointer;`;
const MoreBtn = styled.button`
  margin-left: auto; background: none; border: none; color: #0F766E; font-size: 0.6875rem; font-weight: 600; cursor: pointer; padding: 2px 4px;
`;
const NumInput = styled.input`
  width: 52px; padding: 2px 4px; border: 1px solid #E2E8F0; border-radius: 4px; font-size: 0.75rem; text-align: right;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const TextInput = styled.input`
  flex: 1; min-width: 0; padding: 3px 6px; border: 1px solid #E2E8F0; border-radius: 4px; font-size: 0.75rem;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const Chip = styled.span`
  display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px;
  background: #F1F5F9; color: #475569; font-size: 0.6875rem;
`;
const Detail = styled.div`display: flex; flex-direction: column; gap: 6px; padding-left: 50px;
  @media (max-width: 640px) { padding-left: 0; }
`;
const PriorityBox = styled.div`min-width: 120px;`;
const Textarea = styled.textarea`
  width: 100%; padding: 6px 8px; font-size: 0.75rem; color: #0F172A; line-height: 1.5;
  border: 1px solid #E2E8F0; border-radius: 6px; font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; }
`;
