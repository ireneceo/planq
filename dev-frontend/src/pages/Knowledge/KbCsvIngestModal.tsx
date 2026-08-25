// Q knowledge — CSV 일괄 업로드 모달
// 샘플 다운로드 → 채워서 붙여넣기 (또는 파일 업로드) → 미리보기 → 일괄 저장
// 설계: docs/KB_AI_INGEST_DESIGN.md
import React, { useState, useCallback } from 'react';
import { downloadBlob } from '../../utils/download';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { mapApiError } from '../../utils/apiError';

const SAMPLE_CSV = `title,body,category,tags,source_language,auto_translate
환불 정책,결제 후 7일 안에 환불 가능. 사용 흔적 있으면 30%만 환급.,policy,"환불,정책",ko,true
배송 안내,평일 14시 전 결제 시 당일 발송. 주말 결제는 월요일 발송.,manual,"배송,안내",ko,true
Pricing,Starter 9.9 USD/mo · Basic 29 USD/mo,pricing,"price,plan",en,true`;

interface Props {
  businessId: number;
  onClose: () => void;
  onSaved: () => void;
}

interface KbColumn { id: string; name: string; type: string; show_in_list: boolean }
interface CsvCandidate {
  title: string;
  body: string;
  category?: string;
  categories?: string[];
  tags: string[];
  source_language: 'ko' | 'en';
  auto_translate: boolean;
  // #316/#319 — title/body 외 남은 열이 항목으로 들어온다. 그대로 batch 로 넘긴다.
  custom_columns?: KbColumn[] | null;
  custom_values?: Record<string, string> | null;
}

const WarnBox = styled.div`
  margin: 8px 0; padding: 8px 12px; border-radius: 6px;
  background: #FFF7ED; border: 1px solid #FED7AA; color: #9A3412;
  font-size: 12px; line-height: 1.5;
`;
const InfoBox = styled.div`
  margin: 8px 0; padding: 8px 12px; border-radius: 6px;
  background: #F0FDFA; border: 1px solid #CCFBF1; color: #0F766E;
  font-size: 12px; line-height: 1.5;
  strong { font-weight: 700; }
`;
const DupRow = styled.div`display: flex; align-items: center; gap: 8px; margin: 8px 0;`;
const DupLabel = styled.span`font-size: 12px; color: #64748B;`;
const DupChoice = styled.button<{ $on: boolean }>`
  padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; font-family: inherit;
  cursor: pointer; transition: all 0.12s;
  border: 1px solid ${p => (p.$on ? '#14B8A6' : '#E2E8F0')};
  background: ${p => (p.$on ? '#F0FDFA' : '#fff')};
  color: ${p => (p.$on ? '#0F766E' : '#64748B')};
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20,184,166,0.3); }
`;

