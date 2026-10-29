// 템플릿 적용 미리보기 — 추진과제(그룹)별로 묶고, 고른 시작일로 실제 날짜를 보여 준다 (2026-10-27).
//   Irene «업무 템플릿 저장할 때 추진과제(그룹)은 저장이 안되는데? … 일정을 임의로 짜면 잘 들어가는지 봐줘».
//   날짜는 서버가 계산한 rows(/apply dry_run — 기간 맞춤 포함)를 그대로 쓴다(2026-10-29). rows 가 오기 전에만
//   같은 규칙(시작 = 기준일 + start_offset · 마감 = 시작 + 기간)으로 잠깐 그린다. 날짜 없는 업무는 «날짜 없음».
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { addDaysStr } from '../../utils/timezones';
import type { ScheduleRow } from './templateItem';

export interface TemplateGroup { title: string; color?: string | null; description?: string | null; }
interface PreviewItem {
  id: number;
  order_index: number;
  title: string;
  start_offset_days: number | null;
  duration_days: number | null;
  body?: string | null;
  is_milestone?: boolean;
  estimated_hours: number | null;
  role_hint: string | null;
  workstream_title?: string | null;
}

/** 기간 — 0 은 «시작일에 마감». 값이 없을 때만 1 (서버 templateApply.itemDuration 과 같은 규칙). */
export function itemDuration(it: { duration_days?: number | null }): number {
  const d = Number(it.duration_days);
  return Number.isInteger(d) && d >= 0 ? d : 1;
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

export default function TemplateItemsPreview({ items, groups, startDate, rows }: { items: PreviewItem[]; groups: TemplateGroup[]; startDate: string; rows?: ScheduleRow[] | null }) {
  const { t } = useTranslation('qtask');

  // 그룹 순서 = 템플릿에 저장된 순서, 거기 없는 이름은 항목 순서로 뒤에. 그룹 없는 업무는 맨 끝.
  const order: string[] = [];
  const label = new Map<string, string>();
  const add = (title?: string | null) => {
    const k = title ? norm(title) : '';
    if (!k || label.has(k)) return;
    label.set(k, title as string); order.push(k);
  };
  groups.forEach(g => add(g.title));
  items.forEach(it => add(it.workstream_title));
  const sections = [...order, ''].map(k => ({
    key: k,
    title: k ? label.get(k) as string : null,
    rows: items.filter(it => (it.workstream_title ? norm(it.workstream_title) : '') === k),
  })).filter(sec => sec.rows.length > 0);
  const hasGroups = sections.some(sec => sec.title);

  return (
    <Box data-testid="tpl-preview">
      <Title>{t('tpl.preview', '미리보기 ({{n}}개 업무)', { n: items.length, defaultValue: `미리보기 (${items.length}개 업무)` })}</Title>
      {sections.map(sec => (
        <Section key={sec.key || 'none'}>
          {hasGroups && (
            <GroupHead data-testid="tpl-preview-group">
              {sec.title || t('tpl.groupNone', '(그룹 없음)')}
              <GroupCount>{sec.rows.length}</GroupCount>
            </GroupHead>
          )}
          <List>
            {sec.rows.map(it => {
              const row = rows?.find(r => r.order_index === it.order_index);
              const undated = row ? row.start_date === null : (it.start_offset_days === null || it.start_offset_days === undefined);
              const off = it.start_offset_days || 0;
              const dur = itemDuration(it);
              const s = row ? row.start_date : (startDate ? addDaysStr(startDate, off) : null);
              const d = row ? row.due_date : (startDate ? addDaysStr(startDate, off + dur) : null);
              return (
                <Row key={it.id}>
                  <PrevTitle>
                    {/* 번호 = AI 에게 «2번» 이라고 말할 때의 번호(서버 ai-refine 과 같은 1부터) */}
                    <Num>{items.indexOf(it) + 1}</Num>
                    {it.title}
                    {it.is_milestone && <Badge>{t('tpl.milestone', '주요')}</Badge>}
                    {it.body && <Badge>{t('tpl.hasBody', '본문')}</Badge>}
                  </PrevTitle>
                  <RowMeta>
                    {undated ? t('tpl.noDate', '날짜 없음') : (s && d ? (s === d ? md(s) : `${md(s)} ~ ${md(d)}`) : `D+${off}~${off + dur}`)}
                    {it.estimated_hours ? ` · ${it.estimated_hours}h` : ''}
                    {it.role_hint ? ` · ${it.role_hint}` : ''}
                  </RowMeta>
                </Row>
              );
            })}
          </List>
        </Section>
      ))}
    </Box>
  );
}

const Box = styled.div`
  background: #F8FAFC; border-radius: 8px;
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 6px;
`;
const Title = styled.div`font-size: 0.75rem; font-weight: 700; color: #475569;`;
const Section = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const GroupHead = styled.div`
  display: flex; align-items: center; gap: 6px;
  margin-top: 4px; font-size: 0.6875rem; font-weight: 700; color: #0F766E;
`;
const GroupCount = styled.span`color: #94A3B8; font-weight: 600;`;
const List = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const Row = styled.div`
  display: flex; flex-direction: column; gap: 2px;
  padding: 6px 8px;
  background: #FFFFFF; border-radius: 6px;
`;
const PrevTitle = styled.div`font-size: 0.75rem; font-weight: 600; color: #0F172A; display: flex; align-items: center; gap: 4px; flex-wrap: wrap;`;
const Num = styled.span`font-size: 0.625rem; font-weight: 700; color: #0F766E; min-width: 14px;`;
const Badge = styled.span`font-size: 0.625rem; font-weight: 600; color: #0F766E; background: #F0FDFA; border-radius: 4px; padding: 0 5px;`;
const RowMeta = styled.div`font-size: 0.6875rem; color: #94A3B8;`;
