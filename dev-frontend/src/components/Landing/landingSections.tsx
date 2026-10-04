// 랜딩 공개 페이지 공용 섹션 껍데기 — 기능 페이지(FeaturesPage)에서 빼 왔다(2026-10-04).
//   디테일 페이지(/details/)가 같은 머리·섹션·카드·하단 띠를 써야 해서 옮겼다. 베끼면 한쪽만 고쳐진다
//   (CLAUDE.md «껍데기는 빼서 같이 쓴다»). 값은 옮기면서 바꾸지 않았다.
import styled from 'styled-components';
import { Link } from 'react-router-dom';

export const Container = styled.div`max-width: 1080px; margin: 0 auto; padding: 0 24px; @media (max-width: 640px) { padding: 0 16px; }`;
export const SubHero = styled.section`
  padding: 96px 0 56px;
  background: linear-gradient(180deg, #F0FDFA 0%, #FFFFFF 100%);
  text-align: center;
`;
export const Eyebrow = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 0.8125rem; font-weight: 500; color: #0D9488;
  letter-spacing: 3px; margin-bottom: 16px;
`;
export const Title = styled.h1`
  font-size: 2.75rem; font-weight: 700; color: #0F172A;
  line-height: 1.3; word-break: keep-all; margin-bottom: 20px;
  @media (max-width: 768px) { font-size: 2rem; }
`;
export const Sub = styled.p`
  font-size: 1.0625rem; font-weight: 300; color: #64748B;
  line-height: 1.7; max-width: 720px; margin: 0 auto;
  word-break: keep-all;
`;
export const Anchors = styled.div`
  margin-top: 32px;
  display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
`;
export const Anchor = styled.a`
  height: 36px; padding: 0 16px;
  display: inline-flex; align-items: center;
  background: #FFFFFF; color: #0D9488;
  border: 1px solid #99F6E4; border-radius: 999px;
  font-size: 0.8125rem; font-weight: 500; text-decoration: none;
  transition: background 0.15s, transform 0.15s;
  &:hover { background: #F0FDFA; transform: translateY(-1px); }
`;
export const Group = styled.section<{ $bg?: 'bg' | 'dark' }>`
  padding: 96px 0;
  background: ${p => p.$bg === 'dark' ? '#0F172A' : p.$bg === 'bg' ? '#FAFBFC' : '#FFFFFF'};
  ${p => p.$bg === 'dark' && `color: #FFFFFF;`}
  scroll-margin-top: 80px;
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  .reveal.in { opacity: 1; transform: none; }
  @media (max-width: 768px) { padding: 64px 0; }
`;
export const GroupTag = styled.div<{ $light?: boolean }>`
  font-family: 'Outfit', sans-serif;
  font-size: 0.8125rem; font-weight: 500;
  color: ${p => p.$light ? '#5EEAD4' : '#0D9488'};
  letter-spacing: 3px; margin-bottom: 12px;
`;
export const GroupTitle = styled.h2<{ $light?: boolean }>`
  font-size: 2.25rem; font-weight: 700;
  color: ${p => p.$light ? '#FFFFFF' : '#0F172A'};
  letter-spacing: -0.6px; margin: 0 0 16px;
  word-break: keep-all;
  @media (max-width: 768px) { font-size: 1.75rem; }
`;
export const GroupDesc = styled.p<{ $light?: boolean }>`
  font-size: 1rem; font-weight: 300;
  color: ${p => p.$light ? '#94A3B8' : '#64748B'};
  line-height: 1.7; max-width: 720px;
  word-break: keep-all;
  margin-bottom: 48px;
`;
export const SmallCard = styled.div`
  padding: 24px 22px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 12px;
  display: flex; flex-direction: column; gap: 8px;
  transition: opacity 0.7s ease-out, transform 0.7s ease-out, border-color 0.2s;
  &:hover { border-color: #99F6E4; }
`;
export const SmallName = styled.h3`
  font-size: 0.9375rem; font-weight: 700; color: #0F172A; margin: 0;
`;
export const SmallLead = styled.p`
  font-size: 0.8125rem; color: #64748B; line-height: 1.7;
  margin: 0; word-break: keep-all;
`;
export const CtaBand = styled.section`
  padding: 96px 0;
  background: linear-gradient(160deg, #0F172A 0%, #134E4A 100%);
  color: #FFFFFF; text-align: center;
  ${Container} { display: flex; flex-direction: column; align-items: center; gap: 16px; }
`;
export const CtaTitle = styled.h2`font-size: 2rem; font-weight: 700; line-height: 1.4; margin: 0; word-break: keep-all; @media (max-width: 768px) { font-size: 1.5rem; }`;
export const CtaSub = styled.p`font-size: 0.9375rem; color: #94A3B8; font-weight: 300; margin: 0;`;
export const CtaBtn = styled(Link)`
  margin-top: 12px;
  padding: 16px 48px; border-radius: 999px;
  background: #14B8A6; color: #FFFFFF;
  font-size: 1rem; font-weight: 500;
  text-decoration: none;
  transition: all 0.3s;
  box-shadow: 0 0 40px rgba(20,184,166,0.3);
  &:hover { background: #0D9488; transform: translateY(-2px); }
`;
