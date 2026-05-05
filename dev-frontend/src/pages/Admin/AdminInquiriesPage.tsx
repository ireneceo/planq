// platform_admin 문의 인박스 — 랜딩 /contact 폼 + 게스트 Cue "문의 남기기" 통합 인박스
// 라우트: /admin/inquiries
// 기능: 상태별 탭 (new/in_progress/resolved/spam) + 종류 필터 + 상세 + 답변 노트 + 상태 변경
import { useEffect, useMemo, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../../components/Layout/PageShell';
import { Tabs, Tab } from '../../components/Common/TabComponents';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import DetailDrawer from '../../components/Common/DetailDrawer';
import EmptyState from '../../components/Common/EmptyState';
import { apiFetch } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { formatDateTime } from '../../utils/dateFormat';

type Status = 'new' | 'in_progress' | 'resolved' | 'spam';
type Kind = 'enterprise' | 'general' | 'landing';

interface InquiryItem {
  id: number;
  kind: Kind;
  source: string | null;
  business_id: number | null;
  from_user_id: number | null;
  from_name: string;
  from_email: string;
  from_company: string | null;
  from_phone: string | null;
  message: string;
  from_user_timezone: string | null;
  status: Status;
  reply_note: string | null;
  replied_at: string | null;
  replied_by_user_id: number | null;
  created_at: string;
  fromUser?: { id: number; name: string; email: string } | null;
  Business?: { id: number; name: string; brand_name: string | null } | null;
  repliedBy?: { id: number; name: string } | null;
}

const STATUSES: Status[] = ['new', 'in_progress', 'resolved', 'spam'];

const AdminInquiriesPage = () => {
  const { t, i18n } = useTranslation('common');
  const tf = useTimeFormat();  // 관리자 본인 워크스페이스 tz
  const adminLocale = i18n.language?.startsWith('en') ? 'en-US' : 'ko-KR';
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<InquiryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState<Status>('new');
  const [kindFilter, setKindFilter] = useState<Kind | 'all'>('all');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<InquiryItem | null>(null);
  const [replyNote, setReplyNote] = useState('');
  const [nextStatus, setNextStatus] = useState<Status>('in_progress');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set('status', activeStatus);
      if (kindFilter !== 'all') sp.set('kind', kindFilter);
      const r = await apiFetch(`/api/inquiries/admin?${sp.toString()}`);
      const j = await r.json();
      if (j.success) setItems(j.data || []);
    } finally { setLoading(false); }
  }, [activeStatus, kindFilter]);

  useEffect(() => { void load(); }, [load]);

  // URL ?inquiry=:id 으로 직접 진입 시 (관리자 알림 메일의 CTA)
  useEffect(() => {
    const idParam = params.get('inquiry');
    if (idParam && /^\d+$/.test(idParam)) setDetailId(Number(idParam));
  }, [params]);

  useEffect(() => {
    const it = items.find(x => x.id === detailId);
    setDetail(it || null);
    setReplyNote(it?.reply_note || '');
    setNextStatus(it?.status === 'new' ? 'in_progress' : (it?.status || 'in_progress'));
  }, [detailId, items]);

  const closeDetail = useCallback(() => {
    setDetailId(null);
    if (params.get('inquiry')) { params.delete('inquiry'); setParams(params, { replace: true }); }
  }, [params, setParams]);

  const submit = useCallback(async () => {
    if (!detail || submitting) return;
    setSubmitting(true);
    try {
      const r = await apiFetch(`/api/inquiries/admin/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, reply_note: replyNote }),
      });
      const j = await r.json();
      if (j.success) {
        await load();
        closeDetail();
      }
    } finally { setSubmitting(false); }
  }, [detail, submitting, nextStatus, replyNote, load, closeDetail]);

  const kindOptions: PlanQSelectOption[] = useMemo(() => [
    { value: 'all', label: t('adminInq.kindAll', '전체 종류') as string },
    { value: 'general', label: t('adminInq.kindGeneral', '일반 문의') as string },
    { value: 'landing', label: t('adminInq.kindLanding', '랜딩 페이지') as string },
    { value: 'enterprise', label: t('adminInq.kindEnterprise', '기업 문의') as string },
  ], [t]);

  return (
    <PageShell
      title={t('adminInq.title', '문의 인박스') as string}
      count={items.length}
      actions={
        <PlanQSelect
          size="sm" isSearchable={false}
          value={kindOptions.find(o => o.value === kindFilter)}
          options={kindOptions}
          onChange={(opt) => {
            const v = (opt as PlanQSelectOption | null)?.value as Kind | 'all' | undefined;
            setKindFilter(v || 'all');
          }}
        />
      }
    >
      <Tabs>
        {STATUSES.map(s => (
          <Tab key={s} active={activeStatus === s} onClick={() => setActiveStatus(s)}>
            {t(`adminInq.status.${s}`, statusLabel(s))}
          </Tab>
        ))}
      </Tabs>

      {loading ? (
        <Loading>{t('common.loading', '불러오는 중...')}</Loading>
      ) : items.length === 0 ? (
        <EmptyState
          icon="inbox"
          title={t('adminInq.empty', '이 상태의 문의가 없습니다') as string}
        />
      ) : (
        <List>
          {items.map(it => (
            <Row key={it.id} $active={detailId === it.id} onClick={() => setDetailId(it.id === detailId ? null : it.id)}>
              <RowHeader>
                <FromName>{it.from_name}</FromName>
                <KindTag>{kindLabel(it.kind, t)}</KindTag>
                <Spacer />
                <CreatedAt>{tf.formatDateTime(it.created_at)}</CreatedAt>
              </RowHeader>
              <FromInfo>
                {it.from_email}
                {it.from_company ? ` · ${it.from_company}` : ''}
                {it.from_phone ? ` · ${it.from_phone}` : ''}
                {it.source ? <SourceTag>· {it.source}</SourceTag> : null}
              </FromInfo>
              <Preview>{it.message.slice(0, 200)}{it.message.length > 200 ? '…' : ''}</Preview>
            </Row>
          ))}
        </List>
      )}

      {detail && (
        <DetailDrawer open={!!detail} onClose={closeDetail} width={520} ariaLabel={t('adminInq.detailAria', '문의 상세') as string}>
          <DetailDrawer.Header onClose={closeDetail}>
            <DetailTitle>
              <span>#{detail.id}</span>
              <DetailFromName>{detail.from_name}</DetailFromName>
              <KindTag>{kindLabel(detail.kind, t)}</KindTag>
            </DetailTitle>
          </DetailDrawer.Header>
          <DetailDrawer.Body>
            <DSection>
              <DLabel>{t('adminInq.dContact', '연락처')}</DLabel>
              <DValue>
                <a href={`mailto:${detail.from_email}`}>{detail.from_email}</a>
                {detail.from_phone ? ` · ${detail.from_phone}` : ''}
              </DValue>
              {detail.from_company && (
                <DValue><DLabelInline>{t('adminInq.dCompany', '회사')}</DLabelInline> {detail.from_company}</DValue>
              )}
              <DValue>
                <DLabelInline>{t('adminInq.dSource', '경로')}</DLabelInline> {detail.source || '—'}
                {detail.fromUser ? ` · ${t('adminInq.dLoggedIn', '로그인 사용자')}: ${detail.fromUser.name}` : ` · ${t('adminInq.dGuest', '게스트')}`}
              </DValue>
              <DValue>
                <DLabelInline>{t('adminInq.dCreated', '접수')}</DLabelInline>{' '}
                {tf.formatDateTime(detail.created_at)}{' '}
                <TzTag title={t('adminInq.dTzAdmin', '관리자 워크스페이스 시간') as string}>{tf.tz}</TzTag>
                {detail.from_user_timezone && detail.from_user_timezone !== tf.tz && (
                  <>
                    {' · '}
                    {formatDateTime(detail.created_at, detail.from_user_timezone, adminLocale)}{' '}
                    <TzTag title={t('adminInq.dTzUser', '문의자 워크스페이스 시간') as string}>{detail.from_user_timezone}</TzTag>
                  </>
                )}
              </DValue>
            </DSection>

            <DSection>
              <DLabel>{t('adminInq.dMessage', '문의 내용')}</DLabel>
              <DMessage>{detail.message}</DMessage>
            </DSection>

            <DSection>
              <DLabel>{t('adminInq.dStatus', '상태 변경')}</DLabel>
              <PlanQSelect
                size="sm" isSearchable={false}
                value={{ value: nextStatus, label: t(`adminInq.status.${nextStatus}`, statusLabel(nextStatus)) as string }}
                options={STATUSES.map(s => ({ value: s, label: t(`adminInq.status.${s}`, statusLabel(s)) as string }))}
                onChange={(opt) => {
                  const v = (opt as PlanQSelectOption | null)?.value as Status | undefined;
                  if (v) setNextStatus(v);
                }}
              />
            </DSection>

            <DSection>
              <DLabel>{t('adminInq.dReplyNote', '답변 노트 (내부)')}</DLabel>
              <ReplyTextarea
                value={replyNote}
                onChange={(e) => setReplyNote(e.target.value)}
                rows={6}
                placeholder={t('adminInq.dReplyPh', '내부 노트 — 어떻게 처리했는지 기록. 문의자에게 전달되지 않습니다. 회신은 별도로 메일에서 직접 보내주세요.') as string}
              />
              {detail.repliedBy && detail.replied_at && (
                <DMeta>
                  {t('adminInq.dRepliedBy', '마지막 처리')}: {detail.repliedBy.name} · {tf.formatDateTime(detail.replied_at)}
                </DMeta>
              )}
            </DSection>
          </DetailDrawer.Body>
          <DetailDrawer.Footer>
            <FooterRow>
              <a href={`mailto:${detail.from_email}?subject=Re: PlanQ 문의 %23${detail.id}`} target="_blank" rel="noreferrer">
                <SecondaryBtn type="button">{t('adminInq.dReplyEmail', '메일로 회신')}</SecondaryBtn>
              </a>
              <PrimaryBtn type="button" onClick={submit} disabled={submitting}>
                {submitting ? t('common.saving', '저장 중...') : t('adminInq.dSave', '저장')}
              </PrimaryBtn>
            </FooterRow>
          </DetailDrawer.Footer>
        </DetailDrawer>
      )}
    </PageShell>
  );
};

function statusLabel(s: Status): string {
  return s === 'new' ? '신규' : s === 'in_progress' ? '처리중' : s === 'resolved' ? '완료' : '스팸';
}

function kindLabel(k: Kind, t: (key: string, fallback: string) => string): string {
  return k === 'enterprise' ? t('adminInq.kindEnterprise', '기업')
    : k === 'landing' ? t('adminInq.kindLanding', '랜딩')
    : t('adminInq.kindGeneral', '일반');
}

export default AdminInquiriesPage;

// ─── styled ───
const Loading = styled.div`padding: 40px; text-align: center; color: #64748B; font-size: 14px;`;
const List = styled.div`display: flex; flex-direction: column; gap: 8px; padding: 16px 0;`;
const Row = styled.div<{ $active: boolean }>`
  border: 1px solid ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  background: ${p => p.$active ? '#F0FDFA' : '#FFFFFF'};
  border-radius: 10px;
  padding: 14px 16px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  &:hover { border-color: #14B8A6; }
`;
const RowHeader = styled.div`display: flex; align-items: center; gap: 8px;`;
const FromName = styled.div`font-size: 14px; font-weight: 700; color: #0F172A;`;
const KindTag = styled.span`
  font-size: 11px; font-weight: 600; color: #0F766E;
  padding: 2px 8px; background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 999px;
`;
const Spacer = styled.div`flex: 1;`;
const CreatedAt = styled.span`font-size: 12px; color: #94A3B8;`;
const FromInfo = styled.div`font-size: 12px; color: #64748B; margin-top: 4px;`;
const SourceTag = styled.span`color: #94A3B8; margin-left: 4px;`;
const Preview = styled.div`font-size: 13px; color: #334155; margin-top: 8px; line-height: 1.55;`;

const DetailTitle = styled.div`display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; color: #0F172A;`;
const DetailFromName = styled.span`font-weight: 700;`;
const DSection = styled.section`margin-bottom: 18px;`;
const DLabel = styled.div`font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px;`;
const DLabelInline = styled.span`font-size: 11px; font-weight: 600; color: #94A3B8;`;
const DValue = styled.div`font-size: 13px; color: #0F172A; line-height: 1.6; margin-bottom: 4px; a { color: #0D9488; }`;
const DMessage = styled.div`
  font-size: 13px; color: #0F172A; line-height: 1.7;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  padding: 12px 14px; white-space: pre-wrap;
`;
const ReplyTextarea = styled.textarea`
  width: 100%; box-sizing: border-box;
  border: 1px solid #E2E8F0; border-radius: 8px;
  padding: 10px 12px; font-size: 13px; color: #0F172A;
  font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const DMeta = styled.div`font-size: 11px; color: #94A3B8; margin-top: 6px;`;
const TzTag = styled.span`
  display: inline-block; padding: 1px 6px; margin-left: 2px;
  font-size: 10px; font-weight: 600; color: #475569;
  background: #F1F5F9; border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`;
const FooterRow = styled.div`display: flex; gap: 8px; justify-content: flex-end; width: 100%;`;
const PrimaryBtn = styled.button`
  padding: 8px 16px; background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 8px 16px; background: #FFFFFF; color: #475569;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; }
`;
