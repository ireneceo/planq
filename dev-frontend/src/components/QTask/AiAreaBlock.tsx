// components/QTask/AiAreaBlock.tsx — #354 루틴 설계 "영역" 블록.
//
// 왜 채택/폐기를 확정 **전에** 고르게 하는가:
//   #358 이 그 답이다 — AI 가 만든 워크스트림 4개·지표 3개가 프로젝트와 무관한 일반론이라
//   아무도 안 쓰고 몇 달을 남아 있었고, 제대로 된 영역을 넣기 전에 **그것부터 지워야 했다.**
//   "전량 저장 후 사용자가 지우는" 방식의 반대로 간다.
//
// 폐기해도 그 영역의 업무는 지우지 않는다 — 미배치로 남는다. 숨은 연쇄 삭제는 만들지 않는다.
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

const Wrap = styled.div`
  display: flex; flex-direction: column; gap: 8px;
`;
const Row = styled.div<{ $adopted: boolean }>`
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 12px;
  border: 1px solid ${(p) => (p.$adopted ? '#99f6e4' : '#e2e8f0')};
  background: ${(p) => (p.$adopted ? '#f0fdfa' : '#f8fafc')};
  border-radius: 10px;
  opacity: ${(p) => (p.$adopted ? 1 : 0.6)};
  transition: opacity 0.15s, background 0.15s, border-color 0.15s;
`;
// 체크박스 자체는 작지만 **누르는 자리는 40px** 이어야 한다(폰 터치 타겟 최소 규칙).
//   글리프에 직접 height 를 박으면 토큰 밖 컨트롤 높이가 되고, 폰에서는 누르기도 어렵다.
const CheckHit = styled.label`
  width: 44px; height: 44px; margin: -10px 0 -10px -12px;
  flex-shrink: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
`;
const Check = styled.input`
  width: 16px; aspect-ratio: 1; cursor: pointer; accent-color: #14B8A6;
`;
const Body = styled.div`
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px;
`;
const TitleRow = styled.div`
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
`;
const TitleInput = styled.input`
  flex: 1; min-width: 120px;
  border: none; background: transparent; padding: 0;
  font-size: 0.875rem; font-weight: 600; color: #0f172a;
  &:focus { outline: none; border-bottom: 1px solid #14B8A6; }
  &:disabled { color: #94a3b8; }
`;
// 기존 영역을 새로 만들지 않고 **재사용**한다는 사실이 보여야, 사용자가 중복을 걱정하지 않는다.
const Tag = styled.span<{ $kind: 'existing' | 'new' }>`
  flex-shrink: 0;
  font-size: 0.6875rem; font-weight: 600;
  padding: 2px 7px; border-radius: 999px;
  color: ${(p) => (p.$kind === 'existing' ? '#0f766e' : '#9a3412')};
  background: ${(p) => (p.$kind === 'existing' ? '#ccfbf1' : '#ffedd5')};
`;
const Desc = styled.div`
  font-size: 0.75rem; color: #64748b; line-height: 1.45;
`;
const Count = styled.div`
  font-size: 0.75rem; color: #475569;
`;
const Empty = styled.div`
  font-size: 0.8125rem; color: #94a3b8; padding: 10px 2px;
`;

export interface AiArea {
  idx: number;
  title: string;
  description?: string | null;
  existing?: boolean;
  adopted?: boolean;
}

interface Props {
  areas: AiArea[];
  /** area_ref 별 업무 수 — 폐기했을 때 무엇이 미배치로 떨어지는지 보여준다 */
  taskCountByArea: Record<number, number>;
  onChange: (idx: number, patch: Partial<AiArea>) => void;
  disabled?: boolean;
}

export default function AiAreaBlock({ areas, taskCountByArea, onChange, disabled }: Props) {
  const { t } = useTranslation('qtask');
  if (!areas.length) return <Empty>{t('ai.area.none', '영역이 제안되지 않았습니다') as string}</Empty>;

  return (
    <Wrap data-testid="ai-area-block">
      {areas.map((a) => {
        const adopted = a.adopted !== false;
        const n = taskCountByArea[a.idx] || 0;
        return (
          <Row key={a.idx} $adopted={adopted}>
            <CheckHit>
              <Check
                type="checkbox"
                checked={adopted}
                disabled={disabled}
                onChange={(e) => onChange(a.idx, { adopted: e.target.checked })}
                aria-label={a.title}
              />
            </CheckHit>
            <Body>
              <TitleRow>
                <TitleInput
                  value={a.title}
                  disabled={disabled || !adopted}
                  onChange={(e) => onChange(a.idx, { title: e.target.value })}
                  aria-label={t('ai.area.nameLabel', '영역 이름') as string}
                />
                <Tag $kind={a.existing ? 'existing' : 'new'}>
                  {a.existing
                    ? (t('ai.area.existing', '기존 영역 재사용') as string)
                    : (t('ai.area.new', '새로 만듦') as string)}
                </Tag>
              </TitleRow>
              {a.description && <Desc>{a.description}</Desc>}
              <Count>
                {adopted
                  ? (t('ai.area.taskCount', { n, defaultValue: '업무 {{n}}건' }) as string)
                  : (t('ai.area.droppedHint', { n, defaultValue: '업무 {{n}}건은 영역 없이 만들어집니다 (삭제되지 않습니다)' }) as string)}
              </Count>
            </Body>
          </Row>
        );
      })}
    </Wrap>
  );
}
