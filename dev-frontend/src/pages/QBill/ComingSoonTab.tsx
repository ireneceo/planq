import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

interface Props {
  descKey: string;
}

export default function ComingSoonTab({ descKey }: Props) {
  const { t } = useTranslation('qbill');
  return (
    <Wrap>
      <Icon aria-hidden>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 14" />
        </svg>
      </Icon>
      <Body>{t(descKey)}</Body>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  color: #94A3B8;
  text-align: center;
`;
const Icon = styled.div`
  color: #CBD5E1;
  margin-bottom: 12px;
`;
const Body = styled.div`
  font-size: 13px;
  max-width: 360px;
  line-height: 1.5;
`;
