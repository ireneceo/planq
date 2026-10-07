// 설문 설정 서랍 (#460) — 표 문서의 «설문으로 받기». 설계 docs/SURVEY_DESIGN.md
//
// 껍데기는 DetailDrawer(우측 상세 표준), 입력은 AutoSaveField(저장 버튼 없음).
// 열기·닫기만 버튼이다 — 링크가 생기고 죽는 **행위**라 자동저장이 아니다(닫기는 확인을 받는다).
import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../Common/DetailDrawer';
import AutoSaveField from '../Common/AutoSaveField';
import ActionButton from '../Common/ActionButton';
import ConfirmDialog from '../Common/ConfirmDialog';
import SingleDateField from '../Common/SingleDateField';
import { fetchSurvey, saveSurvey, type SurveySettings, type SurveyView, type QRecordColumn } from '../../services/qtable';

interface Props {
  open: boolean;
  onClose: () => void;
  recordId: number;
  columns: QRecordColumn[];
  onChanged?: (v: SurveyView) => void;
}

const SurveyDrawer: React.FC<Props> = ({ open, onClose, recordId, columns, onChanged }) => {
  const { t } = useTranslation('qtable');
  const [view, setView] = useState<SurveyView | null>(null);
  const [st, setSt] = useState<SurveySettings>({});
  const stRef = useRef<SurveySettings>({});
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const apply = (v: SurveyView) => { setView(v); setSt(v.settings || {}); stRef.current = v.settings || {}; onChanged?.(v); };
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchSurvey(recordId).then((v) => { if (alive && v) apply(v); }).catch(() => { if (alive) setErr(t('survey.loadFailed', '설문 설정을 불러오지 못했어요.')); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recordId]);

  // 화면 값 → ref(저장은 ref 를 읽는다 — 클릭으로 이미 뒤집힌 값을 저장해야 한다)
  const stage = (patch: SurveySettings) => { const next = { ...stRef.current, ...patch }; stRef.current = next; setSt(next); };
  const persist = async (keys: (keyof SurveySettings)[]) => {
    const body: SurveySettings = {};
    keys.forEach((k) => { (body as Record<string, unknown>)[k] = stRef.current[k] ?? null; });
    const v = await saveSurvey(recordId, { settings: body });
    // 저장 응답은 조회와 같은 모양(surveyView)이지만, 통째 대입 대신 합친다(가드 savemerge 규칙)
    setView((prev) => (prev ? { ...prev, ...v } : v)); onChanged?.(v);
  };

  const toggleIn = (key: 'required' | 'hidden', id: string) => {
    const cur = new Set(stRef.current[key] || []);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    stage({ [key]: [...cur] } as SurveySettings);
  };

  const setEnabled = async (on: boolean) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { apply(await saveSurvey(recordId, { enabled: on })); }
    catch (e) {
      setErr((e as Error).message === 'security_level_blocks'
        ? t('survey.blocked', '보안등급이 «일반» 이 아닌 문서는 밖에서 응답을 받을 수 없어요.')
        : t('survey.saveFailed', '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally { setBusy(false); }
  };

  const url = view?.path ? `${window.location.origin}${view.path}` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* 복사 실패 — 링크 글자를 직접 고를 수 있다 */ }
  };
  const qCols = columns.filter((c) => c.type !== 'secret');
  const closesDay = st.closes_at ? st.closes_at.slice(0, 10) : '';

  return (
    <DetailDrawer open={open} onClose={onClose} ariaLabel={t('survey.title', '설문으로 받기') as string}>
      <DetailDrawer.Header onClose={onClose}>{t('survey.title', '설문으로 받기')}</DetailDrawer.Header>
      <DetailDrawer.Body>
        <Lead>{t('survey.lead', '링크를 받은 누구나 로그인 없이 응답할 수 있어요. 응답 1건이 이 표의 한 줄이 되고, 응답은 이 문서를 볼 수 있는 사람만 봅니다.')}</Lead>
        {err && <Err role="alert">{err}</Err>}
        {!view ? null : (
          <>
            <Section>
              <Row>
                <Status $on={view.enabled}>{view.enabled ? t('survey.on', '응답 받는 중') : t('survey.off', '꺼짐')}</Status>
                <Count>{t('survey.count', { defaultValue: '응답 {{n}}건', n: view.response_count }) as string}</Count>
              </Row>
              {view.blocked && <Warn>{t('survey.blocked', '보안등급이 «일반» 이 아닌 문서는 밖에서 응답을 받을 수 없어요.')}</Warn>}
              {view.enabled && (
                <>
                  <LinkBox data-testid="survey-link">{url}</LinkBox>
                  <Row>
                    {/* autosave-exempt: 링크 복사·열기·닫기는 행위 버튼이다 */}
                    <ActionButton tone="primary" size="sm" onClick={copy} data-testid="survey-copy">{copied ? t('survey.copied', '복사됨') : t('survey.copy', '링크 복사')}</ActionButton>
                    <ActionButton tone="secondary" size="sm" onClick={() => window.open(url, '_blank', 'noopener')}>{t('survey.preview', '응답 화면 보기')}</ActionButton>
                    <ActionButton tone="danger" size="sm" onClick={() => setConfirmOff(true)} disabled={busy}>{t('survey.close', '설문 닫기')}</ActionButton>
                  </Row>
                </>
              )}
              {!view.enabled && !view.blocked && (
                <ActionButton tone="primary" size="md" onClick={() => setEnabled(true)} loading={busy} data-testid="survey-open">{t('survey.open', '설문 열기')}</ActionButton>
              )}
            </Section>

            <Section>
              <Label>{t('survey.formTitle', '설문 제목')}</Label>
              <AutoSaveField type="input" onSave={() => persist(['title'])}>
                <Input value={st.title || ''} maxLength={200} onChange={(e) => stage({ title: e.target.value })} />
              </AutoSaveField>
              <Label>{t('survey.intro', '안내문')}</Label>
              <AutoSaveField type="input" onSave={() => persist(['intro'])}>
                <TextArea rows={3} value={st.intro || ''} maxLength={2000} onChange={(e) => stage({ intro: e.target.value })}
                  placeholder={t('survey.introPh', '응답자에게 보일 설명 (선택)') as string} />
              </AutoSaveField>
            </Section>

            <Section>
              <Label>{t('survey.questions', '문항 — 표의 칸')}</Label>
              <Hint>{t('survey.questionsHint', '칸을 더하거나 고치면 문항도 바뀝니다. «숨김» 칸은 응답 화면에 나오지 않아요(담당·처리 상태 같은 내부용). 비밀 칸은 항상 빠집니다.')}</Hint>
              {qCols.length === 0 && <Hint>{t('survey.noColumns', '먼저 표에 칸을 추가하세요.')}</Hint>}
              {qCols.map((c) => {
                const req = (st.required || []).includes(c.id);
                const hid = (st.hidden || []).includes(c.id);
                return (
                  <QRow key={c.id}>
                    <QName>{c.name}</QName>
                    <AutoSaveField type="toggle" onSave={() => persist(['required'])}>
                      <Chip type="button" role="switch" aria-checked={req} $on={req} onClick={() => toggleIn('required', c.id)}>{t('survey.required', '필수')}</Chip>
                    </AutoSaveField>
                    <AutoSaveField type="toggle" onSave={() => persist(['hidden'])}>
                      <Chip type="button" role="switch" aria-checked={hid} $on={hid} onClick={() => toggleIn('hidden', c.id)}>{t('survey.hidden', '숨김')}</Chip>
                    </AutoSaveField>
                  </QRow>
                );
              })}
            </Section>

            <Section>
              <Label>{t('survey.closesAt', '마감일')}</Label>
              <AutoSaveField type="select" onSave={() => persist(['closes_at'])}>
                <SingleDateField value={closesDay} onChange={(d) => stage({ closes_at: d ? new Date(`${d}T23:59:59`).toISOString() : null })} />
              </AutoSaveField>
              <Label>{t('survey.maxResponses', { defaultValue: '최대 응답 수 (최대 {{n}})', n: view.hard_cap }) as string}</Label>
              <AutoSaveField type="input" onSave={() => persist(['max_responses'])}>
                <Input inputMode="numeric" value={st.max_responses ? String(st.max_responses) : ''}
                  placeholder={t('survey.maxPh', '비워 두면 제한 없음') as string}
                  onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); stage({ max_responses: Number.isFinite(n) && n > 0 ? n : null }); }} />
              </AutoSaveField>
            </Section>
          </>
        )}
      </DetailDrawer.Body>
      <ConfirmDialog
        isOpen={confirmOff}
        onClose={() => setConfirmOff(false)}
        onConfirm={() => { setConfirmOff(false); setEnabled(false); }}
        title={t('survey.closeConfirmTitle', '설문을 닫을까요?')}
        message={t('survey.closeConfirmMsg', '지금 링크로는 더 이상 응답을 받지 않아요. 다시 열면 새 링크가 만들어집니다. 받은 응답은 표에 그대로 남아요.')}
        confirmText={t('survey.close', '설문 닫기') as string}
        variant="danger"
      />
    </DetailDrawer>
  );
};

