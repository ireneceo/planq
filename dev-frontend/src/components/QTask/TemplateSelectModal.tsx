// 업무 템플릿 선택 + 적용 모달 (사이클 N+1 Phase 2)
// 디자인: /docs PostAiModal 패턴 1:1 동일.
//
// 흐름:
//   1) 템플릿 카드 리스트 (시스템 preset + 워크스페이스)
//   2) 카드 클릭 → 시작일 + 담당자 매핑 입력 stage
//   3) [적용] 클릭 → POST /api/task-templates/:id/apply → task 일괄 생성
import { useEffect, useState, useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ModalActionButton from '../Common/ModalActionButton';
import PlanQSelect from '../Common/PlanQSelect';
import SingleDateField from '../Common/SingleDateField';
import SearchBox from '../Common/SearchBox';
import { apiFetch } from '../../contexts/AuthContext';
import { mapApiError } from '../../utils/apiError';

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
}

interface TemplateItem {
  id: number;
  order_index: number;
  title: string;
  description?: string | null;
  start_offset_days: number;
  duration_days: number;
  estimated_hours: number | null;
  role_hint: string | null;
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
}

type Stage = 'list' | 'detail' | 'edit';

const CATEGORY_LABELS: Record<string, string> = {
  web_dev: '웹 개발',
  marketing: '마케팅',
  sales: '영업',
  ops: '운영',
  custom: '기타',
};

