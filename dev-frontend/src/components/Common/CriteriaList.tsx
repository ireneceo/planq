// CriteriaList — «무엇을 기준으로 나누는가» 공개 목록 (2026-10-15, docs/MAIL_CRITERIA_DESIGN.md §3.5)
//
// Irene: *"이에 대한 상세 조건들을 모두 설정에 나오게 하고 우리끼리 가지고 있지 말고 투명하게 공개하자 …
//   이건 이메일도 그렇고 Q sales 리스트도 그렇게 하자."*
//   메일 분류 기준(설정 › 메일 계정)과 상담 유입 기준(설정 › 권한) 두 곳이 **이 한 벌**을 쓴다 — 베끼면 갈라진다.
//   항목의 이름·설명은 호출부가 i18n 으로 채워 넘긴다(서버는 id 만 안다). 낱말(terms)은 서버 카탈로그 그대로.
//
// ★ 스위치는 바로 저장하지 않는다 — 기준 하나를 끄면 이미 받은 메일 수십 건이 옮겨질 수 있어, 호출부(onToggle)가
//   «몇 건이 옮겨지는지» 를 먼저 세어 확인창으로 묻는다. 그래서 AutoSaveField 로 감싸지 않는다(아래 예외 선언).
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { Switch, SwitchKnob } from './switchShell';
import { listRowTitleCss } from '../../theme/tokens';

export interface CriteriaItem {
  id: string;
  title: string;
  desc: string;
  /** 끌 수 없는 기준 — 스위치 대신 «기본» 글자 */
  lockable?: boolean;
  enabled: boolean;
  /** 엔진이 실제로 찾는 낱말(서버 카탈로그 그대로) */
  terms?: string[];
  examples?: string[];
  /** 최근 30일 이 기준이 정한 메일 수(없으면 안 보인다) */
  hits?: number | null;
  /** 항목 아래 덧붙일 것(예: 주소 목록 입력) */
  extra?: React.ReactNode;
}
export interface CriteriaGroup { key: string; title: string; hint?: string; items: CriteriaItem[] }

interface Props {
  groups: CriteriaGroup[];
  canEdit: boolean;
  busyId?: string | null;
  onToggle: (id: string, next: boolean) => void;
  testIdPrefix?: string;
}

const CriteriaList: React.FC<Props> = ({ groups, canEdit, busyId, onToggle, testIdPrefix = 'criteria' }) => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <Wrap data-testid={`${testIdPrefix}-list`}>
      {groups.map((g) => (
        <Group key={g.key} data-testid={`${testIdPrefix}-group-${g.key}`}>
          <GroupHead>
            <GroupTitle>{g.title}</GroupTitle>
            {g.hint && <GroupHint>{g.hint}</GroupHint>}
          </GroupHead>
          <Rows>
            {g.items.map((it) => {
              const hasDetail = (it.terms && it.terms.length > 0) || (it.examples && it.examples.length > 0);
              const isOpen = !!open[it.id];
              return (
                <Row key={it.id} data-testid={`${testIdPrefix}-row-${it.id}`} $off={!it.enabled}>
                  <RowMain>
                    <RowTop>
                      <RowTitle id={`${testIdPrefix}-${it.id}-label`}>{it.title}</RowTitle>
                      {typeof it.hits === 'number' && it.hits > 0 && (
                        <Hits>{t('criteriaList.hits', { n: it.hits, defaultValue: '최근 30일 {{n}}건' }) as string}</Hits>
                      )}
                      {!it.enabled && <OffTag>{t('criteriaList.off', { defaultValue: '꺼짐' }) as string}</OffTag>}
                    </RowTop>
                    <RowDesc>{it.desc}</RowDesc>
                    {hasDetail && (
                      <DetailBtn type="button" aria-expanded={isOpen}
                        onClick={() => setOpen((o) => ({ ...o, [it.id]: !o[it.id] }))}>
                        {isOpen
                          ? t('criteriaList.hideDetail', { defaultValue: '자세한 조건 접기' }) as string
                          : t('criteriaList.showDetail', { defaultValue: '자세한 조건 보기' }) as string}
                      </DetailBtn>
                    )}
                    {isOpen && hasDetail && (
                      <Detail>
                        {it.examples && it.examples.length > 0 && (
                          <>
                            <DetailLabel>{t('criteriaList.examples', { defaultValue: '이런 메일' }) as string}</DetailLabel>
                            <ExampleList>{it.examples.map((e) => <li key={e}>{e}</li>)}</ExampleList>
                          </>
                        )}
                        {it.terms && it.terms.length > 0 && (
                          <>
                            <DetailLabel>{t('criteriaList.terms', { n: it.terms.length, defaultValue: '찾는 말 ({{n}}개)' }) as string}</DetailLabel>
                            <TermList>{it.terms.map((term, i) => <Term key={`${i}-${term}`}>{term}</Term>)}</TermList>
                          </>
                        )}
                      </Detail>
                    )}
                    {it.extra}
                  </RowMain>
                  {it.lockable ? (
                    <Locked title={t('criteriaList.lockedHint', { defaultValue: '이 기준을 끄면 메일이 갈 곳이 없어져 항상 켜져 있습니다' }) as string}>
                      {t('criteriaList.locked', { defaultValue: '기본' }) as string}
                    </Locked>
                  ) : (
                    // autosave-exempt: 끄기 전에 «이미 받은 메일 몇 건이 옮겨지는지» 를 세어 확인창으로 묻는다(호출부 onToggle)
                    <Switch
                      type="button" role="switch" aria-checked={it.enabled}
                      aria-labelledby={`${testIdPrefix}-${it.id}-label`}
                      data-testid={`${testIdPrefix}-switch-${it.id}`}
                      $on={it.enabled} disabled={!canEdit || busyId === it.id}
                      onClick={() => onToggle(it.id, !it.enabled)}
                    >
                      <SwitchKnob $on={it.enabled} />
                    </Switch>
                  )}
                </Row>
              );
            })}
          </Rows>
        </Group>
      ))}
    </Wrap>
  );
};

