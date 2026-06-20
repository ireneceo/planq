// 성공 지표 에디터 (D3 #65) — 구조화 정량 KR. 변경 시 디바운스 전체 교체 저장.
import { useState, useRef, useCallback, useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { putSuccessMetrics, type SuccessMetric } from '../../../services/projectCanvas';
import { PlusIcon, TrashIcon, CheckIcon } from '../../../components/Common/Icons';

interface Props {
  projectId: number;
  initial: SuccessMetric[];
  onSaved?: (m: SuccessMetric[]) => void;
}

type Status = 'idle' | 'saving' | 'saved' | 'error';

export default function SuccessMetricsEditor({ projectId, initial, onSaved }: Props) {
  const { t } = useTranslation('qproject');
  const [rows, setRows] = useState<SuccessMetric[]>(initial);
  const [status, setStatus] = useState<Status>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const scheduleSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const payload = rowsRef.current.filter((r) => r.label.trim());
      setStatus('saving');
      try {
        const saved = await putSuccessMetrics(projectId, payload);
        setRows(saved);
        setStatus('saved');
        onSaved?.(saved);
        setTimeout(() => setStatus('idle'), 1800);
      } catch {
        setStatus('error');
        setTimeout(() => setStatus('idle'), 3000);
      }
    }, 900);
  }, [projectId, onSaved]);

  const patchRow = (i: number, key: keyof SuccessMetric, v: string) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
    scheduleSave();
  };
  const addRow = () => { setRows((prev) => [...prev, { label: '', target: '', current: '', unit: '' }]); };
  const removeRow = (i: number) => { setRows((prev) => prev.filter((_, idx) => idx !== i)); scheduleSave(); };

  return (
    <Box>
      <Head>
        <span>{t('canvas.metrics.title')}</span>
        <Status>
          {status === 'saving' && <Spinner />}
          {status === 'saved' && <Saved><CheckIcon size={12} /></Saved>}
          {status === 'error' && <Err>!</Err>}
        </Status>
      </Head>
      <HintText>{t('canvas.metrics.hint')}</HintText>
      {rows.length === 0 ? (
        <Empty>{t('canvas.metrics.empty')}</Empty>
      ) : (
        <List>
          <RowHead>
            <span>{t('canvas.metrics.label')}</span>
            <span>{t('canvas.metrics.current')}</span>
            <span>{t('canvas.metrics.target')}</span>
            <span>{t('canvas.metrics.unit')}</span>
            <span />
          </RowHead>
          {rows.map((r, i) => (
            <Row key={r.id || `new-${i}`}>
              <In value={r.label} placeholder={t('canvas.metrics.labelPh') as string} onChange={(e) => patchRow(i, 'label', e.target.value)} />
              <InS value={r.current} placeholder={t('canvas.metrics.currentPh') as string} onChange={(e) => patchRow(i, 'current', e.target.value)} />
              <InS value={r.target} placeholder={t('canvas.metrics.targetPh') as string} onChange={(e) => patchRow(i, 'target', e.target.value)} />
              <InS value={r.unit} placeholder={t('canvas.metrics.unitPh') as string} onChange={(e) => patchRow(i, 'unit', e.target.value)} />
              <DelBtn type="button" onClick={() => removeRow(i)} title={t('canvas.workstreams.del') as string}><TrashIcon size={14} /></DelBtn>
            </Row>
          ))}
        </List>
      )}
      <AddBtn type="button" onClick={addRow}><PlusIcon size={14} />{t('canvas.metrics.add')}</AddBtn>
    </Box>
  );
}

const Box = styled.div``;
const Head = styled.div`display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:#0F172A;`;
const HintText = styled.div`font-size:12px;color:#94A3B8;margin:4px 0 12px;`;
const Status = styled.span`display:inline-flex;width:18px;height:18px;align-items:center;justify-content:center;`;
const Spinner = styled.span`width:14px;height:14px;border:2px solid #E2E8F0;border-top-color:#94A3B8;border-radius:50%;animation:spin .6s linear infinite;@keyframes spin{to{transform:rotate(360deg)}}`;
const Saved = styled.span`display:inline-flex;width:18px;height:18px;align-items:center;justify-content:center;background:#D1FAE5;color:#065F46;border-radius:50%;`;
const Err = styled.span`display:inline-flex;width:18px;height:18px;align-items:center;justify-content:center;background:#EF4444;color:#fff;border-radius:50%;font-size:12px;font-weight:700;`;
const Empty = styled.div`font-size:13px;color:#94A3B8;padding:12px 0;`;
const List = styled.div`display:flex;flex-direction:column;gap:6px;`;
const RowHead = styled.div`display:grid;grid-template-columns:1fr 80px 80px 64px 28px;gap:8px;font-size:11px;font-weight:600;color:#94A3B8;padding:0 2px;`;
const Row = styled.div`display:grid;grid-template-columns:1fr 80px 80px 64px 28px;gap:8px;align-items:center;`;
const In = styled.input`height:36px;border:1px solid #E2E8F0;border-radius:8px;padding:0 10px;font-size:13px;color:#0F172A;&:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,.15);}`;
const InS = styled(In)`text-align:center;padding:0 4px;`;
const DelBtn = styled.button`display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;background:transparent;color:#CBD5E1;border-radius:6px;cursor:pointer;&:hover{background:#FEF2F2;color:#EF4444;}`;
const AddBtn = styled.button`display:inline-flex;align-items:center;gap:6px;margin-top:12px;height:34px;padding:0 12px;border:1px dashed #CBD5E1;background:#fff;border-radius:8px;font-size:13px;font-weight:600;color:#475569;cursor:pointer;&:hover{border-color:#14B8A6;color:#0F766E;background:#F0FDFA;}`;
