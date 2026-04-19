// 프로젝트 색상 팔레트 — 타임라인/일정 보기에서 프로젝트를 시각적으로 분리.
// 사용자가 새 프로젝트 생성 시 선택하거나, 미지정 시 id 기반으로 자동 순환 배정.

export const PROJECT_COLOR_PALETTE: { value: string; label: string }[] = [
  { value: '#14B8A6', label: 'Teal' },
  { value: '#F43F5E', label: 'Rose' },
  { value: '#3B82F6', label: 'Blue' },
  { value: '#F59E0B', label: 'Amber' },
  { value: '#22C55E', label: 'Green' },
  { value: '#8B5CF6', label: 'Violet' },
  { value: '#EC4899', label: 'Pink' },
  { value: '#6366F1', label: 'Indigo' },
  { value: '#F97316', label: 'Orange' },
  { value: '#64748B', label: 'Slate' },
];

// id 가 주어지면 palette 에서 순환 pick, color 가 이미 있으면 그걸 사용
export function colorForProject(project: { id: number; color?: string | null }): string {
  if (project.color && /^#[0-9A-Fa-f]{6}$/.test(project.color)) return project.color;
  const i = Math.abs(project.id) % PROJECT_COLOR_PALETTE.length;
  return PROJECT_COLOR_PALETTE[i].value;
}

// 해당 색의 연한 배경 (rgba 로 alpha 처리)
export function lightenColor(hex: string, alpha = 0.12): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return 'rgba(148, 163, 184, 0.12)';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 텍스트용 어두운 변형 (HSL 에서 명도 낮추기)
export function darkenColor(hex: string, factor = 0.5): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return '#475569';
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
