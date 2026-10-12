// 응답 화면 미리보기 — 공개 링크가 없어도 응답자가 보게 될 화면을 본다(제출 불가). 서버 GET /api/surveys/:id/preview 가
//   공개 GET 과 같은 함수(questionnaireView)로 만든 모양을 그대로 SurveyForm 에 넘긴다.
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../../Common/StandardModal';
import SurveyForm from './SurveyForm';
import { fetchSurveyPreview, type SurveyQuestionnaire } from '../../../services/qtable';

const SurveyPreviewModal: React.FC<{ open: boolean; onClose: () => void; recordId: number }> = ({ open, onClose, recordId }) => {
  const { t } = useTranslation('qdocs');
  const [data, setData] = useState<SurveyQuestionnaire | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setData(null); setErr(false);
    fetchSurveyPreview(recordId).then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [open, recordId]);
  return (
    <StandardModal open={open} onClose={onClose} size="md" title={t('survey.preview', '응답 화면 미리보기') as string}>
      <Pad data-testid="survey-preview">
        {err ? <Msg>{t('survey.previewFailed', '미리보기를 불러오지 못했어요.')}</Msg>
          : !data ? <Msg>{t('loading', '불러오는 중...')}</Msg>
          : <SurveyForm survey={data} preview />}
      </Pad>
    </StandardModal>
  );
};

export default SurveyPreviewModal;

const Pad = styled.div`padding: 4px 8px;`;
const Msg = styled.div`padding: 24px; text-align: center; color: #94A3B8; font-size: 0.875rem;`;
