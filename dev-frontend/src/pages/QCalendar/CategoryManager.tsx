// 일정 분류 관리 창 — 대표/관리자만 (2026-11-27, docs/CALENDAR_CATEGORIES_DESIGN.md §8)
//   창 자체는 공용 «사전 관리 창»(components/Common/DictManageModal — 업무 태그·역할이 같이 쓴다)을 쓴다.
//   여기는 분류 API·문구와 분류만의 칸(색 점·사용 켜기/끄기)만 둔다.
//   ★ 기본 분류(미팅·업무·마감·개인·기타)는 지우지 못하고 끄기만 한다 · «기타» 는 끌 수도 없다(지운 분류의 일정이 옮겨 갈 자리).
//   ★ 커스텀 분류를 지우면 그 일정은 «기타» 로 옮겨진다 — 몇 건인지 확인 문구에 적는다.
import { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DictManageModal, { type DictAdapter, type DictResult } from '../../components/Common/DictManageModal';
import { useCalendarCategories, categoryLabel, CATEGORY_SWATCHES, CATEGORY_NAME_MAX, type CalendarCategoryRow, type CallResult } from './calendarCategories';
import { Swatches, Swatch } from './CategoryPicker';
import { CATEGORY_PALETTE } from './categoryColors';
import type { EventCategory } from './types';

interface Entry extends CalendarCategoryRow { name: string; raw_name: string | null }

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number | null | undefined;
}

