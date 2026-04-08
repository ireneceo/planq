import React, { useState, useRef, useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '\u{1F1EC}\u{1F1E7}' },
  { code: 'ko', label: '\uD55C\uAD6D\uC5B4', flag: '\u{1F1F0}\u{1F1F7}' },
];

interface LanguageSelectorProps {
  variant?: 'dropdown' | 'compact' | 'sidebar' | 'icon';
}

const LanguageSelector: React.FC<LanguageSelectorProps> = ({ variant = 'dropdown' }) => {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentLang = LANGUAGES.find(l => l.code === i18n.language) || LANGUAGES[0];

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = async (code: string) => {
    setOpen(false);
    if (code === i18n.language) return;
    await i18n.changeLanguage(code);
    localStorage.setItem('i18nextLng', code);
    if (user) {
      try {
        const { apiFetch } = await import('../../contexts/AuthContext');
        await apiFetch('/api/users/language', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: code })
        });
      } catch { /* best-effort */ }
    }
  };

  if (variant === 'icon') {
    return (
      <Container ref={ref}>
        <IconToggle onClick={() => setOpen(!open)}>{currentLang.flag}</IconToggle>
        {open && (
          <Dropdown $direction="down">
            {LANGUAGES.map(lang => (
              <Option key={lang.code} $active={lang.code === i18n.language} onClick={() => handleSelect(lang.code)}>
                <span>{lang.flag}</span>
                <span>{lang.label}</span>
                {lang.code === i18n.language && <Check>&#x2713;</Check>}
              </Option>
            ))}
          </Dropdown>
        )}
      </Container>
    );
  }

  if (variant === 'sidebar') {
    return (
      <Container ref={ref} style={{ width: '100%' }}>
        <SidebarToggle onClick={() => setOpen(!open)}>
          <SidebarLeft>
            <FlagCircle>{currentLang.flag}</FlagCircle>
            <SidebarLabel>{currentLang.label}</SidebarLabel>
          </SidebarLeft>
          <Arrow $open={open}>&#x25BE;</Arrow>
        </SidebarToggle>
        {open && (
          <Dropdown $direction="up">
            {LANGUAGES.map(lang => (
              <Option key={lang.code} $active={lang.code === i18n.language} onClick={() => handleSelect(lang.code)}>
                <FlagCircle>{lang.flag}</FlagCircle>
                <span>{lang.label}</span>
                {lang.code === i18n.language && <Check>&#x2713;</Check>}
              </Option>
            ))}
          </Dropdown>
        )}
      </Container>
    );
  }

  const isCompact = variant === 'compact';

  return (
    <Container ref={ref}>
      <Toggle onClick={() => setOpen(!open)} $compact={isCompact}>
        <span>{currentLang.flag}</span>
        {!isCompact && <span>{currentLang.label}</span>}
        <Arrow $open={open}>&#x25BE;</Arrow>
      </Toggle>
      {open && (
        <Dropdown $direction="down">
          {LANGUAGES.map(lang => (
            <Option key={lang.code} $active={lang.code === i18n.language} onClick={() => handleSelect(lang.code)}>
              <span>{lang.flag}</span>
              <span>{lang.label}</span>
              {lang.code === i18n.language && <Check>&#x2713;</Check>}
            </Option>
          ))}
        </Dropdown>
      )}
    </Container>
  );
};

export default LanguageSelector;

const Container = styled.div`position: relative; display: inline-flex;`;

const Toggle = styled.button<{ $compact: boolean }>`
  display: flex; align-items: center;
  gap: ${({ $compact }) => $compact ? '4px' : '8px'};
  padding: ${({ $compact }) => $compact ? '6px 8px' : '6px 12px'};
  background: transparent; border: 1px solid #E0E0E0; border-radius: 8px;
  cursor: pointer; font-size: 13px; color: #374151; transition: all 0.15s;
  &:hover { background: #F9FAFB; border-color: #D1D5DB; }
`;

const IconToggle = styled.button`
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; background: none; border: none;
  border-radius: 8px; cursor: pointer; font-size: 18px; transition: background 0.15s;
  &:hover { background: #F3F4F6; }
`;

const SidebarToggle = styled.button`
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; padding: 10px 0; background: transparent; border: none;
  cursor: pointer; font-size: 13px; color: #CCFBF1; transition: background 0.15s;
  border-radius: 6px;
  &:hover { background: rgba(255, 255, 255, 0.08); }
`;

const SidebarLeft = styled.div`display: flex; align-items: center; gap: 10px;`;
const SidebarLabel = styled.span`font-size: 13px; font-weight: 500; color: #CCFBF1;`;
const FlagCircle = styled.span`font-size: 16px; line-height: 1;`;

const Arrow = styled.span<{ $open: boolean }>`
  font-size: 10px; color: #5EEAD4; transition: transform 0.15s;
  transform: ${({ $open }) => $open ? 'rotate(180deg)' : 'none'};
`;

const Dropdown = styled.div<{ $direction?: 'up' | 'down' }>`
  position: absolute;
  ${({ $direction }) => $direction === 'up' ? 'bottom: calc(100% + 4px);' : 'top: calc(100% + 4px);'}
  left: 0; right: 0; min-width: 170px; background: white;
  border: 1px solid #E5E7EB; border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12); z-index: 1100; overflow: hidden;
`;

const Option = styled.button<{ $active: boolean }>`
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 10px 14px; border: none;
  background: ${({ $active }) => $active ? '#F0FDFA' : 'transparent'};
  cursor: pointer; font-size: 14px;
  color: ${({ $active }) => $active ? '#0D9488' : '#374151'};
  font-weight: ${({ $active }) => $active ? 600 : 400};
  transition: background 0.1s;
  &:hover { background: ${({ $active }) => $active ? '#F0FDFA' : '#F9FAFB'}; }
`;

const Check = styled.span`margin-left: auto; color: #0D9488; font-size: 14px;`;
