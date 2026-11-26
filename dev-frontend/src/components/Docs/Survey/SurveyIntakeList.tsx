// 설문 «응답» 탭 위 접수함 — 응답마다 [사건 만들기] (2026-11-26 · docs/INTAKE_AUTO_CASE_DESIGN.md §6)
//   정본 진입점: 응답 목록의 [사건 만들기]. 만드는 사람 = 누른 사람(서버 services/intakeCase).
//   기존 고객과 이메일이 같아도 저절로 잇지 않는다 — 창에서 [연결]/[새 잠재 고객]/[연결 안 함] 을 고른다.
//   실시간: record:row(응답·사건) 신호에 다시 읽기 + 탭 복귀 다시 읽기.
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import StandardModal from '../../Common/StandardModal';
import ModalActionButton from '../../Common/ModalActionButton';
import { fetchRecord, type QRecordRow } from '../../../services/qtable';
import {
  fetchIntakeCases, fetchIntakePreview, createIntakeCase,
  IntakeApiError, type IntakeCaseView, type IntakePreview,
} from '../../../services/intake';
import { onSocket } from '../../../services/socket';
import { useVisibilityRefresh } from '../../../hooks/useVisibilityRefresh';
import { tabStore } from '../../../stores/tabStore';
import { formatDayTime } from '../../../utils/dateFormat';

const PAGE = 20;
type Choice = 'link' | 'new' | 'none';

interface Props { recordId: number }

const SurveyIntakeList: React.FC<Props> = ({ recordId }) => {
  const { t } = useTranslation('qtable');
  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState<QRecordRow[]>([]);
  const [cases, setCases] = useState<Record<string, IntakeCaseView>>({});
  const [orphans, setOrphans] = useState<IntakeCaseView[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [openRow, setOpenRow] = useState<QRecordRow | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const r = await fetchRecord(recordId);
    if (!r) return;
    const sorted = [...(r.rows || [])].sort((a, b) => b.id - a.id);
    setRows(sorted);
    try {
      const c = await fetchIntakeCases(recordId, sorted.slice(0, 500).map((x) => x.id));
      setEnabled(c.enabled); setCases(c.cases || {}); setOrphans(c.orphans || []);
    } catch { setEnabled(false); }
  }, [recordId]);
  const silent = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { load().catch(() => null); }, 250);
  }, [load]);
  useEffect(() => { load().catch(() => null); }, [load]);
  useEffect(() => onSocket<{ id: number }>('record:row', (p) => { if (p?.id === recordId) silent(); }), [recordId, silent]);
  useVisibilityRefresh(silent);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  if (!enabled) return null;
  const list = rows.slice(0, shown);
  const waiting = rows.filter((r) => !cases[r.id] || cases[r.id].status !== 'done').length;

  return (
    <Box data-testid="survey-intake-list">
      <Head>
        <Title>{t('intake.inboxTitle', '접수함')}</Title>
        <Count>{t('intake.inboxCount', { defaultValue: '사건 안 만든 응답 {{n}}건', n: waiting }) as string}</Count>
      </Head>
      {rows.length === 0 && <Empty>{t('intake.inboxEmpty', '아직 응답이 없어요.')}</Empty>}
      {list.map((r) => {
        const c = cases[r.id];
        return (
          <Item key={r.id} data-testid={`intake-row-${r.id}`}>
            <Main>
              <Who>{rowLabel(r) || t('intake.noName', '이름 없는 응답')}</Who>
              <When>{formatDayTime(r.created_at)}</When>
            </Main>
            {c && c.status === 'done' && c.project_id ? (
              <LinkBtn type="button" data-testid={`intake-open-${r.id}`} onClick={() => tabStore.openInNewTab(`/projects/p/${c.project_id}`)}>
                {t('intake.openCase', '사건 보기 →')}
              </LinkBtn>
            ) : c && c.status === 'error' && c.error === 'tasks_partial' && c.project_id ? (
              <Act>
                <ErrNote data-testid={`intake-partial-${r.id}`}>{t('intake.partial', { defaultValue: '업무가 일부만 만들어졌어요({{n}}개) — 프로젝트에서 확인해 주세요', n: c.task_count }) as string}</ErrNote>
                <LinkBtn type="button" data-testid={`intake-open-${r.id}`} onClick={() => tabStore.openInNewTab(`/projects/p/${c.project_id}`)}>
                  {t('intake.openCase', '사건 보기 →')}
                </LinkBtn>
              </Act>
            ) : (
              <Act>
                {c && c.status === 'error' && <ErrNote>{errText(t, c.error)}</ErrNote>}
                {c && c.status === 'running' && !c.stale
                  ? <Busy>{t('intake.running', '만드는 중…')}</Busy>
                  : (
                    <MakeBtn type="button" data-testid={`intake-make-${r.id}`} onClick={() => setOpenRow(r)}>
                      {c && (c.status === 'error' || c.stale) ? t('intake.retry', '다시 만들기') : t('intake.make', '사건 만들기')}
                    </MakeBtn>
                  )}
              </Act>
            )}
          </Item>
        );
      })}
      {orphans.length > 0 && (
        <>
          <OrphanHead>{t('intake.orphanTitle', '원 응답이 지워진 사건')}</OrphanHead>
          {orphans.map((c) => (
            <Item key={`o-${c.id}`} data-testid={`intake-orphan-${c.id}`}>
              <Main>
                <Who>{c.project_name || t('intake.noName', '이름 없는 응답')}</Who>
                <When>{t('intake.orphanNote', '원 응답 삭제됨')} · {formatDayTime(c.created_at)}</When>
              </Main>
              {c.project_id && (
                <LinkBtn type="button" onClick={() => tabStore.openInNewTab(`/projects/p/${c.project_id}`)}>{t('intake.openCase', '사건 보기 →')}</LinkBtn>
              )}
            </Item>
          ))}
        </>
      )}
      {rows.length > shown && <More type="button" onClick={() => setShown((n) => n + PAGE)}>{t('intake.more', '더 보기')}</More>}
      {openRow && <MakeCaseModal row={openRow} onClose={() => setOpenRow(null)} onDone={() => { setOpenRow(null); load().catch(() => null); }} />}
    </Box>
  );
};

