// 업무 템플릿 선택 + 적용 모달 (사이클 N+1 Phase 2)
// 디자인: /docs PostAiModal 패턴 1:1 동일.
//
// 흐름:
//   1) 템플릿 카드 리스트 (시스템 preset + 워크스페이스)
//   2) 카드 클릭 → 시작일(또는 시작일~끝날짜 기간 맞춤) + 담당자 매핑 입력 stage
//   3) [적용] 클릭 → POST /api/task-templates/:id/apply → task 일괄 생성
//   일정 계산은 서버 한 벌(dry_run) — 미리보기·적용·AI 시작점이 같은 날짜 (2026-10-29, docs/TASK_TEMPLATE_DETAIL_DESIGN.md)
import { useEffect, useState, useMemo } from 'react';
import styled from 'styled-components';
import { modalFooterRadius, phoneSheetFlow } from '../Common/modalShell';
import { useTranslation } from 'react-i18next';
import ModalActionButton from '../Common/ModalActionButton';
import PlanQSelect from '../Common/PlanQSelect';
import SingleDateField from '../Common/SingleDateField';
import SearchBox from '../Common/SearchBox';
import HighlightText from '../Common/HighlightText';
import MatchReason from '../Common/MatchReason';
import { pickMatch } from '../../utils/searchMatch';
import { apiFetch } from '../../contexts/AuthContext';
import { mapApiError } from '../../utils/apiError';
import type { AiSeed } from './AiTaskCreateModal';
import TemplateItemsPreview, { type TemplateGroup } from './TemplateItemsPreview';
import TemplateEditItems from './TemplateEditItems';
import { SegmentedToggle, SegmentedBtn } from '../Common/segmentedToggle';
import { addDaysStr } from '../../utils/timezones';
import { type TemplateItem, type ScheduleRow, normalizeOffsets } from './templateItem';

interface Member { user_id: number; name: string; }

interface Template {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  task_count: number;
  total_duration_days: number;
  is_system: boolean;
  is_default: boolean;
  usage_count: number;
  workstreams?: TemplateGroup[] | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
  projectId?: number | null;
  members: Member[];
  onApplied: (createdTasks: Array<{ id: number; title: string }>) => void;
  // AI 추천 "이 템플릿 쓰기" → 이 id 의 템플릿 상세(detail)로 바로 진입.
  initialTemplateId?: number | null;
  /** 요청을 적어 «AI 로 고쳐 넣기» — 부모가 이 모달을 닫고 AI 업무추가 모달을 템플릿 항목으로 연다.
   *  미제공이면 그 칸 자체를 숨긴다. 템플릿 원본은 바꾸지 않는다(이번에 넣을 업무만 고친다). */
  onRefineWithAi?: (seed: AiSeed) => void;
}

type Stage = 'list' | 'detail' | 'edit';

const CATEGORY_LABELS: Record<string, string> = {
  web_dev: '웹 개발',
  marketing: '마케팅',
  sales: '영업',
  ops: '운영',
  custom: '기타',
};

