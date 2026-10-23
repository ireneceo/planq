// 확장자 색상 상자 아이콘 — DocsTab 에서 나눔(동작 그대로)
import type React from 'react';
import styled from 'styled-components';

// 확장자별 색상 아이콘 (Notion/Linear 패턴)
type ExtPalette = { bg: string; fg: string };
function extPalette(ext: string): ExtPalette {
  const e = ext.toLowerCase();
  if (['pdf'].includes(e)) return { bg: '#FEE2E2', fg: '#B91C1C' };
  if (['doc', 'docx', 'hwp', 'hwpx'].includes(e)) return { bg: '#DBEAFE', fg: '#1D4ED8' };
  if (['xls', 'xlsx', 'csv'].includes(e)) return { bg: '#D1FAE5', fg: '#047857' };
  if (['ppt', 'pptx'].includes(e)) return { bg: '#FED7AA', fg: '#C2410C' };
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return { bg: '#F0FDFA', fg: '#0F766E' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(e)) return { bg: '#FCE7F3', fg: '#BE185D' };
  if (['mp3', 'wav', 'm4a'].includes(e)) return { bg: '#FEF9C3', fg: '#854D0E' };
  if (['mp4', 'mov', 'webm'].includes(e)) return { bg: '#E0E7FF', fg: '#4338CA' };
  if (['txt', 'md'].includes(e)) return { bg: '#F1F5F9', fg: '#475569' };
  return { bg: '#F1F5F9', fg: '#64748B' };
}
export const FileExtIcon: React.FC<{ ext: string; size?: number; large?: boolean }> = ({ ext, size = 32, large }) => {
  const p = extPalette(ext);
  const label = (ext || '—').toUpperCase().slice(0, 4);
  // ★ 글자 크기 배율을 따라가려면 상자도 같이 rem 이어야 한다 — 글자만 키우면 32px 상자를 넘친다.
  return (
    <FileExtBox style={{ width: `${size / 16}rem`, height: `${size / 16}rem`, background: p.bg, color: p.fg, fontSize: `${(large ? 13 : 10) / 16}rem` }}>
      {label}
    </FileExtBox>
  );
};
const FileExtBox = styled.div`
  display:flex;align-items:center;justify-content:center;
  border-radius:8px;font-weight:800;letter-spacing:.3px;flex-shrink:0;
`;