export default SurveyIntakeList;

/** 줄 이름 — 첫 글자 칸 값(응답 목록에서 누구인지 알아볼 만큼만) */
function rowLabel(r: QRecordRow): string {
  if (r.respondent && (r.respondent.name || r.respondent.email)) return String(r.respondent.name || r.respondent.email);
  const vals = r.values || {};
  for (const v of Object.values(vals)) {
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 60);
  }
  return '';
}

function errText(t: TFunction<'qtable'>, code: string | null): string {
  const known = ['tasks_partial', 'prospect_limit', 'project_limit', 'clients_forbidden', 'client_not_candidate', 'client_no_contact', 'intake_template', 'intake_off', 'intake_anonymous', 'intake_in_progress'];
  const k = code && known.includes(code) ? code : 'failed';
  return t(`intake.err.${k}`) as string;
}

const MakeCaseModal: React.FC<{ row: QRecordRow; onClose: () => void; onDone: () => void }> = ({ row, onClose, onDone }) => {
  const { t } = useTranslation('qtable');
  const [pv, setPv] = useState<IntakePreview | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>('none');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchIntakePreview(row.id).then((p) => { if (alive) setPv(p); })
      .catch((e) => { if (alive) setLoadErr(e instanceof IntakeApiError ? e.code : 'failed'); });
    return () => { alive = false; };
  }, [row.id]);

  const match = pv ? (pv.email_match || pv.phone_match) : null;
  const submit = async () => {
    if (!pv || submitting) return;
    setSubmitting(true); setErr(null);
    try {
      await createIntakeCase(row.id, choice === 'link' && match ? { client_choice: 'link', client_id: match.id } : { client_choice: choice === 'link' ? 'none' : choice });
      onDone();
    } catch (e) {
      setErr(errText(t, e instanceof IntakeApiError ? e.code : null));
    } finally { setSubmitting(false); }
  };

  return (
    <StandardModal open onClose={onClose} size="md" title={t('intake.modalTitle', '사건 만들기') as string} ariaLabel={t('intake.modalTitle', '사건 만들기') as string}
      footer={(
        <>
          <ModalActionButton variant="secondary" onClick={onClose}>{t('intake.cancel', '취소')}</ModalActionButton>
          <ModalActionButton variant="primary" data-testid="intake-confirm" disabled={!pv || !pv.enabled || submitting} onClick={submit}>
            {submitting ? t('intake.creating', '만드는 중…') : t('intake.confirm', '만들기')}
          </ModalActionButton>
        </>
      )}>
      {loadErr && <ErrBox role="alert">{errText(t, loadErr)}</ErrBox>}
      {!pv && !loadErr && <Muted>{t('intake.loading', '불러오는 중…')}</Muted>}
      {pv && (
        <Sheet data-testid="intake-preview">
          <Kv><K>{t('intake.pvProject', '만들 프로젝트')}</K><V>{pv.project_name}</V></Kv>
          <Kv><K>{t('intake.pvTemplate', '업무 템플릿')}</K>
            <V>{pv.template ? t('intake.pvTemplateVal', { defaultValue: '{{name}} · 업무 {{n}}개', name: pv.template.name, n: pv.template.item_count }) as string : t('intake.err.intake_template')}</V>
          </Kv>
          {(pv.contact.name || pv.contact.email || pv.contact.phone || pv.contact.company) && (
            <Kv><K>{t('intake.pvContact', '응답자')}</K>
              <V>{[pv.contact.name, pv.contact.company, pv.contact.email, pv.contact.phone].filter(Boolean).join(' · ')}</V>
            </Kv>
          )}
          <K>{t('intake.pvClient', '고객 연결')}</K>
          {pv.recipient_client ? (
            <Note>{t('intake.recipientClient', { defaultValue: '설문을 보낸 고객 «{{name}}» 에 연결돼요.', name: pv.recipient_client.name || '' }) as string}</Note>
          ) : !pv.can_touch_clients ? (
            <Note>{t('intake.noClientPerm', '고객을 잇거나 만들려면 Q sale 쓰기 권한이 필요해요. 이번에는 고객 없이 만들어요.')}</Note>
          ) : (
            <Choices role="radiogroup" aria-label={t('intake.pvClient', '고객 연결') as string}>
              {match && (
                <Radio data-testid="intake-choice-link">
                  <input type="radio" name="intake-client" checked={choice === 'link'} onChange={() => setChoice('link')} />
                  <span>
                    {t('intake.choiceLink', { defaultValue: '기존 고객 «{{name}}» 과 연결', name: match.name || '' }) as string}
                    <Sub>{pv.email_match ? t('intake.matchEmail', '이메일이 같아요 · 본인 확인은 안 된 주소예요') : t('intake.matchPhone', '전화번호가 같아요 · 후보일 뿐이에요')}</Sub>
                  </span>
                </Radio>
              )}
              <Radio data-testid="intake-choice-new">
                <input type="radio" name="intake-client" checked={choice === 'new'} onChange={() => setChoice('new')} />
                <span>{t('intake.choiceNew', '새 잠재 고객으로 추가')}</span>
              </Radio>
              <Radio data-testid="intake-choice-none">
                <input type="radio" name="intake-client" checked={choice === 'none'} onChange={() => setChoice('none')} />
                <span>{t('intake.choiceNone', '고객 연결 안 함')}</span>
              </Radio>
            </Choices>
          )}
          <Muted>{t('intake.pvNote', '프로젝트는 나만 보이는 범위로 만들어지고, 템플릿 업무는 오늘부터 일정이 잡혀요. 고객에게 메일은 가지 않아요.')}</Muted>
          {err && <ErrBox role="alert">{err}</ErrBox>}
        </Sheet>
      )}
    </StandardModal>
  );
};

