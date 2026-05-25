// VisibilityField — PlanQ 통합 visibility 입력 컴포넌트 (사이클 N+65)
//
// PlanQ Visibility 4단계 (VISIBILITY_VOCABULARY.md):
//   L1 = 개인 (나만 보기)
//   L2 = 팀 비공개 (특정 프로젝트 또는 특정 멤버)
//   L3 = 워크스페이스 전체
//   L4 = 외부 (특정 고객 + share_token)
//
// UI: 5 라디오 (L3 / L2-project / L2-members / L4 / L1) + sub-target picker
// 사용처: KnowledgePage 등록 + 상세, CalendarEvent, Post, TaskComment 등 모든 자산 통일.
import React from 'react';
import styled, { css } from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect, { type PlanQSelectOption } from './PlanQSelect';

export type VLevel = 'L1' | 'L2' | 'L3' | 'L4';

// L2 의 두 분기 — UI 레벨에서만 구분 (DB 는 vlevel + project_id / target_member_ids 로 표현)
export type VVariant = 'L1' | 'L2_project' | 'L2_members' | 'L3' | 'L4';

export interface VisibilityValue {
  vlevel: VLevel;
  variant: VVariant;
  project_id: number | null;
  client_ids: number[];
  target_member_ids: number[];
}

export interface VisibilityFieldProps {
  value: VisibilityValue;
  onChange: (next: VisibilityValue) => void;
  projects: Array<{ id: number; name: string }>;
  clients: Array<{ id: number; display_name?: string | null; biz_name?: string | null; company_name?: string | null }>;
  members: Array<{ user_id: number; name: string; role: string }>;
  // 일부 옵션 숨김 (예: 일정은 client 제외)
  hide?: Partial<Record<VVariant, boolean>>;
  // 라벨 override (자산별 hint 문구 다르게)
  labels?: Partial<Record<VVariant, { title?: string; hint?: string }>>;
  disabled?: boolean;
}

// value 직렬화 헬퍼 — backend payload 변환 (각 자산 라우트에 그대로 spread)
export function serializeVisibility(v: VisibilityValue) {
  return {
    vlevel: v.vlevel,
    project_id: v.variant === 'L2_project' ? v.project_id : null,
    client_id: v.variant === 'L4' ? (v.client_ids[0] || null) : null,
    client_ids: v.variant === 'L4' ? v.client_ids : [],
    target_member_ids: v.variant === 'L2_members' ? v.target_member_ids : [],
  };
}

// backend 응답 → VisibilityValue 변환
export function parseVisibility(d: {
  vlevel?: string | null; scope?: string | null; read_policy?: string | null;
  project_id?: number | null; client_id?: number | null;
  client_ids?: number[] | null; target_member_ids?: number[] | null;
}): VisibilityValue {
  const vl = (d.vlevel as VLevel) ||
    (d.scope === 'private' ? 'L1' :
     d.scope === 'project' ? 'L2' :
     d.scope === 'client' ? 'L4' :
     (d.scope === 'workspace' && d.read_policy === 'owner') ? 'L2' : 'L3');
  let variant: VVariant = vl as VVariant;
  if (vl === 'L2') {
    if (d.project_id) variant = 'L2_project';
    else variant = 'L2_members';
  }
  return {
    vlevel: vl,
    variant,
    project_id: d.project_id || null,
    client_ids: Array.isArray(d.client_ids) && d.client_ids.length > 0
      ? d.client_ids
      : (d.client_id ? [d.client_id] : []),
    target_member_ids: Array.isArray(d.target_member_ids) ? d.target_member_ids : [],
  };
}

// 변경 시 sub-target 자동 reset
function applyVariant(prev: VisibilityValue, variant: VVariant): VisibilityValue {
  const vlevel: VLevel = variant === 'L2_project' || variant === 'L2_members' ? 'L2' : (variant as VLevel);
  const next: VisibilityValue = { ...prev, vlevel, variant };
  if (variant !== 'L2_project') next.project_id = null;
  if (variant !== 'L2_members') next.target_member_ids = [];
  if (variant !== 'L4') next.client_ids = [];
  return next;
}

const VARIANT_ORDER: VVariant[] = ['L3', 'L2_project', 'L2_members', 'L4', 'L1'];

