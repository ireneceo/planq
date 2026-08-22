// 메일 주소를 클릭했을 때 뜨는 메뉴 (#261)
//
// 운영 신고: "상세에서도 클릭해서 블럭처리나 카피나 이 이메일 주소로 검색하거나 새메일로 하면
//   이 주소 들어가거나 고객정보로 저장하거나 등등 … 메일 기본 기능들 다 없어."
//
// 같은 신고에 "어떤 메일은 아예 안 들어와" 가 붙어 있었는데, 실측해보니 그 메일은 **보관함에 있었다**.
//   즉 못 받은 게 아니라 **사람을 기준으로 찾을 길이 없었던** 것이다 —
//   그래서 이 메뉴의 첫 항목이 "이 주소의 메일 보기"(보관 포함) 다.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useEscapeStack } from '../../hooks/useEscapeStack';

export interface AddressMenuProps {
  email: string;
  name?: string | null;
  businessId: number;
  /** 이 주소의 메일 모아보기 */
  onViewMail: (email: string) => void;
  /** 이 주소로 새 메일 쓰기 */
  onCompose: (email: string) => void;
  /** 고객으로 저장 (없을 때만 노출) */
  onSaveClient: (email: string, name?: string | null) => void;
  /** 이 발신자를 스팸으로 분류 */
  onBlock: (email: string) => void;
}

const AddressMenu: React.FC<AddressMenuProps> = ({ email, name, onViewMail, onCompose, onSaveClient, onBlock }) => {
  const { t } = useTranslation('qmail');
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEscapeStack(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* 클립보드 권한이 없으면 조용히 넘어간다 — 다른 항목은 그대로 쓸 수 있다 */ }
  };

  const pick = (fn: () => void) => { setOpen(false); fn(); };

  return (
    <Wrap ref={wrapRef}>
      <AddrBtn
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={email}
        data-testid="mail-address-open"
      >
        {email}
      </AddrBtn>
      {copied && <Copied role="status">{t('address.copied', { defaultValue: '복사됨' }) as string}</Copied>}
      {open && (
        <Menu role="menu" onClick={(e) => e.stopPropagation()}>
          <MenuHead>{name ? `${name} · ${email}` : email}</MenuHead>
          <Item role="menuitem" type="button" onClick={() => pick(() => onViewMail(email))}>
            {t('address.viewMail', { defaultValue: '이 주소의 메일 보기' }) as string}
          </Item>
          <Item role="menuitem" type="button" onClick={() => pick(copy)}>
            {t('address.copy', { defaultValue: '주소 복사' }) as string}
          </Item>
          <Item role="menuitem" type="button" onClick={() => pick(() => onCompose(email))}>
            {t('address.compose', { defaultValue: '이 주소로 새 메일' }) as string}
          </Item>
          <Item role="menuitem" type="button" onClick={() => pick(() => onSaveClient(email, name))}>
            {t('address.saveClient', { defaultValue: '고객으로 저장' }) as string}
          </Item>
          <Divider />
          {/* 차단은 원본을 지우지 않는다 — 분류만 바꾼다. 규칙 화면에서 언제든 되돌릴 수 있다. */}
          <Item role="menuitem" type="button" $danger onClick={() => pick(() => onBlock(email))}>
            {t('address.block', { defaultValue: '스팸으로 분류' }) as string}
          </Item>
          <Hint>{t('address.blockHint', { defaultValue: '원본은 남습니다. 규칙 설정에서 되돌릴 수 있어요.' }) as string}</Hint>
        </Menu>
      )}
    </Wrap>
  );
};

export default AddressMenu;

const Wrap = styled.span` position: relative; display: inline-flex; align-items: center; `;
const AddrBtn = styled.button`
  background: none; border: none; padding: 0; cursor: pointer;
  font: inherit; color: inherit; text-decoration: underline dotted;
  text-underline-offset: 2px;
  &:hover { color: #F43F5E; }
  &:focus-visible { outline: 2px solid #F43F5E; outline-offset: 2px; border-radius: 3px; }
`;
const Copied = styled.span`
  margin-left: 6px; padding: 1px 6px; border-radius: 999px;
  background: #DCFCE7; color: #166534; font-size: 10px; font-weight: 700;
`;
const Menu = styled.div`
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 60;
  min-width: 210px; padding: 6px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  display: flex; flex-direction: column; gap: 2px;
`;
const MenuHead = styled.div`
  padding: 6px 8px 8px; font-size: 11px; color: #94A3B8;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border-bottom: 1px solid #F1F5F9; margin-bottom: 4px;
`;
const Item = styled.button<{ $danger?: boolean }>`
  display: block; width: 100%; text-align: left;
  padding: 8px 10px; min-height: 36px;
  background: none; border: none; border-radius: 7px; cursor: pointer;
  font-size: 13px; color: ${p => (p.$danger ? '#B91C1C' : '#334155')};
  &:hover { background: ${p => (p.$danger ? '#FEF2F2' : '#F1F5F9')}; }
`;
const Divider = styled.div` height: 1px; background: #F1F5F9; margin: 4px 0; `;
const Hint = styled.div` padding: 2px 10px 6px; font-size: 10px; color: #94A3B8; line-height: 1.4; `;
