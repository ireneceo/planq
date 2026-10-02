// 랜딩 서브 페이지 공용 조각 — 서비스 페이지와 자가진단(#426)이 같은 폭·버튼·머리말을 쓴다.
//   베끼면 한쪽만 바뀐다(CLAUDE.md «껍데기는 빼서 같이 쓴다»).
import styled from 'styled-components';
import { Link } from 'react-router-dom';

export const Container = styled.div`max-width: 1080px; margin: 0 auto; padding: 0 24px; @media (max-width: 640px) { padding: 0 16px; }`;
export const Eyebrow = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 0.8125rem; font-weight: 500; color: #0D9488;
  letter-spacing: 3px; margin-bottom: 16px;
`;
export const PrimaryCta = styled(Link)`
  display: inline-flex; align-items: center; justify-content: center;
  min-height: 48px; padding: 0 28px;
  border-radius: 999px; background: #0F766E; color: #FFFFFF;
  font-size: 0.9375rem; font-weight: 600; text-decoration: none;
  transition: background 0.2s, transform 0.2s;
  &:hover { background: #115E59; transform: translateY(-1px); }
`;
export const SecondaryCta = styled(Link)`
  display: inline-flex; align-items: center; justify-content: center;
  min-height: 48px; padding: 0 28px;
  border-radius: 999px; background: #FFFFFF; color: #0F766E;
  border: 1px solid #99F6E4;
  font-size: 0.9375rem; font-weight: 600; text-decoration: none;
  transition: background 0.2s, border-color 0.2s;
  &:hover { background: #F0FDFA; border-color: #5EEAD4; }
`;
