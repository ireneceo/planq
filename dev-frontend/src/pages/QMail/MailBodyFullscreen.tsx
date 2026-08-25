// pages/QMail/MailBodyFullscreen.tsx — 메일 본문 전체 화면 읽기 (운영 #260)
//
// 왜 필요한가: 본문 iframe 은 이미 내용만큼 늘어나므로 "잘리는" 문제가 아니다.
//   좁은 3분할 패널 안에서 읽는 게 답답한 것이다("보이는 높이값이 낮아서 답답한 감이 있네" — Irene).
//   → 같은 srcDoc 을 화면 전체에 띄워 읽기만 하는 모드를 만든다. 본문을 다시 만들지 않고 그대로 재사용한다.
//
// 보안: 원본과 **같은 sandbox 조합**을 쓴다(allow-scripts, same-origin 없음).
//   여기서 sandbox 를 느슨하게 하면 정화·격리 계약이 이 경로에서만 깨진다.
import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 헤더에 보일 제목 — 보통 메일 제목 */
  title: string;
  /** 보낸사람 등 부가 한 줄 */
  subtitle?: string;
  /** 본문 srcDoc (ThreadMessages 가 쓰는 buildMailSrcDoc 결과 그대로) */
  srcDoc?: string;
  /** HTML 이 없는 메일의 평문 본문 */
  text?: string | null;
}

const MailBodyFullscreen: React.FC<Props> = ({ open, onClose, title, subtitle, srcDoc, text }) => {
  const { t } = useTranslation('qmail');
  const ref = useRef<HTMLDivElement>(null);
  useBodyScrollLock(open);
  useEscapeStack(open, onClose);
  useFocusTrap(ref, open);
  if (!open) return null;

  return createPortal(
    <Backdrop onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Panel ref={ref} role="dialog" aria-modal="true" aria-label={title || (t('detail.fullView', { defaultValue: '전체 화면으로 보기' }) as string)}>
        <Head>
          <HeadText>
            <HeadTitle>{title}</HeadTitle>
            {subtitle && <HeadSub>{subtitle}</HeadSub>}
          </HeadText>
          <CloseBtn type="button" onClick={onClose}
            aria-label={t('common.close', { defaultValue: '닫기' }) as string}
            title={t('common.close', { defaultValue: '닫기' }) as string}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </CloseBtn>
        </Head>
        <Body>
          {srcDoc
            ? <Frame sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" srcDoc={srcDoc} title={title || 'mail'} />
            : <PlainText>{text || (t('detail.noContent', { defaultValue: '(내용 없음)' }) as string)}</PlainText>}
        </Body>
      </Panel>
    </Backdrop>,
    document.body,
  );
};

export default MailBodyFullscreen;

const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 1200;
  background: rgba(15, 23, 42, 0.55);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  @media (max-width: 768px) { padding: 0; }
`;
const Panel = styled.div`
  display: flex; flex-direction: column;
  width: min(1100px, 100%); height: min(92vh, 100%);
  background: #fff; border-radius: 14px; overflow: hidden;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28);
  @media (max-width: 768px) {
    width: 100%; height: 100%; border-radius: 0;
    padding-bottom: var(--pq-safe-bottom, 0px);
  }
`;
const Head = styled.div`
  display: flex; align-items: center; gap: 12px;
  min-height: 60px; padding: 14px 20px;
  background: #fff; border-bottom: 1px solid #e2e8f0;
`;
const HeadText = styled.div` flex: 1; min-width: 0; `;
const HeadTitle = styled.div`
  font-size: 16px; font-weight: 700; letter-spacing: -0.2px; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const HeadSub = styled.div`
  margin-top: 2px; font-size: 12px; color: #64748B;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const CloseBtn = styled.button`
  flex-shrink: 0; width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 8px;
  color: #64748B; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
// 본문이 패널 가장자리에 붙지 않게 **바깥 컨테이너**가 여백을 준다.
//   iframe 안(srcDoc 의 guard)은 건드리지 않는다 — 거기 margin:0 은 뉴스레터 템플릿 디자인을
//   보존하려고 일부러 넣은 것이라, 안쪽을 고치면 발신자 레이아웃이 깨진다.
const Body = styled.div`
  flex: 1; min-height: 0; overflow: auto; background: #fff;
  padding: 20px 24px;
  @media (max-width: 768px) { padding: 12px; }
`;
// 전체 화면에서는 iframe 이 영역을 꽉 채우고 **자기 안에서** 스크롤한다.
//   바깥 Body 스크롤과 겹치면 두 겹 스크롤이 되어 읽기가 더 나빠진다.
const Frame = styled.iframe` width: 100%; height: 100%; border: none; display: block; background: #fff; `;
const PlainText = styled.pre`
  margin: 0; padding: 0;   /* 여백은 Body 가 담당 — 여기에도 주면 이중이 된다 */
  font: inherit; font-size: 14px; line-height: 1.7; color: #0F172A;
  white-space: pre-wrap; word-break: break-word;
`;
