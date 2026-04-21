// /business/clients — 마스터-디테일 드로어 패턴.
// 리스트 행 클릭 → 우측 드로어 (재클릭 토글, 전역 규칙)
// 인라인 편집: 이름 / 회사 더블클릭. 활성 스위치는 드로어·리스트 양쪽.
// 섹션: 헤더 / 연락처 / 메모 / 연결 프로젝트 / 연결 대화 / 히스토리
// 삭제는 드로어 맨 아래 Danger 블록 (확인 모달).
import { useEffect, useState, useCallback, useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import LetterAvatar from '../../components/Common/LetterAvatar';
import SearchBox from '../../components/Common/SearchBox';
import PageShell from '../../components/Layout/PageShell';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

type ClientStatus = 'invited' | 'active' | 'archived';

interface ClientRow {
  id: number;
  business_id: number;
  user_id: number;
  display_name: string | null;
  company_name: string | null;
  notes: string | null;
  status?: ClientStatus;
  project_count?: number;
  active_project_count?: number;
  invited_at: string | null;
  created_at: string;
  user?: { id: number; name: string; email: string; phone: string | null; avatar_url?: string | null };
  linked_projects?: Array<{ id: number; name: string; status: string; color: string | null; project_type?: string; project_client_id: number }>;
  linked_conversations?: Array<{ id: number; title: string; channel_type: string; status: string; project_id: number | null; last_message_at: string | null }>;
}

interface HistoryEntry {
  id: number;
  action: string;
  target_type: string;
  target_id: number | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
  User?: { id: number; name: string; avatar_url?: string | null };
}

type StatusFilter = 'all' | 'active' | 'archived';

const STATUS_STYLE: Record<ClientStatus, { bg: string; fg: string; label: string }> = {
  active: { bg: '#CCFBF1', fg: '#0F766E', label: '활성' },
  archived: { bg: '#E2E8F0', fg: '#475569', label: '보관' },
  invited: { bg: '#FEF3C7', fg: '#92400E', label: '초대됨' },
};

export default function ClientsPage() {
  const { t } = useTranslation('clients');
  const { user } = useAuth();
  const { formatDate } = useTimeFormat();
  const navigate = useNavigate();
  const businessId = user?.business_id || 0;
  const isAdmin = user?.business_role === 'owner' || user?.platform_role === 'platform_admin';

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');

  // 드로어
  const [activeId, setActiveId] = useState<number | null>(null);
  useBodyScrollLock(activeId != null);
  const [activeDetail, setActiveDetail] = useState<ClientRow | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // 인라인 편집 (리스트)
  const [editingCell, setEditingCell] = useState<{ id: number; field: 'display_name' | 'company_name' } | null>(null);
  const [editDraft, setEditDraft] = useState('');

  // 초대 모달
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteCompany, setInviteCompany] = useState('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // 삭제 모달
  const [deleteTarget, setDeleteTarget] = useState<ClientRow | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<{ other_projects: { id: number; name: string; status: string }[] } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/clients/${businessId}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed');
      setClients(Array.isArray(data.data) ? data.data : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  // 드로어 상세 로드
  useEffect(() => {
    if (!activeId) { setActiveDetail(null); setHistory([]); setHistoryLoaded(false); setHistoryOpen(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/clients/${businessId}/${activeId}`);
        const j = await res.json();
        if (!cancelled && j.success) setActiveDetail(j.data);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [activeId, businessId]);

  const loadHistory = async () => {
    if (!activeId || historyLoaded) return;
    try {
      const res = await apiFetch(`/api/clients/${businessId}/${activeId}/history`);
      const j = await res.json();
      if (j.success) { setHistory(j.data || []); setHistoryLoaded(true); }
    } catch { /* ignore */ }
  };

  // 삭제 영향도
  useEffect(() => {
    if (!deleteTarget) { setDeleteImpact(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/clients/${businessId}/${deleteTarget.id}/removal-impact`);
        const j = await res.json();
        if (!cancelled && j.success) setDeleteImpact(j.data);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [deleteTarget, businessId]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/clients/${businessId}/${deleteTarget.id}`, { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.message || '삭제 실패');
      setClients((prev) => prev.filter((x) => x.id !== deleteTarget.id));
      if (activeId === deleteTarget.id) setActiveId(null);
      setDeleteTarget(null);
      setDeleteImpact(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  // 공용 필드 업데이트 (디바운스 없음 — 인라인/드로어 blur 시 호출)
  const patchClient = async (id: number, patch: Partial<Pick<ClientRow, 'display_name' | 'company_name' | 'notes'>>) => {
    const res = await apiFetch(`/api/clients/${businessId}/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const j = await res.json();
    if (j.success) {
      setClients((prev) => prev.map((c) => c.id === id ? { ...c, ...patch } : c));
      setActiveDetail((prev) => prev && prev.id === id ? { ...prev, ...patch } : prev);
    }
  };

  const toggleStatus = async (id: number, next: 'active' | 'archived') => {
    const res = await apiFetch(`/api/clients/${businessId}/${id}/archive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    const j = await res.json();
    if (j.success) {
      setClients((prev) => prev.map((c) => c.id === id ? { ...c, status: next } : c));
      setActiveDetail((prev) => prev && prev.id === id ? { ...prev, status: next } : prev);
      setHistoryLoaded(false); // 히스토리 재로드 필요
    }
  };

  const filtered = useMemo(() => clients.filter((c) => {
    if (statusFilter !== 'all') {
      const st = c.status || 'active';
      if (statusFilter === 'active' && st !== 'active' && st !== 'invited') return false;
      if (statusFilter === 'archived' && st !== 'archived') return false;
    }
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const name = (c.display_name || c.user?.name || '').toLowerCase();
    const company = (c.company_name || '').toLowerCase();
    const email = (c.user?.email || '').toLowerCase();
    return name.includes(q) || company.includes(q) || email.includes(q);
  }), [clients, query, statusFilter]);

  const submitInvite = async () => {
    setInviteError(null);
    if (!inviteName.trim() || !inviteEmail.trim()) { setInviteError('이름과 이메일은 필수입니다'); return; }
    setInviteSubmitting(true);
    try {
      const res = await apiFetch(`/api/clients/${businessId}/invite`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: inviteName.trim(), email: inviteEmail.trim(), company_name: inviteCompany.trim() || null }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.message || '초대 실패');
      setInviteOpen(false); setInviteName(''); setInviteEmail(''); setInviteCompany('');
      await load();
    } catch (e) {
      setInviteError((e as Error).message);
    } finally { setInviteSubmitting(false); }
  };

  const commitEdit = async () => {
    if (!editingCell) return;
    const v = editDraft.trim();
    const curr = clients.find((c) => c.id === editingCell.id);
    if (!curr) { setEditingCell(null); return; }
    const old = editingCell.field === 'display_name' ? (curr.display_name || '') : (curr.company_name || '');
    if (v !== old) await patchClient(editingCell.id, { [editingCell.field]: v || null });
    setEditingCell(null);
  };

  return (
    <PageShell
      title={t('page.title')}
      count={filtered.length}
      actions={
        <>
          <SearchBox value={query} onChange={setQuery} placeholder={(t('searchPlaceholder') as string) || '이름·회사·이메일 검색'} width={240} />
          <FilterSeg>
            {(['active', 'all', 'archived'] as StatusFilter[]).map((s) => (
              <FilterSegBtn key={s} $active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                {s === 'active' ? '활성' : s === 'archived' ? '보관' : '전체'}
              </FilterSegBtn>
            ))}
          </FilterSeg>
          {isAdmin && (
            <InviteBtn type="button" onClick={() => setInviteOpen(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              고객 초대
            </InviteBtn>
          )}
        </>
      }
    >
      {loading && <Empty>{t('loading')}</Empty>}
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {!loading && !error && filtered.length === 0 && (
        <Empty>{query ? t('noResults') : t('empty')}</Empty>
      )}

      {!loading && !error && filtered.length > 0 && (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th style={{ width: 44 }} />
                <Th>{t('col.name')}</Th>
                <Th>{t('col.company')}</Th>
                <Th>{t('col.email')}</Th>
                <Th>{t('col.phone')}</Th>
                <Th style={{ width: 90 }}>상태</Th>
                <Th style={{ width: 100, textAlign: 'center' }}>프로젝트</Th>
                <Th style={{ width: 120 }}>{t('col.invitedAt')}</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const name = c.display_name || c.user?.name || '—';
                const st = (c.status || 'invited') as ClientStatus;
                const sStyle = STATUS_STYLE[st];
                const isSelected = activeId === c.id;
                const isEditingName = editingCell?.id === c.id && editingCell?.field === 'display_name';
                const isEditingCompany = editingCell?.id === c.id && editingCell?.field === 'company_name';
                return (
                  <Tr key={c.id} $selected={isSelected} onClick={() => setActiveId((prev) => prev === c.id ? null : c.id)}>
                    <Td>
                      <LetterAvatar name={name} src={c.user?.avatar_url || null} size={32} variant={isSelected ? 'active' : 'neutral'} />
                    </Td>
                    <Td onDoubleClick={(e) => { if (!isAdmin) return; e.stopPropagation(); setEditDraft(c.display_name || c.user?.name || ''); setEditingCell({ id: c.id, field: 'display_name' }); }}>
                      {isEditingName ? (
                        <CellInput autoFocus value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onBlur={commitEdit}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingCell(null); }} />
                      ) : (<NameCell>{name}</NameCell>)}
                    </Td>
                    <Td onDoubleClick={(e) => { if (!isAdmin) return; e.stopPropagation(); setEditDraft(c.company_name || ''); setEditingCell({ id: c.id, field: 'company_name' }); }}>
                      {isEditingCompany ? (
                        <CellInput autoFocus value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onBlur={commitEdit}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingCell(null); }} />
                      ) : (<span>{c.company_name || <Muted>—</Muted>}</span>)}
                    </Td>
                    <Td>{c.user?.email || <Muted>—</Muted>}</Td>
                    <Td>{c.user?.phone || <Muted>—</Muted>}</Td>
                    <Td>
                      <StatusPill style={{ background: sStyle.bg, color: sStyle.fg }}>{sStyle.label}</StatusPill>
                    </Td>
                    <Td style={{ textAlign: 'center' }}>
                      {c.project_count && c.project_count > 0 ? <ProjCount>{c.project_count}</ProjCount> : <Muted>—</Muted>}
                    </Td>
                    <Td>{formatDate(c.invited_at || c.created_at)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}

      {/* 우측 드로어 */}
      {activeId && activeDetail && (<>
        <DrawerBackdrop onClick={() => setActiveId(null)} />
        <Drawer>
          <DrawerHeader>
            <DrawerBack onClick={() => setActiveId(null)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
              목록
            </DrawerBack>
            <DrawerClose onClick={() => setActiveId(null)} aria-label="닫기">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </DrawerClose>
          </DrawerHeader>
          <DrawerScroll>
            <HeadRow>
              <LetterAvatar name={activeDetail.display_name || activeDetail.user?.name || '고객'} src={activeDetail.user?.avatar_url || null} size={56} variant="active" />
              <HeadText>
                <HeadName>{activeDetail.display_name || activeDetail.user?.name || '고객'}</HeadName>
                {activeDetail.company_name && <HeadCompany>{activeDetail.company_name}</HeadCompany>}
              </HeadText>
              <HeadSide>
                <SwitchWrap title={activeDetail.status === 'archived' ? '보관됨 — 클릭하여 활성화' : '활성 — 클릭하여 보관'}>
                  <SwitchInput type="checkbox" checked={activeDetail.status !== 'archived'} disabled={!isAdmin}
                    onChange={(e) => toggleStatus(activeDetail.id, e.target.checked ? 'active' : 'archived')} />
                  <SwitchTrack />
                  <SwitchLabel>{activeDetail.status === 'archived' ? '보관' : '활성'}</SwitchLabel>
                </SwitchWrap>
              </HeadSide>
            </HeadRow>

            <Section>
              <SectionTitle>연락처</SectionTitle>
              <ContactRow><ContactLabel>이메일</ContactLabel><ContactValue>{activeDetail.user?.email || '—'}</ContactValue></ContactRow>
              <ContactRow><ContactLabel>전화</ContactLabel><ContactValue>{activeDetail.user?.phone || '—'}</ContactValue></ContactRow>
              <Helper>이메일·전화는 고객이 본인 프로필에서 수정합니다.</Helper>
            </Section>

            <Section>
              <SectionTitle>메모</SectionTitle>
              <NoteArea
                defaultValue={activeDetail.notes || ''}
                placeholder="이 고객에 관한 내부 메모 — 자동저장"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (activeDetail.notes || '').trim()) patchClient(activeDetail.id, { notes: v || null });
                }}
                disabled={!isAdmin}
              />
            </Section>

            <Section>
              <SectionTitle>연결 프로젝트 <SmallCount>{activeDetail.linked_projects?.length || 0}</SmallCount></SectionTitle>
              {(!activeDetail.linked_projects || activeDetail.linked_projects.length === 0)
                ? <Dim>연결된 프로젝트 없음</Dim>
                : <ItemList>
                    {activeDetail.linked_projects.map((p) => (
                      <ItemCard key={p.id} onClick={() => navigate(`/projects/p/${p.id}`)}>
                        <ColorDot style={{ background: p.color || '#94A3B8' }} />
                        <ItemMain>
                          <ItemTitle>{p.name}</ItemTitle>
                          <ItemMeta>
                            <ProjectStatusPill $status={p.status}>{p.status === 'active' ? '진행' : p.status === 'paused' ? '일시중지' : '완료'}</ProjectStatusPill>
                            {p.project_type === 'ongoing' && <TypeBadge>구독</TypeBadge>}
                          </ItemMeta>
                        </ItemMain>
                        <GoArrow>›</GoArrow>
                      </ItemCard>
                    ))}
                  </ItemList>}
            </Section>

            <Section>
              <SectionTitle>연결 대화 <SmallCount>{activeDetail.linked_conversations?.length || 0}</SmallCount></SectionTitle>
              {(!activeDetail.linked_conversations || activeDetail.linked_conversations.length === 0)
                ? <Dim>참여중인 대화 없음</Dim>
                : <ItemList>
                    {activeDetail.linked_conversations.map((c) => (
                      <ItemCard key={c.id} onClick={() => navigate(c.project_id ? `/talk?project=${c.project_id}&conv=${c.id}` : `/talk?conv=${c.id}`)}>
                        <ChannelDot $type={c.channel_type} />
                        <ItemMain>
                          <ItemTitle>{c.title}</ItemTitle>
                          <ItemMeta>
                            <ChannelBadge $type={c.channel_type}>{c.channel_type === 'customer' ? '고객' : c.channel_type === 'internal' ? '내부' : c.channel_type}</ChannelBadge>
                            {c.status === 'archived' && <ArchivedPill>보관</ArchivedPill>}
                            {c.last_message_at && <LastMsg>{formatDate(c.last_message_at)}</LastMsg>}
                          </ItemMeta>
                        </ItemMain>
                        <GoArrow>›</GoArrow>
                      </ItemCard>
                    ))}
                  </ItemList>}
            </Section>

            <Section>
              <SectionTitleRow>
                <SectionTitle>히스토리</SectionTitle>
                <HistoryToggle type="button" onClick={() => { setHistoryOpen((v) => !v); loadHistory(); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  {historyOpen ? '닫기' : '열기'}
                </HistoryToggle>
              </SectionTitleRow>
              {historyOpen && (
                !historyLoaded ? <Dim>로드 중…</Dim> :
                history.length === 0 ? <Dim>기록 없음</Dim> :
                <Timeline>
                  {history.map((h) => (
                    <TimelineItem key={h.id}>
                      <TimelineDot $event={h.action} />
                      <TimelineBody>
                        <TimelineHead>
                          <strong>{h.User?.name || '—'}</strong>
                          <TimelineEvent>{labelFor(h.action)}</TimelineEvent>
                        </TimelineHead>
                        {renderHistoryDetail(h)}
                        <TimelineTime>{formatDate(h.created_at)}</TimelineTime>
                      </TimelineBody>
                    </TimelineItem>
                  ))}
                </Timeline>
              )}
            </Section>

            {isAdmin && (
              <DangerBlock>
                <SectionTitle>위험 영역</SectionTitle>
                <DangerBtn type="button" onClick={() => setDeleteTarget(activeDetail)}>고객 완전 삭제</DangerBtn>
                <Helper>이 워크스페이스에서 완전히 삭제합니다. 연결된 프로젝트에서도 해제됩니다.</Helper>
              </DangerBlock>
            )}
          </DrawerScroll>
        </Drawer>
      </>)}

      {/* 고객 초대 모달 */}
      {inviteOpen && (
        <ConfirmBackdrop onMouseDown={(e) => { if (e.target === e.currentTarget) setInviteOpen(false); }}>
          <ConfirmDialog>
            <ConfirmTitle>고객 초대</ConfirmTitle>
            <ConfirmBody>
              <Field><FieldLabel>이름 <Req>*</Req></FieldLabel><FieldInput autoFocus value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="예: 김고객" /></Field>
              <Field><FieldLabel>이메일 <Req>*</Req></FieldLabel><FieldInput value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="client@example.com" type="email" /></Field>
              <Field><FieldLabel>회사명</FieldLabel><FieldInput value={inviteCompany} onChange={(e) => setInviteCompany(e.target.value)} placeholder="선택" /></Field>
              <Helper>이메일이 이미 사용자로 있으면 그 계정에 워크스페이스 고객으로 추가됩니다. 없으면 새 계정을 자동 생성하고 초대장을 보냅니다 (추후).</Helper>
              {inviteError && <WarnBlock>{inviteError}</WarnBlock>}
            </ConfirmBody>
            <ConfirmFooter>
              <CFCancel type="button" onClick={() => setInviteOpen(false)} disabled={inviteSubmitting}>취소</CFCancel>
              <CFPrimary type="button" onClick={submitInvite} disabled={inviteSubmitting || !inviteName.trim() || !inviteEmail.trim()}>
                {inviteSubmitting ? '초대 중…' : '초대'}
              </CFPrimary>
            </ConfirmFooter>
          </ConfirmDialog>
        </ConfirmBackdrop>
      )}

      {/* 삭제 확인 모달 */}
      {deleteTarget && (
        <ConfirmBackdrop onMouseDown={(e) => { if (e.target === e.currentTarget) { setDeleteTarget(null); setDeleteImpact(null); } }}>
          <ConfirmDialog>
            <ConfirmTitle>고객 삭제 확인</ConfirmTitle>
            <ConfirmBody>
              <strong>{deleteTarget.display_name || deleteTarget.user?.name || '고객'}</strong> ({deleteTarget.user?.email || '—'}) 을(를) 이 워크스페이스에서 완전히 삭제합니다.
              {deleteImpact && deleteImpact.other_projects.length > 0 ? (
                <WarnBlock>
                  연결된 <strong>{deleteImpact.other_projects.length}개</strong> 프로젝트에서도 연결이 해제됩니다:
                  <ProjListUl>
                    {deleteImpact.other_projects.map((p) => (<li key={p.id}>{p.name}</li>))}
                  </ProjListUl>
                </WarnBlock>
              ) : deleteImpact ? (
                <WarnBlock>다른 프로젝트 연결 없음 — 이 삭제 이후 워크스페이스에서 사라집니다.</WarnBlock>
              ) : null}
              <Caveat>사용자 계정 자체(로그인)는 유지됩니다. 다시 초대하면 다시 추가할 수 있습니다.</Caveat>
            </ConfirmBody>
            <ConfirmFooter>
              <CFCancel type="button" onClick={() => { setDeleteTarget(null); setDeleteImpact(null); }} disabled={deleting}>취소</CFCancel>
              <CFDanger type="button" onClick={confirmDelete} disabled={deleting}>
                {deleting ? '삭제 중…' : '삭제'}
              </CFDanger>
            </ConfirmFooter>
          </ConfirmDialog>
        </ConfirmBackdrop>
      )}
    </PageShell>
  );
}

function labelFor(action: string): string {
  switch (action) {
    case 'client.invited': return '초대됨';
    case 'client.activated': return '활성화';
    case 'client.archived': return '보관';
    case 'client.updated': return '정보 수정';
    case 'client.deleted': return '삭제';
    case 'project.client_added': return '프로젝트 연결';
    case 'project.client_removed': return '프로젝트 연결 해제';
    default: return action;
  }
}

function renderHistoryDetail(h: HistoryEntry) {
  if (h.action === 'client.updated' && h.old_value && h.new_value) {
    const keys = Object.keys(h.new_value as Record<string, unknown>);
    return <TimelineNote>{keys.map((k) => `${k}: "${String((h.old_value as Record<string, unknown>)?.[k] ?? '')}" → "${String((h.new_value as Record<string, unknown>)[k] ?? '')}"`).join(', ')}</TimelineNote>;
  }
  if (h.action === 'project.client_added' || h.action === 'project.client_removed') {
    const v = (h.new_value || h.old_value) as { project_name?: string } | null;
    return v?.project_name ? <TimelineNote>{v.project_name}</TimelineNote> : null;
  }
  return null;
}

// ─── styled ───
const FilterSeg = styled.div`display:inline-flex;background:#F1F5F9;padding:3px;border-radius:8px;gap:2px;`;
const FilterSegBtn = styled.button<{ $active: boolean }>`
  padding:6px 12px;border:none;background:${p=>p.$active?'#FFF':'transparent'};color:${p=>p.$active?'#0F766E':'#64748B'};
  border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;
  box-shadow:${p=>p.$active?'0 1px 2px rgba(0,0,0,0.06)':'none'};
  &:hover{color:#0F766E;}
`;
const TableWrap = styled.div`background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;`;
const Table = styled.table`width:100%;border-collapse:collapse;font-size:13px;`;
const Th = styled.th`text-align:left;padding:12px 16px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:#64748b;background:#f8fafc;border-bottom:1px solid #e2e8f0;`;
const Tr = styled.tr<{ $selected?: boolean }>`
  cursor: pointer;
  &:not(:last-child){border-bottom:1px solid #f1f5f9;}
  background:${p=>p.$selected?'#F0FDFA':'transparent'};
  ${p=>p.$selected&&'box-shadow:inset 3px 0 0 #14B8A6;'}
  &:hover{background:${p=>p.$selected?'#CCFBF1':'#f8fafc'};}
`;
const Td = styled.td`padding:12px 16px;color:#0f172a;vertical-align:middle;strong{font-weight:600;}`;
const NameCell = styled.strong`font-weight:600;`;
const Muted = styled.span`color:#CBD5E1;`;
const CellInput = styled.input`width:100%;height:26px;padding:0 6px;border:1px solid #14B8A6;border-radius:6px;font-size:13px;font-family:inherit;background:#F0FDFA;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}`;

const StatusPill = styled.span`display:inline-block;padding:2px 10px;border-radius:8px;font-size:11px;font-weight:600;white-space:nowrap;`;
const ProjCount = styled.span`display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:22px;padding:0 8px;background:#F0FDFA;color:#0F766E;border-radius:999px;font-size:12px;font-weight:700;`;
const Empty = styled.div`padding:60px 20px;text-align:center;color:#94a3b8;font-size:14px;`;
const ErrorBanner = styled.div`padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:8px;font-size:13px;margin:0 0 16px;`;

// Drawer
const DrawerBackdrop = styled.div`
  position:fixed;inset:0;background:rgba(15, 23, 42, 0.08);
  z-index:39;
  animation:fb 0.22s ease-out;@keyframes fb{from{opacity:0;}to{opacity:1;}}
  @media (prefers-reduced-motion: reduce){animation:none;}
`;
const Drawer = styled.aside`
  position:fixed;top:0;right:0;bottom:0;
  width:min(520px, calc(100vw - 56px));
  background:#FFF;border-left:1px solid #E2E8F0;
  box-shadow:-16px 0 40px rgba(15,23,42,0.14);display:flex;flex-direction:column;overflow:hidden;z-index:40;
  animation:ds 0.28s cubic-bezier(0.22,1,0.36,1);@keyframes ds{from{transform:translateX(100%);}to{transform:translateX(0);}}
  padding-bottom:env(safe-area-inset-bottom,0px);
  @media (prefers-reduced-motion: reduce){animation:none;}
`;
const DrawerHeader = styled.div`height:60px;padding:14px 20px;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;`;
const DrawerBack = styled.button`display:flex;align-items:center;gap:4px;background:transparent;border:none;color:#0F766E;font-size:12px;font-weight:600;cursor:pointer;padding:0;&:hover{color:#134E4A;}`;
const DrawerClose = styled.button`width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;border-radius:6px;color:#64748B;cursor:pointer;&:hover{background:#F1F5F9;color:#0F172A;}`;
const DrawerScroll = styled.div`flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:20px;`;
const HeadRow = styled.div`display:flex;align-items:center;gap:14px;padding-bottom:16px;border-bottom:1px solid #F1F5F9;`;
const HeadText = styled.div`flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;`;
const HeadName = styled.h2`font-size:20px;font-weight:700;color:#0F172A;margin:0;`;
const HeadCompany = styled.div`font-size:13px;color:#64748B;`;
const HeadSide = styled.div`flex-shrink:0;`;

// Switch
const SwitchWrap = styled.label`display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;`;
const SwitchInput = styled.input`appearance:none;-webkit-appearance:none;position:absolute;opacity:0;pointer-events:none;
  &:checked + span{background:#14B8A6;}
  &:checked + span::after{transform:translateX(18px);}
  &:disabled + span{opacity:0.5;cursor:not-allowed;}
`;
const SwitchTrack = styled.span`display:inline-block;width:38px;height:22px;background:#CBD5E1;border-radius:999px;position:relative;transition:background 0.15s;
  &::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;background:#FFF;border-radius:50%;box-shadow:0 1px 2px rgba(0,0,0,0.2);transition:transform 0.15s;}
`;
const SwitchLabel = styled.span`font-size:12px;font-weight:600;color:#475569;`;

const Section = styled.section`display:flex;flex-direction:column;gap:8px;`;
const SectionTitle = styled.h3`font-size:13px;font-weight:700;color:#0F172A;margin:0;`;
const SectionTitleRow = styled.div`display:flex;align-items:center;justify-content:space-between;`;
const SmallCount = styled.small`margin-left:6px;font-size:11px;color:#94A3B8;font-weight:500;`;
const Helper = styled.div`font-size:11px;color:#94A3B8;line-height:1.5;`;
const ContactRow = styled.div`display:flex;align-items:center;gap:8px;padding:6px 0;`;
const ContactLabel = styled.span`font-size:11px;color:#94A3B8;font-weight:600;width:48px;flex-shrink:0;`;
const ContactValue = styled.span`font-size:13px;color:#0F172A;`;
const NoteArea = styled.textarea`
  width:100%;min-height:70px;max-height:180px;padding:8px 10px;
  border:1px solid #E2E8F0;border-radius:8px;font-size:13px;color:#0F172A;background:#FAFBFC;font-family:inherit;line-height:1.5;resize:vertical;
  &:focus{outline:none;border-color:#14B8A6;background:#FFF;box-shadow:0 0 0 3px rgba(20,184,166,0.1);}
  &:disabled{background:#F8FAFC;color:#64748B;cursor:not-allowed;}
  &::placeholder{color:#CBD5E1;}
`;

const ItemList = styled.div`display:flex;flex-direction:column;gap:6px;`;
const ItemCard = styled.button`
  display:flex;align-items:center;gap:10px;padding:10px 12px;
  background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;cursor:pointer;
  font-family:inherit;text-align:left;width:100%;
  &:hover{background:#F0FDFA;border-color:#CCFBF1;}
`;
const ColorDot = styled.span`width:4px;align-self:stretch;border-radius:2px;flex-shrink:0;`;
const ChannelDot = styled.span<{ $type:string }>`width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${p=>p.$type==='customer'?'#14B8A6':'#94A3B8'};`;
const ItemMain = styled.div`flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;`;
const ItemTitle = styled.div`font-size:13px;font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
const ItemMeta = styled.div`display:flex;align-items:center;gap:6px;font-size:11px;color:#64748B;`;
const ProjectStatusPill = styled.span<{ $status:string }>`padding:1px 6px;border-radius:6px;font-size:10px;font-weight:600;
  ${p=>p.$status==='active'?'background:#CCFBF1;color:#0F766E;':p.$status==='paused'?'background:#FEF3C7;color:#92400E;':'background:#E2E8F0;color:#475569;'}
`;
const TypeBadge = styled.span`padding:1px 6px;background:#F1F5F9;color:#64748B;border-radius:4px;font-size:9px;font-weight:600;`;
const ChannelBadge = styled.span<{ $type:string }>`padding:1px 6px;border-radius:6px;font-size:10px;font-weight:600;
  ${p=>p.$type==='customer'?'background:#F0FDFA;color:#0F766E;':'background:#F1F5F9;color:#64748B;'}
`;
const ArchivedPill = styled.span`padding:1px 6px;background:#E2E8F0;color:#475569;border-radius:6px;font-size:10px;font-weight:600;`;
const LastMsg = styled.span`margin-left:auto;font-size:10px;color:#94A3B8;`;
const GoArrow = styled.span`font-size:18px;color:#CBD5E1;margin-left:auto;`;

// History
const HistoryToggle = styled.button`display:inline-flex;align-items:center;gap:4px;padding:5px 10px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;color:#475569;cursor:pointer;&:hover{background:#F0FDFA;border-color:#CCFBF1;color:#0F766E;}`;
const Timeline = styled.div`display:flex;flex-direction:column;gap:10px;padding-left:8px;border-left:2px solid #E2E8F0;margin-top:4px;`;
const TimelineItem = styled.div`display:flex;gap:10px;position:relative;padding-left:8px;`;
const TimelineDot = styled.div<{ $event:string }>`position:absolute;left:-15px;top:4px;width:10px;height:10px;border-radius:50%;border:2px solid #FFF;${p=>{
  if(p.$event==='client.invited'||p.$event==='client.activated')return 'background:#14B8A6;';
  if(p.$event==='client.archived'||p.$event==='client.deleted')return 'background:#94A3B8;';
  if(p.$event==='project.client_added')return 'background:#0F766E;';
  if(p.$event==='project.client_removed')return 'background:#F43F5E;';
  if(p.$event==='client.updated')return 'background:#3B82F6;';
  return 'background:#CBD5E1;';
}}`;
const TimelineBody = styled.div`flex:1;font-size:12px;color:#334155;`;
const TimelineHead = styled.div`display:flex;flex-wrap:wrap;align-items:center;gap:6px;`;
const TimelineEvent = styled.span`color:#64748B;`;
const TimelineNote = styled.div`margin-top:2px;padding:4px 8px;background:#F8FAFC;border-radius:4px;font-size:11px;color:#475569;`;
const TimelineTime = styled.div`margin-top:2px;font-size:10px;color:#94A3B8;`;

// Danger
const DangerBlock = styled.section`display:flex;flex-direction:column;gap:8px;padding-top:16px;border-top:1px solid #F1F5F9;`;
const DangerBtn = styled.button`height:40px;padding:0 16px;background:#FFF;color:#DC2626;border:1px solid #FECACA;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;align-self:flex-start;&:hover{background:#FEF2F2;border-color:#DC2626;}`;

const Dim = styled.div`padding:12px;text-align:center;font-size:12px;color:#94A3B8;background:#F8FAFC;border-radius:8px;`;

// Delete modal (reused)
const ConfirmBackdrop = styled.div`position:fixed;inset:0;background:rgba(15,23,42,0.40);display:flex;align-items:center;justify-content:center;z-index:60;padding:20px;animation:cbfade 0.15s ease-out;@keyframes cbfade{from{opacity:0;}to{opacity:1;}}`;
const ConfirmDialog = styled.div`width:100%;max-width:440px;background:#fff;border-radius:14px;box-shadow:0 24px 48px rgba(15,23,42,0.20);display:flex;flex-direction:column;overflow:hidden;animation:cbpop 0.18s ease-out;@keyframes cbpop{from{transform:translateY(8px);opacity:0.6;}to{transform:translateY(0);opacity:1;}}`;
const ConfirmTitle = styled.h2`font-size:16px;font-weight:700;color:#0f172a;margin:0;padding:18px 22px;border-bottom:1px solid #e2e8f0;`;
const ConfirmBody = styled.div`padding:18px 22px;font-size:13px;color:#334155;line-height:1.6;display:flex;flex-direction:column;gap:10px;`;
const WarnBlock = styled.div`margin-top:4px;padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:12px;`;
const ProjListUl = styled.ul`margin:6px 0 0 14px;padding:0;& li{margin-bottom:2px;}`;
const Caveat = styled.div`font-size:11px;color:#94a3b8;margin-top:4px;`;
const ConfirmFooter = styled.div`padding:14px 22px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px;background:#fafbfc;`;
const InviteBtn = styled.button`display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;background:#14B8A6;color:#FFF;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;&:hover{background:#0D9488;}`;
const Field = styled.div`display:flex;flex-direction:column;gap:4px;`;
const FieldLabel = styled.label`font-size:12px;font-weight:600;color:#0F172A;`;
const FieldInput = styled.input`height:38px;padding:0 12px;border:1px solid #E2E8F0;border-radius:8px;font-size:13px;color:#0F172A;font-family:inherit;background:#FFF;&:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.1);}&::placeholder{color:#CBD5E1;}`;
const Req = styled.span`color:#F43F5E;margin-left:2px;`;
const CFCancel = styled.button`height:40px;padding:0 16px;background:#fff;color:#475569;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;&:hover:not(:disabled){background:#f8fafc;border-color:#cbd5e1;}&:disabled{opacity:0.5;cursor:not-allowed;}`;
const CFPrimary = styled.button`height:40px;padding:0 20px;background:#14B8A6;color:#FFF;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;&:hover:not(:disabled){background:#0D9488;}&:disabled{background:#CBD5E1;cursor:not-allowed;}`;
const CFDanger = styled.button`height:40px;padding:0 20px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;&:hover:not(:disabled){background:#b91c1c;}&:disabled{background:#fca5a5;cursor:not-allowed;}`;
