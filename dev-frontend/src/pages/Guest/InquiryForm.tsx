// 문의 남기기 폼 — 공개 페이지·창구 «안내» 본문 맨 아래 (2026-11-20 · docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §5.1 · §7 ①)
//
//   로그인·인증번호 없이 이름·이메일·내용만으로 보낸다(Irene «문의를 바로 남길 수 있게»).
//   보낸 것은 그 워크스페이스 Q sale «신규 문의» 에 쌓인다. 판정·저장은 서버 services/workspaceInquiry 한 곳.
// ★ 실패는 보이게 — 429·검증 오류는 폼 아래 문구로(조용한 실패 금지). 성공하면 폼 자리에 «보냈어요».
// ★ 숨은 칸(hp)·채운 시간(elapsed_ms)은 봇 판정용이다. 사람에게는 보이지 않는다(스크린리더에서도 숨김).
import { forwardRef, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import PlanQSelect from '../../components/Common/PlanQSelect';

export type InquiryService = { id: string; name: string };
type Props = {
  /** POST 주소 — 창구 `/api/guest/<token>/inquiries` · (P3) 공개 주소 */
  submitUrl: string | null;
  workspaceName: string;
  services: InquiryService[];
  askPhone: boolean;
  askCompany: boolean;
  /** 서비스 카드 [이 서비스 문의] 로 들어오면 미리 고른 서비스 */
  presetServiceId?: string | null;
  /** 설정 미리 보기 — 칸은 보이되 보낼 수 없다 */
  preview?: boolean;
};

const InquiryForm = forwardRef<HTMLDivElement, Props>(function InquiryForm(
  { submitUrl, workspaceName, services, askPhone, askCompany, presetServiceId, preview }, ref,
) {
  const { t, i18n } = useTranslation('guest');
  const openedAt = useRef(Date.now());
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [serviceId, setServiceId] = useState<string>(presetServiceId || '');
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => { if (presetServiceId) setServiceId(presetServiceId); }, [presetServiceId]);

  const disabled = preview || !submitUrl || busy;
  const canSend = !!name.trim() && /\S+@\S+\.\S+/.test(email) && message.trim().length >= 10 && consent;

  const send = async () => {
    if (disabled || !canSend) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(submitUrl as string, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email, phone: askPhone ? phone : undefined, company: askCompany ? company : undefined,
          service_id: serviceId || undefined, message, consent, hp,
          elapsed_ms: Date.now() - openedAt.current,
          locale: (i18n.language || '').startsWith('en') ? 'en' : 'ko',
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || (r.status === 429 ? 'too_many_requests' : `error_${r.status}`)); return; }
      setDone(true);
    } catch { setErr('network'); }
    finally { setBusy(false); }
  };

  const errText = (code: string) => t(`inquiry.err.${code}`, { defaultValue: t('inquiry.err.generic', { defaultValue: '보내지 못했어요. 잠시 뒤 다시 시도해 주세요.' }) });

  return (
    <Wrap ref={ref} data-testid="entry-inquiry-form">
      <Title>{t('inquiry.title', { defaultValue: '문의 남기기' })}</Title>
      {done ? (
        <Done data-testid="entry-inquiry-done">
          {t('inquiry.done', { name: workspaceName, defaultValue: '문의를 보냈어요. {{name}}에서 이메일로 답변드립니다.' })}
        </Done>
      ) : (
        <>
          <Row2>
            <Field>
              <Lbl htmlFor="inq-name">{t('inquiry.name', { defaultValue: '이름' })} *</Lbl>
              <In id="inq-name" data-testid="entry-inquiry-name" maxLength={100} value={name} disabled={preview}
                autoComplete="name" onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field>
              <Lbl htmlFor="inq-email">{t('inquiry.email', { defaultValue: '이메일' })} *</Lbl>
              <In id="inq-email" data-testid="entry-inquiry-email" type="email" maxLength={200} value={email} disabled={preview}
                autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </Row2>
          {(askPhone || askCompany) && (
            <Row2>
              {askPhone && (
                <Field>
                  <Lbl htmlFor="inq-phone">{t('inquiry.phone', { defaultValue: '전화' })}</Lbl>
                  <In id="inq-phone" type="tel" maxLength={40} value={phone} disabled={preview}
                    autoComplete="tel" onChange={(e) => setPhone(e.target.value)} />
                </Field>
              )}
              {askCompany && (
                <Field>
                  <Lbl htmlFor="inq-company">{t('inquiry.company', { defaultValue: '회사명' })}</Lbl>
                  {/* draft-exempt: 무로그인 공개 폼의 회사명 한 줄 — 초안 키 축(사용자·워크스페이스)이 없다 */}
                  <In id="inq-company" maxLength={200} value={company} disabled={preview}
                    autoComplete="organization" onChange={(e) => setCompany(e.target.value)} />
                </Field>
              )}
            </Row2>
          )}
          {services.length > 0 && (
            <Field>
              <Lbl htmlFor="inq-service">{t('inquiry.service', { defaultValue: '관심 서비스' })}</Lbl>
              <PlanQSelect inputId="inq-service" name="service_id" isSearchable={false} isDisabled={preview}
                options={[{ value: '', label: t('inquiry.serviceNone', { defaultValue: '선택 안 함' }) as string },
                  ...services.map((s) => ({ value: s.id, label: s.name }))]}
                value={{ value: serviceId, label: serviceId ? (services.find((s) => s.id === serviceId)?.name || '') : t('inquiry.serviceNone', { defaultValue: '선택 안 함' }) as string }}
                onChange={(opt: unknown) => setServiceId(String((opt as { value?: string } | null)?.value ?? ''))} />
            </Field>
          )}
          <Field>
            <Lbl htmlFor="inq-message">{t('inquiry.message', { defaultValue: '내용' })} *</Lbl>
            {/* draft-exempt: 무로그인 공개 폼 — 사용자·워크스페이스 축이 없어 초안 키를 만들 수 없다(보내면 끝나는 한 번짜리 폼) */}
            <Area id="inq-message" data-testid="entry-inquiry-message" rows={5} maxLength={2000} value={message} disabled={preview}
              placeholder={t('inquiry.messagePh', { defaultValue: '무엇이 궁금하신지 적어 주세요. (10자 이상)' }) as string}
              onChange={(e) => setMessage(e.target.value)} />
          </Field>
          {/* 봇 판정용 숨은 칸 — 사람에게는 보이지 않는다 */}
          <Hp aria-hidden="true">
            <label>Website<input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} /></label>
          </Hp>
          <Consent>
            <input type="checkbox" id="inq-consent" data-testid="entry-inquiry-consent" checked={consent} disabled={preview}
              onChange={(e) => setConsent(e.target.checked)} />
            <label htmlFor="inq-consent">
              {t('inquiry.consent', { name: workspaceName, defaultValue: '{{name}}이(가) 문의 답변을 위해 이름·이메일·내용을 수집·이용하는 데 동의합니다. (보관 1년)' })}
            </label>
          </Consent>
          {err && <Err data-testid="entry-inquiry-error" role="alert">{errText(err)}</Err>}
          <SendRow>
            <Send type="button" data-testid="entry-inquiry-send" disabled={disabled || !canSend} onClick={send}>
              {busy ? t('inquiry.sending', { defaultValue: '보내는 중…' }) : t('inquiry.send', { defaultValue: '문의 보내기' })}
            </Send>
            <Hint>{!canSend && !preview
              ? t('inquiry.needAll', { defaultValue: '이름·이메일·내용(10자 이상)을 적고 동의에 체크하면 보낼 수 있어요.' })
              : t('inquiry.noLogin', { defaultValue: '로그인 없이 바로 보낼 수 있어요.' })}</Hint>
          </SendRow>
        </>
      )}
    </Wrap>
  );
});
export default InquiryForm;