const VisibilityField: React.FC<VisibilityFieldProps> = ({
  value, onChange, projects, clients, members, hide = {}, labels = {}, disabled = false,
}) => {
  const { t } = useTranslation('common');
  const visibleVariants = VARIANT_ORDER.filter(v => !hide[v]);
  const defaultLabel = (variant: VVariant) => {
    switch (variant) {
      case 'L3': return { title: t('visibility.workspace', { defaultValue: '전체 워크스페이스' }) as string, hint: t('visibility.workspaceHint', { defaultValue: '오너·멤버 모두 볼 수 있어요' }) as string };
      case 'L2_project': return { title: t('visibility.project', { defaultValue: '특정 프로젝트' }) as string, hint: t('visibility.projectHint', { defaultValue: '그 프로젝트 멤버만 볼 수 있어요' }) as string };
      case 'L2_members': return { title: t('visibility.members', { defaultValue: '특정 멤버' }) as string, hint: t('visibility.membersHint', { defaultValue: '선택한 멤버만 볼 수 있어요 (단가표·내부 계정 등)' }) as string };
      case 'L4': return { title: t('visibility.client', { defaultValue: '특정 고객 (다중 가능)' }) as string, hint: t('visibility.clientHint', { defaultValue: '선택한 고객(들)과 우리 팀이 볼 수 있어요' }) as string };
      case 'L1': return { title: t('visibility.private', { defaultValue: '나만 보기' }) as string, hint: t('visibility.privateHint', { defaultValue: '본인만 볼 수 있어요 (개인 보관함)' }) as string };
    }
  };
  return (
    <Wrap>
      <Grid>
        {visibleVariants.map(variant => {
          const label = labels[variant]?.title || defaultLabel(variant).title;
          const hint = labels[variant]?.hint || defaultLabel(variant).hint;
          return (
            <Radio
              key={variant}
              type="button"
              $active={value.variant === variant}
              disabled={disabled}
              onClick={() => onChange(applyVariant(value, variant))}
              role="radio"
              aria-checked={value.variant === variant}
            >
              <RadioTitle>{label}</RadioTitle>
              <RadioHint>{hint}</RadioHint>
            </Radio>
          );
        })}
      </Grid>
      {value.variant === 'L2_project' && (
        <SubField>
          <SubLabel>{t('visibility.projectPick', { defaultValue: '프로젝트 선택' }) as string}</SubLabel>
          <PlanQSelect
            size="sm"
            isSearchable
            menuPlacement="auto"
            placeholder={t('visibility.projectPh', { defaultValue: '프로젝트를 선택하세요' }) as string}
            isDisabled={disabled}
            value={value.project_id
              ? { value: String(value.project_id), label: projects.find(p => p.id === value.project_id)?.name || `#${value.project_id}` }
              : null}
            onChange={(opt) => onChange({ ...value, project_id: (opt as PlanQSelectOption | null)?.value ? Number((opt as PlanQSelectOption).value) : null })}
            options={projects.map(p => ({ value: String(p.id), label: p.name }))}
          />
        </SubField>
      )}
      {value.variant === 'L2_members' && (
        <SubField>
          <SubLabel>{t('visibility.memberPick', { defaultValue: '멤버 선택' }) as string}</SubLabel>
          <PlanQSelect
            size="sm" isSearchable isMulti
            menuPlacement="auto"
            placeholder={t('visibility.memberPh', { defaultValue: '멤버 선택' }) as string}
            isDisabled={disabled}
            value={value.target_member_ids.map(id => {
              const m = members.find(x => x.user_id === id);
              return { value: String(id), label: m ? `${m.name} (${m.role})` : `User #${id}` };
            })}
            onChange={(opts) => {
              const ids: number[] = [];
              if (Array.isArray(opts)) for (const o of opts) {
                const n = Number((o as PlanQSelectOption).value);
                if (n) ids.push(n);
              }
              onChange({ ...value, target_member_ids: ids });
            }}
            options={members.map(m => ({ value: String(m.user_id), label: `${m.name} (${m.role})` }))}
          />
        </SubField>
      )}
      {value.variant === 'L4' && (
        <SubField>
          <SubLabel>{t('visibility.clientPick', { defaultValue: '고객 선택' }) as string}</SubLabel>
          <PlanQSelect
            size="sm" isSearchable isMulti
            menuPlacement="auto"
            placeholder={t('visibility.clientPh', { defaultValue: '고객을 선택하세요' }) as string}
            isDisabled={disabled}
            value={value.client_ids.map(id => {
              const c = clients.find(x => x.id === id);
              return { value: String(id), label: c?.display_name || c?.biz_name || c?.company_name || `Client #${id}` };
            })}
            onChange={(opts) => {
              const ids: number[] = [];
              if (Array.isArray(opts)) for (const o of opts) {
                const n = Number((o as PlanQSelectOption).value);
                if (n) ids.push(n);
              }
              onChange({ ...value, client_ids: ids });
            }}
            options={clients.map(c => ({ value: String(c.id), label: c.display_name || c.biz_name || c.company_name || `Client #${c.id}` }))}
          />
        </SubField>
      )}
    </Wrap>
  );
};

export default VisibilityField;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const Grid = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  @media (max-width: 640px) { grid-template-columns: 1fr; }
`;
const Radio = styled.button<{ $active: boolean }>`
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  padding: 10px 12px;
  background: ${p => p.$active ? '#F0FDFA' : '#FFFFFF'};
  border: 1px solid ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  text-align: left;
  &:hover:not(:disabled) { border-color: ${p => p.$active ? '#0D9488' : '#CBD5E1'}; }
  &:disabled { opacity: 0.55; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
  ${p => p.$active && css`box-shadow: 0 0 0 2px rgba(20,184,166,0.18);`}
`;
const RadioTitle = styled.div`font-size: 13px; font-weight: 600; color: #0F172A;`;
const RadioHint = styled.div`font-size: 11px; color: #64748B; line-height: 1.4;`;
const SubField = styled.div`display: flex; flex-direction: column; gap: 4px; padding-left: 4px;`;
const SubLabel = styled.div`font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px;`;