export default CriteriaList;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 14px;`;
const Group = styled.section`display: flex; flex-direction: column; gap: 6px;`;
const GroupHead = styled.div`display: flex; flex-direction: column; gap: 2px;`;
const GroupTitle = styled.h4`margin: 0; font-size: 0.8125rem; font-weight: 700; color: #0F172A;`;
const GroupHint = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const Rows = styled.ul`list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px;`;
const Row = styled.li<{ $off: boolean }>`
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 10px 12px; border: 1px solid #E2E8F0; border-radius: 10px;
  background: ${(p) => (p.$off ? '#F8FAFC' : '#FFFFFF')};
`;
const RowMain = styled.div`min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px;`;
const RowTop = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const RowTitle = styled.span`${listRowTitleCss} color: #0F172A;`;
const RowDesc = styled.div`font-size: 0.75rem; color: #475569; line-height: 1.55;`;
const Hits = styled.span`font-size: 0.6875rem; color: #0F766E; background: #F0FDFA; padding: 1px 6px; border-radius: 999px;`;
const OffTag = styled.span`font-size: 0.6875rem; color: #64748B; background: #E2E8F0; padding: 1px 6px; border-radius: 999px;`;
const DetailBtn = styled.button`
  align-self: flex-start; background: none; border: none; padding: 0; min-height: 32px;
  font-size: 0.71875rem; color: #0F766E; cursor: pointer;
  &:hover { text-decoration: underline; }
`;
const Detail = styled.div`display: flex; flex-direction: column; gap: 4px; padding: 6px 0 2px;`;
const DetailLabel = styled.div`font-size: 0.6875rem; font-weight: 700; color: #94A3B8;`;
const ExampleList = styled.ul`margin: 0; padding-left: 16px; li { font-size: 0.75rem; color: #334155; word-break: break-word; }`;
const TermList = styled.div`display: flex; flex-wrap: wrap; gap: 4px;`;
const Term = styled.code`
  font-size: 0.6875rem; color: #334155; background: #F1F5F9; border-radius: 6px; padding: 2px 6px;
  font-family: inherit; word-break: break-word; max-width: 100%;
`;
const Locked = styled.span`
  flex-shrink: 0; font-size: 0.6875rem; font-weight: 600; color: #94A3B8;
  border: 1px solid #E2E8F0; border-radius: 999px; padding: 2px 8px;
`;