export default function TemplateSelectModal({ open, onClose, businessId, projectId, members, onApplied, initialTemplateId }: Props) {
  const { t } = useTranslation('qtask');
  const { t: tErr } = useTranslation('errors');
  const [stage, setStage] = useState<Stage>('list');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Template | null>(null);
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [assigneeMap, setAssigneeMap] = useState<Record<string, number | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 편집 stage 용
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCategory, setEditCategory] = useState('custom');
  const [editItems, setEditItems] = useState<TemplateItem[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setStage('list');
    setSelected(null);
    setItems([]);
    setError(null);
    setSubmitting(false);
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
    setStage('detail');
    setItems([]);
    setError(null);
    setLoading(true);
    try {
      const r = await apiFetch(`/api/task-templates/${tpl.id}`);
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      const list: TemplateItem[] = j.data?.items || [];
      setItems(list);
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
          items: editItems.map(it => ({
            title: it.title,
            description: it.description || null,
            start_offset_days: it.start_offset_days,
            duration_days: it.duration_days,
            estimated_hours: it.estimated_hours,
            role_hint: it.role_hint || null,
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

  // items 편집 헬퍼
  const updateItem = (idx: number, patch: Partial<TemplateItem>) => {
    setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  };
  const removeItem = (idx: number) => {
    setEditItems(prev => prev.filter((_, i) => i !== idx));
  };
  const moveItem = (idx: number, dir: -1 | 1) => {
    setEditItems(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };
  const addItem = () => {
    const lastEnd = editItems.length > 0
      ? Math.max(...editItems.map(it => it.start_offset_days + it.duration_days))
      : 0;
    setEditItems(prev => [...prev, {
      id: -Date.now(),
      order_index: prev.length,
      title: '',
      start_offset_days: lastEnd,
      duration_days: 1,
      estimated_hours: null,
      role_hint: null,
    }]);
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
                    {list.map(tpl => (
                      <CardWrap key={tpl.id}>
                        <Card type="button" onClick={() => openDetail(tpl)}>
                          <CardName>{tpl.name}</CardName>
                          {tpl.description && <CardDesc>{tpl.description}</CardDesc>}
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
                    ))}
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

              <FieldRow>
                <ItemsHead>
                  <FieldLabel>{t('tpl.itemsLabel', '일정 항목')} ({editItems.length})</FieldLabel>
                  <SmallBtn type="button" onClick={addItem}>+ {t('tpl.itemAdd', '항목 추가')}</SmallBtn>
                </ItemsHead>
                {loading && <Loading>{t('tpl.loading', '템플릿 불러오는 중...')}</Loading>}
                <ItemsList>
                  {editItems.map((it, idx) => (
                    <ItemRow key={it.id ?? idx}>
                      <ItemTopRow>
                        <ItemNum>{idx + 1}</ItemNum>
                        <ItemTitleInput
                          value={it.title}
                          onChange={e => updateItem(idx, { title: e.target.value })}
                          placeholder={t('tpl.itemTitlePh', '결과물 명사로 끝나도록 (예: 시안 작성)') as string}
                        />
                        <ItemMoveBtn type="button" onClick={() => moveItem(idx, -1)} disabled={idx === 0} title={t('tpl.itemUp', '위로') as string}>↑</ItemMoveBtn>
                        <ItemMoveBtn type="button" onClick={() => moveItem(idx, 1)} disabled={idx === editItems.length - 1} title={t('tpl.itemDown', '아래로') as string}>↓</ItemMoveBtn>
                        <ItemRemoveBtn type="button" onClick={() => removeItem(idx)} title={t('tpl.itemRemove', '삭제') as string}>✕</ItemRemoveBtn>
                      </ItemTopRow>
                      <ItemBotRow>
                        <ItemField>
                          <ItemMeta>{t('tpl.itemStart', '시작')}</ItemMeta>
                          <ItemNumInput type="number" min={0} value={it.start_offset_days}
                            onChange={e => updateItem(idx, { start_offset_days: Number(e.target.value) || 0 })} />
                          <ItemUnit>D+</ItemUnit>
                        </ItemField>
                        <ItemField>
                          <ItemMeta>{t('tpl.itemDur', '기간')}</ItemMeta>
                          <ItemNumInput type="number" min={1} value={it.duration_days}
                            onChange={e => updateItem(idx, { duration_days: Math.max(1, Number(e.target.value) || 1) })} />
                          <ItemUnit>{t('tpl.itemDays', '일')}</ItemUnit>
                        </ItemField>
                        <ItemField>
                          <ItemMeta>{t('tpl.itemEst', '예상')}</ItemMeta>
                          <ItemNumInput type="number" min={0} value={it.estimated_hours ?? ''}
                            onChange={e => updateItem(idx, { estimated_hours: e.target.value ? Number(e.target.value) : null })} />
                          <ItemUnit>h</ItemUnit>
                        </ItemField>
                        <ItemField $flex>
                          <ItemMeta>{t('tpl.itemRole', '역할')}</ItemMeta>
                          <ItemRoleInput
                            type="text"
                            value={it.role_hint || ''}
                            onChange={e => updateItem(idx, { role_hint: e.target.value || null })}
                            placeholder={t('tpl.itemRolePh', '예: 디자이너') as string}
                          />
                        </ItemField>
                      </ItemBotRow>
                    </ItemRow>
                  ))}
                  {editItems.length === 0 && !loading && (
                    <ItemsEmpty>{t('tpl.itemsEmpty', '항목이 없습니다. [+ 항목 추가] 버튼으로 추가하세요.')}</ItemsEmpty>
                  )}
                </ItemsList>
              </FieldRow>
              {error && <ErrorMsg>{error}</ErrorMsg>}
            </>
          )}
          {stage === 'detail' && selected && (
            <>
              {selected.description && <Desc>{selected.description}</Desc>}
              <FieldRow>
                <FieldLabel>{t('tpl.startDate', '시작일')} *</FieldLabel>
                <SingleDateField value={startDate} onChange={(d) => setStartDate(d || new Date().toISOString().slice(0, 10))} size="sm" />
                <Hint>{t('tpl.startHint', '시작일 기준으로 모든 업무의 일정이 계산됩니다.')}</Hint>
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
              <PreviewBox>
                <PreviewTitle>{t('tpl.preview', '미리보기 ({{n}}개 업무)', { n: items.length, defaultValue: `미리보기 (${items.length}개 업무)` })}</PreviewTitle>
                <PreviewList>
                  {items.map(it => (
                    <PreviewItem key={it.id}>
                      <PrevTitle>{it.title}</PrevTitle>
                      <PrevMeta>
                        D+{it.start_offset_days}~{it.start_offset_days + it.duration_days}
                        {it.estimated_hours ? ` · ${it.estimated_hours}h` : ''}
                        {it.role_hint ? ` · ${it.role_hint}` : ''}
                      </PrevMeta>
                    </PreviewItem>
                  ))}
                </PreviewList>
              </PreviewBox>
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
              <ModalActionButton variant="primary" onClick={apply} disabled={!selected || items.length === 0 || submitting || !startDate}>
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
  position: fixed; inset: 0; background: rgba(15,23,42,0.4);
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
    margin-top: 60px; height: calc(100vh - 60px); height: calc(var(--vvh, 100dvh) - 60px);
  }
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px 14px; border-bottom: 1px solid #F1F5F9;
  flex-shrink: 0;
`;
const Title = styled.h2`
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 16px; font-weight: 700; color: #0F172A; margin: 0;
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
`;
const ListToolbar = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding-bottom: 4px;
`;
const ResultCount = styled.div`
  font-size: 11px; color: #94A3B8; white-space: nowrap;
`;
const CategoryCount = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 16px;
  padding: 0 6px;
  margin-left: 6px;
  background: #F0FDFA; color: #0F766E;
  border-radius: 8px;
  font-size: 10px; font-weight: 700;
`;
const Loading = styled.div`padding: 40px 20px; text-align: center; color: #64748B; font-size: 13px;`;
const Empty = styled.div`padding: 40px 20px; text-align: center; color: #94A3B8; font-size: 13px;`;
const CategorySection = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const CategoryTitle = styled.h3`
  font-size: 12px; font-weight: 700; color: #64748B; margin: 0;
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
  font-size: 12px; color: #B91C1C;
`;
const SmallBtn = styled.button<{ $danger?: boolean }>`
  padding: 4px 8px; font-size: 11px; font-weight: 600;
  border-radius: 4px; cursor: pointer;
  background: ${p => p.$danger ? '#DC2626' : '#FFFFFF'};
  color: ${p => p.$danger ? '#FFFFFF' : '#475569'};
  border: 1px solid ${p => p.$danger ? '#DC2626' : '#E2E8F0'};
  &:hover { opacity: 0.85; }
`;
const ItemsHead = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
`;
const ItemsList = styled.div`
  display: flex; flex-direction: column; gap: 6px;
  max-height: 360px; overflow-y: auto;
  padding: 4px;
  background: #F8FAFC; border-radius: 8px;
`;
const ItemsEmpty = styled.div`
  padding: 20px; text-align: center; color: #94A3B8; font-size: 12px;
`;
const ItemRow = styled.div`
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 6px;
`;
const ItemTopRow = styled.div`
  display: flex; align-items: center; gap: 6px;
`;
const ItemNum = styled.div`
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #F0FDFA; color: #0F766E;
  border-radius: 4px;
  font-size: 11px; font-weight: 700;
  flex-shrink: 0;
`;
const ItemTitleInput = styled.input`
  flex: 1; min-width: 0;
  padding: 5px 8px; font-size: 13px; font-weight: 600; color: #0F172A;
  border: 1px solid transparent; border-radius: 4px;
  background: transparent;
  &:focus { outline: none; border-color: #14B8A6; background: #FFFFFF; }
`;
const ItemMoveBtn = styled.button`
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 4px;
  color: #64748B; cursor: pointer; font-size: 11px;
  &:hover:not(:disabled) { color: #0F766E; border-color: #14B8A6; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;
const ItemRemoveBtn = styled(ItemMoveBtn)`
  &:hover { color: #DC2626; border-color: #DC2626; }
`;
const ItemBotRow = styled.div`
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  padding-left: 28px;
`;
const ItemField = styled.div<{ $flex?: boolean }>`
  display: flex; align-items: center; gap: 4px;
  ${p => p.$flex && 'flex: 1; min-width: 120px;'}
`;
const ItemMeta = styled.span`color: #64748B; font-size: 11px;`;
const ItemUnit = styled.span`color: #94A3B8; font-size: 11px;`;
const ItemNumInput = styled.input`
  width: 44px; padding: 2px 4px;
  border: 1px solid #E2E8F0; border-radius: 4px;
  font-size: 12px; text-align: right;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const ItemRoleInput = styled.input`
  flex: 1; min-width: 0;
  padding: 3px 6px;
  border: 1px solid #E2E8F0; border-radius: 4px;
  font-size: 12px;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const EditInput = styled.input`
  width: 100%; padding: 8px 10px; font-size: 13px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFF;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const EditTextarea = styled.textarea`
  width: 100%; padding: 8px 10px; font-size: 13px; color: #0F172A; line-height: 1.5;
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
  font-size: 13px; font-weight: 700; color: #0F172A;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;
const CardDesc = styled.div`
  font-size: 12px; color: #64748B; line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;
const CardMeta = styled.div`
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  font-size: 11px; color: #94A3B8;
  margin-top: auto;
  padding-top: 6px;
  border-top: 1px solid #F1F5F9;
`;
const SystemBadge = styled.span`
  margin-left: auto;
  background: #F0FDFA; color: #0F766E;
  font-size: 10px; font-weight: 700;
  padding: 2px 6px; border-radius: 4px;
`;
const Desc = styled.div`
  padding: 10px 12px; background: #F8FAFC; color: #334155;
  border-radius: 6px; font-size: 12px; line-height: 1.5;
`;
const FieldRow = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const FieldLabel = styled.label`font-size: 12px; font-weight: 600; color: #0F172A;`;
const Hint = styled.div`font-size: 11px; color: #94A3B8;`;
const RoleGrid = styled.div`display: grid; gap: 6px; grid-template-columns: 1fr;`;
const RoleRow = styled.div`display: grid; gap: 8px; grid-template-columns: 100px 1fr; align-items: center;`;
const RoleTag = styled.span`
  font-size: 12px; font-weight: 600; color: #0F766E;
  background: #F0FDFA; border: 1px solid #CCFBF1;
  padding: 4px 8px; border-radius: 6px; text-align: center;
`;
const PreviewBox = styled.div`
  background: #F8FAFC; border-radius: 8px;
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 6px;
`;
const PreviewTitle = styled.div`font-size: 12px; font-weight: 700; color: #475569;`;
const PreviewList = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const PreviewItem = styled.div`
  display: flex; flex-direction: column; gap: 2px;
  padding: 6px 8px;
  background: #FFFFFF; border-radius: 6px;
`;
const PrevTitle = styled.div`font-size: 12px; font-weight: 600; color: #0F172A;`;
const PrevMeta = styled.div`font-size: 11px; color: #94A3B8;`;
const ErrorMsg = styled.div`font-size: 12px; color: #DC2626; background: #FEF2F2; padding: 8px 10px; border-radius: 6px;`;
