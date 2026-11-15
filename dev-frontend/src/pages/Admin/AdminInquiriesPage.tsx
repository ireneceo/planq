// platform_admin 문의 인박스 — 랜딩 /contact 폼 + 게스트 Cue "문의 남기기" 통합 인박스
// 라우트: /admin/inquiries
// 기능: 상태별 탭 (new/in_progress/resolved/spam) + 종류 필터 + 상세 + 답변 노트 + 상태 변경
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AdminReplyDraftButton from './AdminReplyDraftButton';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';
import DiagnosisStatsCard from '../../components/Admin/DiagnosisStatsCard';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { refreshAdminTodo } from '../../hooks/useAdminInboxCounts';
import PageShell from '../../components/Layout/PageShell';
import { Tabs, Tab } from '../../components/Common/TabComponents';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import DetailDrawer from '../../components/Common/DetailDrawer';
import EmptyState from '../../components/Common/EmptyState';
import { apiFetch } from '../../contexts/AuthContext';
import { clearDraftRecord } from '../../services/draftStore';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { formatDateTime } from '../../utils/dateFormat';
import ConfirmDialog from '../../components/Common/ConfirmDialog';

type Status = 'new' | 'in_progress' | 'resolved' | 'spam';
type Kind = 'enterprise' | 'general' | 'landing' | 'diagnosis' | 'onboarding_call';

// 화상 업무설계·사용안내 신청(kind onboarding_call)의 구조 칸 — 서버 services/onboardingCall.normalizeDetails 가 만든 모양.
interface CallDetails {
  slots?: { date: string; part: 'morning' | 'afternoon' | 'evening' }[];
  topics?: ('workflow' | 'migration')[];   // 2026-10-23 — 무엇을 도와드릴까요(옛 신청은 없음 = 둘 다)
  team_size?: string | null;
  current_tools?: string | null;
  focus?: string | null;
  timezone?: string | null;
  plan?: string | null;
  trial_ends_at?: string | null;
}

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
  details?: CallDetails | null;
  from_user_timezone: string | null;
  status: Status;
  reply_note: string | null;
  replied_at: string | null;
  replied_by_user_id: number | null;
  created_at: string;
  fromUser?: { id: number; name: string; email: string } | null;
  Business?: { id: number; name: string; brand_name: string | null } | null;
  repliedBy?: { id: number; name: string } | null;
  // PlanQ 가 직접 보낸 회신(contact_inquiry_replies) 중 보낸 것(sent) 수·마지막 시각 — 서버 목록이 센다.
  reply_count?: number | string;
  last_reply_sent_at?: string | null;
}

// 문의 직접 회신 기록 — 서버 services/inquiryReply.toView 모양. status 'unknown' = 5분 넘게 결과 없음(보내졌을 수 있다).
type ReplyStatus = 'sending' | 'sent' | 'failed' | 'skipped' | 'unknown';
interface InquiryReply {
  id: number;
  to_email: string;
  subject: string;
  body: string;
  status: ReplyStatus;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
  sent_by: { id: number; name: string } | null;
}

const STATUSES: Status[] = ['new', 'in_progress', 'resolved', 'spam'];

// 앱 안 «문의하기» 는 이 표(contact_inquiries)가 아니라 사용자 피드백 원장(feedback_items kind='inquiry')에 쌓인다.
//   (2026-11-02 Irene «문의 답변 완료한게 왜 문의인박스 완료탭에 안나와?») — 같은 탭에 같이 보여 주고, 누르면 그 원장의 상세로 간다.
//   상태 대응은 여기 한 곳: 새 문의 = 접수·검토중 / 진행 중 = 진행대기·반영중 / 처리 완료 = 완료·보류 / 스팸 = 없음.
type FbStatus = 'pending' | 'reviewing' | 'queued' | 'in_progress' | 'done' | 'wontfix';
const APP_INQ_STATUSES: Record<Status, FbStatus[]> = {
  new: ['pending', 'reviewing'],
  in_progress: ['queued', 'in_progress'],
  resolved: ['done', 'wontfix'],
  spam: [],
};
interface AppInquiry {
  id: number;
  parent_id: number | null;
  status: FbStatus;
  title: string;
  body: string;
  admin_response: string | null;
  created_at: string;
  user?: { id: number; name: string; email: string } | null;
}