const KbCsvIngestModal: React.FC<Props> = ({ businessId, onClose, onSaved }) => {
  const { t } = useTranslation('knowledge');
  const { t: tErr } = useTranslation('errors');
  const [csv, setCsv] = useState('');
  const [candidates, setCandidates] = useState<CsvCandidate[]>([]);
  const [step, setStep] = useState<'input' | 'preview'>('input');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);   // #232 드롭존 하이라이트
  // #322 — 초과분이 잘렸는지 / #319 — 어떤 열이 항목이 되는지 사용자에게 보여준다.
  const [parseInfo, setParseInfo] = useState<{ total: number; returned: number; truncated: boolean; limit: number; fieldColumns: string[] } | null>(null);
  // #321 — 같은 CSV 재업로드 시 처리 방식. 기본은 건너뛰기(중복 폭증이 실제 신고였다).
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'create'>('skip');

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => setCsv(String(e.target?.result || ''));
    reader.readAsText(file, 'utf-8');
  }, []);

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
    void downloadBlob(blob, 'planq-kb-sample.csv');
  };

  const parse = useCallback(async () => {
    if (!csv.trim() || parsing) return;
    setParsing(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/kb/csv-ingest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csv.trim() }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.message || 'parse_failed');
      const list = (j.data?.candidates || []) as CsvCandidate[];
      if (list.length === 0) throw new Error(t('csvIngest.errEmpty', '파싱된 행이 없습니다. 헤더와 데이터를 확인해주세요.') as string);
      setCandidates(list);
      setParseInfo({
        total: Number(j.data?.total_parsed) || list.length,
        returned: Number(j.data?.returned) || list.length,
        truncated: !!j.data?.truncated,
        limit: Number(j.data?.limit) || list.length,
        fieldColumns: Array.isArray(j.data?.field_columns) ? j.data.field_columns : [],
      });
      setStep('preview');
    } catch (e) {
      setError(mapApiError(e, tErr));
    } finally {
      setParsing(false);
    }
  }, [csv, parsing, businessId, t]);

  const save = useCallback(async () => {
    if (saving || candidates.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/kb/documents/batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: candidates,
          scope: 'workspace',
          on_duplicate: onDuplicate,   // #321
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.message || 'save_failed');
      onSaved();
      onClose();
    } catch (e) {
      setError(mapApiError(e, tErr));
    } finally {
      setSaving(false);
    }
  }, [candidates, saving, businessId, onSaved, onClose, onDuplicate, tErr]);

  return (
    <Backdrop onClick={onClose}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('csvIngest.title', 'CSV 업로드') as string}>
        <Header>
          <Title>{t('csvIngest.title', 'CSV 일괄 업로드')}</Title>
          <CloseBtn type="button" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </CloseBtn>
        </Header>

        <Body>
          {step === 'input' && (
            <>
              <Hint>
                {t('csvIngest.hint', '샘플을 다운받아 채운 뒤 텍스트를 붙여넣거나 파일을 업로드하세요. 헤더 필수: title, body, category, tags, source_language, auto_translate')}
              </Hint>

              <Row>
                <SecondaryBtn type="button" onClick={downloadSample}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  {t('csvIngest.sample', '샘플 다운로드')}
                </SecondaryBtn>
              </Row>

              {/* 운영 #232 — "버튼 형식은 다 찾아서 바꿔줘. 전체 통일되게 드래그드롭 회색 라운드박스."
                  버튼만 있던 자리를 드롭존으로 교체한다(클릭도 그대로 된다 — label 이 input 을 감싼다). */}
              <DropZone
                $over={dragOver}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault(); setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleFile(f);
                }}
              >
                <input type="file" accept=".csv,text/csv" hidden
                  onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
                <DropIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </DropIcon>
                <DropText>{t('csvIngest.drop', 'CSV 파일을 끌어다 놓거나 클릭해 선택하세요')}</DropText>
              </DropZone>

              <Field>
                <Label>{t('csvIngest.text', 'CSV 내용')}</Label>
                <TextArea
                  value={csv}
                  onChange={e => setCsv(e.target.value)}
                  placeholder={t('csvIngest.textPh', 'CSV 텍스트를 직접 붙여넣어도 됩니다.') as string}
                  rows={10}
                />
              </Field>

              {error && <ErrorBox>{error}</ErrorBox>}
            </>
          )}

          {step === 'preview' && (
            <>
              <Hint>
                {t('csvIngest.previewHint', '파싱된 항목 미리보기. 일괄 저장하면 임베딩과 번역이 백그라운드로 처리됩니다.')}
                <PreviewCount>{candidates.length} {t('csvIngest.rows', '행')}</PreviewCount>
              </Hint>

              {/* #322 — 잘렸으면 반드시 알린다. 여태 조용히 잘려서 나중에 발견했다. */}
              {parseInfo?.truncated && (
                <WarnBox>
                  {t('csvIngest.truncated', '{{total}}건 중 {{returned}}건만 표시됩니다 (한 번에 최대 {{limit}}건). 나머지는 파일을 나눠 올려주세요.', {
                    total: parseInfo.total, returned: parseInfo.returned, limit: parseInfo.limit,
                  })}
                </WarnBox>
              )}

              {/* #319 — 어떤 열이 항목이 되는지 미리 보여준다. */}
              {parseInfo && parseInfo.fieldColumns.length > 0 && (
                <InfoBox>
                  {t('csvIngest.fieldColumns', '다음 열이 항목으로 만들어집니다')}: <strong>{parseInfo.fieldColumns.join(', ')}</strong>
                </InfoBox>
              )}

              {/* #321 — 같은 파일을 다시 올렸을 때의 처리 */}
              <DupRow>
                <DupLabel>{t('csvIngest.onDuplicate', '제목이 같은 정보가 이미 있으면')}</DupLabel>
                <DupChoice
                  type="button" $on={onDuplicate === 'skip'}
                  onClick={() => setOnDuplicate('skip')}
                >{t('csvIngest.dupSkip', '건너뛰기')}</DupChoice>
                <DupChoice
                  type="button" $on={onDuplicate === 'create'}
                  onClick={() => setOnDuplicate('create')}
                >{t('csvIngest.dupCreate', '새로 추가')}</DupChoice>
              </DupRow>
              <PreviewTable>
                <thead>
                  <tr>
                    <Th>{t('csvIngest.col.title', '제목')}</Th>
                    <Th>{t('csvIngest.col.category', '카테고리')}</Th>
                    <Th>{t('csvIngest.col.lang', '언어')}</Th>
                    <Th>{t('csvIngest.col.translate', '번역')}</Th>
                    <Th>{t('csvIngest.col.fields', '항목')}</Th>
                    <Th>{t('csvIngest.col.tags', '태그')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.slice(0, 50).map((c, i) => (
                    <tr key={i}>
                      <Td>{c.title}</Td>
                      <Td>{(c.categories && c.categories.length ? c.categories.join(', ') : c.category) || '—'}</Td>
                      <Td>{c.source_language.toUpperCase()}</Td>
                      <Td>{c.auto_translate ? 'ON' : 'OFF'}</Td>
                      <Td>{(c.custom_columns || []).map(col => col.name).join(', ') || '—'}</Td>
                      <Td>{(c.tags || []).join(', ')}</Td>
                    </tr>
                  ))}
                </tbody>
              </PreviewTable>
              {candidates.length > 50 && <MoreNote>+{candidates.length - 50} {t('csvIngest.more', '행 더')}</MoreNote>}

              {error && <ErrorBox>{error}</ErrorBox>}
            </>
          )}
        </Body>

        <Footer>
          <SecondaryBtn type="button" onClick={onClose} disabled={parsing || saving}>
            {t('common.cancel', '취소')}
          </SecondaryBtn>
          {step === 'input' && (
            <PrimaryBtn type="button" onClick={parse} disabled={!csv.trim() || parsing}>
              {parsing ? t('csvIngest.parsing', '파싱 중...') : t('csvIngest.parse', '미리보기')}
            </PrimaryBtn>
          )}
          {step === 'preview' && (
            <>
              <SecondaryBtn type="button" onClick={() => setStep('input')} disabled={saving}>
                {t('csvIngest.back', '뒤로')}
              </SecondaryBtn>
              <PrimaryBtn type="button" onClick={save} disabled={saving}>
                {saving ? t('csvIngest.saving', '저장 중...') : t('csvIngest.saveAll', '일괄 저장')}
              </PrimaryBtn>
            </>
          )}
        </Footer>
      </Dialog>
    </Backdrop>
  );
};

