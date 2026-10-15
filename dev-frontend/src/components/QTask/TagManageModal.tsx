// TagManageModal — 업무 태그 사전 관리(추가·이름 변경·삭제) (#250 ③청크, Fable 구현 게이트 F4)
//
//   왜 필요한가: 수정·삭제가 없으면 오타 태그를 지울 길이 없고, 워크스페이스 100개
//   상한과 결합해 사전이 쓰레기로 잠긴다.
//
//   ★ 2026-10-15 — 창 자체는 `components/Common/DictManageModal` 로 옮겼다. 역할 사전(RoleManageModal)이
//     같은 창을 쓴다. 여기는 태그 API·문구 어댑터만 둔다.
//   ★ 삭제는 백엔드가 CASCADE 다(태그는 레코드가 아니라 라벨). 대신 **몇 개 업무에서 제거되는지**를
//     반드시 보여준다 — 사용자가 결과를 모르고 지우면 안 된다.
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import DictManageModal, { type DictAdapter, type DictResult } from '../Common/DictManageModal';
import { apiFetch } from '../../contexts/AuthContext';
import type { TaskTagLite } from './TagChips';

export interface TagDictEntry extends TaskTagLite {
  usage_count?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 새 태그를 만들 워크스페이스 */
  bizId: number | null;
  dict: TagDictEntry[];
  /** 사전이 바뀌면 호출측이 다시 읽는다 (소켓 task_tag:updated 도 오지만 본인 창은 즉시) */
  onChanged: () => void;
}

// apiFetch 는 throw 하지 않는다 — 중복(409)·상한(400) 메시지를 그대로 돌려준다.
async function call(url: string, init: RequestInit): Promise<DictResult> {
  const r = await apiFetch(url, init);
  const j = await r.json().catch(() => null);
  return { ok: r.ok && !!j?.success, message: j?.message || null };
}

const TagManageModal: React.FC<Props> = ({ open, onClose, bizId, dict, onChanged }) => {
  const { t } = useTranslation('qtask');
  const adapter = useMemo<DictAdapter<TagDictEntry>>(() => ({
    create: (name) => (bizId
      ? call('/api/tasks/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business_id: bizId, name }) })
      : Promise.resolve({ ok: false })),
    rename: (tag, name) => call(`/api/tasks/tags/${tag.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    }),
    remove: (tag) => call(`/api/tasks/tags/${tag.id}`, { method: 'DELETE' }),
  }), [bizId]);

  return (
    <DictManageModal<TagDictEntry>
      open={open} onClose={onClose} dict={dict} adapter={adapter} onChanged={onChanged}
      texts={{
        title: t('tags.manageTitle', '태그 관리') as string,
        newPh: t('tags.newPh', '새 태그 이름') as string,
        empty: t('tags.manageEmpty', '아직 태그가 없습니다. 업무 상세에서 만들 수 있어요.') as string,
        usage: (tag) => t('tags.usageCount', '업무 {{count}}개', { count: tag.usage_count ?? 0 }) as string,
        deleteConfirm: (tag) => t('tags.deleteConfirm', '“{{name}}” 태그를 {{count}}개 업무에서 제거하고 삭제할까요?', {
          name: tag.name, count: tag.usage_count ?? 0,
        }) as string,
        createFailed: t('tags.createFailed', '태그를 만들지 못했습니다') as string,
        renameFailed: t('tags.renameFailed', '이름을 바꾸지 못했습니다') as string,
        deleteFailed: t('tags.deleteFailed', '삭제하지 못했습니다') as string,
      }} />
  );
};

export default TagManageModal;
