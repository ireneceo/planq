// 설문 «질문지» 탭 — 문항 카드 + 설정. 설계 docs/SURVEY_V2_DESIGN.md §8.2
//
// 문항 카드 = 표 칸 하나(이름 = 질문, 종류 = 칸 종류, order = 순서). 필수·설명은 survey_settings(칸 JSON 을 늘리지 않는다).
// 카드가 곧 미리보기 — 응답자가 보는 입력 모양(별·알약·예/아니오)을 그대로 그린다.
// 모든 입력은 AutoSaveField(저장 버튼 없음). 값은 ref 로 읽는다(stage/persist — 클로저는 뒤집기 전 값을 본다).
// 설명(문서 본문)은 부르는 쪽(PostsPage)이 descriptionSlot 으로 넣는다 — 본문 저장은 문서 편집 흐름 그대로다.
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AutoSaveField from '../../Common/AutoSaveField';
import ConfirmDialog from '../../Common/ConfirmDialog';
import OverflowMenu from '../../Common/OverflowMenu';
import PlanQSelect, { type PlanQSelectOption } from '../../Common/PlanQSelect';
import SingleDateField from '../../Common/SingleDateField';
import { Switch, SwitchKnob } from '../../Common/switchShell';
import { RatingInput, ScaleInput, YesNoInput } from './answerInputs';
import { fetchRecord, updateRecord, fetchSurvey, saveSurvey, type QRecordColumn, type QRecordColumnType, type SurveySettings, type SurveyView } from '../../../services/qtable';
import { onSocket } from '../../../services/socket';

// 질문지에 나오는 칸 종류(서버 services/survey.js SKIP_TYPES 밖) — 순서 = «+ 문항 추가» 메뉴 순서
// 글자는 locales/{ko,en}/qtable.json qType.* (화면 기본값을 코드에 두지 않는다 — i18n 래칫)
export const QUESTION_TYPES: { value: QRecordColumnType; tk: string }[] = [
  { value: 'text', tk: 'qType.text' },
  { value: 'longtext', tk: 'qType.longtext' },
  { value: 'select', tk: 'qType.select' },
  { value: 'multi_select', tk: 'qType.multiSelect' },
  { value: 'yesno', tk: 'qType.yesno' },
  { value: 'rating', tk: 'qType.rating' },
  { value: 'scale', tk: 'qType.scale' },
  { value: 'number', tk: 'qType.number' },
  { value: 'date', tk: 'qType.date' },
  { value: 'email', tk: 'qType.email' },
  { value: 'phone', tk: 'qType.phone' },
];
const QUESTION_SET = new Set(QUESTION_TYPES.map((x) => x.value));
const newColId = () => 'c' + Math.random().toString(16).slice(2, 10);

interface Props {
  recordId: number;
  editable: boolean;
  descriptionSlot?: React.ReactNode;
}