export default function CategoryManager({ open, onClose, businessId }: Props) {
  const { t } = useTranslation('qcalendar');
  const { categories, reload, api } = useCalendarCategories(open ? businessId : null, { manage: true });
  const [colorOpenId, setColorOpenId] = useState<number | null>(null);
  const [rowErr, setRowErr] = useState<{ id: number; msg: string } | null>(null);
  const errText = (code?: string | null) => t(`categories.err.${code || 'generic'}`, { defaultValue: t('categories.err.generic', '저장하지 못했습니다. 다시 시도하세요.') as string }) as string;
  const res = (r: CallResult): DictResult => ({ ok: r.ok, message: r.ok ? null : errText(r.message) });

  const dict: Entry[] = useMemo(
    () => categories.map((c) => ({ ...c, raw_name: c.name, name: categoryLabel(c, t) })),
    [categories, t],
  );
  const adapter = useMemo<DictAdapter<Entry>>(() => ({
    create: async (name) => res(await api.create(name)),
    rename: async (entry, name) => res(await api.update(entry.id, { name })),
    remove: async (entry) => res(await api.remove(entry.id)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [api.create, api.update, api.remove]);

  const dotColor = (c: Entry) => c.color || (c.code ? CATEGORY_PALETTE[c.code as EventCategory]?.fg : null) || '#94A3B8';
  const patch = async (id: number, body: { color?: string | null; is_active?: boolean }) => {
    setRowErr(null);
    const r = await api.update(id, body);
    if (!r.ok) setRowErr({ id, msg: errText(r.message) });
    await reload();
  };

  return (
    <DictManageModal<Entry>
      open={open} onClose={onClose} dict={dict} adapter={adapter} onChanged={() => { void reload(); }}
      testId="calcat-manage" maxLength={CATEGORY_NAME_MAX}
      reorder={async (ids) => res(await api.reorder(ids))}
      reorderFailed={t('categories.err.reorder', '순서를 바꾸지 못했습니다') as string}
      canRemove={(c) => !c.code}
      allowEmptyRename={(c) => !!c.code}
      renderLead={(c) => (
        <DotBtn type="button" $color={dotColor(c)} data-testid="calcat-manage-color"
          aria-label={t('categories.color', '색') as string} aria-expanded={colorOpenId === c.id}
          onClick={() => setColorOpenId(colorOpenId === c.id ? null : c.id)} />
      )}
      renderExtra={(c) => (
        <ActiveBtn type="button" $on={c.is_active} disabled={c.code === 'other'} data-testid="calcat-manage-active"
          title={c.code === 'other' ? t('categories.otherLocked', '«기타» 는 끌 수 없어요 — 지운 분류의 일정이 옮겨 가는 자리예요') as string : undefined}
          onClick={() => void patch(c.id, { is_active: !c.is_active })}>
          {c.is_active ? t('categories.on', '사용') : t('categories.off', '꺼짐')}
        </ActiveBtn>
      )}
      renderBelow={(c) => (<>
        {rowErr?.id === c.id && <RowErr role="alert">{rowErr.msg}</RowErr>}
        {colorOpenId === c.id && (
        <Below>
          <Swatches>
            {CATEGORY_SWATCHES.map((hex) => (
              <Swatch key={hex} type="button" $color={hex} $active={(c.color || '').toUpperCase() === hex} aria-label={hex}
                onClick={() => { setColorOpenId(null); void patch(c.id, { color: hex }); }} />
            ))}
          </Swatches>
          {c.code && c.color && (
            <ResetBtn type="button" onClick={() => { setColorOpenId(null); void patch(c.id, { color: null }); }}>
              {t('categories.colorReset', '기본 색')}
            </ResetBtn>
          )}
        </Below>
        )}
      </>)}
      texts={{
        title: t('categories.manageTitle', '일정 분류 관리') as string,
        newPh: t('categories.newPh', '새 분류 이름') as string,
        empty: t('categories.empty', '분류가 없습니다') as string,
        usage: (c) => `${c.code ? `${t('categories.system', '기본')} · ` : ''}${t('categories.usage', { count: c.event_count ?? 0, defaultValue: '일정 {{count}}개' })}`,
        deleteConfirm: (c) => ((c.event_count ?? 0) > 0
          ? t('categories.deleteConfirm', { name: c.name, count: c.event_count, defaultValue: '“{{name}}” 분류를 삭제할까요? 이 분류의 일정 {{count}}건은 “기타”로 옮겨집니다. 되돌릴 수 없습니다.' })
          : t('categories.deleteConfirmEmpty', { name: c.name, defaultValue: '“{{name}}” 분류를 삭제할까요? 되돌릴 수 없습니다.' })) as string,
        createFailed: t('categories.err.generic', '저장하지 못했습니다. 다시 시도하세요.') as string,
        renameFailed: t('categories.err.generic', '저장하지 못했습니다. 다시 시도하세요.') as string,
        deleteFailed: t('categories.err.delete', '삭제하지 못했습니다') as string,
      }}
    />
  );
}

const DotBtn = styled.button<{ $color: string }>`
  /* 누르는 칸 32 · 그리는 점 20 (터치 칸은 줄이지 않는다) */
  flex-shrink: 0; width: 32px; height: 32px; padding: 0; cursor: pointer; border: none; background: transparent;
  position: relative;
  &::before { content: ''; position: absolute; inset: 6px; border-radius: 50%; background: ${({ $color }) => $color}; box-shadow: 0 0 0 2px #fff, 0 0 0 3px #CBD5E1; }
`;
const ActiveBtn = styled.button<{ $on: boolean }>`
  flex-shrink: 0; height: 32px; padding: 0 8px; border-radius: 6px; cursor: pointer;
  font-size: 0.6875rem; font-weight: 700;
  border: 1px solid ${({ $on }) => ($on ? '#99F6E4' : '#E2E8F0')};
  background: ${({ $on }) => ($on ? '#F0FDFA' : '#F8FAFC')};
  color: ${({ $on }) => ($on ? '#0F766E' : '#94A3B8')};
  &:disabled { opacity: 0.55; cursor: default; }
`;
const RowErr = styled.div`padding-top: 6px; font-size: 0.75rem; color: #DC2626;`;
const Below = styled.div`display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 0 2px 2px;`;
const ResetBtn = styled.button`
  height: 32px; padding: 0 8px; border-radius: 6px; border: 1px solid #E2E8F0; background: #fff;
  font-size: 0.6875rem; color: #475569; cursor: pointer;
`;
