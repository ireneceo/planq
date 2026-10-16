// 고객 내부 메모 — 자동저장. 2026-10-16 설정 > 고객 드로어에서 빼서 Q sale 패널·상세 페이지가 같이 쓴다.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AutoSaveField from '../Common/AutoSaveField';
import { putClientFields } from '../../services/sale';
import { Section, SectionTitle, NoteArea } from './clientDetailStyles';

interface Props {
  businessId: number;
  clientId: number;
  initial: string;
  canEdit: boolean;
  onSaved?: () => void;
}

export default function ClientNotesSection({ businessId, clientId, initial, canEdit, onSaved }: Props) {
  const { t } = useTranslation('clients');
  const [draft, setDraft] = useState(initial);
  useEffect(() => { setDraft(initial); }, [clientId, initial]);
  const ref = useRef(draft);
  ref.current = draft;
  return (
    <Section data-testid="client-notes-section">
      <SectionTitle>{t('section.notes')}</SectionTitle>
      <AutoSaveField onSave={async () => {
        await putClientFields(businessId, clientId, { notes: ref.current.trim() || null });
        onSaved?.();
      }}>
        <NoteArea value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder={t('section.notesPlaceholder') as string} disabled={!canEdit} />
      </AutoSaveField>
    </Section>
  );
}