export default KbCsvIngestModal;

const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 200;
  background: rgba(15, 23, 42, 0.5);
  display: flex; align-items: center; justify-content: center; padding: 24px;
  @media (max-width: 640px) { padding: 0; align-items: stretch; }
`;
const Dialog = styled.div`
  width: 100%; max-width: 720px; max-height: 90vh;
  background: #FFFFFF; border-radius: 14px;
  box-shadow: 0 24px 48px rgba(15,23,42,0.18);
  display: flex; flex-direction: column; overflow: hidden;
  @media (max-width: 640px) {
    max-width: none; max-height: none; border-radius: 0;
    margin-top: 60px; height: calc(100vh - 60px); height: calc(100dvh - 60px);
  }
`;
const Header = styled.div`
  padding: 18px 22px 14px; border-bottom: 1px solid #E2E8F0;
  display: flex; align-items: center; justify-content: space-between;
`;
const Title = styled.h3`
  margin: 0; font-size: 16px; font-weight: 700; color: #0F172A;
`;
const CloseBtn = styled.button`
  /* touch-target-44: 폰 터치 타깃 (theme/tokens CONTROL.touchMin). 데스크탑 크기는 그대로. */
  @media (max-width: 640px) { min-width: 44px; min-height: 44px; }

  width: 32px; height: 32px; border: none; background: transparent;
  border-radius: 8px; cursor: pointer; color: #64748B;
  display: inline-flex; align-items: center; justify-content: center;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`
  padding: 20px 22px; overflow-y: auto; flex: 1;
  display: flex; flex-direction: column; gap: 14px;
`;
const Hint = styled.div`
  font-size: 13px; color: #475569; line-height: 1.6;
  padding: 12px 14px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
`;
const PreviewCount = styled.span`
  font-size: 11px; font-weight: 700; color: #475569; flex-shrink: 0;
  padding: 2px 8px; background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 999px;
`;
const Row = styled.div`
  display: flex; gap: 8px;
`;
const Field = styled.div`
  display: flex; flex-direction: column; gap: 6px;
`;
const Label = styled.label`
  font-size: 12px; font-weight: 700; color: #475569;
`;
const TextArea = styled.textarea`
  width: 100%; box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 12px; color: #0F172A; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const ErrorBox = styled.div`
  padding: 10px 12px; background: #FEF2F2; border: 1px solid #FECACA;
  border-radius: 8px; font-size: 13px; color: #B91C1C;
