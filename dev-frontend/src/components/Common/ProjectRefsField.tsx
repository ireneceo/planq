// 문서·파일 상세의 «연결 프로젝트» — 소속 말고 다른 프로젝트에도 건다 (2026-10-27, docs/PROJECT_REFS_DESIGN.md · Fable GO-WITH-CHANGES)
//   Irene: «같은 문서가 여러 프로젝트에 연결되는 거면 어떻게 해? … 프로젝트 연결도 여러 개 연결해야 할 것 같아.»
//   ★ 소속(프로젝트 칸)은 그대로 하나 — 공개 범위의 기준이다. 연결은 보여 주는 자리만 늘린다.
//     L2(팀 비공개)·지정 멤버 문서를 걸면 «그 프로젝트 사람이라도 권한 없으면 안 보인다» 를 한 줄로 알린다(연결 = 공유 오해 방지).
//   ★ 나만 보기(L1)는 걸 수 없다(서버 400) — 칸을 끄고 이유를 보인다.
//   목록은 서버(GET /api/project-refs/:type/:id — 내가 볼 수 있는 프로젝트만)가 정본. 바꾼 뒤엔 다시 읽는다.
//   모양은 «업무 연결»(DocTaskLinkField)과 같다 — 고르는 칸이 먼저, 걸린 것은 오른쪽 한 줄(높이가 자라지 않게).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import AutoSaveField, { type AutoSaveHandle } from './AutoSaveField';
import PlanQSelect, { type PlanQSelectOption } from './PlanQSelect';
import { useAuth } from '../../contexts/AuthContext';
import { listProjects, type ApiProject } from '../../services/qtalk';
import { fetchEntityRefs, linkProjectRef, unlinkProjectRef, type ProjectRefChip, type ProjectRefEntity } from '../../services/projectRefs';
import { tabStore } from '../../stores/tabStore';

interface Props {
  entityType: ProjectRefEntity;
  entityId: number;
  businessId: number;
  homeProjectId: number | null;
  vlevel?: string | null;
  /** 보기 모드 — 칩만(고르는 칸·× 없음). 연결이 없으면 아무것도 그리지 않는다 */
  readOnly?: boolean;
}

type Op = { kind: 'add' | 'remove'; projectId: number };

const ProjectRefsField: React.FC<Props> = ({ entityType, entityId, businessId, homeProjectId, vlevel, readOnly }) => {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const [refs, setRefs] = useState<ProjectRefChip[]>([]);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const opsRef = useRef<Op[]>([]);
  const saveRef = useRef<AutoSaveHandle>(null);

  const reread = useCallback(async () => {
    setRefs(await fetchEntityRefs(entityType, entityId));
  }, [entityType, entityId]);
  useEffect(() => { void reread(); }, [reread]);
  useEffect(() => {
    if (readOnly) return;
    listProjects(businessId).then(setProjects).catch(() => setProjects([]));
  }, [businessId, readOnly]);

  // 걸 수 있는 곳 — 닫히지 않음 ∧ 내가 그 프로젝트 멤버(owner/admin 은 전부) ∧ 소속·이미 연결 아님. 서버도 같은 판정을 한다.
  const options: PlanQSelectOption[] = useMemo(() => {
    const admin = user?.business_role === 'owner' || user?.business_role === 'admin' || user?.platform_role === 'platform_admin';
    const linked = new Set(refs.map((r) => r.project_id));
    return projects
      .filter((p) => p.status !== 'closed' && p.id !== homeProjectId && !linked.has(p.id))
      .filter((p) => admin || (p.projectMembers || []).some((m) => Number(m.user_id) === Number(user?.id)))
      .map((p) => ({ value: p.id, label: p.name }));
  }, [projects, refs, homeProjectId, user]);

  const save = async () => {
    const ops = opsRef.current.splice(0);
    try {
      for (const op of ops) {
        if (op.kind === 'add') await linkProjectRef(op.projectId, entityType, entityId);
        else await unlinkProjectRef(op.projectId, entityType, entityId);
      }
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      await reread().catch(() => null);
    }
  };

  const pick = (opt: PlanQSelectOption | null) => {
    if (!opt) return;
    setError(null);
    const p = projects.find((x) => x.id === Number(opt.value));
    opsRef.current.push({ kind: 'add', projectId: Number(opt.value) });
    // 화면 먼저 — 저장이 끝나면 서버 목록으로 갈아끼운다
    setRefs((prev) => [...prev, { project_id: Number(opt.value), name: String(opt.label), color: p?.color || null, can_unlink: true }]);
  };
  const remove = (r: ProjectRefChip) => {
    setError(null);
    opsRef.current.push({ kind: 'remove', projectId: r.project_id });
    setRefs((prev) => prev.filter((x) => x.project_id !== r.project_id));
    saveRef.current?.triggerSave();
  };

  if (readOnly && refs.length === 0) return null;
  const isPrivate = vlevel === 'L1';
  const narrowScope = vlevel === 'L2';

  const chips = refs.map((r) => {
    const chip = (
      <Chip key={r.project_id} type="button" data-testid={`project-ref-chip-${r.project_id}`}
        title={t('projectRefs.chipTitle', { name: r.name }) as string}
        $joined={!readOnly && r.can_unlink}
        onClick={() => tabStore.openInNewTab(`/projects/p/${r.project_id}`)}>
        <Dot $c={r.color || '#94A3B8'} aria-hidden />
        <ChipText>{r.name}</ChipText>
      </Chip>
    );
    if (readOnly || !r.can_unlink) return chip;
    return (
      <ChipPair key={r.project_id}>
        {chip}
        <RemoveBtn type="button" data-testid={`project-ref-remove-${r.project_id}`}
          aria-label={t('projectRefs.remove', { name: r.name }) as string} title={t('projectRefs.remove', { name: r.name }) as string}
          onClick={() => remove(r)}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
        </RemoveBtn>
      </ChipPair>
    );
  });

  if (readOnly) {
    return <ReadWrap data-testid="project-refs-chips" aria-label={t('projectRefs.label') as string}><Label>{t('projectRefs.label')}</Label>{chips}</ReadWrap>;
  }

  return (
    <Wrap data-testid="project-refs-field">
      <PickerSlot title={isPrivate ? (t('projectRefs.privateHint') as string) : undefined}>
        <AutoSaveField key={`project-refs-${entityType}-${entityId}`} ref={saveRef} type="select" onSave={save}>
          <div data-testid="project-refs-picker">
            <PlanQSelect
              size="sm"
              isSearchable
              isDisabled={isPrivate}
              value={null}
              options={options}
              placeholder={(isPrivate ? t('projectRefs.privateShort') : t('projectRefs.placeholder')) as string}
              noOptionsMessage={() => t('projectRefs.empty') as string}
              onChange={(o) => pick(o as PlanQSelectOption | null)}
            />
          </div>
        </AutoSaveField>
      </PickerSlot>
      {refs.length > 0 && <Chips data-testid="project-refs-chips">{chips}</Chips>}
      {refs.length > 0 && narrowScope && (
        <Hint data-testid="project-refs-scope-hint" title={t('projectRefs.scopeHint') as string}>{t('projectRefs.scopeHintShort')}</Hint>
      )}
      {error && <Fail role="alert">{t(`projectRefs.err.${error}`, { defaultValue: t('projectRefs.err.default') as string })}</Fail>}
    </Wrap>
  );
};

