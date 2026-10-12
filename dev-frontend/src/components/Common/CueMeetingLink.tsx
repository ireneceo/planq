// components/Common/CueMeetingLink.tsx — Cue 가 만든·붙인 화상회의 링크 한 줄 (2026-10-12).
//
// Irene: *"일정 추가하고 화상 체크하라고 하면 등록한 다음 나한테 화상링크도 주고 그래야지."*
// Cue 의 글 답은 카드를 누르기 **전에** 쓰여 링크를 말할 수 없다 — 실행 결과(meeting_url)를 이 줄이 보여 준다.
// Cue 대화(CueTurnList)와 음성 시트(VoiceCaptureSheet)가 같이 쓴다. 복사 성공은 토스트가 아니라 버튼 글자로.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

function safeHttpUrl(u: string): string | null {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.toString() : null;
  } catch { return null; }
}

export default function CueMeetingLink({ url }: { url: string }) {
  const { t } = useTranslation('common');
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const href = safeHttpUrl(url);
  if (!href) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch { /* 복사 권한이 없으면 링크를 눌러 열면 된다 */ }
  };

  return (
    <Row data-testid="cue-meeting-link">
      <Label>{t('qhelper.action.meetLink', '화상회의 링크')}</Label>
      <Link href={href} target="_blank" rel="noopener noreferrer">{href.replace(/^https?:\/\//, '')}</Link>
      <CopyBtn type="button" onClick={copy} data-testid="cue-meeting-link-copy">
        {copied ? t('qhelper.action.meetLinkCopied', '복사됨') : t('qhelper.action.meetLinkCopy', '복사')}
      </CopyBtn>
    </Row>
  );
}

const Row = styled.div`
  margin-top: 5px; display: flex; align-items: center; gap: 6px; min-width: 0;
  font-size: 0.75rem; background: #F0FDFA; border: 1px solid #CCFBF1; border-radius: 6px; padding: 5px 8px;
`;
const Label = styled.span`flex-shrink: 0; color: #0F766E; font-weight: 600;`;
const Link = styled.a`
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: #0F766E; text-decoration: underline;
`;
const CopyBtn = styled.button`
  flex-shrink: 0; min-height: 32px; padding: 0 10px; border-radius: 6px; cursor: pointer;
  border: 1px solid #99F6E4; background: #fff; color: #0F766E; font-size: 0.75rem; font-weight: 600;
  &:hover { background: #CCFBF1; }
`;