export default SurveyDrawer;

const Lead = styled.p`margin: 0 0 12px; font-size: 0.8125rem; color: #64748B; line-height: 1.6;`;
const Section = styled.section`display: flex; flex-direction: column; gap: 8px; padding: 14px 0; border-top: 1px solid #F1F5F9;`;
const Row = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const Status = styled.span<{ $on: boolean }>`
  padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 700;
  background: ${(p) => (p.$on ? '#F0FDFA' : '#F1F5F9')}; color: ${(p) => (p.$on ? '#0F766E' : '#64748B')};
`;
const Count = styled.span`font-size: 0.8125rem; color: #475569;`;
const LinkBox = styled.div`
  font-size: 0.8125rem; color: #0F172A; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  padding: 8px 10px; word-break: break-all; user-select: all;
`;
const Label = styled.div`font-size: 0.75rem; font-weight: 700; color: #475569;`;
const Hint = styled.div`font-size: 0.75rem; color: #94A3B8; line-height: 1.5;`;
const Input = styled.input`
  height: 36px; padding: 0 10px; font-size: 0.875rem; border: 1px solid #E2E8F0; border-radius: 8px; width: 100%;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const TextArea = styled.textarea`
  padding: 8px 10px; font-size: 0.875rem; border: 1px solid #E2E8F0; border-radius: 8px; width: 100%; resize: vertical; font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const QRow = styled.div`display: flex; align-items: center; gap: 6px; min-height: 40px;`;
const QName = styled.div`flex: 1; min-width: 0; font-size: 0.875rem; color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Chip = styled.button<{ $on: boolean }>`
  height: 32px; padding: 0 12px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; cursor: pointer;
  border: 1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};
  background: ${(p) => (p.$on ? '#F0FDFA' : '#FFF')}; color: ${(p) => (p.$on ? '#0F766E' : '#64748B')};
  @media (max-width: 640px) { height: 40px; }
`;
const Warn = styled.div`font-size: 0.8125rem; color: #B45309; background: #FFFBEB; border-radius: 8px; padding: 8px 10px;`;
const Err = styled.div`font-size: 0.8125rem; color: #B91C1C; background: #FEF2F2; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px;`;
