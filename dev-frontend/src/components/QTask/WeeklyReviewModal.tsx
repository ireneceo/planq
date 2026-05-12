// WeeklyReviewModal — "이번 주 마무리" 모달
//
// 수동 박제 트리거. 현재 주의 업무 요약을 보여주고 한 주 메모를 입력받아 저장.

import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { createWeeklyReview, getLatestWeeklyReview, type WeeklyReview } from '../../services/weeklyReview';
import { mondayOfDateStr, addDaysStr, todayInTz } from '../../utils/timezones';

interface Props {
  businessId: number;
  wsTz: string;
  onClose: () => void;
  onSaved: (review: WeeklyReview) => void;
}

const WeeklyReviewModal: React.FC<Props> = ({ businessId, wsTz, onClose, onSaved }) => {
  const { t } = useTranslation('qtask');
  const [retroNote, setRetroNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingReview, setExistingReview] = useState<WeeklyReview | null>(null);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);

  // 현재 주 계산
  const today = todayInTz(wsTz);
  const monday = mondayOfDateStr(today);
  const sunday = addDaysStr(monday, 6);

  // 날짜 포맷 (MM/DD)
  const fmt = (d: string) => {
    const [, m, day] = d.split('-');
    return `${parseInt(m)}/${parseInt(day)}`;
  };
  const dayOfWeek = (d: string) => {
    const dow = new Date(d).getDay();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return days[dow];
  };

  // 기존 결산 확인
  useEffect(() => {
    (async () => {
      try {
        const latest = await getLatestWeeklyReview(businessId);
        if (latest && latest.week_start === monday) {
          setExistingReview(latest);
          setRetroNote(latest.retro_note || '');
        }
      } catch (e) {
        // ignore
      }
    })();
  }, [businessId, monday]);

  const handleSave = async (overwrite = false) => {
    if (saving) return;
    setError(null);

    // 기존 row 있는데 overwrite false면 확인 다이얼로그
    if (existingReview && !overwrite && !showOverwriteConfirm) {
      setShowOverwriteConfirm(true);
      return;
    }

    setSaving(true);
    try {
      const review = await createWeeklyReview({
        business_id: businessId,
        week_start: monday,
        retro_note: retroNote.trim() || undefined,
        overwrite: overwrite || !!existingReview,
      });
      // 성공 시각 피드백 — 짧은 ✓ 후 close
      setSaved(true);
      setTimeout(() => onSaved(review), 800);
    } catch (e: any) {
      if (e.message?.includes('already_exists')) {
        setShowOverwriteConfirm(true);
      } else {
        setError(e.message || (t('weeklyReview.modal.saveError', { defaultValue: '저장 실패. 잠시 후 다시 시도하세요.' }) as string));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Overlay onClick={onClose}>
      <Dialog onClick={e => e.stopPropagation()}>
        <Header>
          <Title>{t('weeklyReview.modal.title', '이번 주 마무리')}</Title>
          <Period>
            {fmt(monday)} ({dayOfWeek(monday)}) ~ {fmt(sunday)} ({dayOfWeek(sunday)})
          </Period>
        </Header>

        {saved ? (
          <ConfirmBody>
            <SavedIcon>✓</SavedIcon>
            <ConfirmText>{t('weeklyReview.modal.saved', { defaultValue: '저장 완료. 결산 목록에서 확인하세요.' }) as string}</ConfirmText>
          </ConfirmBody>
        ) : showOverwriteConfirm ? (
          <ConfirmBody>
            <ConfirmText>{t('weeklyReview.modal.alreadyExists', '이번 주 결산이 이미 있어요. 지금 시점으로 덮어쓸까요?')}</ConfirmText>
            {error && <ErrorMsg>{error}</ErrorMsg>}
            <BtnRow>
              <CancelBtn onClick={() => { setShowOverwriteConfirm(false); setError(null); }} disabled={saving}>
                {t('common.cancel', '취소')}
              </CancelBtn>
              <SaveBtn onClick={() => handleSave(true)} disabled={saving}>
                {saving
                  ? (t('weeklyReview.modal.saving', { defaultValue: '저장 중...' }) as string)
                  : t('weeklyReview.modal.overwrite', '덮어쓰기')}
              </SaveBtn>
            </BtnRow>
          </ConfirmBody>
        ) : (
          <>
            <Body>
              <NoteLabel>{t('weeklyReview.modal.noteLabel', '한 주 메모')}:</NoteLabel>
              <NoteInput
                value={retroNote}
                onChange={e => setRetroNote(e.target.value)}
                placeholder={t('weeklyReview.modal.notePlaceholder', '이번 주 어땠나요? (선택)')}
                rows={3}
              />
            </Body>

            {error && <ErrorMsg>{error}</ErrorMsg>}

            <BtnRow>
              <CancelBtn onClick={onClose} disabled={saving}>
                {t('weeklyReview.modal.cancel', '취소')}
              </CancelBtn>
              <SaveBtn onClick={() => handleSave()} disabled={saving}>
                {saving
                  ? (t('weeklyReview.modal.saving', { defaultValue: '저장 중...' }) as string)
                  : t('weeklyReview.modal.save', '저장')}
              </SaveBtn>
            </BtnRow>
          </>
        )}
      </Dialog>
    </Overlay>
  );
};

export default WeeklyReviewModal;

// ─── Styles ───
const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  @media (max-width: 640px) { padding: 16px; }
`;

const Dialog = styled.div`
  background: #fff;
  border-radius: 12px;
  width: 90%;
  max-width: 400px;
  padding: 24px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  @media (max-width: 640px) { margin-top: 60px; max-height: calc(100vh - 100px); overflow-y: auto; }
`;

const Header = styled.div`
  margin-bottom: 20px;
  text-align: center;
`;

const Title = styled.h2`
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 700;
  color: #1e293b;
`;

const Period = styled.div`
  font-size: 13px;
  color: #64748b;
`;

const Body = styled.div`
  margin-bottom: 20px;
`;

const NoteLabel = styled.label`
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  margin-bottom: 8px;
`;

const NoteInput = styled.textarea`
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  resize: vertical;
  min-height: 60px;
  &:focus {
    outline: none;
    border-color: #14b8a6;
  }
`;

const BtnRow = styled.div`
  display: flex;
  gap: 10px;
  justify-content: flex-end;
`;

const CancelBtn = styled.button`
  padding: 8px 16px;
  border: 1px solid #e2e8f0;
  background: #fff;
  border-radius: 6px;
  font-size: 14px;
  color: #64748b;
  cursor: pointer;
  &:hover { background: #f8fafc; }
`;

const SaveBtn = styled.button`
  padding: 8px 20px;
  border: none;
  background: #14b8a6;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  &:hover { background: #0d9488; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;

const ConfirmBody = styled.div`
  padding: 20px 0;
`;

const ConfirmText = styled.p`
  font-size: 14px;
  color: #475569;
  text-align: center;
  margin-bottom: 20px;
`;

const ErrorMsg = styled.div`
  color: #DC2626;
  font-size: 13px;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px;
  text-align: center;
`;

const SavedIcon = styled.div`
  width: 56px; height: 56px;
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 14px;
  font-size: 28px; font-weight: 800; color: #166534;
  background: #DCFCE7; border-radius: 50%;
`;