export default function TemplateSelectModal({ open, onClose, businessId, projectId, members, onApplied, initialTemplateId, onRefineWithAi }: Props) {
  const { t } = useTranslation('qtask');
  const { t: tErr } = useTranslation('errors');
  const [stage, setStage] = useState<Stage>('list');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Template | null>(null);
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().slice(0, 10));
  // 일정 넣는 방법 — 시작일만 / 시작일~끝날짜(기간 맞춤). 계산은 서버(dry_run) 한 벌.
  const [schedMode, setSchedMode] = useState<'start' | 'range'>('start');
  const [endDate, setEndDate] = useState<string>('');
  const [schedule, setSchedule] = useState<ScheduleRow[] | null>(null);
  const [spanDays, setSpanDays] = useState<number | null>(null);
  const [scheduleMissing, setScheduleMissing] = useState(false);
  const [schedError, setSchedError] = useState<string | null>(null);
  const [assigneeMap, setAssigneeMap] = useState<Record<string, number | null>>({});
  const [aiRequest, setAiRequest] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 편집 stage 용
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCategory, setEditCategory] = useState('custom');
  const [editItems, setEditItems] = useState<TemplateItem[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  // 편집 중 고를 수 있는 그룹 이름 — 이 템플릿에 이미 있는 이름(자유 입력도 된다)
  const editGroupNames = useMemo(() => Array.from(new Set(editItems.map(it => it.workstream_title?.trim()).filter(Boolean) as string[])), [editItems]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setStage('list');
    setSelected(null);
    setItems([]);
    setError(null);
    setSubmitting(false);
    setAiRequest('');
    setStartDate(new Date().toISOString().slice(0, 10));
    setAssigneeMap({});
    setLoading(true);
    apiFetch(`/api/task-templates?business_id=${businessId}`)
      .then(r => r.json())
      .then(j => {
        if (j.success) {
          const list: Template[] = j.data || [];
          setTemplates(list);
          // AI 추천 deep-link — 해당 템플릿 상세로 바로 진입
          if (initialTemplateId) {
            const hit = list.find(t => t.id === initialTemplateId);
            if (hit) openDetail(hit);
          }
        } else setError(j.message || 'failed');
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, businessId, initialTemplateId]);

  // 검색 필터 — 이름·설명·카테고리 모두 검색
  const filtered = useMemo(() => {
    if (!search.trim()) return templates;
    const q = search.toLowerCase();
    return templates.filter(t => {
      const hay = [t.name, t.description, t.category].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [templates, search]);

  // 카테고리별 그룹 (필터링 후)
  const grouped = useMemo(() => {
    const groups: Record<string, Template[]> = {};
    filtered.forEach(t => {
      const cat = t.category || 'custom';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    });
    return groups;
  }, [filtered]);

  // 워크스페이스에서 사용 중인 모든 카테고리 (자유 입력 자동완성)
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    templates.forEach(t => { if (t.category) set.add(t.category); });
    return Array.from(set).sort();
  }, [templates]);

  const openDetail = async (tpl: Template) => {
    setSelected(tpl);
    setAiRequest('');
    setStage('detail');
    setItems([]);
    setError(null);
    setSchedMode('start');
    setSchedule(null);
    setSchedError(null);
    setScheduleMissing(false);
    setLoading(true);
    try {
      const r = await apiFetch(`/api/task-templates/${tpl.id}`);
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      const list: TemplateItem[] = j.data?.items || [];
      setItems(list);
      setScheduleMissing(!!j.data?.schedule_missing);
      // 끝날짜 기본값 = 저장된 기간 그대로(시작일 + 총 기간)
      setEndDate(addDaysStr(startDate, Number(j.data?.total_duration_days) || 0));
      // 고유 role_hint 추출 → assigneeMap 초기화 (모두 null = fuzzy 자동)
      const roles = Array.from(new Set(list.map(i => i.role_hint).filter(Boolean))) as string[];
      const map: Record<string, number | null> = {};
      roles.forEach(r => { map[r] = null; });
      setAssigneeMap(map);
    } catch (e) {
      setError(mapApiError(e, tErr));
    } finally {
      setLoading(false);
    }
  };

  // 미리보기 일정 — 서버 dry_run 한 벌(적용·AI 시작점과 같은 계산). 날짜를 바꿀 때마다 다시 묻는다.
  useEffect(() => {
    if (!open || stage !== 'detail' || !selected || items.length === 0 || !startDate) return;
    const useRange = schedMode === 'range' && !!endDate && !scheduleMissing;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const r = await apiFetch(`/api/task-templates/${selected.id}/apply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ business_id: businessId, start_date: startDate, ...(useRange ? { end_date: endDate } : {}), dry_run: true }),
        });
        const j = await r.json();
        if (!alive) return;
        if (!j.success) { setSchedule(null); setSchedError(mapApiError(new Error(j.message || 'failed'), tErr)); return; }
        setSchedError(null);
        setSchedule(j.data.items || []);
        setSpanDays(typeof j.data.span_days === 'number' ? j.data.span_days : null);
      } catch (e) { if (alive) setSchedError(mapApiError(e, tErr)); }
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stage, selected, items, startDate, endDate, schedMode, scheduleMissing, businessId]);

  const openEdit = async (tpl: Template, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected(tpl);
    setEditName(tpl.name);
    setEditDesc(tpl.description || '');
    setEditCategory(tpl.category || 'custom');
    setStage('edit');
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/task-templates/${tpl.id}`);
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      const list: TemplateItem[] = j.data?.items || [];
      setEditItems(list);
    } catch (e) {
      setError(mapApiError(e, tErr));
    } finally {
      setLoading(false);
    }
  };

  const saveEdit = async () => {
    if (!selected || !editName.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // 메타 + items 동시 저장 (2단 호출)
      const r1 = await apiFetch(`/api/task-templates/${selected.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDesc.trim() || null,
          category: editCategory.trim() || null,
        }),
      });
      const j1 = await r1.json();
      if (!j1.success) throw new Error(j1.message || 'meta failed');

      const r2 = await apiFetch(`/api/task-templates/${selected.id}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 가장 이른 날을 첫날(0)로 맞춰 보낸다. 디테일 칸은 전부 그대로 — 안 보내면 저장할 때마다 지워진다.
          items: normalizeOffsets(editItems).map(it => ({
            title: it.title,
            description: it.description || null,
            body: it.body || null,
            start_offset_days: it.start_offset_days,
            duration_days: it.duration_days,
            estimated_hours: it.estimated_hours,
            role_hint: it.role_hint || null,
            priority: it.priority || null,
            workstream_title: it.workstream_title?.trim() || null,
            is_milestone: !!it.is_milestone,
            category: it.category || null,
            vlevel: it.vlevel || null,
            security_level: it.security_level || null,
            recurrence_rule: it.recurrence_rule || null,
            tag_names: it.tag_names || null,
            action_items: it.action_items || null,
            depends_on_indexes: it.depends_on_indexes || null,
          })),
        }),
      });
      const j2 = await r2.json();
      if (!j2.success) throw new Error(j2.message || 'items failed');

      // 목록 갱신
      const r3 = await apiFetch(`/api/task-templates?business_id=${businessId}`);
      const j3 = await r3.json();
      if (j3.success) setTemplates(j3.data || []);
      setStage('list');
    } catch (e) {
      setError(mapApiError(e, tErr));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async (tpl: Template, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const r = await apiFetch(`/api/task-templates/${tpl.id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      setTemplates(prev => prev.filter(x => x.id !== tpl.id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(mapApiError(err, tErr));
    }
  };

  const apply = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/task-templates/${selected.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          project_id: projectId || null,
          start_date: startDate,
          ...(schedMode === 'range' && endDate && !scheduleMissing ? { end_date: endDate } : {}),
          assignee_map: assigneeMap,
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      onApplied(j.data?.created || []);
      onClose();
    } catch (e) {
      setError(mapApiError(e, tErr));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const roleHints = Object.keys(assigneeMap);

  // 템플릿 항목 → AI 후보 모양(AiCandidateCard). 날짜는 미리보기와 같은 서버 계산(기간 맞춤 포함) — AI 를 눌러도 일정이 되돌아가지 않는다.
  //   디테일(본문·주요·분류·공개 범위·태그·액션·연결)도 실어 보낸다 — AI 는 바꿀 것만 고치고(서버 ai-refine), 확정이 그대로 저장한다.
  const refineWithAi = () => {
    if (!selected || !onRefineWithAi || items.length === 0 || !aiRequest.trim() || !schedule) return;
    onRefineWithAi({
      templateId: selected.id,
      templateName: selected.name,
      prompt: [selected.name, selected.description || ''].filter(Boolean).join('\n'),
      baseDate: startDate,
      instruction: aiRequest.trim(),
      roleAssignees: assigneeMap,
      candidates: items.map((it, i) => {
        const row = schedule.find(r => r.order_index === it.order_index);
        const start = row ? row.start_offset_days : it.start_offset_days;
        const dur = row ? row.duration_days : it.duration_days;
        return {
          idx: i,
          title: it.title,
          description: it.description || undefined,
          body: it.body || null,
          estimated_hours: it.estimated_hours ?? null,
          duration_days: dur ?? 0,
          start_offset_days: start,
          due_offset_days: start === null ? null : start + (dur ?? 0),
          priority: it.priority || 'normal',
          assignee_hint: it.role_hint || null,
          // 템플릿 그룹 — 확정 때 프로젝트에 없으면 만든다(서버 ai-create/confirm · source_template_id).
          workstream_hint: projectId ? (it.workstream_title || null) : null,
          assignee_user_id: it.role_hint ? (assigneeMap[it.role_hint] ?? null) : null,
          depends_on_index: null,
          depends_on_indexes: it.depends_on_indexes || null,
          is_milestone: !!it.is_milestone,
          category: it.category || null,
          vlevel: it.vlevel || null,
          security_level: it.security_level || null,
          recurrence_rule: it.recurrence_rule || null,
          tag_names: it.tag_names || null,
          action_items: it.action_items || null,
          vague: false,
          selected: true,
        };
      }),
    });
  };

  return (
    <Backdrop onClick={onClose}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('tpl.title', '템플릿으로 업무 추가') as string}>
        <Header>
          <Title>
            {(stage === 'detail' || stage === 'edit') && (
              <BackBtn type="button" onClick={() => setStage('list')} aria-label="back">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
              </BackBtn>
            )}
            {stage === 'list' ? t('tpl.title', '템플릿으로 업무 추가') : stage === 'edit' ? t('tpl.editTitle', '템플릿 수정') : selected?.name}
          </Title>
          <CloseBtn type="button" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </CloseBtn>
        </Header>

        <Body>
          {stage === 'list' && (
            <>
              <ListToolbar>
                <SearchBox
                  value={search}
                  onChange={setSearch}
                  placeholder={t('tpl.searchPh', '템플릿 검색 (이름·설명·카테고리)') as string}
                  width="100%"
                  size="md"
                />
                <ResultCount>
                  {search.trim()
                    ? t('tpl.searchResult', '검색 결과 {{n}}개', { n: filtered.length, defaultValue: `검색 결과 ${filtered.length}개` })
                    : t('tpl.totalCount', '총 {{n}}개', { n: templates.length, defaultValue: `총 ${templates.length}개` })}
                </ResultCount>
              </ListToolbar>
              {loading && <Loading>{t('tpl.loading', '템플릿 불러오는 중...')}</Loading>}
              {!loading && Object.keys(grouped).length === 0 && (
                <Empty>{search.trim() ? t('tpl.searchEmpty', '검색 결과가 없습니다.') : t('tpl.empty', '사용 가능한 템플릿이 없습니다.')}</Empty>
              )}
              {Object.entries(grouped).map(([cat, list]) => (
                <CategorySection key={cat}>
                  <CategoryTitle>
                    {t(`tpl.cat.${cat}`, CATEGORY_LABELS[cat] || cat)}
                    <CategoryCount>{list.length}</CategoryCount>
                  </CategoryTitle>
                  <Grid>
                    {list.map(tpl => {
                      // 필터는 이름·설명·분류(코드값)를 본다. 분류에서만 맞았으면 카드에 그 이유를 한 줄로 적는다
                      //   — 분류 이름은 위 섹션 제목에 이미 보이므로 스니펫은 붙이지 않는다.
                      const hit = search.trim() ? pickMatch([
                        { field: 'name', text: tpl.name, shown: true },
                        { field: 'description', text: tpl.description, shown: true },
                        { field: 'category', text: tpl.category },
                      ], search) : null;
                      return (
                      <CardWrap key={tpl.id}>
                        <Card type="button" onClick={() => openDetail(tpl)}>
                          <CardName><HighlightText text={tpl.name} query={search} /></CardName>
                          {tpl.description && <CardDesc><HighlightText text={tpl.description} query={search} /></CardDesc>}
                          {hit && !hit.shown && <MatchReason field={hit.field} query={search} />}
                          <CardMeta>
                            <span>{t('tpl.itemCount', '{{n}} 항목', { n: tpl.task_count, defaultValue: `${tpl.task_count} 항목` })}</span>
                            {tpl.total_duration_days > 0 && <span>·</span>}
                            {tpl.total_duration_days > 0 && <span>{t('tpl.duration', '{{n}}일', { n: tpl.total_duration_days, defaultValue: `${tpl.total_duration_days}일` })}</span>}
                            {tpl.is_system && <SystemBadge>{t('tpl.systemBadge', '기본')}</SystemBadge>}
                          </CardMeta>
                        </Card>
                        {!tpl.is_system && (
                          <CardActions>
                            <CardActionBtn type="button" onClick={(e) => openEdit(tpl, e)} title={t('tpl.edit', '수정') as string}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </CardActionBtn>
                            <CardActionBtn type="button" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(tpl.id); }} title={t('tpl.delete', '삭제') as string}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                            </CardActionBtn>
                          </CardActions>
                        )}
                        {confirmDeleteId === tpl.id && (
                          <ConfirmRow>
                            <span>{t('tpl.confirmDelete', '정말 삭제할까요?')}</span>
                            <SmallBtn type="button" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}>{t('tpl.cancel', '취소')}</SmallBtn>
                            <SmallBtn $danger type="button" onClick={(e) => confirmDelete(tpl, e)}>{t('tpl.delete', '삭제')}</SmallBtn>
                          </ConfirmRow>
                        )}
                      </CardWrap>
                      );
                    })}
                  </Grid>
                </CategorySection>
              ))}
              {error && <ErrorMsg>{error}</ErrorMsg>}
            </>
          )}

          {stage === 'edit' && selected && (
            <>
              <FieldRow>
                <FieldLabel>{t('tpl.editName', '템플릿 이름')} *</FieldLabel>
                <EditInput type="text" value={editName} onChange={e => setEditName(e.target.value)} maxLength={200} />
              </FieldRow>
              <FieldRow>
                <FieldLabel>{t('tpl.editDesc', '설명 (선택)')}</FieldLabel>
                <EditTextarea rows={3} value={editDesc} onChange={e => setEditDesc(e.target.value)} />
              </FieldRow>
              <FieldRow>
                <FieldLabel>{t('tpl.editCategory', '카테고리')}</FieldLabel>
                <EditInput
                  type="text"
                  list="tpl-category-list"
                  value={editCategory}
                  onChange={e => setEditCategory(e.target.value)}
                  placeholder={t('tpl.categoryPh', '카테고리 (자유 입력 — 예: 웹 개발, 마케팅, 교육 사업)') as string}
                  maxLength={50}
                />
                <datalist id="tpl-category-list">
                  {allCategories.map(c => <option key={c} value={c} />)}
                </datalist>
                <Hint>{t('tpl.categoryHint', '같은 카테고리끼리 자동으로 그룹됩니다. 새 카테고리를 입력하면 새 그룹이 만들어져요.')}</Hint>
              </FieldRow>

              <TemplateEditItems items={editItems} onChange={setEditItems} groupNames={editGroupNames} loading={loading} />
              {error && <ErrorMsg>{error}</ErrorMsg>}
            </>
          )}
          {stage === 'detail' && selected && (
            <>
              {selected.description && <Desc>{selected.description}</Desc>}
              {scheduleMissing && <WarnMsg data-testid="tpl-schedule-missing">{t('tpl.scheduleMissing', '이 템플릿에는 일정 정보가 없어요(예전에 저장된 템플릿). 지금 넣으면 모든 업무가 시작일 하루에 들어가요 — [수정]에서 날짜를 넣거나 프로젝트에서 다시 저장해 주세요.')}</WarnMsg>}
              <FieldRow>
                <FieldLabel>{t('tpl.modeLabel', '일정 넣는 방법')}</FieldLabel>
                <SegmentedToggle role="tablist" data-testid="tpl-sched-mode">
                  <SegmentedBtn type="button" $active={schedMode === 'start'} onClick={() => setSchedMode('start')}>{t('tpl.modeStart', '시작일만')}</SegmentedBtn>
                  <SegmentedBtn type="button" $active={schedMode === 'range'} disabled={scheduleMissing}
                    title={scheduleMissing ? t('tpl.rangeDisabled', '일정 정보가 없는 템플릿이라 기간 맞춤을 쓸 수 없어요.') as string : undefined}
                    onClick={() => setSchedMode('range')}>{t('tpl.modeRange', '시작일~끝날짜 (기간 맞춤)')}</SegmentedBtn>
                </SegmentedToggle>
                <DateRow>
                  <DateCol>
                    <FieldLabel>{t('tpl.startDate', '시작일')} *</FieldLabel>
                    <SingleDateField value={startDate} onChange={(d) => setStartDate(d || new Date().toISOString().slice(0, 10))} size="sm" />
                  </DateCol>
                  {schedMode === 'range' && !scheduleMissing && (
                    <DateCol data-testid="tpl-end-date">
                      <FieldLabel>{t('tpl.endDate', '끝날짜')} *</FieldLabel>
                      <SingleDateField value={endDate} minDate={startDate} onChange={(d) => setEndDate(d || startDate)} size="sm" />
                    </DateCol>
                  )}
                </DateRow>
                <Hint>
                  {schedMode === 'range' && !scheduleMissing
                    ? t('tpl.rangeHint', '전체 일정을 이 기간에 맞게 늘이거나 줄여요. 업무 순서·간격 비율은 그대로이고 하루짜리는 하루짜리로 남아요.')
                    : t('tpl.startOnlyHint', '템플릿에 저장된 간격 그대로, 시작일부터 들어가요.')}
                  {spanDays !== null && !scheduleMissing ? ` · ${t('tpl.spanInfo', '전체 {{n}}일', { n: spanDays })}` : ''}
                </Hint>
                {schedError && <ErrorMsg>{schedError}</ErrorMsg>}
              </FieldRow>
              {roleHints.length > 0 && (
                <FieldRow>
                  <FieldLabel>{t('tpl.assignees', '담당자 매핑 (선택)')}</FieldLabel>
                  <Hint>{t('tpl.assigneesHint', '비워두면 워크스페이스 멤버 직무 정보로 자동 매칭됩니다.')}</Hint>
                  <RoleGrid>
                    {roleHints.map(role => (
                      <RoleRow key={role}>
                        <RoleTag>{role}</RoleTag>
                        <PlanQSelect
                          size="sm"
                          isClearable
                          placeholder={t('tpl.roleAutoMatch', '자동 매칭') as string}
                          value={assigneeMap[role]
                            ? { value: String(assigneeMap[role]), label: members.find(m => m.user_id === assigneeMap[role])?.name || `#${assigneeMap[role]}` }
                            : null}
                          onChange={(v) => {
                            const val = (v as { value?: string })?.value;
                            setAssigneeMap(prev => ({ ...prev, [role]: val ? Number(val) : null }));
                          }}
                          options={members.map(m => ({ value: String(m.user_id), label: m.name || `#${m.user_id}` }))}
                        />
                      </RoleRow>
                    ))}
                  </RoleGrid>
                </FieldRow>
              )}
              {onRefineWithAi && (
                <FieldRow data-testid="tpl-ai-refine">
                  <FieldLabel htmlFor="tpl-ai-request">{t('tpl.aiRefineLabel', 'AI 에게 요청해서 고쳐 넣기 (선택)')}</FieldLabel>
                  {/* draft-exempt: 한두 줄 지시 — 보내면 AI 미리보기로 넘어가 거기 누적된다(AiRegenerateBar 입력과 같은 성격) */}
                  <AiRequestInput id="tpl-ai-request" rows={2} value={aiRequest}
                    onChange={(e) => setAiRequest(e.target.value)}
                    placeholder={t('tpl.aiRefinePh', '예) 디자인 검수 단계를 하나 추가하고, 개발 기간을 2일씩 늘려줘') as string} />
                  <AiRefineRow>
                    <Hint>{t('tpl.aiRefineHint', '이번에 넣을 업무만 고쳐요. 템플릿 원본은 그대로예요.')}</Hint>
                    <ModalActionButton variant="ai" onClick={refineWithAi} disabled={!aiRequest.trim() || items.length === 0 || loading || !schedule}>
                      {t('tpl.aiRefineGo', 'AI 로 고쳐서 미리보기')}
                    </ModalActionButton>
                  </AiRefineRow>
                </FieldRow>
              )}
              <TemplateItemsPreview items={items} groups={selected.workstreams || []} startDate={startDate} rows={schedule} />
              {error && <ErrorMsg>{error}</ErrorMsg>}
            </>
          )}
        </Body>

        <Footer>
          {stage === 'list' && (
            <ModalActionButton variant="secondary" onClick={onClose}>{t('tpl.cancel', '취소')}</ModalActionButton>
          )}
          {stage === 'edit' && (
            <>
              <ModalActionButton variant="secondary" onClick={() => setStage('list')}>{t('tpl.back', '뒤로')}</ModalActionButton>
              <ModalActionButton variant="primary" onClick={saveEdit} disabled={!editName.trim() || submitting}>
                {submitting ? t('tpl.saving', '저장 중...') : t('tpl.saveEdit', '저장')}
              </ModalActionButton>
            </>
          )}
          {stage === 'detail' && (
            <>
              <ModalActionButton variant="secondary" onClick={() => setStage('list')}>{t('tpl.back', '뒤로')}</ModalActionButton>
              <ModalActionButton variant="secondary" onClick={onClose}>{t('tpl.cancel', '취소')}</ModalActionButton>
              <ModalActionButton variant="primary" onClick={apply} disabled={!selected || items.length === 0 || submitting || !startDate || !!schedError}>
                {submitting
                  ? t('tpl.applying', '적용 중...')
                  : t('tpl.applyN', '{{n}}개 추가', { n: items.length, defaultValue: `${items.length}개 추가` })}
              </ModalActionButton>
            </>
          )}
        </Footer>
      </Dialog>
    </Backdrop>
  );
}