`;
const PreviewTable = styled.table`
  width: 100%; border-collapse: collapse;
  font-size: 12px; color: #334155;
`;
const Th = styled.th`
  padding: 8px 10px; text-align: left; background: #F8FAFC;
  border-bottom: 1px solid #E2E8F0; font-weight: 700; font-size: 11px; color: #64748B;
`;
const Td = styled.td`
  padding: 8px 10px; border-bottom: 1px solid #F1F5F9;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;
`;
const MoreNote = styled.div`
  text-align: center; font-size: 12px; color: #94A3B8; padding: 6px;
`;
const Footer = styled.div`
  padding: 14px 22px; border-top: 1px solid #E2E8F0;
  display: flex; justify-content: flex-end; gap: 8px;
`;
const PrimaryBtn = styled.button`
  padding: 8px 16px; background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; background: #FFFFFF; color: #475569;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { border-color: #14B8A6; color: #0F766E; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

// 운영 #232 — 첨부 표면 공통 형태(회색 라운드 점선 박스). AttachmentField 와 같은 계열.
const DropZone = styled.label<{ $over: boolean }>`
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  padding: 20px 16px; cursor: pointer;
  background: ${p => (p.$over ? '#F0FDFA' : '#F8FAFC')};
  border: 1.5px dashed ${p => (p.$over ? '#14B8A6' : '#CBD5E1')};
  border-radius: 10px;
  color: ${p => (p.$over ? '#0F766E' : '#64748B')};
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  &:hover { border-color: #94A3B8; }
`;
const DropIcon = styled.svg` width: 22px; height: 22px; `;
const DropText = styled.div` font-size: 12.5px; font-weight: 600; text-align: center; `;