const AdminInquiriesPage = () => {
  const { t, i18n } = useTranslation('common');
  const tf = useTimeFormat();  // 관리자 본인 워크스페이스 tz
  const adminLocale = i18n.language?.startsWith('en') ? 'en-US' : 'ko-KR';
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<InquiryItem[]>([]);
  const [appItems, setAppItems] = useState<AppInquiry[]>([]);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState<Status>('new');
  const [kindFilter, setKindFilter] = useState<Kind | 'all'>('all');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<InquiryItem | null>(null);
  const [replyNote, setReplyNote] = useState('');
  // 회신 — 쓰는 동안은 서버에 저장하지 않는다(내부 노트와 다르다). [PlanQ 에서 보내기] 가 이 글을 문의자에게 보내고,
  //   보낸 글은 서버 기록(contact_inquiry_replies)에 남는다.
  //   쓰다 닫아도 이 브라우저에 남는다(입력 초안 규칙) — 문의마다 따로, 처리 완료·스팸으로 저장하면 비운다.
  const replyDraftKey = useDraftKey('admin-inquiry-reply', detailId, 'platform');
  const inqReplyDraft = useDraftText(replyDraftKey);
  // 지금 열린 문의 — 비동기 응답(발송·기록 읽기)이 도착했을 때 «아직 그 문의인가» 를 본다(Fable 완료 검증 B2).
  const detailIdRef = useRef<number | null>(detailId);
  detailIdRef.current = detailId;
  // 노트·상태 선택을 마지막으로 채운 문의 — 닫으면 비운다(다시 열면 서버 값으로 다시 채운다)
  const filledIdRef = useRef<number | null>(null);
  // 기록 읽기 순번 — 같은 문의를 두 번 읽을 때 늦게 보낸 요청의 답만 쓴다(Fable 2차 N3)
  const repliesSeqRef = useRef(0);
  const replyDraft = inqReplyDraft.text;
  const setReplyDraft = inqReplyDraft.setText;
  const clearReplyDraft = inqReplyDraft.clear;
  const [nextStatus, setNextStatus] = useState<Status>('in_progress');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); }, [replyDraft]);
  // 보낸 회신 기록 · 보내기 확인창 · 결과 안내
  const [replies, setReplies] = useState<InquiryReply[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set('status', activeStatus);
      if (kindFilter !== 'all') sp.set('kind', kindFilter);
      const fbStatuses = kindFilter === 'all' ? APP_INQ_STATUSES[activeStatus] : [];
      const [r, ...fb] = await Promise.all([
        apiFetch(`/api/inquiries/admin?${sp.toString()}`),
        ...fbStatuses.map((st) => apiFetch(`/api/feedback/admin?kind=inquiry&status=${st}`)),
      ]);
      const j = await r.json();
      if (j.success) setItems(j.data || []);
      const fbRows: AppInquiry[] = [];
      for (const res of fb) {
        const fj = await res.json().catch(() => null);
        if (fj?.success && Array.isArray(fj.data)) fbRows.push(...fj.data);
      }
      fbRows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      setAppItems(fbRows);
    } finally { setLoading(false); }
  }, [activeStatus, kindFilter]);

  useEffect(() => { void load(); }, [load]);

  // URL ?inquiry=:id 으로 직접 진입 시 (관리자 알림 메일의 CTA)
  useEffect(() => {
    // ?status= — 확인 필요에서 «진행 중» 문의를 누르면 그 탭이어야 목록에서 찾는다
    const st = params.get('status') as Status | null;
    if (st && STATUSES.includes(st)) setActiveStatus(st);
    const idParam = params.get('inquiry');
    if (idParam && /^\d+$/.test(idParam)) setDetailId(Number(idParam));
  }, [params]);

  const loadReplies = useCallback(async (id: number) => {
    const seq = ++repliesSeqRef.current;
    try {
      const r = await apiFetch(`/api/inquiries/admin/${id}/replies`);
      const j = await r.json();
      if (detailIdRef.current !== id || seq !== repliesSeqRef.current) return;   // 그사이 다른 문의로 옮겼다 — 남의 기록을 그리지 않는다
      if (j.success && Array.isArray(j.data)) setReplies(j.data);
    } catch { /* 기록을 못 읽어도 상세는 보인다 */ }
  }, []);

  useEffect(() => {
    setReplies([]); setSendNote(null); setExpanded({}); setConfirmOpen(false);
    if (detailId) void loadReplies(detailId);
  }, [detailId, loadReplies]);

  const reasonText = useCallback((code: string | null) => {
    if (!code) return t('adminInq.reply.err.generic');
    if (code === 'sending_disabled' || code === 'smtp_not_configured') return t(`adminInq.reply.reason.${code}`);
    if (code.startsWith('blocked_')) return t('adminInq.reply.reason.blocked');
    return code;   // SMTP 오류 원문 — 관리자 화면이라 그대로 보인다
  }, [t]);

  const sendReply = useCallback(async () => {
    if (!detail || sending) return;
    setConfirmOpen(false);
    setSending(true);
    setSendNote(null);
    // 보낸 문의와 그 초안 키를 붙잡는다 — 응답이 올 때 다른 문의가 열려 있으면 그 문의 화면·초안을 건드리지 않는다.
    const sentId = detail.id;
    const sentKey = replyDraftKey;
    const stillHere = () => detailIdRef.current === sentId;
    try {
      const r = await apiFetch(`/api/inquiries/admin/${sentId}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: replyDraft }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.success) {
        const rep = j.data.reply as InquiryReply;
        if (rep.status === 'sent') {
          if (stillHere()) clearReplyDraft(); else clearDraftRecord(sentKey);
          if (stillHere()) {
            setSendNote({ tone: 'ok', text: t('adminInq.reply.sentOk') });
            // 서버가 new → in_progress 로 옮겼을 수 있다 — 열린 상세는 그 값으로(목록에서 빠져도 상세는 닫지 않는다, B1)
            const st = j.data.inquiry_status as Status | undefined;
            if (st) setDetail((d) => (d && d.id === sentId ? { ...d, status: st } : d));
          }
          void load(); refreshAdminTodo();
        } else if (stillHere()) {
          setSendNote({ tone: 'err', text: t('adminInq.reply.failedWith', { reason: reasonText(rep.error_message) }) });
        }
      } else if (stillHere()) {
        const code = String(j?.message || '');
        const known = ['duplicate_reply', 'reply_daily_limit', 'inquiry_spam', 'reply_body_too_long', 'reply_body_required', 'invalid_recipient'];
        const key = r.status === 429 && !known.includes(code) ? 'rate' : (known.includes(code) ? code : 'generic');
        setSendNote({ tone: 'err', text: t(`adminInq.reply.err.${key}`) });
      }
    } catch {
      if (stillHere()) setSendNote({ tone: 'err', text: t('adminInq.reply.err.generic') });
    } finally {
      setSending(false);
      // 성공·실패·응답 유실 모두 기록을 다시 읽는다 — 응답만 잃은 경우(행은 sending)도 확인창 경고가 붙게(Fable N1)
      void loadReplies(sentId);
    }
  }, [detail, sending, replyDraft, replyDraftKey, clearReplyDraft, t, reasonText, loadReplies, load]);

  useEffect(() => {
    const it = items.find(x => x.id === detailId);
    // 열린 문의가 목록 재조회로 빠졌을 때(회신을 보내 «새 문의» → «처리중» 으로 옮겨진 경우)는 상세를 닫지 않고
    //   쓰던 내부 노트·상태 선택도 그대로 둔다(Fable 완료 검증 B1). 다른 문의를 열거나 닫으면 종전대로.
    if (!it) {
      setDetail((d) => (d && detailId && d.id === detailId ? d : null));
      if (!detailId) filledIdRef.current = null;
      return;
    }
    setDetail(it);
    // 노트·상태 선택은 **열린 문의가 바뀔 때만** 서버 값으로 채운다 — 회신을 보낸 뒤 목록을 다시 읽어도
    //   쓰던 내부 노트·고른 상태가 덮이지 않게(Fable 2차 B1-b: «처리중» 탭에서 보낸 후속 회신).
    if (filledIdRef.current !== it.id) {
      filledIdRef.current = it.id;
      setReplyNote(it.reply_note || '');
      setNextStatus(it.status === 'new' ? 'in_progress' : it.status);
    }
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
        if (nextStatus === 'resolved' || nextStatus === 'spam') clearReplyDraft();
        await load();
        refreshAdminTodo();
        closeDetail();
      }
    } finally { setSubmitting(false); }
  }, [detail, submitting, nextStatus, replyNote, load, closeDetail, clearReplyDraft]);

  const kindOptions: PlanQSelectOption[] = useMemo(() => [
    { value: 'all', label: t('adminInq.kindAll', '전체 종류') as string },
    { value: 'general', label: t('adminInq.kindGeneral', '일반 문의') as string },
    { value: 'landing', label: t('adminInq.kindLanding', '랜딩 페이지') as string },
    { value: 'enterprise', label: t('adminInq.kindEnterprise', '기업 문의') as string },
    { value: 'diagnosis', label: t('adminInq.kindDiagnosis') as string },
    { value: 'onboarding_call', label: t('adminInq.kindOnboardingCall', '화상 안내 신청') as string },
  ], [t]);

  return (
    <PageShell
      title={t('adminInq.title', '문의 인박스') as string}
      count={items.length + appItems.length}
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

      {/* #426 자가진단 — 고른 종류가 자가진단이면 응답 통계를 위에 */}
      {kindFilter === 'diagnosis' && <DiagnosisStatsCard />}

      {loading ? (
        <Loading>{t('common.loading', '불러오는 중...')}</Loading>
      ) : items.length === 0 && appItems.length === 0 ? (
        <EmptyState
          icon={<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>}
          title={t('adminInq.empty', '이 상태의 문의가 없습니다') as string}
        />
      ) : (
        <>
        {appItems.length > 0 && (
          <List data-testid="admin-inq-app-list">
            <GroupLabel>{t('adminInq.appGroup', { count: appItems.length })}</GroupLabel>
            {appItems.map(it => (
              <Row key={`fb-${it.id}`} $active={false} data-testid="admin-inq-app-row"
                onClick={() => navigate(`/admin/feedback?id=${it.id}`)}>
                <RowHeader>
                  <FromName>{it.user?.name || '—'}</FromName>
                  <KindTag>{t('adminInq.appKind')}</KindTag>
                  {it.parent_id ? <KindTag>{t('adminInq.appFollowUp')}</KindTag> : null}
                  <Spacer />
                  <CreatedAt>{tf.formatDateTime(it.created_at)}</CreatedAt>
                </RowHeader>
                <FromInfo>
                  {it.user?.email || ''}
                  <SourceTag>· {t(`adminInq.appStatus.${it.status}`)}</SourceTag>
                  {it.admin_response ? <SourceTag>· {t('adminInq.appAnswered')}</SourceTag> : null}
                </FromInfo>
                <Preview>{it.title ? `${it.title} — ` : ''}{it.body.slice(0, 200)}{it.body.length > 200 ? '…' : ''}</Preview>
              </Row>
            ))}
          </List>
        )}
        {items.length > 0 && (
        <List>
          {appItems.length > 0 && <GroupLabel>{t('adminInq.webGroup', { count: items.length })}</GroupLabel>}
          {items.map(it => (
            <Row key={it.id} $active={detailId === it.id} onClick={() => setDetailId(it.id === detailId ? null : it.id)}>
              <RowHeader>
                <FromName>{it.from_name}</FromName>
                <KindTag>{kindLabel(it.kind, t)}</KindTag>
                {Number(it.reply_count || 0) > 0 && (
                  <ReplyTag title={it.last_reply_sent_at ? tf.formatDateTime(it.last_reply_sent_at) : undefined}>
                    {t('adminInq.reply.rowTag', { count: Number(it.reply_count) })}
                  </ReplyTag>
                )}
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
        </>
      )}

      {detail && (
        <DetailDrawer open={!!detail} onClose={closeDetail} ariaLabel={t('adminInq.detailAria', '문의 상세') as string}>
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

            {detail.kind === 'onboarding_call' && detail.details && (
              <DSection data-testid="admin-inq-call-details">
                <DLabel>{t('adminInq.call.title', '시작 안내 30분 신청 내용')}</DLabel>
                <CallTable>
                  <tbody>
                    <tr>
                      <th>{t('adminInq.call.topics', '주제')}</th>
                      <td>{(detail.details.topics && detail.details.topics.length ? detail.details.topics : ['workflow', 'migration'])
                        .map((k) => t(`onboardingCall.topic.${k}`)).join(' · ')}</td>
                    </tr>
                    <tr>
                      <th>{t('adminInq.call.slots', '희망 시간')}</th>
                      <td>
                        {(detail.details.slots || []).map((sl, i) => (
                          <div key={i}>{i + 1}. {sl.date} {t(`onboardingCall.part.${sl.part}`)}</div>
                        ))}
                        {detail.details.timezone && <TzTag>{detail.details.timezone}</TzTag>}
                      </td>
                    </tr>
                    <tr><th>{t('adminInq.call.team', '인원')}</th><td>{detail.details.team_size ? t(`onboardingCall.team.${detail.details.team_size}`) : '—'}</td></tr>
                    <tr><th>{t('adminInq.call.tools', '지금 쓰는 도구·자료 양')}</th><td>{detail.details.current_tools || '—'}</td></tr>
                    <tr><th>{t('adminInq.call.focus', '먼저 맞추고 싶은 일')}</th><td>{detail.details.focus || '—'}</td></tr>
                    <tr>
                      <th>{t('adminInq.call.workspace', '워크스페이스')}</th>
                      <td>{detail.Business ? (detail.Business.brand_name || detail.Business.name) : t('adminInq.call.noWorkspace', '가입 전(랜딩)')}</td>
                    </tr>
                    {detail.details.plan && (
                      <tr><th>{t('adminInq.call.plan', '체험 플랜')}</th><td>{detail.details.plan}</td></tr>
                    )}
                    {detail.details.trial_ends_at && (
                      <tr><th>{t('adminInq.call.trialEnds', '체험 종료')}</th><td>{tf.formatDateTime(detail.details.trial_ends_at)}</td></tr>
                    )}
                  </tbody>
                </CallTable>
              </DSection>
            )}

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
              <DLabel>{t('adminInq.dReplyDraft')}</DLabel>
              <ReplyTextarea
                {...inqReplyDraft.bind}
                rows={6}
                placeholder={t('adminInq.dReplyDraftPh') as string}
                data-testid="admin-inq-reply-draft"
              />
              <AdminReplyDraftButton key={detail.id} endpoint={`/api/inquiries/admin/${detail.id}/ai-draft`} value={replyDraft} onDraft={setReplyDraft} />
              <DraftActions>
                <SendBtn
                  type="button"
                  data-testid="admin-inq-reply-send"
                  disabled={sending || !replyDraft.trim() || detail.status === 'spam'}
                  title={detail.status === 'spam' ? t('adminInq.reply.spamDisabled') as string : (!replyDraft.trim() ? t('adminInq.reply.emptyDisabled') as string : undefined)}
                  onClick={() => setConfirmOpen(true)}
                >
                  {sending ? t('adminInq.reply.sending') : t('adminInq.reply.send')}
                </SendBtn>
                {replyDraft.trim() && (
                  <LinkBtn type="button" onClick={() => { void navigator.clipboard?.writeText(replyDraft).then(() => setCopied(true)).catch(() => {}); }}>
                    {copied ? t('adminInq.dReplyCopied') : t('adminInq.dReplyCopy')}
                  </LinkBtn>
                )}
              </DraftActions>
              {detail.status === 'spam' && <DMeta>{t('adminInq.reply.spamDisabled')}</DMeta>}
              {sendNote && <SendNote $tone={sendNote.tone} role="status" data-testid="admin-inq-reply-note">{sendNote.text}</SendNote>}
            </DSection>

            {replies.length > 0 && (
              <DSection data-testid="admin-inq-replies">
                <DLabel>{t('adminInq.reply.historyTitle', { count: replies.length })}</DLabel>
                <ReplyList>
                  {replies.map((rp) => {
                    const long = rp.body.length > 240 || rp.body.split('\n').length > 4;
                    const open = !!expanded[rp.id];
                    return (
                      <ReplyItem key={rp.id} data-testid="admin-inq-reply-row">
                        <ReplyHead>
                          <ReplyStatusChip $s={rp.status}>{t(`adminInq.reply.status.${rp.status}`)}</ReplyStatusChip>
                          <ReplyMeta>{tf.formatDateTime(rp.sent_at || rp.created_at)}</ReplyMeta>
                        </ReplyHead>
                        <ReplyMeta>{t('adminInq.reply.by', { name: rp.sent_by?.name || '—', email: rp.to_email })}</ReplyMeta>
                        <ReplyBody $clamp={long && !open}>{rp.body}</ReplyBody>
                        {long && (
                          <LinkBtn type="button" onClick={() => setExpanded((m) => ({ ...m, [rp.id]: !open }))}>
                            {open ? t('adminInq.reply.less') : t('adminInq.reply.more')}
                          </LinkBtn>
                        )}
                        {(rp.status === 'failed' || rp.status === 'skipped') && rp.error_message && (
                          <ReplyError>{reasonText(rp.error_message)}</ReplyError>
                        )}
                      </ReplyItem>
                    );
                  })}
                </ReplyList>
              </DSection>
            )}

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
              <PrimaryBtn type="button" onClick={submit} disabled={submitting}>
                {submitting ? t('common.saving', '저장 중...') : t('adminInq.dSave', '저장')}
              </PrimaryBtn>
            </FooterRow>
          </DetailDrawer.Footer>
        </DetailDrawer>
      )}
      {detail && (
        <ConfirmDialog
          isOpen={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => { void sendReply(); }}
          title={t('adminInq.reply.confirmTitle')}
          message={`${t('adminInq.reply.confirmMsg', { name: detail.from_name, email: detail.from_email })}${replies.some((r) => r.status === 'unknown' || r.status === 'sending') ? `\n\n${t('adminInq.reply.confirmUnknown')}` : ''}`}
          confirmText={t('adminInq.reply.confirmOk')}
          cancelText={t('adminInq.reply.cancel')}
          variant={replies.some((r) => r.status === 'unknown' || r.status === 'sending') ? 'warning' : 'info'}
        />
      )}
    </PageShell>
  );
};

const CallTable = styled.table`
  width: 100%; border-collapse: collapse; font-size: 0.8125rem; color: #334155;
  th { text-align: left; font-weight: 600; color: #64748B; padding: 6px 12px 6px 0; width: 112px; vertical-align: top; white-space: nowrap; }
  td { padding: 6px 0; vertical-align: top; word-break: break-word; }
  tr + tr th, tr + tr td { border-top: 1px solid #F1F5F9; }
`;

function statusLabel(s: Status): string {
  return s === 'new' ? '신규' : s === 'in_progress' ? '처리중' : s === 'resolved' ? '완료' : '스팸';
}

function kindLabel(k: Kind, t: (key: string, fallback: string) => string): string {
  return k === 'enterprise' ? t('adminInq.kindEnterprise', '기업')
    : k === 'onboarding_call' ? t('adminInq.kindOnboardingCallShort', '화상 안내')
    : k === 'diagnosis' ? t('adminInq.kindDiagnosisShort', '자가진단')
    : k === 'landing' ? t('adminInq.kindLanding', '랜딩')
    : t('adminInq.kindGeneral', '일반');
}

export default AdminInquiriesPage;

// ─── styled ───
const Loading = styled.div`padding: 40px; text-align: center; color: #64748B; font-size: 0.875rem;`;
const List = styled.div`display: flex; flex-direction: column; gap: 8px; padding: 16px 0;`;
const GroupLabel = styled.div`font-size: 0.75rem; font-weight: 700; color: #64748B; padding: 0 2px;`;
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
const FromName = styled.div`font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const KindTag = styled.span`
  font-size: 0.6875rem; font-weight: 600; color: #0F766E;
  padding: 2px 8px; background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 999px;
`;
const Spacer = styled.div`flex: 1;`;
const CreatedAt = styled.span`font-size: 0.75rem; color: #94A3B8;`;
const FromInfo = styled.div`font-size: 0.75rem; color: #64748B; margin-top: 4px;`;
const SourceTag = styled.span`color: #94A3B8; margin-left: 4px;`;
const Preview = styled.div`font-size: 0.8125rem; color: #334155; margin-top: 8px; line-height: 1.55;`;

const DetailTitle = styled.div`display: flex; align-items: center; gap: 8px; font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const DetailFromName = styled.span`font-weight: 700;`;
const DSection = styled.section`margin-bottom: 18px;`;
const DLabel = styled.div`font-size: 0.6875rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px;`;
const DLabelInline = styled.span`font-size: 0.6875rem; font-weight: 600; color: #94A3B8;`;
const DValue = styled.div`font-size: 0.8125rem; color: #0F172A; line-height: 1.6; margin-bottom: 4px; a { color: #0D9488; }`;
const DMessage = styled.div`
  font-size: 0.8125rem; color: #0F172A; line-height: 1.7;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  padding: 12px 14px; white-space: pre-wrap;
`;
const ReplyTextarea = styled.textarea`
  width: 100%; box-sizing: border-box;
  border: 1px solid #E2E8F0; border-radius: 8px;
  padding: 10px 12px; font-size: 0.8125rem; color: #0F172A;
  font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const DraftActions = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px; & > div { margin-top: 0; }`;
const LinkBtn = styled.button`border: none; background: none; padding: 0; color: #0D9488; font-size: 0.75rem; font-weight: 600; cursor: pointer; text-decoration: underline;`;
const DMeta = styled.div`font-size: 0.6875rem; color: #94A3B8; margin-top: 6px;`;
const TzTag = styled.span`
  display: inline-block; padding: 1px 6px; margin-left: 2px;
  font-size: 0.625rem; font-weight: 600; color: #475569;
  background: #F1F5F9; border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`;
const ReplyTag = styled.span`
  font-size: 0.6875rem; font-weight: 600; color: #475569;
  padding: 2px 8px; background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 999px;
`;
const SendBtn = styled.button`
  padding: 8px 14px; background: #FFFFFF; color: #0F766E;
  border: 1px solid #14B8A6; border-radius: 8px; font-size: 0.8125rem; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #F0FDFA; }
  &:disabled { color: #94A3B8; border-color: #E2E8F0; cursor: not-allowed; }
`;
const SendNote = styled.div<{ $tone: 'ok' | 'err' }>`
  margin-top: 8px; font-size: 0.75rem; font-weight: 600; line-height: 1.5;
  color: ${p => p.$tone === 'ok' ? '#0F766E' : '#B91C1C'};
`;
const ReplyList = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const ReplyItem = styled.div`border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px; background: #FFFFFF;`;
const ReplyHead = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const ReplyMeta = styled.div`font-size: 0.6875rem; color: #64748B; margin-top: 2px;`;
const ReplyBody = styled.div<{ $clamp: boolean }>`
  margin-top: 6px; font-size: 0.8125rem; color: #0F172A; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
  ${p => p.$clamp ? 'display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;' : ''}
`;
const ReplyError = styled.div`margin-top: 6px; font-size: 0.75rem; color: #B91C1C;`;
const REPLY_CHIP: Record<ReplyStatus, [string, string, string]> = {
  sent: ['#0F766E', '#F0FDFA', '#99F6E4'],
  failed: ['#B91C1C', '#FEF2F2', '#FECACA'],
  skipped: ['#475569', '#F1F5F9', '#E2E8F0'],
  sending: ['#475569', '#F1F5F9', '#E2E8F0'],
  unknown: ['#B45309', '#FFFBEB', '#FDE68A'],
};
const ReplyStatusChip = styled.span<{ $s: ReplyStatus }>`
  font-size: 0.6875rem; font-weight: 700; padding: 2px 8px; border-radius: 999px;
  color: ${p => REPLY_CHIP[p.$s][0]}; background: ${p => REPLY_CHIP[p.$s][1]}; border: 1px solid ${p => REPLY_CHIP[p.$s][2]};
`;
const FooterRow = styled.div`display: flex; gap: 8px; justify-content: flex-end; width: 100%;`;
const PrimaryBtn = styled.button`
  padding: 8px 16px; background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px; font-size: 0.8125rem; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