const Box = styled.div`border: 1px solid #E2E8F0; border-radius: 12px; background: #FFF; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; min-width: 0;`;
const Head = styled.div`display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;`;
const Title = styled.div`font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const Count = styled.div`font-size: 0.75rem; color: #64748B;`;
const Empty = styled.div`font-size: 0.8125rem; color: #94A3B8; padding: 6px 0;`;
const Item = styled.div`display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid #F1F5F9; min-width: 0;
  @media (max-width: 640px) { flex-wrap: wrap; }
`;
const Main = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const Who = styled.div`font-size: 0.875rem; font-weight: 600; color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const When = styled.div`font-size: 0.75rem; color: #94A3B8;`;
const Act = styled.div`display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-left: auto;`;
const MakeBtn = styled.button`
  height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid #14B8A6; background: #FFF; color: #0F766E;
  font-size: 0.8125rem; font-weight: 700; cursor: pointer; white-space: nowrap;
  &:hover { background: #F0FDFA; }
  @media (max-width: 640px) { height: 40px; }
`;
const LinkBtn = styled.button`
  height: 32px; padding: 0 8px; border: 0; background: transparent; color: #0F766E; font-size: 0.8125rem; font-weight: 600; cursor: pointer; white-space: nowrap; margin-left: auto;
  &:hover { text-decoration: underline; }
  @media (max-width: 640px) { height: 40px; }
`;
const OrphanHead = styled.div`font-size: 0.75rem; font-weight: 700; color: #64748B; padding-top: 8px;`;
const Busy = styled.span`font-size: 0.8125rem; color: #64748B;`;
const ErrNote = styled.span`font-size: 0.75rem; color: #B91C1C;`;
const More = styled.button`align-self: flex-start; height: 32px; padding: 0 10px; border: 0; background: transparent; color: #0F766E; font-size: 0.8125rem; cursor: pointer;`;
const Sheet = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const Kv = styled.div`display: flex; flex-direction: column; gap: 2px;`;
const K = styled.div`font-size: 0.75rem; font-weight: 700; color: #475569;`;
const V = styled.div`font-size: 0.875rem; color: #0F172A; word-break: break-word;`;
const Note = styled.div`font-size: 0.8125rem; color: #334155; background: #F8FAFC; border-radius: 8px; padding: 8px 10px;`;
const Choices = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Radio = styled.label`display: flex; align-items: flex-start; gap: 8px; font-size: 0.875rem; color: #0F172A; cursor: pointer; min-height: 32px;
  input { margin-top: 3px; accent-color: #14B8A6; }
`;
const Sub = styled.div`font-size: 0.75rem; color: #B45309;`;
const Muted = styled.div`font-size: 0.75rem; color: #94A3B8; line-height: 1.5;`;
const ErrBox = styled.div`font-size: 0.8125rem; color: #B91C1C; background: #FEF2F2; border-radius: 8px; padding: 8px 10px;`;