// ─── styled — /docs PostAiModal 패턴 1:1 동일 ───
const Backdrop = styled.div`
  position: fixed; inset: var(--pq-popup-top, 0px) 0 0; background: rgba(15,23,42,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 20px;
  @media (max-width: 640px) { padding: 0; align-items: stretch; }
`;
const Dialog = styled.div`
  background: #fff; border-radius: 14px;
  width: 100%; max-width: 720px; max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  @media (max-width: 640px) {
    max-width: none; max-height: none; border-radius: 0;
    height: calc(100vh - var(--pq-popup-top, 0px)); height: calc(var(--vvh, 100dvh) - var(--pq-popup-top, 0px));
    /* 폰 전면 — 버튼 줄을 화면에 고정하지 않는다(modalShell phoneSheetFlow, 2026-10-22). */
    ${() => phoneSheetFlow(Header, Body)}
  }
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px 14px; border-bottom: 1px solid #F1F5F9;
  flex-shrink: 0;
`;
const Title = styled.h2`
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 1rem; font-weight: 700; color: #0F172A; margin: 0;
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
`;
const BackBtn = styled.button`
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px;
  color: #64748B; cursor: pointer; flex-shrink: 0;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const CloseBtn = styled.button`
  /* touch-target-44: 폰 터치 타깃 (theme/tokens CONTROL.touchMin). 데스크탑 크기는 그대로. */
  @media (max-width: 640px) { min-width: 44px; min-height: 44px; }

  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px;
  color: #64748B; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`
  padding: 16px 22px 12px;
  flex: 1; overflow-y: auto;
  min-height: 0;
  display: flex; flex-direction: column; gap: 14px;