const Wrap = styled.div`
  display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid #E2E8F0;border-radius:12px;background:#fff;
  scroll-margin-top:72px;
`;
const Title = styled.div`font-size:0.9375rem;font-weight:700;color:#0F172A;`;
const Row2 = styled.div`display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:10px;`;
const Field = styled.div`display:flex;flex-direction:column;gap:4px;min-width:0;`;
const Lbl = styled.label`font-size:0.75rem;font-weight:600;color:#475569;`;
const In = styled.input`
  height:40px;padding:0 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:0.875rem;color:#0F172A;box-sizing:border-box;width:100%;
  &:focus{outline:none;border-color:#14B8A6;}
  &:disabled{background:#F8FAFC;}
`;
const Area = styled.textarea`
  padding:10px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:0.875rem;line-height:1.6;color:#0F172A;
  resize:vertical;font-family:inherit;box-sizing:border-box;width:100%;
  &:focus{outline:none;border-color:#14B8A6;}
  &:disabled{background:#F8FAFC;}
`;
const Hp = styled.div`position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;`;
const Consent = styled.div`
  display:flex;align-items:flex-start;gap:8px;font-size:0.75rem;color:#475569;line-height:1.5;
  input{margin-top:2px;width:1rem;height:1rem;flex-shrink:0;accent-color:#14B8A6;}
`;
const Err = styled.div`
  padding:8px 12px;background:#FFF1F2;border:1px solid #FECDD3;border-radius:8px;font-size:0.75rem;color:#B91C3C;
`;
const SendRow = styled.div`display:flex;align-items:center;flex-wrap:wrap;gap:10px;`;
const Send = styled.button`
  min-height:40px;padding:0 18px;border-radius:10px;border:none;cursor:pointer;
  background:#14B8A6;color:#fff;font-size:0.875rem;font-weight:700;
  &:hover:not(:disabled){background:#0D9488;}
  &:disabled{background:#99F6E4;cursor:not-allowed;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
const Hint = styled.span`font-size:0.75rem;color:#94A3B8;`;
const Done = styled.div`
  padding:12px 14px;background:#F0FDFA;border:1px solid #99F6E4;border-radius:8px;font-size:0.875rem;color:#0F766E;line-height:1.5;
`;
