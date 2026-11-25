// 항목 «검색에서 숨기기» — 워크스페이스가 «제한 자료 잠금 표시» 를 켰을 때만 보인다(꺼져 있으면 뜻이 없다).
//   제한(L2) 자료에서만 · 올린 사람·작성자·대표·관리자만 바꾼다(서버 PUT /api/access-requests/:biz/hide/:type/:id 가 다시 본다).
//   (2026-11-25 · docs/FILE_SEARCH_DISCOVERY_DESIGN.md §2 «항목별 숨김은 필수 동반»)
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AutoSaveField from '../Common/AutoSaveField';
import { Switch, SwitchKnob } from '../Common/switchShell';
import { discoveryEnabled, setHideExistence, type LockedKind } from '../../services/accessRequests';

interface Props {
  businessId: number | null | undefined;
  kind: LockedKind;
  id: number;
  initial: boolean;
  canEdit: boolean;
  onChanged?: (hide: boolean) => void;
}

const HideExistenceToggle: React.FC<Props> = ({ businessId, kind, id, initial, canEdit, onChanged }) => {
  const { t } = useTranslation('common');
  const [enabled, setEnabled] = useState(false);
  const [on, setOn] = useState(initial);
  const onRef = useRef(initial);
  onRef.current = on;
  useEffect(() => { setOn(initial); }, [initial, id]);
  useEffect(() => {
    let alive = true;
    if (businessId) discoveryEnabled(businessId).then((v) => { if (alive) setEnabled(v); });
    return () => { alive = false; };
  }, [businessId]);
  if (!enabled || !businessId) return null;
  const persist = async () => {
    const next = onRef.current;
    try { await setHideExistence(businessId, kind, id, next); onChanged?.(next); }
    catch (e) { setOn(!next); throw e; }
  };
  const labelId = `hide-existence-${kind}-${id}`;
  return (
    <Wrap data-testid="hide-existence">
      <Text>
        <Label id={labelId}>{t('accessRequest.hide.label', '검색에서 숨기기') as string}</Label>
        <Hint>{t('accessRequest.hide.hint') as string}</Hint>
      </Text>
      <AutoSaveField key={labelId} type="toggle" onSave={persist}>
        <Switch type="button" role="switch" aria-checked={on} aria-labelledby={labelId} data-testid="hide-existence-switch"
          $on={on} disabled={!canEdit} onClick={() => setOn((v) => !v)}>
          <SwitchKnob $on={on} />
        </Switch>
      </AutoSaveField>
    </Wrap>
  );
};

export default HideExistenceToggle;

const Wrap = styled.div` display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; `;
const Text = styled.div` display: flex; flex-direction: column; gap: 2px; min-width: 0; `;
const Label = styled.div` font-size: 0.8125rem; font-weight: 600; color: #334155; `;
const Hint = styled.div` font-size: 0.75rem; color: #94A3B8; line-height: 1.45; `;
