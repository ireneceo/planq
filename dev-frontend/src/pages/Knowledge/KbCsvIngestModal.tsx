// Q knowledge — CSV 일괄 업로드 모달
// 샘플 다운로드 → 채워서 붙여넣기 (또는 파일 업로드) → 미리보기 → 일괄 저장
// 설계: docs/KB_AI_INGEST_DESIGN.md
import React, { useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';

const SAMPLE_CSV = `title,body,category,tags,source_language,auto_translate
환불 정책,결제 후 7일 안에 환불 가능. 사용 흔적 있으면 30%만 환급.,policy,"환불,정책",ko,true
배송 안내,평일 14시 전 결제 시 당일 발송. 주말 결제는 월요일 발송.,manual,"배송,안내",ko,true
Pricing,Starter 9.9 USD/mo · Basic 29 USD/mo,pricing,"price,plan",en,true`;

interface Props {
  businessId: number;
  onClose: () => void;
  onSaved: () => void;
}

interface CsvCandidate {
  title: string;
  body: string;
  category: string;
  tags: string[];
  source_language: 'ko' | 'en';
  auto_translate: boolean;
}

const KbCsvIngestModal: React.FC<Props> = ({ businessId, onClose, onSaved }) => {
  const { t } = useTranslation('knowledge');
  const [csv, setCsv] = useState('');
  const [candidates, setCandidates] = useState<CsvCandidate[]>([]);
  const [step, setStep] = useState<'input' | 'preview'>('input');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => setCsv(String(e.target?.result || ''));
    reader.readAsText(file, 'utf-8');
  }, []);

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'planq-kb-sample.csv'; a.click();
    URL.revokeObjectURL(url);
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
      setStep('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
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
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.message || 'save_failed');
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
    } finally {
      setSaving(false);
    }
  }, [candidates, saving, businessId, onSaved, onClose]);

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
                <FileInputLabel>
                  <input type="file" accept=".csv,text/csv" hidden
                    onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
                  {t('csvIngest.upload', '파일 선택')}
                </FileInputLabel>
              </Row>

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
              <PreviewTable>
                <thead>
                  <tr>
                    <Th>{t('csvIngest.col.title', '제목')}</Th>
                    <Th>{t('csvIngest.col.category', '카테고리')}</Th>
                    <Th>{t('csvIngest.col.lang', '언어')}</Th>
                    <Th>{t('csvIngest.col.translate', '번역')}</Th>
                    <Th>{t('csvIngest.col.tags', '태그')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.slice(0, 50).map((c, i) => (
                    <tr key={i}>
                      <Td>{c.title}</Td>
                      <Td>{c.category}</Td>
                      <Td>{c.source_language.toUpperCase()}</Td>
                      <Td>{c.auto_translate ? 'ON' : 'OFF'}</Td>
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
const FileInputLabel = styled.label`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; background: #FFFFFF; color: #475569;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; }
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
