// OutputKindManageModal — 업무 «산출물» 목록 관리(직접 추가한 것만 이름 변경·삭제) (docs/TASK_DELIVERABLES_DESIGN.md §6.1)
//   창은 Common/DictManageModal 한 벌(태그·역할과 같다). 기본 항목은 이름 변경·삭제 대상이 아니라 목록에 넣지 않는다.
//   서버 오류는 코드로 오므로 여기서 문구로 옮긴다(서버 한글 문장을 그대로 띄우지 않는다).
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import DictManageModal, { type DictAdapter, type DictResult } from '../Common/DictManageModal';
import { apiFetch } from '../../contexts/AuthContext';
import { outputErrorKey, type OutputKindLite } from './outputKindLabel';

interface Props {
  open: boolean;
  onClose: () => void;
  bizId: number | null;
  rows: OutputKindLite[];
  onChanged: () => void;
}

const OutputKindManageModal: React.FC<Props> = ({ open, onClose, bizId, rows, onChanged }) => {
  const { t } = useTranslation('qtask');
  const call = useMemo(() => async (url: string, init: RequestInit): Promise<DictResult> => {
    const r = await apiFetch(url, init);
    const j = await r.json().catch(() => null);
    const k = outputErrorKey(j?.message);
    return { ok: r.ok && !!j?.success, message: k ? (t(k) as string) : null };
  }, [t]);
  const adapter = useMemo<DictAdapter<OutputKindLite>>(() => ({
    create: (name) => (bizId
      ? call('/api/tasks/output-kinds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business_id: bizId, name }) })
      : Promise.resolve({ ok: false })),
    rename: (k, name) => call(`/api/tasks/output-kinds/${k.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    }),
    remove: (k) => call(`/api/tasks/output-kinds/${k.id}`, { method: 'DELETE' }),
  }), [bizId, call]);
  const custom = useMemo(() => rows.filter((r) => !r.preset_key), [rows]);

  return (
    <DictManageModal<OutputKindLite>
      open={open} onClose={onClose} dict={custom} adapter={adapter} onChanged={onChanged} maxLength={40}
      testId="output-kind-manage"
      texts={{
        title: t('outputs.manageTitle', '산출물 목록 관리') as string,
        newPh: t('outputs.newPh', '새 산출물 이름') as string,
        empty: t('outputs.manageEmpty', '직접 추가한 산출물이 아직 없습니다') as string,
        usage: (k) => t('outputs.usageCount', '업무 {{count}}개', { count: k.usage_count ?? 0 }) as string,
        deleteConfirm: (k) => t('outputs.deleteConfirm', '“{{name}}” 산출물을 {{count}}개 업무에서 빼고 삭제할까요?', {
          name: k.name, count: k.usage_count ?? 0,
        }) as string,
        createFailed: t('outputs.createFailed', '산출물을 추가하지 못했습니다') as string,
        renameFailed: t('outputs.renameFailed', '이름을 바꾸지 못했습니다') as string,
        deleteFailed: t('outputs.deleteFailed', '삭제하지 못했습니다') as string,
      }} />
  );
};

export default OutputKindManageModal;
