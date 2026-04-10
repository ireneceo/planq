import { useState, useMemo } from 'react';
import styled from 'styled-components';
import StartMeetingModal from './StartMeetingModal';
import type { StartConfig } from './StartMeetingModal';
import { MOCK_SESSIONS, MOCK_LIVE_UTTERANCES } from './mockData';
import type { MockUtterance } from './mockData';
import { getLanguageByCode } from '../../constants/languages';
import {
  MicIcon,
  MonitorIcon,
  StopIcon,
  PlusIcon,
  CheckIcon,
  ArrowRightIcon,
  HelpCircleIcon,
} from '../../components/Common/Icons';

/**
 * Q Note 페이지
 *
 * 색상 원칙 (엄격):
 *   - Primary 딥틸: #14B8A6 #0D9488 #115E59 #F0FDFA #CCFBF1 #99F6E4
 *     → 일반 액션, 활성 상태, 녹음 인디케이터
 *   - Point 코랄/로즈: #F43F5E #E11D48 #FFF1F2 #FFE4E6 #FECDD3 #9F1239
 *     → AI 감지 강조 (질문 카드), 핵심 CTA (답변 찾기)
 *     → 화면당 1-2번만 절제
 *   - Neutral: #FFFFFF #F8FAFC #F1F5F9 #E2E8F0 #CBD5E1 #94A3B8 #64748B #475569 #0F172A
 *     → 텍스트, 보더, 배경
 *   - 그 외 색상 사용 금지 (빨강 에러용 제외, 노랑/주황/보라 일체 금지)
 */

type ViewMode = 'empty' | 'live' | 'review';

