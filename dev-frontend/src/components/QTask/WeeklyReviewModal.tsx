// WeeklyReviewModal — "이번 주 마무리" 모달
//
// 수동 박제 트리거. 현재 주의 업무 요약을 보여주고 한 주 메모를 입력받아 저장.

import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { createWeeklyReview, getLatestWeeklyReview, type WeeklyReview } from '../../services/weeklyReview';
import { mondayOfDateStr, addDaysStr, todayInTz } from '../../utils/timezones';
import ActionButton from '../Common/ActionButton';
import DrawerFooter from '../Common/DrawerFooter';

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
    const days = [
      t('weekdayShort.0', '일'), t('weekdayShort.1', '월'), t('weekdayShort.2', '화'),
      t('weekdayShort.3', '수'), t('weekdayShort.4', '목'), t('weekdayShort.5', '금'), t('weekdayShort.6', '토'),
    ];
    return days[dow];
  };

  // 기존 결산 확인
  useEffect(() => {
    (async () => {
      try {
        const latest = await getLatestWeeklyReview(businessId);
        // ★ 2026-08-24 — **형식이 다른 두 값을 그대로 비교하고 있었다.**
        //   POST 응답의 week_start 는 `"2026-08-24"` 인데 GET /latest 는 `"2026-08-24T00:00:00.000Z"` 로 온다
        //   (DATEONLY 가 경로에 따라 문자열/Date 로 갈리는 이 저장소의 알려진 함정).
        //   `===` 로 재면 **영원히 false** 라 기존 보고서를 절대 못 찾았고, 그래서
        //     ① 이미 쓴 내용이 안 불러와지고 ② 저장 시 서버가 409 를 내며 그 원문
        //     (`Weekly review already exists for this week`)이 사용자 화면에 그대로 떴다.
        //   Irene 신고("또 하려니까 already exists 라고 나온다")의 실제 원인이 이것이다.
        const latestWeek = latest ? String(latest.week_start).slice(0, 10) : null;
        if (latest && latestWeek === monday) {
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

    // ★ 2026-08-24 (Irene) — 기존 보고서가 있어도 **확인창을 띄우지 않는다.**
    //   버튼이 이미 '보고서 수정' 이고 본문에 기존 내용이 채워져 있어 의도가 분명하다.
    //   여태는 여기서 확인창이 뜨고, 실패 경로에서는 서버 원문(`Weekly review already exists…`)이
    //   그대로 보였다 — 사용자에게는 "왜 안 되지" 로만 읽힌다.

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
        // 이미 있다는 건 오류가 아니라 상태다 — 사용자에게 서버 원문을 보여주는 대신 그대로 수정 저장한다.
        try {
          const review = await createWeeklyReview({
            business_id: businessId, week_start: monday,
            retro_note: retroNote.trim() || undefined, overwrite: true,
          });
          setSaved(true);
          setTimeout(() => onSaved(review), 800);
          return;
        } catch (e2: any) {
          setError(e2.message || (t('weeklyReview.modal.saveError', { defaultValue: '저장 실패. 잠시 후 다시 시도하세요.' }) as string));
        }
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
            <ConfirmText>{t('weeklyReview.modal.saved', { defaultValue: '보고서가 저장됐어요. 나의 업무보고에서 볼 수 있어요.' }) as string}</ConfirmText>
          </ConfirmBody>
        ) : (
          <>
            <Body>
              {/* 이미 쓴 보고서가 있으면 **그 사실과 다음 행동**을 먼저 말한다. 아래 메모칸에는 그 내용이
                  이미 채워져 있다(위 useEffect) — 사용자는 이어서 고치면 된다. */}
              {existingReview && (
                <ExistingBar>
                  <span>{t('weeklyReview.modal.existing', { defaultValue: '이번 주 보고서가 이미 있어요. 내용을 불러왔습니다.' }) as string}</span>
                  <LinkBtn type="button" data-testid="weekly-review-open" onClick={() => onSaved(existingReview)}>
                    {t('weeklyReview.modal.openReport', { defaultValue: '보고서 보기' }) as string}
                  </LinkBtn>
                </ExistingBar>
              )}
              <NoteLabel>{t('weeklyReview.modal.noteLabel', '한 주 메모')}:</NoteLabel>
              <NoteInput
                value={retroNote}
                onChange={e => setRetroNote(e.target.value)}
                placeholder={t('weeklyReview.modal.notePlaceholder', '이번 주 어땠나요? (선택)')}
                rows={3}
              />
              {error && <ErrorMsg>{error}</ErrorMsg>}
            </Body>
            <DrawerFooter align="right" size="sm">
              <ActionButton tone="secondary" size="sm" onClick={onClose} disabled={saving}>
                {t('weeklyReview.modal.cancel', '취소') as string}
              </ActionButton>
              <ActionButton tone="primary" size="sm" loading={saving} onClick={() => handleSave()}>
                {existingReview
                  ? (t('weeklyReview.modal.editReport', { defaultValue: '보고서 수정' }) as string)
                  : (t('weeklyReview.modal.writeReport', { defaultValue: '보고서 작성' }) as string)}
              </ActionButton>
            </DrawerFooter>
          </>
        )}
      </Dialog>
    </Overlay>
  );
};

export default WeeklyReviewModal;

// ─── Styles ───
const ExistingBar = styled.div`
  display:flex; align-items:center; gap:8px; flex-wrap:wrap;
  margin-bottom:10px; padding:8px 10px; border-radius:8px;
  background:#F0FDFA; border:1px solid #99F6E4;
  font-size:12px; color:#0F766E; line-height:1.5;
`;
const LinkBtn = styled.button`
  margin-left:auto; padding:0; background:none; border:none; cursor:pointer;
  font-size:12px; font-weight:700; color:#0F766E; text-decoration:underline; font-family:inherit;
  &:hover { color:#0D9488; }
`;
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
  max-width: 420px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  @media (max-width: 640px) { margin-top: 60px; max-height: calc(100vh - 100px); overflow-y: auto; }
`;

const Header = styled.div`
  padding: 20px 20px 0;
  margin-bottom: 16px;
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
  padding: 0 20px 16px;
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

const ConfirmBody = styled.div`
  padding: 20px;
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
