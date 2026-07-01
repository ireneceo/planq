// Q조직 (Workspace Org) D1 — 조직 관리. 부서/팀 + 멤버 소속·직책 배정.
//   owner/admin. 부서 카드(색·부서장·멤버수·팀) + 멤버 배정 테이블(AutoSave).
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { listMembers, type WorkspaceMember } from '../../services/workspace';
import PageShell from '../../components/Layout/PageShell';
import ActionButton from '../../components/Common/ActionButton';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import EmptyState from '../../components/Common/EmptyState';
import { mapApiError } from '../../utils/apiError';
import {
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  createTeam, deleteTeam, assignMember, fetchOrgOverview,
  type OrgDepartment,
} from '../../services/org';

const DEPT_COLORS = ['#14B8A6', '#F43F5E', '#6366F1', '#F59E0B', '#22C55E', '#0EA5E9', '#14B8A6', '#64748B'];

const OrgPage = () => {
  const { t } = useTranslation('org');
  const { t: tErr } = useTranslation('errors');
  const { user } = useAuth();
  const bizId = (user as { business_id?: number } | null)?.business_id || 0;

  const [depts, setDepts] = useState<OrgDepartment[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newDeptName, setNewDeptName] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmDeptDel, setConfirmDeptDel] = useState<OrgDepartment | null>(null);
  const [teamDraft, setTeamDraft] = useState<Record<number, string>>({});
  const [jobDraft, setJobDraft] = useState<Record<number, string>>({});
  const [assign, setAssign] = useState<Record<number, { department_id: number | null; team_id: number | null; job_title: string | null }>>({});

  const load = useCallback(() => {
    if (!bizId) return;
    setLoading(true);
    Promise.all([listDepartments(bizId), listMembers(bizId), fetchOrgOverview(bizId, 'company')])
      .then(([d, m, ov]) => {
        setDepts(d);
        setMembers((m || []).filter((x) => x.user_id && !x.user?.is_ai));
        const a: Record<number, { department_id: number | null; team_id: number | null; job_title: string | null }> = {};
        (ov.byMember || []).forEach((bm) => { a[bm.user_id] = { department_id: bm.department_id, team_id: bm.team_id, job_title: bm.job_title }; });
        setAssign(a);
      })
      .catch((e) => setErr(mapApiError(e, tErr)))
      .finally(() => setLoading(false));
  }, [bizId, tErr]);
  useEffect(() => { load(); }, [load]);

  const addDept = async () => {
    const name = newDeptName.trim();
    if (!name || adding) return;
    setAdding(true); setErr(null);
    try {
      const color = DEPT_COLORS[depts.length % DEPT_COLORS.length];
      await createDepartment(bizId, { name, color });
      setNewDeptName(''); load();
    } catch (e) { setErr(mapApiError(e, tErr)); }
    finally { setAdding(false); }
  };

  const renameDept = async (d: OrgDepartment, name: string) => {
    if (name.trim() === d.name || !name.trim()) return;
    try { await updateDepartment(bizId, d.id, { name: name.trim() }); load(); }
    catch (e) { setErr(mapApiError(e, tErr)); }
  };
  const setDeptColor = async (d: OrgDepartment, color: string) => {
    try { await updateDepartment(bizId, d.id, { color }); setDepts((prev) => prev.map((x) => x.id === d.id ? { ...x, color } : x)); }
    catch (e) { setErr(mapApiError(e, tErr)); }
  };
  const setLead = async (d: OrgDepartment, leadId: number | null) => {
    try { await updateDepartment(bizId, d.id, { lead_user_id: leadId }); setDepts((prev) => prev.map((x) => x.id === d.id ? { ...x, lead_user_id: leadId } : x)); }
    catch (e) { setErr(mapApiError(e, tErr)); }
  };
  const addTeam = async (d: OrgDepartment) => {
    const name = (teamDraft[d.id] || '').trim();
    if (!name) return;
    try { await createTeam(bizId, { department_id: d.id, name }); setTeamDraft((p) => ({ ...p, [d.id]: '' })); load(); }
    catch (e) { setErr(mapApiError(e, tErr)); }
  };
  const removeTeam = async (teamId: number) => {
    try { await deleteTeam(bizId, teamId); load(); }
    catch (e) { setErr(mapApiError(e, tErr)); }
  };
  const doDeleteDept = async () => {
    if (!confirmDeptDel) return;
    const d = confirmDeptDel; setConfirmDeptDel(null);
    try { await deleteDepartment(bizId, d.id); load(); }
    catch (e) { setErr(mapApiError(e, tErr)); }
  };

  // 멤버 배정 — 부서/팀 즉시 저장, 직책은 blur 저장. 저장 성공 시 ✓ 2초 표시 (자동저장 원칙).
  const [savedRows, setSavedRows] = useState<Record<number, boolean>>({});
  const flashSaved = (userId: number) => {
    setSavedRows((p) => ({ ...p, [userId]: true }));
    window.setTimeout(() => setSavedRows((p) => { const n = { ...p }; delete n[userId]; return n; }), 2000);
  };
  const changeAssign = async (userId: number, patch: { department_id?: number | null; team_id?: number | null; job_title?: string | null }) => {
    setErr(null);
    try {
      const r = await assignMember(bizId, userId, patch);
      setAssign((p) => ({ ...p, [userId]: { department_id: r.department_id, team_id: r.team_id, job_title: r.job_title } }));
      flashSaved(userId);
    } catch (e) { setErr(mapApiError(e, tErr)); }
  };

  const deptOptions: PlanQSelectOption[] = [
    { value: '', label: t('unassigned') as string },
    ...depts.map((d) => ({ value: String(d.id), label: d.name })),
  ];
  const teamOptionsFor = (deptId: number | null): PlanQSelectOption[] => {
    const d = depts.find((x) => x.id === deptId);
    return [{ value: '', label: t('noTeam') as string }, ...((d?.teams || []).map((tm) => ({ value: String(tm.id), label: tm.name })))];
  };
  const leadOptionsFor = (): PlanQSelectOption[] => [
    { value: '', label: t('noLead') as string },
    ...members.map((m) => ({ value: String(m.user_id), label: m.user?.name || `#${m.user_id}` })),
  ];

  const cur = (userId: number) => assign[userId] || { department_id: null, team_id: null, job_title: null };

  return (
    <PageShell
      title={t('title') as string}
      count={depts.length}
      actions={
        <AddRow>
          <AddInput value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addDept(); }}
            placeholder={t('newDeptPh') as string} maxLength={100} />
          <ActionButton tone="primary" size="sm" loading={adding} disabled={!newDeptName.trim()} onClick={addDept}>
            {t('addDept') as string}
          </ActionButton>
        </AddRow>
      }
    >
      {err && <ErrMsg>{err}</ErrMsg>}
      {loading ? (
        <Dim>{t('loading') as string}</Dim>
      ) : (
        <>
          {depts.length === 0 ? (
            <EmptyState title={t('emptyTitle') as string} description={t('emptyDesc') as string} />
          ) : (
            <DeptGrid>
              {depts.map((d) => (
                <DeptCard key={d.id}>
                  <DeptTop>
                    <ColorDots>
                      {DEPT_COLORS.map((c) => (
                        <ColorDot key={c} $c={c} $on={d.color === c} type="button"
                          aria-label={c} onClick={() => setDeptColor(d, c)} />
                      ))}
                    </ColorDots>
                    <DelBtn type="button" onClick={() => setConfirmDeptDel(d)} aria-label={t('deleteDept') as string}>×</DelBtn>
                  </DeptTop>
                  <DeptName defaultValue={d.name} onBlur={(e) => renameDept(d, e.target.value)} aria-label={t('deptName') as string} />
                  <DeptMeta>
                    <MetaChip>{t('memberCount', { count: d.member_count }) as string}</MetaChip>
                  </DeptMeta>
                  <FieldLabel>{t('lead') as string}</FieldLabel>
                  <PlanQSelect size="sm" isClearable={false} isSearchable
                    value={leadOptionsFor().find((o) => o.value === String(d.lead_user_id || ''))}
                    options={leadOptionsFor()}
                    onChange={(o) => setLead(d, (o as PlanQSelectOption)?.value ? Number((o as PlanQSelectOption).value) : null)} />
                  <FieldLabel>{t('teams') as string}</FieldLabel>
                  <TeamChips>
                    {(d.teams || []).map((tm) => (
                      <TeamChip key={tm.id}>
                        {tm.name}
                        <TeamX type="button" onClick={() => removeTeam(tm.id)} aria-label={t('deleteTeam') as string}>×</TeamX>
                      </TeamChip>
                    ))}
                  </TeamChips>
                  <TeamAdd>
                    <AddInput value={teamDraft[d.id] || ''} onChange={(e) => setTeamDraft((p) => ({ ...p, [d.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') addTeam(d); }}
                      placeholder={t('newTeamPh') as string} maxLength={100} />
                    <ActionButton tone="secondary" size="sm" disabled={!(teamDraft[d.id] || '').trim()} onClick={() => addTeam(d)}>
                      {t('addTeam') as string}
                    </ActionButton>
                  </TeamAdd>
                </DeptCard>
              ))}
            </DeptGrid>
          )}

          {/* 멤버 배정 */}
          <SectionTitle>{t('assignTitle') as string}</SectionTitle>
          <SectionHint>{t('assignHint') as string}</SectionHint>
          {members.length === 0 ? (
            <Dim>{t('noMembers') as string}</Dim>
          ) : (
            <AssignTable>
              <AssignHead>
                <span>{t('member') as string}</span>
                <span>{t('department') as string}</span>
                <span>{t('team') as string}</span>
                <span>{t('jobTitle') as string}</span>
              </AssignHead>
              {members.map((m) => {
                const c = cur(m.user_id!);
                return (
                  <AssignRow key={m.user_id}>
                    <MemberName>
                      {m.user?.name || `#${m.user_id}`}
                      {savedRows[m.user_id!] && <SavedBadge aria-live="polite">✓</SavedBadge>}
                    </MemberName>
                    <PlanQSelect size="sm" isClearable={false} isSearchable={false}
                      value={deptOptions.find((o) => o.value === String(c.department_id || ''))}
                      options={deptOptions}
                      onChange={(o) => { const v = (o as PlanQSelectOption)?.value; changeAssign(m.user_id!, { department_id: v ? Number(v) : null, team_id: null }); }} />
                    <PlanQSelect size="sm" isClearable={false} isSearchable={false}
                      value={teamOptionsFor(c.department_id).find((o) => o.value === String(c.team_id || ''))}
                      options={teamOptionsFor(c.department_id)}
                      onChange={(o) => { const v = (o as PlanQSelectOption)?.value; changeAssign(m.user_id!, { team_id: v ? Number(v) : null }); }} />
                    <JobInput
                      value={jobDraft[m.user_id!] ?? (c.job_title || '')}
                      onChange={(e) => setJobDraft((p) => ({ ...p, [m.user_id!]: e.target.value }))}
                      onBlur={(e) => changeAssign(m.user_id!, { job_title: e.target.value || null })}
                      placeholder={t('jobTitlePh') as string} maxLength={100} />
                  </AssignRow>
                );
              })}
            </AssignTable>
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={!!confirmDeptDel}
        onClose={() => setConfirmDeptDel(null)}
        onConfirm={doDeleteDept}
        title={t('deleteDept') as string}
        message={t('confirmDeleteDept', { name: confirmDeptDel?.name || '' }) as string}
        confirmText={t('deleteDept') as string}
        cancelText={t('cancel', { defaultValue: '취소' }) as string}
        variant="danger"
      />
    </PageShell>
  );
};

export default OrgPage;

// ─── styled ───
const AddRow = styled.div`display: flex; align-items: center; gap: 8px;`;
const AddInput = styled.input`
  padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; color: #0f172a; font-family: inherit; min-width: 0;
  &:focus { outline: none; border-color: #14b8a6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const ErrMsg = styled.div`margin-bottom: 16px; padding: 10px 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-size: 13px; color: #b91c1c;`;
const Dim = styled.div`padding: 32px 16px; text-align: center; font-size: 13px; color: #94a3b8;`;
const DeptGrid = styled.div`
  display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; margin-bottom: 28px;
  @media (max-width: 768px) { grid-template-columns: 1fr; }
`;
const DeptCard = styled.div`
  border: 1px solid #e2e8f0; border-radius: 14px; background: #fff; padding: 16px;
  display: flex; flex-direction: column; gap: 8px;
`;
const DeptTop = styled.div`display: flex; align-items: center; justify-content: space-between;`;
const ColorDots = styled.div`display: flex; gap: 4px;`;
const ColorDot = styled.button<{ $c: string; $on: boolean }>`
  width: 16px; height: 16px; border-radius: 50%; cursor: pointer; padding: 0;
  background: ${(p) => p.$c}; border: 2px solid ${(p) => (p.$on ? '#0f172a' : 'transparent')};
  transition: transform 0.1s; &:hover { transform: scale(1.15); }
`;
const DelBtn = styled.button`
  width: 26px; height: 26px; border: none; background: transparent; color: #94a3b8; font-size: 16px; cursor: pointer; border-radius: 6px;
  &:hover { background: #fee2e2; color: #b91c1c; }
`;
const DeptName = styled.input`
  border: none; background: transparent; font-size: 16px; font-weight: 700; color: #0f172a; padding: 2px 0; font-family: inherit;
  &:focus { outline: none; border-bottom: 2px solid #14b8a6; }
`;
const DeptMeta = styled.div`display: flex; gap: 6px;`;
const MetaChip = styled.span`font-size: 11px; font-weight: 700; color: #0f766e; background: #f0fdfa; border-radius: 999px; padding: 2px 10px;`;
const FieldLabel = styled.div`font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px; margin-top: 4px;`;
const TeamChips = styled.div`display: flex; flex-wrap: wrap; gap: 6px;`;
const TeamChip = styled.span`
  display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; color: #475569;
  background: #f1f5f9; border-radius: 999px; padding: 3px 6px 3px 10px;
`;
const TeamX = styled.button`
  width: 16px; height: 16px; border: none; background: transparent; color: #94a3b8; font-size: 13px; cursor: pointer; border-radius: 50%; line-height: 1;
  &:hover { background: #fee2e2; color: #b91c1c; }
`;
const TeamAdd = styled.div`display: flex; gap: 6px; ${AddInput} { flex: 1; padding: 6px 10px; font-size: 12px; }`;
const SectionTitle = styled.h2`font-size: 15px; font-weight: 700; color: #0f172a; margin: 8px 0 4px;`;
const SectionHint = styled.p`font-size: 12px; color: #64748b; margin: 0 0 14px;`;
const AssignTable = styled.div`border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; background: #fff;`;
const AssignHead = styled.div`
  display: grid; grid-template-columns: 1.4fr 1.2fr 1.2fr 1.2fr; gap: 12px; padding: 10px 16px;
  background: #f8fafc; border-bottom: 1px solid #e2e8f0;
  span { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; }
  @media (max-width: 768px) { grid-template-columns: 1fr; gap: 4px; span { display: none; } }
`;
const AssignRow = styled.div`
  display: grid; grid-template-columns: 1.4fr 1.2fr 1.2fr 1.2fr; gap: 12px; align-items: center; padding: 10px 16px;
  border-bottom: 1px solid #f1f5f9; &:last-child { border-bottom: none; }
  @media (max-width: 768px) { grid-template-columns: 1fr; gap: 8px; padding: 12px 16px; }
`;
const MemberName = styled.div`font-size: 13px; font-weight: 600; color: #0f172a; display: flex; align-items: center; gap: 6px;`;
const SavedBadge = styled.span`
  font-size: 11px; font-weight: 700; color: #0f766e; background: #f0fdfa;
  border-radius: 999px; padding: 1px 7px;
  animation: fadeBadge 2s ease forwards;
  @keyframes fadeBadge { 0% { opacity: 0; } 12% { opacity: 1; } 75% { opacity: 1; } 100% { opacity: 0; } }
`;
const JobInput = styled.input`
  padding: 7px 10px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; color: #0f172a; font-family: inherit;
  &:focus { outline: none; border-color: #14b8a6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
