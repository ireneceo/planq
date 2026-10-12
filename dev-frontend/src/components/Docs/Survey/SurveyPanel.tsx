// 설문 상세 본문 — 네 탭(질문지 · 응답 · 통계 · 발행). 설계 docs/SURVEY_V2_DESIGN.md §8.2
//
// 탭 줄은 본문 맨 위에 둔다(두 밴드 계약 — 상세 크롬은 밴드 2개로 끝난다. 셋째 밴드를 만들지 않으려고 탭을 본문으로 내렸다).
// [보내기]·[응답 화면 보기] 는 밴드2 오른쪽 액션(PostsPage)과 발행 탭이 같은 모달을 연다.
// 응답·통계·발행 탭은 응답을 볼 수 있는 사람(멤버 이상)에게만 — 서버도 같은 술어로 막는다(services/surveyAccess).
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import SurveyEditor from './SurveyEditor';
import SurveyPublishTab from './SurveyPublishTab';
import SurveyStats from '../SurveyStats';
import PostTableGrid from '../PostTableGrid';

export type SurveyTab = 'questions' | 'responses' | 'stats' | 'publish';

interface Props {
  recordId: number;
  businessId: number;
  editable: boolean;              // 편집 모드(질문지·응답 격자 수정)
  canSeeResponses: boolean;       // 멤버 이상
  tab: SurveyTab;
  onTab: (t: SurveyTab) => void;
  descriptionSlot?: React.ReactNode;
  responseCount?: number | null;
  onSend: () => void;
  onPreview: () => void;
  publishReloadKey?: number;
}

const SurveyPanel: React.FC<Props> = ({ recordId, businessId, editable, canSeeResponses, tab, onTab, descriptionSlot, responseCount, onSend, onPreview, publishReloadKey }) => {
  const { t } = useTranslation('qdocs');
  const tabs: { key: SurveyTab; label: string }[] = [
    { key: 'questions', label: t('survey.tab.questions', '질문지') as string },
    ...(canSeeResponses ? [
      { key: 'responses' as const, label: `${t('survey.tab.responses', '응답') as string}${responseCount ? ` ${responseCount}` : ''}` },
      { key: 'stats' as const, label: t('survey.tab.stats', '통계') as string },
      { key: 'publish' as const, label: t('survey.tab.publish', '발행') as string },
    ] : []),
  ];
  const cur = tabs.some((x) => x.key === tab) ? tab : 'questions';
  return (
    <Wrap data-testid="survey-panel">
      <Tabs role="tablist" aria-label={t('survey.tabsLabel', '설문') as string}>
        {tabs.map((x) => (
          <Tab key={x.key} type="button" role="tab" aria-selected={cur === x.key} $active={cur === x.key} data-testid={`survey-tab-${x.key}`} onClick={() => onTab(x.key)}>{x.label}</Tab>
        ))}
      </Tabs>
      <Body>
        {cur === 'questions' && <SurveyEditor recordId={recordId} editable={editable} descriptionSlot={descriptionSlot} />}
        {cur === 'responses' && (
          <GridBleed className="pq-fullbleed"><PostTableGrid recordId={recordId} businessId={businessId} readOnly={!editable} surveyMode /></GridBleed>
        )}
        {cur === 'stats' && <SurveyStats recordId={recordId} />}
        {cur === 'publish' && <SurveyPublishTab recordId={recordId} onSend={onSend} onPreview={onPreview} reloadKey={publishReloadKey} />}
      </Body>
    </Wrap>
  );
};

export default SurveyPanel;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 14px; min-width: 0;`;
const Tabs = styled.div`
  display: flex; gap: 4px; border-bottom: 1px solid #E2E8F0; overflow-x: auto; scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`;
const Tab = styled.button<{ $active: boolean }>`
  flex-shrink: 0; height: 40px; padding: 0 14px; border: 0; background: transparent; cursor: pointer;
  font-size: 0.875rem; font-weight: ${(p) => (p.$active ? 700 : 500)}; color: ${(p) => (p.$active ? '#0F766E' : '#64748B')};
  border-bottom: 2px solid ${(p) => (p.$active ? '#14B8A6' : 'transparent')}; margin-bottom: -1px;
  &:hover { color: #0F766E; }
  @media (max-width: 640px) { height: 44px; }
`;
const Body = styled.div`min-width: 0;`;
const GridBleed = styled.div``;
