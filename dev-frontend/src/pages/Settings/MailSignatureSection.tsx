// 메일 서명 — 계정마다 등록한다.
//
// 회사 공용 메일(help@…)과 내 개인 메일의 서명이 같을 리 없다. 그래서 워크스페이스 하나가 아니라
// **계정별**로 저장한다. 발송 시 백엔드(services/emailSend.appendSignature)가 본문 끝에 붙인다 —
// 답장·전달·새 메일 세 경로가 모두 그 한 곳을 지나므로 화면마다 붙이는 코드를 두지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import RichEditor from '../../components/Common/RichEditor';
import { apiFetch } from '../../contexts/AuthContext';

interface Props {
  businessId: number;
  accountId: number;
  initialHtml: string | null;
  initialEnabled: boolean;
}

export default function MailSignatureSection({ businessId, accountId, initialHtml, initialEnabled }: Props) {
  const { t } = useTranslation('qmail');
  const [html, setHtml] = useState(initialHtml || '');
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  const save = useCallback(async (patch: { signature_html?: string; signature_enabled?: boolean }) => {
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-accounts/${accountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error('save_failed');
      setErr(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setErr(true);
      setTimeout(() => setErr(false), 4000);
    }
  }, [businessId, accountId]);

  // 자동저장 — 입력 2초 debounce (저장 버튼 없음, PlanQ 표준)
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save({ signature_html: html }), 2000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [html, save]);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    save({ signature_enabled: next });   // 토글은 즉시 저장
  };

  return (
    <Wrap>
      <Head>
        {/* ★ 주소별 서명(위 "보내는 주소")이 생기면서 이 섹션이 무엇인지 모호해졌다.
            이름을 **기본 서명** 으로 바꿔 두 섹션을 같은 단어로 잇는다 —
            별칭 행의 "기본 서명 사용" 배지가 이 제목을 가리킨다.
            (Irene: "이 부분은 기본계정에 붙는 거지? … 좀 혼란스러운데") */}
        <Title>{t('signature.title', { defaultValue: '기본 서명' }) as string}</Title>
        <Right>
          {saved && <Badge $ok>{t('signature.saved', { defaultValue: '저장됨' }) as string}</Badge>}
          {err && <Badge>{t('signature.failed', { defaultValue: '저장 실패' }) as string}</Badge>}
          <Toggle
            type="button"
            role="switch"
            aria-checked={enabled}
            $on={enabled}
            onClick={toggle}
          >
            <Knob $on={enabled} />
          </Toggle>
          <ToggleText>{enabled
            ? t('signature.on', { defaultValue: '서명 사용' }) as string
            : t('signature.off', { defaultValue: '서명 안 씀' }) as string}</ToggleText>
        </Right>
      </Head>
      <Desc>{t('signature.desc', { defaultValue: '위 "보내는 주소"에 전용 서명이 없는 주소로 보낼 때 이 서명이 붙습니다. 답장·전달·새 메일 끝에 자동으로 들어가요.' }) as string}</Desc>
      {/* ★ 이 토글은 **메일함 전체 스위치**다 — 끄면 주소별 전용 서명까지 안 붙는다.
          "자동 첨부" 라고만 적혀 있어 주소별 스위치로 읽혔다. 그 사실을 문장으로 드러낸다. */}
      <ScopeNote>{enabled
        ? t('signature.scopeOn', { defaultValue: '이 스위치는 메일함 전체에 적용돼요. 끄면 주소별 전용 서명도 붙지 않습니다.' }) as string
        : t('signature.scopeOff', { defaultValue: '지금은 주소별 전용 서명을 포함해 어떤 서명도 붙지 않습니다.' }) as string}</ScopeNote>
      <EditorBox $dim={!enabled}>
        <RichEditor
          value={html}
          onChange={setHtml}
          placeholder={t('signature.placeholder', { defaultValue: '예) 홍길동 · 워프로랩 · 010-0000-0000' }) as string}
          minHeight={110}
        />
      </EditorBox>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex; flex-direction: column; gap: 8px;
  margin-top: 14px; padding-top: 14px; border-top: 1px solid #F1F5F9;
`;
const Head = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 12px;`;
const Title = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A;`;
const Right = styled.div`display: flex; align-items: center; gap: 8px;`;
const Badge = styled.span<{ $ok?: boolean }>`
  font-size: 0.6875rem; font-weight: 700; padding: 1px 8px; border-radius: 999px;
  color: ${(p) => (p.$ok ? '#0F766E' : '#B45309')};
  background: ${(p) => (p.$ok ? '#F0FDFA' : '#FEF3C7')};
`;
const Toggle = styled.button<{ $on: boolean }>`
  width: 34px; height: 20px; border-radius: 999px; border: none; cursor: pointer;
  padding: 2px; display: flex; align-items: center;
  background: ${(p) => (p.$on ? '#14B8A6' : '#CBD5E1')};
  transition: background 0.15s ease;
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const Knob = styled.span<{ $on: boolean }>`
  width: 16px; height: 16px; border-radius: 50%; background: #fff;
  transform: translateX(${(p) => (p.$on ? 14 : 0)}px);
  transition: transform 0.15s ease;
  @media (prefers-reduced-motion: reduce) { transition: none; }
`;
const ToggleText = styled.span`font-size: 0.6875rem; color: #64748B;`;
const Desc = styled.p`margin: 0; font-size: 0.75rem; color: #94A3B8; line-height: 1.6;`;
const ScopeNote = styled.p`
  margin: 0; padding: 6px 10px; border-radius: 8px;
  background: #F8FAFC; border: 1px solid #E2E8F0;
  font-size: 0.6875rem; color: #64748B; line-height: 1.6;
`;
const EditorBox = styled.div<{ $dim: boolean }>`
  opacity: ${(p) => (p.$dim ? 0.55 : 1)};
  transition: opacity 0.15s ease;
`;