const SurveyEditor: React.FC<Props> = ({ recordId, editable, descriptionSlot }) => {
  const { t } = useTranslation('qtable');
  const [cols, setCols] = useState<QRecordColumn[] | null>(null);
  const colsRef = useRef<QRecordColumn[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [view, setView] = useState<SurveyView | null>(null);
  const [st, setSt] = useState<SurveySettings>({});
  const stRef = useRef<SurveySettings>({});
  const [confirmDel, setConfirmDel] = useState<QRecordColumn | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetchRecord(recordId);
    if (r) {
      const sorted = [...r.columns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      colsRef.current = sorted; setCols(sorted); setRowCount(r.rows?.length || r.row_count || 0);
    }
    try {
      const v = await fetchSurvey(recordId);
      setView(v);
      if (v) { stRef.current = v.settings || {}; setSt(v.settings || {}); }
    } catch { setView(null); }
  }, [recordId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onSocket<{ id: number }>('record:row', (p) => { if (p?.id === recordId) setRowCount((n) => n + 1); }), [recordId]);

  const canEdit = editable && !!view;   // 설정을 읽을 수 있어야(관리 권한) 고칠 수 있다

  // ── 칸(문항) ──
  const stageCols = (next: QRecordColumn[]) => { colsRef.current = next; setCols(next); };
  const persistCols = async () => {
    const saved = await updateRecord(recordId, { columns: colsRef.current.map((c, i) => ({ ...c, order: i })) });
    // 저장 응답은 칸만 준다 — 칸만 합친다(가드 savemerge)
    colsRef.current = [...saved.columns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  };
  const patchCol = (id: string, patch: Partial<QRecordColumn>) => stageCols(colsRef.current.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const move = async (id: string, dir: -1 | 1) => {
    const arr = [...colsRef.current]; const i = arr.findIndex((c) => c.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    stageCols(arr);
    try { await persistCols(); setErr(null); } catch { setErr(t('survey.saveFailed', '저장하지 못했어요. 잠시 후 다시 시도해 주세요.') as string); load(); }
  };
  const duplicate = async (c: QRecordColumn) => {
    const arr = [...colsRef.current]; const i = arr.findIndex((x) => x.id === c.id);
    arr.splice(i + 1, 0, { ...c, id: newColId(), name: `${c.name} ${t('survey.copySuffix', '(복사)')}` });
    stageCols(arr);
    try { await persistCols(); setErr(null); } catch { setErr(t('survey.saveFailed', '저장하지 못했어요. 잠시 후 다시 시도해 주세요.') as string); load(); }
  };
  const remove = async (c: QRecordColumn) => {
    stageCols(colsRef.current.filter((x) => x.id !== c.id));
    try { await persistCols(); setErr(null); } catch { setErr(t('survey.saveFailed', '저장하지 못했어요. 잠시 후 다시 시도해 주세요.') as string); load(); }
  };
  const addQuestion = async (type: QRecordColumnType) => {
    setAddOpen(false);
    const n = colsRef.current.filter((c) => QUESTION_SET.has(c.type)).length + 1;
    const col: QRecordColumn = { id: newColId(), name: t('survey.newQuestion', { defaultValue: '질문 {{n}}', n }) as string, type, order: colsRef.current.length,
      ...(type === 'select' || type === 'multi_select' ? { options: [t('survey.optionN', { defaultValue: '선택지 {{n}}', n: 1 }) as string, t('survey.optionN', { defaultValue: '선택지 {{n}}', n: 2 }) as string] } : {}) };
    stageCols([...colsRef.current, col]);
    try { await persistCols(); setErr(null); } catch { setErr(t('survey.saveFailed', '저장하지 못했어요. 잠시 후 다시 시도해 주세요.') as string); load(); }
  };

  // ── 설정(필수·설명·익명·제출 뒤 문구·마감·최대 응답) ──
  const stage = (patch: SurveySettings) => { const next = { ...stRef.current, ...patch }; stRef.current = next; setSt(next); };
  const persist = async (keys: (keyof SurveySettings)[]) => {
    const body: SurveySettings = {};
    keys.forEach((k) => { (body as Record<string, unknown>)[k] = stRef.current[k] ?? null; });
    const v = await saveSurvey(recordId, { settings: body });
    setView((prev) => (prev ? { ...prev, ...v } : v));
  };
  const toggleRequired = (id: string) => {
    const cur = new Set(stRef.current.required || []);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    stage({ required: [...cur] });
  };

  if (!cols) return <Empty>{t('detail.loading', '불러오는 중...')}</Empty>;
  const questions = cols.filter((c) => QUESTION_SET.has(c.type) && !(st.hidden || []).includes(c.id));
  const otherCount = cols.length - questions.length;
  const typeOpts: PlanQSelectOption[] = QUESTION_TYPES.map((x) => ({ value: x.value, label: t(x.tk) as string }));
  const closesDay = st.closes_at ? String(st.closes_at).slice(0, 10) : '';

  const preview = (c: QRecordColumn) => {
    if (c.type === 'rating') return <RatingInput value={null} readOnly label={c.name} />;
    if (c.type === 'scale') return <ScaleInput value={null} readOnly label={c.name} />;
    if (c.type === 'yesno') return <YesNoInput value={null} readOnly label={c.name} />;
    if (c.type === 'select' || c.type === 'multi_select') {
      return <Opts>{(c.options || []).map((o) => <OptPreview key={o} $multi={c.type === 'multi_select'}>{o}</OptPreview>)}</Opts>;
    }
    return <FakeInput $tall={c.type === 'longtext'}>{t(QUESTION_TYPES.find((x) => x.value === c.type)?.tk || 'qType.text')}</FakeInput>;
  };

  return (
    <Wrap data-testid="survey-editor">
      {descriptionSlot && (
        <DescBox>
          <DescLabel>{t('survey.descriptionLabel', '설명 (응답자에게 맨 위에 보여요)')}</DescLabel>
          {descriptionSlot}
        </DescBox>
      )}
      {err && <Err role="alert">{err}</Err>}
      {questions.length === 0 && <Empty data-testid="survey-no-questions">{t('survey.noQuestions', '아직 문항이 없어요. 아래 «문항 추가» 로 시작하세요.')}</Empty>}
      {questions.map((c, i) => {
        const req = (st.required || []).includes(c.id);
        const help = (st.help || {})[c.id] || '';
        return (
          <QCard key={c.id} data-testid={`survey-qcard-${c.id}`}>
            <QHead>
              <QNum>{i + 1}.</QNum>
              {canEdit ? (
                <QNameBox>
                  <AutoSaveField key={`n-${c.id}`} type="input" onSave={persistCols}>
                    <QNameInput value={c.name} maxLength={200} aria-label={t('survey.questionPh', '질문을 적어 주세요') as string}
                      placeholder={t('survey.questionPh', '질문을 적어 주세요') as string}
                      onChange={(e) => patchCol(c.id, { name: e.target.value })} />
                  </AutoSaveField>
                </QNameBox>
              ) : (
                <QNameText>{c.name}{req && <Req>*</Req>}</QNameText>
              )}
              {canEdit && (
                <QTools>
                  <TypeBox>
                    <AutoSaveField key={`t-${c.id}`} type="select" onSave={persistCols}>
                      <PlanQSelect size="sm" isSearchable={false} options={typeOpts}
                        value={typeOpts.find((o) => o.value === c.type) || null}
                        onChange={(o) => {
                          const v = (o as PlanQSelectOption | null)?.value as QRecordColumnType | undefined;
                          if (!v) return;
                          patchCol(c.id, { type: v, ...((v === 'select' || v === 'multi_select') && !(c.options || []).length ? { options: [t('survey.optionN', { defaultValue: '선택지 {{n}}', n: 1 }) as string] } : {}) });
                        }} />
                    </AutoSaveField>
                  </TypeBox>
                  <ReqWrap>
                    <ReqLabel>{t('survey.required', '필수')}</ReqLabel>
                    <AutoSaveField key={`r-${c.id}`} type="toggle" onSave={() => persist(['required'])}>
                      <Switch type="button" role="switch" aria-checked={req} $on={req} aria-label={t('survey.required', '필수') as string}
                        onClick={() => toggleRequired(c.id)}><SwitchKnob $on={req} /></Switch>
                    </AutoSaveField>
                  </ReqWrap>
                  <OverflowMenu label={t('survey.questionMenu', '문항 메뉴') as string} items={[
                    { key: 'up', label: t('survey.moveUp', '위로') as string, onClick: () => move(c.id, -1), disabled: i === 0 },
                    { key: 'down', label: t('survey.moveDown', '아래로') as string, onClick: () => move(c.id, 1), disabled: i === questions.length - 1 },
                    { key: 'dup', label: t('survey.duplicate', '복제') as string, onClick: () => duplicate(c) },
                    { key: 'del', label: t('survey.delete', '삭제') as string, danger: true, dividerBefore: true, onClick: () => (rowCount > 0 ? setConfirmDel(c) : remove(c)) },
                  ]} />
                </QTools>
              )}
            </QHead>
            {canEdit ? (
              <AutoSaveField key={`h-${c.id}`} type="input" onSave={() => persist(['help'])}>
                <HelpInput value={help} maxLength={300} placeholder={t('survey.helpPh', '문항 설명(선택)') as string}
                  onChange={(e) => stage({ help: { ...(stRef.current.help || {}), [c.id]: e.target.value } })} />
              </AutoSaveField>
            ) : (help && <HelpText>{help}</HelpText>)}
            {canEdit && (c.type === 'select' || c.type === 'multi_select') && (
              <AutoSaveField key={`o-${c.id}`} type="input" onSave={persistCols}>
                <OptionsArea rows={Math.min(8, Math.max(2, (c.options || []).length + 1))}
                  value={(c.options || []).join('\n')}
                  aria-label={t('survey.optionsLabel', '선택지 (한 줄에 하나)') as string}
                  placeholder={t('survey.optionsLabel', '선택지 (한 줄에 하나)') as string}
                  onChange={(e) => patchCol(c.id, { options: e.target.value.split('\n').map((x) => x.trimStart()).filter((x, k, a) => x !== '' || k === a.length - 1).slice(0, 50) })} />
              </AutoSaveField>
            )}
            <QPreview aria-hidden={canEdit ? undefined : true}>{preview(c)}</QPreview>
          </QCard>
        );
      })}
      {otherCount > 0 && <Hint>{t('survey.otherColumns', { defaultValue: '응답 화면에 나오지 않는 칸 {{n}}개(첨부·URL·체크 등)는 «응답» 탭 표에만 보여요.', n: otherCount }) as string}</Hint>}
      {canEdit && (
        <AddWrap>
          <AddBtn type="button" data-testid="survey-add-question" aria-expanded={addOpen} onClick={() => setAddOpen((v) => !v)}>+ {t('survey.addQuestion', '문항 추가')}</AddBtn>
          {addOpen && (
            <AddMenu role="menu" data-testid="survey-add-menu">
              {QUESTION_TYPES.map((x) => (
                <AddItem key={x.value} type="button" role="menuitem" data-testid={`survey-add-${x.value}`} onClick={() => addQuestion(x.value)}>{t(x.tk)}</AddItem>
              ))}
            </AddMenu>
          )}
        </AddWrap>
      )}
      {canEdit && (
        <Settings data-testid="survey-settings">
          <SetTitle>{t('survey.settingsTitle', '설정')}</SetTitle>
          <SetRow>
            <SetLabel>{t('survey.anonymous', '익명 응답')}</SetLabel>
            <AutoSaveField type="toggle" onSave={() => persist(['anonymous'])}>
              <Switch type="button" role="switch" aria-checked={!!st.anonymous} $on={!!st.anonymous} aria-label={t('survey.anonymous', '익명 응답') as string}
                onClick={() => stage({ anonymous: !stRef.current.anonymous })}><SwitchKnob $on={!!st.anonymous} /></Switch>
            </AutoSaveField>
          </SetRow>
          <Hint>{t('survey.anonymousHint', '누가 어떤 답을 했는지 연결하지 않아요. 받는 사람이 1명인 회차에는 의미가 없어요. 켜면 그 뒤로 들어오는 응답부터 적용돼요.')}</Hint>
          <SetLabel>{t('survey.thanks', '제출 뒤 문구')}</SetLabel>
          <AutoSaveField type="input" onSave={() => persist(['thanks'])}>
            <Area rows={2} maxLength={500} value={st.thanks || ''} placeholder={t('survey.thanksPh', '예: 소중한 의견 감사합니다. 더 나은 서비스로 보답할게요.') as string}
              onChange={(e) => stage({ thanks: e.target.value })} />
          </AutoSaveField>
          <SetGrid>
            <div>
              <SetLabel>{t('survey.closesAt', '응답 마감')}</SetLabel>
              <AutoSaveField type="select" onSave={() => persist(['closes_at'])}>
                <SingleDateField value={closesDay} onChange={(d) => stage({ closes_at: d ? new Date(`${d}T23:59:59`).toISOString() : null })} />
              </AutoSaveField>
            </div>
            <div>
              <SetLabel>{t('survey.maxResponses', { defaultValue: '최대 응답 수 (최대 {{n}})', n: view?.hard_cap ?? 5000 }) as string}</SetLabel>
              <AutoSaveField type="input" onSave={() => persist(['max_responses'])}>
                <Input inputMode="numeric" value={st.max_responses ? String(st.max_responses) : ''} placeholder={t('survey.maxPh', '비워 두면 제한 없음') as string}
                  onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); stage({ max_responses: Number.isFinite(n) && n > 0 ? n : null }); }} />
              </AutoSaveField>
            </div>
          </SetGrid>
        </Settings>
      )}
      <ConfirmDialog
        isOpen={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => { const c = confirmDel; setConfirmDel(null); if (c) remove(c); }}
        title={t('survey.deleteQuestionTitle', '이 문항을 지울까요?') as string}
        message={t('survey.deleteQuestionMsg', { defaultValue: '이미 받은 응답 {{n}}건에서 이 문항의 답도 함께 사라져요.', n: rowCount }) as string}
        confirmText={t('survey.delete', '삭제') as string}
        cancelText={t('survey.cancel', '취소') as string}
        variant="danger"
      />
    </Wrap>
  );
};

export default SurveyEditor;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 12px; max-width: 760px;`;
const DescBox = styled.div`border: 1px solid #E2E8F0; border-radius: 12px; background: #FFF; padding: 10px 14px; min-width: 0;`;
const DescLabel = styled.div`font-size: 0.75rem; font-weight: 700; color: #64748B; margin-bottom: 4px;`;
const QCard = styled.div`border: 1px solid #E2E8F0; border-radius: 12px; background: #FFF; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; min-width: 0;`;
const QHead = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
`;
const QNum = styled.span`font-size: 0.9375rem; font-weight: 700; color: #0F172A; flex-shrink: 0;`;
const QNameBox = styled.div`flex: 1 1 260px; min-width: 0;`;
const QNameInput = styled.input`
  width: 100%; height: 36px; padding: 0 10px; border: 1px solid transparent; border-radius: 8px; background: #F8FAFC;
  font-size: 0.9375rem; font-weight: 600; color: #0F172A;
  &:hover { border-color: #E2E8F0; }
  &:focus { outline: none; border-color: #14B8A6; background: #FFF; }
`;
const QNameText = styled.div`flex: 1; min-width: 0; font-size: 0.9375rem; font-weight: 600; color: #0F172A; line-height: 1.5;`;
const Req = styled.span`color: #DC2626; margin-left: 4px;`;
const QTools = styled.div`display: flex; align-items: center; gap: 8px; margin-left: auto;
  @media (max-width: 640px) { width: 100%; margin-left: 0; }
`;
const TypeBox = styled.div`width: 200px; @media (max-width: 640px) { flex: 1; width: auto; }`;
const ReqWrap = styled.div`display: flex; align-items: center; gap: 6px;`;
const ReqLabel = styled.span`font-size: 0.75rem; color: #475569; font-weight: 600;`;
const HelpInput = styled.input`
  width: 100%; height: 32px; padding: 0 10px; border: 1px solid #F1F5F9; border-radius: 8px; font-size: 0.8125rem; color: #475569;
  &:focus { outline: none; border-color: #14B8A6; }
  @media (max-width: 640px) { height: 40px; }
`;
const HelpText = styled.div`font-size: 0.8125rem; color: #64748B;`;
const OptionsArea = styled.textarea`
  width: 100%; padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.8125rem; font-family: inherit; line-height: 1.6; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const QPreview = styled.div`padding: 4px 0 2px; min-width: 0; overflow-x: auto;`;
const Opts = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const OptPreview = styled.div<{ $multi: boolean }>`
  font-size: 0.8125rem; color: #334155; display: flex; align-items: center; gap: 8px;
  &::before { content: ''; width: 14px; aspect-ratio: 1; border: 1.5px solid #CBD5E1; border-radius: ${(p) => (p.$multi ? '4px' : '50%')}; flex-shrink: 0; }
`;
const FakeInput = styled.div<{ $tall: boolean }>`
  height: ${(p) => (p.$tall ? '64px' : '36px')}; border: 1px dashed #E2E8F0; border-radius: 8px; padding: 8px 10px;
  font-size: 0.75rem; color: #CBD5E1;
`;
const AddWrap = styled.div`position: relative;`;
const AddBtn = styled.button`
  height: 40px; padding: 0 16px; border-radius: 10px; border: 1px dashed #14B8A6; background: #F0FDFA; color: #0F766E;
  font-size: 0.875rem; font-weight: 700; cursor: pointer;
  &:hover { background: #CCFBF1; }
`;
const AddMenu = styled.div`
  margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; padding: 10px; border: 1px solid #E2E8F0; border-radius: 10px; background: #FFF;
`;
const AddItem = styled.button`
  height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid #E2E8F0; background: #FFF; font-size: 0.8125rem; color: #334155; cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; }
  @media (max-width: 640px) { height: 40px; }
`;
const Settings = styled.div`border-top: 1px solid #E2E8F0; padding-top: 14px; display: flex; flex-direction: column; gap: 8px;`;
const SetTitle = styled.div`font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const SetRow = styled.div`display: flex; align-items: center; gap: 10px;`;
const SetLabel = styled.div`font-size: 0.75rem; font-weight: 700; color: #475569;`;
const SetGrid = styled.div`display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 12px;`;
const Area = styled.textarea`
  width: 100%; padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem; font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const Input = styled.input`
  width: 100%; height: 36px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const Hint = styled.div`font-size: 0.75rem; color: #94A3B8; line-height: 1.5;`;
const Empty = styled.div`padding: 24px 12px; text-align: center; font-size: 0.875rem; color: #94A3B8; border: 1px dashed #E2E8F0; border-radius: 12px;`;
const Err = styled.div`font-size: 0.8125rem; color: #B91C1C; background: #FEF2F2; border-radius: 8px; padding: 8px 10px;`;