const QNotePage = () => {
  const [showStartModal, setShowStartModal] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('live');
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [config, setConfig] = useState<StartConfig | null>({
    title: 'Weekly Product Sync (Eng team)',
    brief: '',
    participants: [],
    meetingLanguages: ['en'],
    translationLanguage: 'ko',
    answerLanguage: 'en',
    captureMode: 'browser_tab',
    documents: [],
    pastedContext: '',
    urls: [],
  });

  const meetingLangLabels = useMemo(() => {
    if (!config) return '';
    return config.meetingLanguages
      .map((c) => getLanguageByCode(c)?.label || c)
      .join(' + ');
  }, [config]);

  const handleStart = (cfg: StartConfig) => {
    setConfig(cfg);
    setShowStartModal(false);
    setViewMode('live');
    setIsRecording(true);
  };

  return (
    <Layout $collapsed={sidebarCollapsed}>
      {/* ── 좌측 사이드바: 세션 목록 ── */}
      <Sidebar $collapsed={sidebarCollapsed}>
        <SidebarHeader>
          <SidebarTitle>Q Note</SidebarTitle>
          <NewSessionBtn onClick={() => setShowStartModal(true)}>
            <PlusIcon size={14} />
            <span>새 회의</span>
          </NewSessionBtn>
        </SidebarHeader>

        <SearchBox placeholder="세션 검색" />

        <SessionList>
          {MOCK_SESSIONS.map((session) => {
            const lang = getLanguageByCode(session.language);
            const isActive = activeSessionId === session.id;
            return (
              <SessionItem
                key={session.id}
                $active={isActive}
                onClick={() => {
                  setActiveSessionId(session.id);
                  setViewMode('review');
                  setIsRecording(false);
                }}
              >
                <SessionItemTitle>{session.title}</SessionItemTitle>
                <SessionItemMeta>
                  <span>{session.date}</span>
                  <Dot>·</Dot>
                  <span>{session.duration}</span>
                  <Dot>·</Dot>
                  <span>{lang?.label}</span>
                </SessionItemMeta>
              </SessionItem>
            );
          })}
        </SessionList>
      </Sidebar>

      {/* ── 우측 메인 ── */}
      <Main>
        {/* 사이드바 토글 — 미팅 풀스크린용 */}
        <CollapseToggle
          onClick={() => setSidebarCollapsed((v) => !v)}
          aria-label={sidebarCollapsed ? '사이드바 열기' : '사이드바 닫기'}
        >
          {sidebarCollapsed ? '›' : '‹'}
        </CollapseToggle>

        {viewMode === 'empty' && (
          <EmptyState>
            <EmptyIconWrap>
              <MicIcon size={36} />
            </EmptyIconWrap>
            <EmptyTitle>회의를 시작해보세요</EmptyTitle>
            <EmptyDesc>
              실시간 음성 인식, 번역, 질문 감지로
              <br />
              회의록을 자동으로 만들어드립니다.
            </EmptyDesc>
            <EmptyBtn onClick={() => setShowStartModal(true)}>
              <PlusIcon size={16} />
              <span>새 회의 시작</span>
            </EmptyBtn>
          </EmptyState>
        )}

        {viewMode === 'live' && config && (
          <>
            <MainHeader>
              <HeaderLeft>
                <SessionTitle>{config.title}</SessionTitle>
                <SessionMeta>
                  <Badge>{meetingLangLabels}</Badge>
                  <Badge>
                    <BadgeIcon>
                      {config.captureMode === 'browser_tab' ? (
                        <MonitorIcon size={12} />
                      ) : (
                        <MicIcon size={12} />
                      )}
                    </BadgeIcon>
                    {config.captureMode === 'browser_tab' ? '브라우저 탭' : '마이크'}
                  </Badge>
                </SessionMeta>
              </HeaderLeft>
              <HeaderRight>
                {isRecording && (
                  <RecordingIndicator>
                    <RecordDot />
                    녹음 중 · 04:38
                  </RecordingIndicator>
                )}
                <StopBtn onClick={() => setIsRecording(false)}>
                  {isRecording ? <StopIcon size={14} /> : <CheckIcon size={14} />}
                  <span>{isRecording ? '중지' : '완료'}</span>
                </StopBtn>
              </HeaderRight>
            </MainHeader>

            <Transcript>
              {MOCK_LIVE_UTTERANCES.map((u) => (
                <UtteranceCard key={u.id} $isQuestion={u.isQuestion && !u.isSelf}>
                  <UtteranceHeader>
                    <Speaker>{u.speaker}</Speaker>
                    <Timestamp>{u.timestamp}</Timestamp>
                  </UtteranceHeader>
                  <Original $bold={u.isQuestion && !u.isSelf}>{u.original}</Original>
                  {u.translation && (
                    <Translation $bold={u.isQuestion && !u.isSelf}>{u.translation}</Translation>
                  )}
                  {u.isQuestion && !u.isSelf && (
                    <QuestionBar>
                      <QuestionLabel>
                        <HelpCircleIcon size={14} />
                        <span>질문</span>
                      </QuestionLabel>
                      <FindAnswerBtn>
                        <span>답변 찾기</span>
                        <ArrowRightIcon size={14} />
                      </FindAnswerBtn>
                    </QuestionBar>
                  )}
                </UtteranceCard>
              ))}

              {isRecording && (
                <InterimCard>
                  <UtteranceHeader>
                    <Speaker>···</Speaker>
                    <Timestamp>실시간</Timestamp>
                  </UtteranceHeader>
                  <InterimText>회의 도중 인식 결과가 여기에 실시간으로...</InterimText>
                </InterimCard>
              )}
            </Transcript>
          </>
        )}

        {viewMode === 'review' && (
          <>
            <MainHeader>
              <HeaderLeft>
                <SessionTitle>
                  {MOCK_SESSIONS.find((s) => s.id === activeSessionId)?.title}
                </SessionTitle>
                <SessionMeta>
                  <Badge>리뷰</Badge>
                </SessionMeta>
              </HeaderLeft>
              <HeaderRight>
                <SecondaryBtn>요약 생성</SecondaryBtn>
                <SecondaryBtn>질문 보기</SecondaryBtn>
              </HeaderRight>
            </MainHeader>
            <Transcript>
              {MOCK_LIVE_UTTERANCES.map((u: MockUtterance) => (
                <UtteranceCard key={u.id} $isQuestion={u.isQuestion && !u.isSelf}>
                  <UtteranceHeader>
                    <Speaker>{u.speaker}</Speaker>
                    <Timestamp>{u.timestamp}</Timestamp>
                  </UtteranceHeader>
                  <Original $bold={u.isQuestion && !u.isSelf}>{u.original}</Original>
                  {u.translation && (
                    <Translation $bold={u.isQuestion && !u.isSelf}>{u.translation}</Translation>
                  )}
                </UtteranceCard>
              ))}
            </Transcript>
          </>
        )}
      </Main>

      <StartMeetingModal
        open={showStartModal}
        onClose={() => setShowStartModal(false)}
        onStart={handleStart}
      />
    </Layout>
  );
};

export default QNotePage;

// ─────────────────────────────────────────────────────────
// 색상 토큰 (이 페이지의 모든 색상은 아래 목록에서만)
// PRIMARY: #14B8A6 #0D9488 #115E59 #F0FDFA #CCFBF1 #99F6E4
// POINT:   #F43F5E #E11D48 #FFF1F2 #FFE4E6 #FECDD3 #9F1239
// NEUTRAL: #FFFFFF #F8FAFC #F1F5F9 #E2E8F0 #CBD5E1 #94A3B8 #64748B #334155 #0F172A
// ─────────────────────────────────────────────────────────

const Layout = styled.div<{ $collapsed: boolean }>`
  display: grid;
  grid-template-columns: ${(p) => (p.$collapsed ? '0px 1fr' : '300px 1fr')};
  height: calc(100vh - 64px);
  background: #f8fafc;
  transition: grid-template-columns 200ms ease;
`;

const Sidebar = styled.aside<{ $collapsed: boolean }>`
  background: #ffffff;
  border-right: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: translateX(${(p) => (p.$collapsed ? '-100%' : '0')});
  transition: transform 200ms ease;
  visibility: ${(p) => (p.$collapsed ? 'hidden' : 'visible')};
`;

