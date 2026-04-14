import { useState, useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { HelpCircleIcon, PlusIcon } from '../../components/Common/Icons';

// ─────────────────────────────────────────────────────────
// Q Talk Page — Phase 5 UI Mock (승인 대기용)
// 실제 API 연결은 Irene 승인 후 별도 세션에서 진행됩니다.
// ─────────────────────────────────────────────────────────

const Layout = styled.div`
  display: grid;
  grid-template-columns: 300px 1fr 320px;
  height: calc(100vh - 64px);
  background: #f8fafc;
  position: relative;
  @media (max-width: 1200px) {
    grid-template-columns: 280px 1fr;
  }
  @media (max-width: 900px) {
    display: block;
  }
`;

const LeftPanel = styled.aside`
  background: #ffffff;
  border-right: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  @media (max-width: 900px) {
    display: none;
  }
`;

const LeftHeader = styled.div`
  padding: 20px 20px 12px;
  border-bottom: 1px solid #f1f5f9;
`;

const LeftTitle = styled.h1`
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 4px;
`;

const LeftSub = styled.p`
  font-size: 12px;
  color: #94a3b8;
  margin: 0;
`;

const FilterRow = styled.div`
  display: flex;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid #f1f5f9;
`;

const FilterBtn = styled.button<{ $active?: boolean }>`
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid ${(p) => (p.$active ? '#14b8a6' : '#e2e8f0')};
  background: ${(p) => (p.$active ? '#f0fdfa' : '#ffffff')};
  color: ${(p) => (p.$active ? '#0d9488' : '#475569')};
  border-radius: 999px;
  cursor: pointer;
  &:hover {
    border-color: #14b8a6;
    color: #0d9488;
  }
`;

const ConvList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
`;

const ConvItem = styled.div<{ $active?: boolean }>`
  padding: 14px 18px;
  border-left: 3px solid ${(p) => (p.$active ? '#14b8a6' : 'transparent')};
  background: ${(p) => (p.$active ? '#f0fdfa' : 'transparent')};
  cursor: pointer;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  &:hover {
    background: #f8fafc;
  }
`;

const Avatar = styled.div<{ $color?: string }>`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: ${(p) => p.$color || '#14b8a6'};
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
`;

const ConvInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const ConvNameRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const ConvName = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ConvTime = styled.div`
  font-size: 11px;
  color: #94a3b8;
  flex-shrink: 0;
`;

const ConvPreview = styled.div`
  font-size: 12px;
  color: #64748b;
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const StateDot = styled.span<{ $color: string }>`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${(p) => p.$color};
  margin-right: 6px;
`;

const MainPanel = styled.section`
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
`;

const MainHeader = styled.div`
  padding: 14px 24px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const MainHeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const HeaderName = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
`;

const HeaderMeta = styled.div`
  font-size: 11px;
  color: #64748b;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const CueStatus = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
  color: #9f1239;
  background: #ffe4e6;
  border-radius: 10px;
`;

const MessageArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const MsgRow = styled.div<{ $mine?: boolean; $cue?: boolean }>`
  display: flex;
  gap: 10px;
  flex-direction: ${(p) => (p.$mine ? 'row-reverse' : 'row')};
`;

const MsgAvatar = styled.div<{ $cue?: boolean }>`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: ${(p) => (p.$cue ? '#f43f5e' : '#14b8a6')};
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
`;

const MsgBody = styled.div<{ $mine?: boolean; $cue?: boolean }>`
  max-width: 75%;
  padding: 10px 14px;
  border-radius: 12px;
  background: ${(p) => (p.$mine ? '#0f172a' : p.$cue ? '#fff1f2' : '#ffffff')};
  color: ${(p) => (p.$mine ? '#ffffff' : '#0f172a')};
  border: 1px solid ${(p) => (p.$mine ? '#0f172a' : p.$cue ? '#fecdd3' : '#e2e8f0')};
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
`;

const MsgHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 4px;
`;

const CueBadge = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  background: #f43f5e;
  color: #ffffff;
  border-radius: 6px;
  font-size: 9px;
`;

const MsgText = styled.div`
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
`;

const Sources = styled.div`
  margin-top: 8px;
  padding: 8px 10px;
  background: #fafaf9;
  border: 1px dashed #e7e5e4;
  border-radius: 8px;
  font-size: 11px;
  color: #78716c;
`;

const SourceItem = styled.div`
  display: flex;
  gap: 6px;
  padding: 2px 0;
`;

const MsgTime = styled.div`
  font-size: 10px;
  color: #94a3b8;
  margin-top: 4px;
`;

const Composer = styled.div`
  border-top: 1px solid #e2e8f0;
  background: #ffffff;
  padding: 12px 20px 16px;
`;

const ComposerInput = styled.textarea`
  width: 100%;
  min-height: 48px;
  max-height: 180px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 14px;
  resize: vertical;
  outline: none;
  font-family: inherit;
  &:focus { border-color: #14b8a6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15); }
`;

const ComposerBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
`;

const InternalToggle = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #64748b;
  cursor: pointer;
`;

const SendBtn = styled.button`
  margin-left: auto;
  height: 36px;
  padding: 0 18px;
  background: #14b8a6;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  &:hover { background: #0d9488; }
`;

const RightPanel = styled.aside`
  background: #ffffff;
  border-left: 1px solid #e2e8f0;
  overflow-y: auto;
  padding: 18px 18px 28px;
  @media (max-width: 1200px) {
    display: none;
  }
`;

const SideSection = styled.div`
  margin-bottom: 20px;
`;

const SideTitle = styled.h3`
  font-size: 12px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 8px;
`;

const ProfileCard = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
`;

const ProfileInfo = styled.div`
  flex: 1;
`;

const ProfileName = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
`;

const ProfileCompany = styled.div`
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
`;

const SummaryBox = styled.div`
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 12px;
  color: #475569;
  line-height: 1.5;
`;

const InProgressItem = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 12px;
  color: #475569;
  margin-bottom: 6px;
`;

const StatusPill = styled.span<{ $color?: string }>`
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  background: ${(p) => p.$color || '#f1f5f9'};
  color: ${(p) => (p.$color ? '#ffffff' : '#475569')};
  border-radius: 8px;
`;

const SuggestCard = styled.div`
  padding: 10px 12px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  font-size: 12px;
  color: #92400e;
  margin-bottom: 8px;
`;

const SuggestPreview = styled.div`
  color: #451a03;
  margin-bottom: 6px;
  line-height: 1.5;
`;

const SuggestSend = styled.button`
  padding: 4px 10px;
  background: #f59e0b;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  &:hover { background: #d97706; }
`;

const InternalMemo = styled.textarea`
  width: 100%;
  min-height: 72px;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 12px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  background: #fffbeb;
  &:focus { border-color: #f59e0b; }
`;

const BannerCard = styled.div`
  background: #ffffff;
  border: 1px dashed #cbd5e1;
  border-radius: 12px;
  padding: 20px 24px;
  margin: 24px;
  max-width: 680px;
`;

const BannerTitle = styled.h2`
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 4px;
`;

const BannerDesc = styled.p`
  font-size: 13px;
  color: #64748b;
  margin: 0 0 16px;
`;

const BannerSubTitle = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 12px 0 6px;
`;

const BannerList = styled.ul`
  margin: 0;
  padding: 0 0 0 18px;
  font-size: 13px;
  color: #475569;
  line-height: 1.7;
`;

// ─────────────────────────────────────────────────────────
// 목업 데이터 (실 API 연결 전 화면 확인용)
// ─────────────────────────────────────────────────────────
type MockConv = { id: number; name: string; company: string; avatar: string; color: string; preview: string; time: string; state: 'cue' | 'human' | 'paused' };
type MockMsg = { id: number; sender: 'client' | 'human' | 'cue'; name: string; text: string; time: string; sources?: { title: string; section: string }[] };

const MOCK_CONVS: MockConv[] = [
  { id: 1, name: '김서연', company: 'A사', avatar: '김', color: '#14b8a6', preview: '시안 수정 부탁드려요', time: '14:32', state: 'cue' },
  { id: 2, name: 'Sarah Lee', company: 'B Corp', avatar: 'S', color: '#0ea5e9', preview: 'When can we schedule...', time: '13:10', state: 'human' },
  { id: 3, name: '이준호', company: '스타트업C', avatar: '이', color: '#f59e0b', preview: '환불 문의드립니다', time: '11:45', state: 'paused' },
  { id: 4, name: 'Maria Rossi', company: 'D s.r.l.', avatar: 'M', color: '#a855f7', preview: 'Grazie per la risposta!', time: '어제', state: 'cue' },
];

const MOCK_MSGS: MockMsg[] = [
  { id: 1, sender: 'client', name: '김서연', text: '안녕하세요, 지난번 시안 2개를 금요일까지 보내주실 수 있을까요?', time: '14:28' },
  { id: 2, sender: 'cue', name: 'Cue', text: '안녕하세요 김서연님. 금요일 오후 2시까지 드리는 일정으로 확인됐습니다. 시안 방향은 기존 버전을 유지할까요?', time: '14:28',
    sources: [
      { title: '작업 일정 가이드', section: '시안 납기 — 3.1' },
      { title: '서비스 정책 v2', section: '수정 횟수 — 2.4' },
    ]
  },
  { id: 3, sender: 'client', name: '김서연', text: '네 기존 방향 유지하되, 컬러 톤만 조금 밝게 해주시면 좋겠어요', time: '14:30' },
  { id: 4, sender: 'human', name: '나 (Irene)', text: '확인했습니다. 금요일 오후 2시까지 2개 시안 + 밝은 컬러 톤으로 작업해서 전달드릴게요.', time: '14:32' },
];

// ─────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────
export default function QTalkPage() {
  const { t } = useTranslation('qtalk');
  const [filter, setFilter] = useState<'all' | 'mine' | 'unread'>('all');
  const [selectedId, setSelectedId] = useState<number>(1);
  const [composer, setComposer] = useState('');
  const [isInternal, setIsInternal] = useState(false);

  const selected = useMemo(() => MOCK_CONVS.find((c) => c.id === selectedId), [selectedId]);

  return (
    <Layout>
      {/* ─── LEFT: 대화 리스트 ─── */}
      <LeftPanel>
        <LeftHeader>
          <LeftTitle>{t('page.title')}</LeftTitle>
          <LeftSub>{t('page.subtitle')}</LeftSub>
        </LeftHeader>

        <FilterRow>
          <FilterBtn $active={filter === 'all'} onClick={() => setFilter('all')}>{t('page.listHeader.all')}</FilterBtn>
          <FilterBtn $active={filter === 'mine'} onClick={() => setFilter('mine')}>{t('page.listHeader.mine')}</FilterBtn>
          <FilterBtn $active={filter === 'unread'} onClick={() => setFilter('unread')}>{t('page.listHeader.unread')}</FilterBtn>
        </FilterRow>

        <ConvList>
          {MOCK_CONVS.map((c) => {
            const stateColor =
              c.state === 'cue' ? '#f43f5e' :
              c.state === 'human' ? '#14b8a6' :
              '#94a3b8';
            return (
              <ConvItem
                key={c.id}
                $active={c.id === selectedId}
                onClick={() => setSelectedId(c.id)}
              >
                <Avatar $color={c.color}>{c.avatar}</Avatar>
                <ConvInfo>
                  <ConvNameRow>
                    <ConvName>{c.name}</ConvName>
                    <ConvTime>{c.time}</ConvTime>
                  </ConvNameRow>
                  <ConvPreview>
                    <StateDot $color={stateColor} />
                    {c.preview}
                  </ConvPreview>
                </ConvInfo>
              </ConvItem>
            );
          })}
        </ConvList>
      </LeftPanel>

      {/* ─── MIDDLE: 대화 메인 ─── */}
      <MainPanel>
        {selected ? (
          <>
            <MainHeader>
              <MainHeaderLeft>
                <Avatar $color={selected.color}>{selected.avatar}</Avatar>
                <div>
                  <HeaderName>{selected.name}</HeaderName>
                  <HeaderMeta>
                    {selected.company}
                  </HeaderMeta>
                </div>
              </MainHeaderLeft>
              <CueStatus>
                <StateDot $color="#f43f5e" />
                {selected.state === 'paused' ? t('page.state.cuePaused') : t('page.state.cueActive')}
              </CueStatus>
            </MainHeader>

            <MessageArea>
              {MOCK_MSGS.map((m) => {
                const isMine = m.sender === 'human';
                const isCue = m.sender === 'cue';
                return (
                  <MsgRow key={m.id} $mine={isMine} $cue={isCue}>
                    {!isMine && (
                      <MsgAvatar $cue={isCue}>
                        {isCue ? 'C' : m.name.charAt(0)}
                      </MsgAvatar>
                    )}
                    <div>
                      <MsgBody $mine={isMine} $cue={isCue}>
                        <MsgHeader>
                          {isCue && <CueBadge>{t('page.message.cueBadge')}</CueBadge>}
                          <span>{m.name}</span>
                        </MsgHeader>
                        <MsgText>{m.text}</MsgText>
                        {m.sources && m.sources.length > 0 && (
                          <Sources>
                            <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('page.message.sources')}</div>
                            {m.sources.map((s, i) => (
                              <SourceItem key={i}>
                                <span>·</span>
                                <span>{s.title} → {s.section}</span>
                              </SourceItem>
                            ))}
                          </Sources>
                        )}
                      </MsgBody>
                      <MsgTime style={{ textAlign: isMine ? 'right' : 'left' }}>{m.time}</MsgTime>
                    </div>
                  </MsgRow>
                );
              })}

              <BannerCard>
                <BannerTitle>{t('page.comingSoon.title')}</BannerTitle>
                <BannerDesc>{t('page.comingSoon.desc')}</BannerDesc>

                <BannerSubTitle>완료</BannerSubTitle>
                <BannerList>
                  {(t('page.comingSoon.done', { returnObjects: true }) as string[]).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </BannerList>

                <BannerSubTitle>다음</BannerSubTitle>
                <BannerList>
                  {(t('page.comingSoon.next', { returnObjects: true }) as string[]).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </BannerList>
              </BannerCard>
            </MessageArea>

            <Composer>
              <ComposerInput
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                placeholder={t('page.composer.placeholder') || ''}
              />
              <ComposerBar>
                <InternalToggle>
                  <input
                    type="checkbox"
                    checked={isInternal}
                    onChange={(e) => setIsInternal(e.target.checked)}
                  />
                  {t('page.composer.internal')}
                </InternalToggle>
                <SendBtn onClick={() => { /* mock: no-op until approved */ }}>
                  {t('page.composer.send')}
                </SendBtn>
              </ComposerBar>
            </Composer>
          </>
        ) : (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <HelpCircleIcon size={42} />
            <h2 style={{ color: '#0f172a', marginTop: 14 }}>{t('page.empty.title')}</h2>
            <p style={{ color: '#64748b' }}>{t('page.empty.desc')}</p>
            <button style={{ marginTop: 14, background: '#14b8a6', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 8, fontSize: 14, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <PlusIcon size={14} />
              {t('page.empty.invite')}
            </button>
          </div>
        )}
      </MainPanel>

      {/* ─── RIGHT: 고객 사이드패널 ─── */}
      <RightPanel>
        {selected && (
          <>
            <SideSection>
              <SideTitle>{t('page.sidebar.profile')}</SideTitle>
              <ProfileCard>
                <Avatar $color={selected.color}>{selected.avatar}</Avatar>
                <ProfileInfo>
                  <ProfileName>{selected.name}</ProfileName>
                  <ProfileCompany>{selected.company}</ProfileCompany>
                </ProfileInfo>
              </ProfileCard>
            </SideSection>

            <SideSection>
              <SideTitle>{t('page.sidebar.summary')}</SideTitle>
              <SummaryBox>
                • 로고 리뉴얼 진행 중<br />
                • 시안 2개 금요일까지<br />
                • 컬러 톤 밝게 요청<br />
                • 다음 단계: 내부 검토 후 발송
              </SummaryBox>
            </SideSection>

            <SideSection>
              <SideTitle>{t('page.sidebar.inProgress')}</SideTitle>
              <InProgressItem>
                <span style={{ flex: 1 }}>시안 2개 작업</span>
                <StatusPill $color="#f59e0b">진행중</StatusPill>
              </InProgressItem>
              <InProgressItem>
                <span style={{ flex: 1 }}>4월 작업비 청구서</span>
                <StatusPill>발송대기</StatusPill>
              </InProgressItem>
            </SideSection>

            <SideSection>
              <SideTitle>{t('page.sidebar.cueSuggestions')}</SideTitle>
              <SuggestCard>
                <SuggestPreview>
                  "금요일 오후 2시에 작업물 전달드릴 예정이에요. 컬러 톤은 기존 대비 +15% 밝기로 조정합니다."
                </SuggestPreview>
                <SuggestSend>보내기</SuggestSend>
              </SuggestCard>
            </SideSection>

            <SideSection>
              <SideTitle>{t('page.sidebar.internalNote')}</SideTitle>
              <InternalMemo
                placeholder={t('page.sidebar.internalNotePlaceholder') || ''}
                defaultValue="고객이 컬러 톤에 민감. 지난주에도 비슷한 피드백 있었음."
              />
            </SideSection>
          </>
        )}
      </RightPanel>
    </Layout>
  );
}