`;
const Footer = styled.div`
  display: flex; justify-content: flex-end; gap: 6px;
  padding: 12px 22px 18px;
  flex-shrink: 0;
  border-top: 1px solid #F1F5F9; background: #fff;
  /* 하단 라운드 — 배경이 껍데기 라운드를 덮지 않게. 규격은 Common/modalShell 하나다. */
  ${modalFooterRadius}
`;
const ListToolbar = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding-bottom: 4px;
`;
const ResultCount = styled.div`
  font-size: 0.6875rem; color: #94A3B8; white-space: nowrap;
`;
const CategoryCount = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 16px;
  padding: 0 6px;
  margin-left: 6px;
  background: #F0FDFA; color: #0F766E;
  border-radius: 8px;
  font-size: 0.625rem; font-weight: 700;
`;
const Loading = styled.div`padding: 40px 20px; text-align: center; color: #64748B; font-size: 0.8125rem;`;
const Empty = styled.div`padding: 40px 20px; text-align: center; color: #94A3B8; font-size: 0.8125rem;`;
const CategorySection = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const CategoryTitle = styled.h3`
  font-size: 0.75rem; font-weight: 700; color: #64748B; margin: 0;
  text-transform: uppercase; letter-spacing: 0.5px;
`;
const Grid = styled.div`
  display: grid; gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  align-items: stretch;
`;
const CardWrap = styled.div`
  position: relative;
  display: flex; flex-direction: column;
  height: 100%;
  &:hover .card-action-btn { opacity: 1; }
`;
const CardActions = styled.div`
  position: absolute; top: 8px; right: 8px;
  display: inline-flex; gap: 4px;
`;
const CardActionBtn = styled.button.attrs({ className: 'card-action-btn' })`
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 6px;
  color: #64748B; cursor: pointer; opacity: 0;
  transition: opacity 0.15s, color 0.15s, border-color 0.15s;
  &:hover { color: #0F766E; border-color: #14B8A6; }
`;
const ConfirmRow = styled.div`
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px; margin-top: 6px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px;
  font-size: 0.75rem; color: #B91C1C;
`;
const SmallBtn = styled.button<{ $danger?: boolean }>`
  padding: 4px 8px; font-size: 0.6875rem; font-weight: 600;
  border-radius: 4px; cursor: pointer;
  background: ${p => p.$danger ? '#DC2626' : '#FFFFFF'};
  color: ${p => p.$danger ? '#FFFFFF' : '#475569'};
  border: 1px solid ${p => p.$danger ? '#DC2626' : '#E2E8F0'};
  &:hover { opacity: 0.85; }
`;
const EditInput = styled.input`
  width: 100%; padding: 8px 10px; font-size: 0.8125rem; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFF;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const EditTextarea = styled.textarea`
  width: 100%; padding: 8px 10px; font-size: 0.8125rem; color: #0F172A; line-height: 1.5;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFF; font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const Card = styled.button`
  flex: 1;
  text-align: left; padding: 14px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px;
  cursor: pointer; font-family: inherit;
  display: flex; flex-direction: column; gap: 6px;
  min-height: 96px;
  transition: border-color 0.15s, background 0.15s;
  &:hover { border-color: #14B8A6; background: #F0FDFA; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.3); outline-offset: 2px; }
`;
const CardName = styled.div`
  font-size: 0.8125rem; font-weight: 700; color: #0F172A;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;
const CardDesc = styled.div`
  font-size: 0.75rem; color: #64748B; line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;
const CardMeta = styled.div`
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  font-size: 0.6875rem; color: #94A3B8;
  margin-top: auto;
  padding-top: 6px;
  border-top: 1px solid #F1F5F9;
`;
const SystemBadge = styled.span`
  margin-left: auto;
  background: #F0FDFA; color: #0F766E;
  font-size: 0.625rem; font-weight: 700;
  padding: 2px 6px; border-radius: 4px;
`;
const Desc = styled.div`
  padding: 10px 12px; background: #F8FAFC; color: #334155;
  border-radius: 6px; font-size: 0.75rem; line-height: 1.5;
`;
const FieldRow = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const FieldLabel = styled.label`font-size: 0.75rem; font-weight: 600; color: #0F172A;`;
const Hint = styled.div`font-size: 0.6875rem; color: #94A3B8;`;
const AiRequestInput = styled.textarea`
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 56px;
  padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  font: inherit; font-size: 0.8125rem; color: #0F172A; background: #FFF;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const AiRefineRow = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;`;
const RoleGrid = styled.div`display: grid; gap: 6px; grid-template-columns: 1fr;`;
const RoleRow = styled.div`display: grid; gap: 8px; grid-template-columns: 100px 1fr; align-items: center;`;
const RoleTag = styled.span`
  font-size: 0.75rem; font-weight: 600; color: #0F766E;
  background: #F0FDFA; border: 1px solid #CCFBF1;
  padding: 4px 8px; border-radius: 6px; text-align: center;
`;
const WarnMsg = styled.div`font-size: 0.75rem; color: #92400E; background: #FFFBEB; border: 1px solid #FDE68A; padding: 8px 10px; border-radius: 6px; line-height: 1.5;`;
const DateRow = styled.div`display: flex; gap: 12px; flex-wrap: wrap;`;
const DateCol = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const ErrorMsg = styled.div`font-size: 0.75rem; color: #DC2626; background: #FEF2F2; padding: 8px 10px; border-radius: 6px;`;