export default ProjectRefsField;

const Wrap = styled.div`
  display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; min-width: 0;
  flex: 3 1 auto; max-width: 100%;
`;
const ReadWrap = styled.span`display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; min-width: 0;`;
const Label = styled.span`flex-shrink: 0; font-size: 0.75rem; color: #64748B;`;
// 칩 줄 — 첫 칩 + × 는 늘 보여야 한다(뗄 수 있는 문은 이 × 하나). 3폭 실측: 칩 줄이 96px 로 눌려 × 가 잘렸다.
//   칩 폭을 160 으로 묶고(폰 390 한 줄 = 고르는 칸 150 + 칩 160 + × 22 + 사이 = 338 < 358), 줄 자체는 자기 폭을 지킨다.
//   칩이 많으면 가로로 흘린다(높이가 자라지 않게). 남는 폭이 모자라면 안내 문구가 먼저 줄어든다.
const Chips = styled.div`
  display: flex; align-items: center; gap: 4px; flex-wrap: nowrap; min-width: min(186px, 100%); flex: 0 1 auto;  /* 186 = 칩 160 + × 22 + 사이 — 첫 칩과 × 는 눌리지 않는다 */
  overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; padding: 2px 0;
`;
const PickerSlot = styled.div`flex: 0 0 200px; min-width: 0; max-width: 200px;
  @media (max-width: 640px) { flex-basis: 150px; max-width: 150px; }
`;
const Chip = styled.button<{ $joined?: boolean }>`
  display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; max-width: 160px; padding: 2px 8px; line-height: 1.45;
  border-radius: 6px; border: 1px solid #E2E8F0; background: #F8FAFC; color: #334155;
  font-size: 0.75rem; font-weight: 500; cursor: pointer; font-family: inherit;
  ${(p) => p.$joined ? 'border-top-right-radius: 0; border-bottom-right-radius: 0; border-right: none;' : ''}
  &:hover { background: #F1F5F9; }
`;
const Dot = styled.span<{ $c: string }>`width: 8px; height: 8px; border-radius: 2px; background: ${(p) => p.$c}; flex-shrink: 0;`;
const ChipPair = styled.span`display: inline-flex; align-items: stretch; flex-shrink: 0; min-width: 0;`;
const RemoveBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center; width: 22px; padding: 0;
  border: 1px solid #E2E8F0; border-left: 1px solid #CBD5E1; border-radius: 0 6px 6px 0;
  background: #F8FAFC; color: #475569; cursor: pointer;
  &:hover { background: #FEE2E2; color: #B91C1C; border-color: #FECACA; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;
const ChipText = styled.span`overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;`;
const Hint = styled.span`flex: 0 100 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; color: #64748B;`;
const Fail = styled.span`flex: 0 0 auto; white-space: nowrap; font-size: 0.75rem; color: #B91C1C;`;
