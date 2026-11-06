// MailResponsibleSection — 회사 공용 메일함의 «책임자» 한 사람 (2026-11-06 · Fable 설계).
//
//   Irene: «회사 공용메일을 같이 보면 실제 메일주소에 대한 담당자는 정하면 좋겠어. 누가 1차적인 담당 책임자인지»
//          «확인필요에도 모든 메일이 뜨지 않고 자기가 담당으로 된 이메일 주소에 대해 나오는 거지»
//   - 보는 권한은 그대로(메일함은 모두 본다). 바뀌는 것은 표시 + 확인필요 귀속(서버 services/mailTodoWhere).
//   - 스레드 «답변 담당» 과 다른 축이라 글자를 «책임» 으로 가른다(qmail 규칙 ② — 같은 글자 두 뜻 금지).
//   - 개인 메일함에는 이 섹션이 없다(부르는 쪽이 회사 공용 카드에만 얹는다).
//   - 고르면 바로 저장(AutoSaveField · PlanQ 표준). 관리자가 아니면 읽기 전용.
import { useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import AutoSaveField from '../../components/Common/AutoSaveField';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';

export interface MailMemberOption { user_id: number; name: string }

interface Props {
  businessId: number;
  accountId: number;
  initial: number | null;
  members: MailMemberOption[];
  canEdit: boolean;
  onSaved?: (next: number | null) => void;
}

export default function MailResponsibleSection({ businessId, accountId, initial, members, canEdit, onSaved }: Props) {
  const { t } = useTranslation('qmail');
  const [value, setValue] = useState<number | null>(initial);
  const valueRef = useRef<number | null>(initial);

  const persist = async () => {
    const next = valueRef.current;
    const r = await apiFetch(`/api/businesses/${businessId}/email-accounts/${accountId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ responsible_user_id: next }),
    });
    // 실패는 던진다 — 삼키면 저장 안 된 값이 화면에 남는다(! 배지가 떠야 한다)
    if (!r.ok) { valueRef.current = initial; setValue(initial); throw new Error('save_failed'); }
    onSaved?.(next);
  };

  const noneLabel = t('responsible.none') as string;
  const options: PlanQSelectOption[] = [
    { value: '', label: noneLabel },
    ...members.map((m) => ({ value: String(m.user_id), label: m.name })),
  ];
  const current = value != null ? members.find((m) => m.user_id === value) : undefined;
  const selected = current ? { value: String(current.user_id), label: current.name } : { value: '', label: noneLabel };

  return (
    <Wrap data-testid={`mail-responsible-${accountId}`}>
      <Title>{t('responsible.title') as string}</Title>
      <Desc>{t('responsible.desc') as string}</Desc>
      {canEdit ? (
        <SelectWrap>
          <AutoSaveField key={`mail-responsible-${accountId}`} type="select" onSave={persist}>
            <PlanQSelect
              size="sm" isSearchable={members.length > 8}
              value={selected}
              options={options}
              onChange={(opt) => {
                const v = (opt as PlanQSelectOption | null)?.value;
                const next = v ? Number(v) : null;
                valueRef.current = next;
                setValue(next);
              }}
            />
          </AutoSaveField>
        </SelectWrap>
      ) : (
        <ReadOnly>{current ? current.name : noneLabel}</ReadOnly>
      )}
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex; flex-direction: column; gap: 8px;
  margin-top: 14px; padding-top: 14px; border-top: 1px solid #F1F5F9;
`;
const Title = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A;`;
const Desc = styled.p`margin: 0; font-size: 0.75rem; color: #94A3B8; line-height: 1.6;`;
const SelectWrap = styled.div`max-width: 320px; width: 100%;`;
const ReadOnly = styled.div`font-size: 0.8125rem; font-weight: 600; color: #334155;`;