const SidebarHeader = styled.div`
  padding: 20px 20px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const SidebarTitle = styled.h1`
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
`;

const NewSessionBtn = styled.button`
  height: 32px;
  padding: 0 12px;
  border: none;
  background: #14b8a6;
  color: #ffffff;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  &:hover {
    background: #0d9488;
  }
`;

const SearchBox = styled.input`
  margin: 0 20px 12px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  color: #0f172a;
  &::placeholder {
    color: #94a3b8;
  }
  &:focus {
    outline: none;
    border-color: #14b8a6;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15);
  }
`;

const SessionList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 4px 12px 20px;
`;

const SessionItem = styled.div<{ $active: boolean }>`
  padding: 12px 14px;
  border-radius: 10px;
  cursor: pointer;
  background: ${(p) => (p.$active ? '#f0fdfa' : 'transparent')};
  border: 1px solid ${(p) => (p.$active ? '#14b8a6' : 'transparent')};
  margin-bottom: 4px;
  transition: all 120ms;
  &:hover {
    background: #f8fafc;
  }
`;

const SessionItemTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const SessionItemMeta = styled.div`
  font-size: 11px;
  color: #64748b;
  display: flex;
  gap: 6px;
  align-items: center;
`;

const Dot = styled.span`
  color: #cbd5e1;
`;

const Main = styled.section`
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const CollapseToggle = styled.button`
  position: absolute;
  top: 50%;
  left: 0;
  transform: translate(-50%, -50%);
  z-index: 10;
  width: 24px;
  height: 48px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #64748b;
  border-radius: 0 8px 8px 0;
  cursor: pointer;
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  padding-left: 8px;
  box-shadow: 2px 0 6px rgba(15, 23, 42, 0.04);
  &:hover {
    color: #0d9488;
    border-color: #14b8a6;
  }
`;

const MainHeader = styled.div`
  padding: 20px 32px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
`;

const HeaderLeft = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const HeaderRight = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
`;

const SessionTitle = styled.h2`
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
`;

const SessionMeta = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  background: #f1f5f9;
  color: #475569;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
`;

const BadgeIcon = styled.span`
  display: inline-flex;
  align-items: center;
  color: #64748b;
`;

const RecordingIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 14px;
  background: #f0fdfa;
  color: #0f766e;
  border: 1px solid #99f6e4;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
`;

const RecordDot = styled.span`
  width: 8px;
  height: 8px;
  background: #0d9488;
  border-radius: 50%;
  animation: pulse 1.6s ease-in-out infinite;
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.4;
      transform: scale(0.85);
    }
  }
`;

const StopBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 18px;
  background: #14b8a6;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  &:hover {
    background: #0d9488;
  }
`;

const SecondaryBtn = styled.button`
  height: 36px;
  padding: 0 16px;
  background: #ffffff;
  color: #0d9488;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  &:hover {
    background: #f0fdfa;
    border-color: #14b8a6;
  }
`;

const Transcript = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px 80px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const UtteranceCard = styled.div<{ $isQuestion: boolean }>`
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-left: ${(p) => (p.$isQuestion ? '4px solid #f43f5e' : '1px solid #e2e8f0')};
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
`;

const UtteranceHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
`;

const Speaker = styled.span`
  font-size: 12px;
  font-weight: 700;
  color: #0d9488;
`;

const Timestamp = styled.span`
  font-size: 11px;
  color: #94a3b8;
`;

const Original = styled.div<{ $bold?: boolean }>`
  font-size: 15px;
  color: #0f172a;
  line-height: 1.55;
  margin-bottom: 6px;
  font-weight: ${(p) => (p.$bold ? 700 : 400)};
`;

const Translation = styled.div<{ $bold?: boolean }>`
  font-size: 13px;
  color: #64748b;
  line-height: 1.5;
  font-weight: ${(p) => (p.$bold ? 600 : 400)};
`;

const QuestionBar = styled.div`
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const QuestionLabel = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #9f1239;
  background: #ffe4e6;
  padding: 4px 10px;
  border-radius: 12px;
`;

const FindAnswerBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #f43f5e;
  color: #ffffff;
  border: none;
  height: 30px;
  padding: 0 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms;
  &:hover {
    background: #e11d48;
  }
  &:active {
    background: #be123c;
  }
`;

const InterimCard = styled.div`
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 12px;
  padding: 14px 18px;
`;

const InterimText = styled.div`
  font-size: 14px;
  color: #94a3b8;
`;

const EmptyState = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px;
`;

const EmptyIconWrap = styled.div`
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: #f0fdfa;
  color: #0d9488;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
`;

const EmptyTitle = styled.h2`
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 8px;
`;

const EmptyDesc = styled.p`
  font-size: 14px;
  color: #64748b;
  margin: 0 0 24px;
  line-height: 1.6;
`;

const EmptyBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 28px;
  background: #14b8a6;
  color: #ffffff;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  &:hover {
    background: #0d9488;
  }
`;
