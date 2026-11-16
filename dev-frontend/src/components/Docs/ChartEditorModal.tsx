// 차트 만들기·고치기 창 (2026-11-16, docs/DOC_CHART_BLOCK_DESIGN.md)
//   종류(막대·선·영역·원) · 제목 · 단위 · 데이터 표(첫 열 = 항목, 머리줄 = 계열 이름) · 아래 미리보기(PDF 와 같은 그림 함수).
//   엑셀·구글 시트에서 복사한 칸을 표 칸에 붙여넣으면 그 자리부터 펼친다.
// autosave-exempt: 문서 본문에 넣는 창 — [넣기]/[저장] 을 눌러야 문서에 들어가고, 문서 자체는 편집기 자동저장이 맡는다
import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';
import { SegmentedToggle, SegmentedBtn } from '../Common/segmentedToggle';
import { normalizeChart, chartDataUri, parseTsv, emptyChart, CHART_LIMIT, type ChartData, type ChartKind } from './chartData';

interface Props {
  open: boolean;
  /** 고치기면 기존 값, 새로 넣기면 null(빈 표) */
  initial: ChartData | null;
  mode: 'insert' | 'edit';
  onClose: () => void;
  onSubmit: (chart: ChartData) => void;
}

// 표 칸은 글자로 들고 있는다(입력 중 «1,2» 같은 중간 상태를 숫자로 바꾸면 커서가 튄다). 저장·미리보기 때 normalizeChart 가 숫자로.
interface Grid { labels: string[]; names: string[]; cells: string[][] }   // cells[항목][계열]

const toGrid = (c: ChartData): Grid => ({
  labels: c.labels.length ? [...c.labels] : ['', '', ''],
  names: c.series.length ? c.series.map((s) => s.name) : [''],
  cells: (c.labels.length ? c.labels : ['', '', '']).map((_, i) =>
    (c.series.length ? c.series : [{ name: '', values: [] }]).map((s) => (s.values[i] == null ? '' : String(s.values[i])))),
});
const fromGrid = (g: Grid, kind: ChartKind, title: string, unit: string): ChartData => normalizeChart({
  v: 1, kind, title, unit,
  labels: g.labels,
  series: g.names.map((name, k) => ({ name, values: g.cells.map((r) => r[k] ?? '') })),
});

const KIND_KEYS: ChartKind[] = ['bar', 'line', 'area', 'pie'];

const ChartEditorModal: React.FC<Props> = ({ open, initial, mode, onClose, onSubmit }) => {
  const { t } = useTranslation('qdocs');
  const [kind, setKind] = useState<ChartKind>('bar');
  const [title, setTitle] = useState('');
  const [unit, setUnit] = useState('');
  const [grid, setGrid] = useState<Grid>(() => toGrid(emptyChart()));

  useEffect(() => {
    if (!open) return;
    const c = initial ? normalizeChart(initial) : emptyChart();
    setKind(c.kind); setTitle(c.title); setUnit(c.unit); setGrid(toGrid(c));
  }, [open, initial]);

  const chart = useMemo(() => fromGrid(grid, kind, title, unit), [grid, kind, title, unit]);
  const preview = useMemo(() => chartDataUri(chart), [chart]);
  const hasValue = chart.series.some((s) => s.values.some((v) => v != null));

  const setCell = (i: number, k: number, v: string) => setGrid((g) => ({ ...g, cells: g.cells.map((r, ri) => (ri === i ? r.map((c, ci) => (ci === k ? v : c)) : r)) }));
  const setLabel = (i: number, v: string) => setGrid((g) => ({ ...g, labels: g.labels.map((l, li) => (li === i ? v : l)) }));
  const setName = (k: number, v: string) => setGrid((g) => ({ ...g, names: g.names.map((n, ni) => (ni === k ? v : n)) }));
  const addRow = () => setGrid((g) => (g.labels.length >= CHART_LIMIT.labels ? g : { ...g, labels: [...g.labels, ''], cells: [...g.cells, g.names.map(() => '')] }));
  const delRow = (i: number) => setGrid((g) => (g.labels.length <= 1 ? g : { ...g, labels: g.labels.filter((_, li) => li !== i), cells: g.cells.filter((_, ri) => ri !== i) }));
  const addCol = () => setGrid((g) => (g.names.length >= CHART_LIMIT.series ? g : { ...g, names: [...g.names, ''], cells: g.cells.map((r) => [...r, '']) }));
  const delCol = (k: number) => setGrid((g) => (g.names.length <= 1 ? g : { ...g, names: g.names.filter((_, ni) => ni !== k), cells: g.cells.map((r) => r.filter((_, ci) => ci !== k)) }));

  // 붙여넣기 — 칸 (row, col) 에서 시작. col -1 = 항목 이름 칸, row -1 = 계열 이름 칸
  const onPaste = (row: number, col: number) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const m = parseTsv(e.clipboardData.getData('text/plain'));
    if (!m) return;
    e.preventDefault();
    setGrid((g0) => {
      const g: Grid = { labels: [...g0.labels], names: [...g0.names], cells: g0.cells.map((r) => [...r]) };
      m.forEach((line, dr) => line.forEach((val, dc) => {
        const r = row + dr; const c = col + dc;
        if (c >= CHART_LIMIT.series) return;
        if (r >= CHART_LIMIT.labels) return;
        while (g.names.length <= c) { g.names.push(''); g.cells.forEach((x) => x.push('')); }
        while (r >= 0 && g.labels.length <= r) { g.labels.push(''); g.cells.push(g.names.map(() => '')); }
        if (r < 0 && c < 0) return;
        if (r < 0) g.names[c] = val.trim();
        else if (c < 0) g.labels[r] = val.trim();
        else g.cells[r][c] = val.trim();
      }));
      return g;
    });
  };

  return (
    <StandardModal open={open} onClose={onClose} size="lg"
      title={mode === 'edit' ? t('editor.chart.editTitle', '차트 고치기') : t('editor.chart.insertTitle', '차트 넣기')}
      footer={(
        <>
          <ActionButton tone="secondary" size="md" onClick={onClose}>{t('editor.chart.cancel', '취소')}</ActionButton>
          <ActionButton tone="primary" size="md" data-testid="doc-chart-submit" disabled={!hasValue}
            onClick={() => onSubmit(chart)}>
            {mode === 'edit' ? t('editor.chart.save', '저장') : t('editor.chart.insert', '넣기')}
          </ActionButton>
        </>
      )}>
      <Row>
        <SegmentedToggle role="radiogroup" aria-label={t('editor.chart.kind', '종류') as string}>
          {KIND_KEYS.map((k) => (
            <SegmentedBtn key={k} type="button" role="radio" aria-checked={kind === k} $active={kind === k}
              data-testid={`doc-chart-kind-${k}`} onClick={() => setKind(k)}>
              {t(`editor.chart.kinds.${k}`, { bar: '막대', line: '선', area: '영역', pie: '원' }[k])}
            </SegmentedBtn>
          ))}
        </SegmentedToggle>
      </Row>
      <Row>
        <Field $grow>
          <Label htmlFor="doc-chart-title">{t('editor.chart.titleLabel', '제목')}</Label>
          <Input id="doc-chart-title" data-testid="doc-chart-title" value={title} maxLength={CHART_LIMIT.title}
            placeholder={t('editor.chart.titlePh', '예: 월별 매출') as string} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field>
          <Label htmlFor="doc-chart-unit">{t('editor.chart.unitLabel', '단위')}</Label>
          <Input id="doc-chart-unit" value={unit} maxLength={CHART_LIMIT.unit} $narrow
            placeholder={t('editor.chart.unitPh', '예: 만원') as string} onChange={(e) => setUnit(e.target.value)} />
        </Field>
      </Row>
      <div>
        <Label as="div">{t('editor.chart.data', '데이터')}</Label>
        <Hint>{kind === 'pie'
          ? t('editor.chart.hintPie', '원 그래프는 첫 번째 계열만 씁니다. 엑셀에서 복사한 칸을 표에 붙여넣을 수 있어요.')
          : t('editor.chart.hint', '첫 열은 항목, 머리줄은 계열 이름입니다. 엑셀에서 복사한 칸을 표에 붙여넣을 수 있어요.')}</Hint>
        <GridWrap>
          <GridTable data-testid="doc-chart-grid">
            <thead>
              <tr>
                <th aria-hidden="true" />
                {grid.names.map((n, k) => (
                  <th key={k}>
                    <CellInput value={n} maxLength={CHART_LIMIT.name} $head $del={grid.names.length > 1} aria-label={t('editor.chart.seriesName', { n: k + 1, defaultValue: '계열 {{n}} 이름' }) as string}
                      placeholder={t('editor.chart.seriesPh', { n: k + 1, defaultValue: '계열 {{n}}' }) as string}
                      onChange={(e) => setName(k, e.target.value)} onPaste={onPaste(-1, k)} />
                    {grid.names.length > 1 && (
                      <MiniBtn type="button" onClick={() => delCol(k)} aria-label={t('editor.chart.delSeries', '이 계열 빼기') as string}>×</MiniBtn>
                    )}
                  </th>
                ))}
                <th>
                  {grid.names.length < CHART_LIMIT.series && (
                    <MiniBtn type="button" data-testid="doc-chart-add-series" onClick={addCol}>＋ {t('editor.chart.addSeries', '계열')}</MiniBtn>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {grid.labels.map((l, i) => (
                <tr key={i}>
                  <td>
                    <CellInput value={l} maxLength={CHART_LIMIT.name} $head aria-label={t('editor.chart.labelName', { n: i + 1, defaultValue: '항목 {{n}}' }) as string}
                      placeholder={t('editor.chart.labelPh', { n: i + 1, defaultValue: '항목 {{n}}' }) as string}
                      onChange={(e) => setLabel(i, e.target.value)} onPaste={onPaste(i, -1)} />
                  </td>
                  {grid.names.map((_, k) => (
                    <td key={k}>
                      <CellInput value={grid.cells[i]?.[k] ?? ''} inputMode="decimal" data-testid={`doc-chart-cell-${i}-${k}`}
                        aria-label={`${l || i + 1} · ${grid.names[k] || k + 1}`}
                        onChange={(e) => setCell(i, k, e.target.value)} onPaste={onPaste(i, k)} />
                    </td>
                  ))}
                  <td>
                    {grid.labels.length > 1 && (
                      <MiniBtn type="button" onClick={() => delRow(i)} aria-label={t('editor.chart.delRow', '이 항목 빼기') as string}>×</MiniBtn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </GridTable>
        </GridWrap>
        {grid.labels.length < CHART_LIMIT.labels && (
          <MiniBtn type="button" data-testid="doc-chart-add-row" onClick={addRow}>＋ {t('editor.chart.addRow', '항목')}</MiniBtn>
        )}
      </div>
      <div>
        <Label as="div">{t('editor.chart.preview', '미리보기')}</Label>
        <Preview><img src={preview} alt="" data-testid="doc-chart-preview" /></Preview>
      </div>
    </StandardModal>
  );
};

export default ChartEditorModal;

const Row = styled.div`display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap;`;
const Field = styled.div<{ $grow?: boolean }>`display: flex; flex-direction: column; gap: 6px; ${(p) => (p.$grow ? 'flex: 1 1 220px; min-width: 0;' : '')}`;
const Label = styled.label`font-size: 0.8125rem; font-weight: 600; color: #475569;`;
const Hint = styled.p`margin: 4px 0 8px; font-size: 0.75rem; color: #64748B;`;
const Input = styled.input<{ $narrow?: boolean }>`
  height: 36px; padding: 0 10px; border: 1px solid #CBD5E1; border-radius: 8px; font-size: 0.875rem; color: #0F172A;
  width: ${(p) => (p.$narrow ? '120px' : '100%')}; box-sizing: border-box;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const GridWrap = styled.div`max-width: 100%; overflow-x: auto; border: 1px solid #E2E8F0; border-radius: 8px;`;
const GridTable = styled.table`
  border-collapse: collapse; min-width: 100%;
  th, td { border-bottom: 1px solid #E2E8F0; padding: 0; position: relative; white-space: nowrap; }
  th + th, td + td { border-left: 1px solid #E2E8F0; }
  thead th { background: #F8FAFC; }
  tbody tr:last-child td { border-bottom: none; }
  th:last-child, td:last-child { width: 1%; padding: 0 4px; }
`;
// $del — 칸 안에 × 버튼이 붙는 머리 칸만 오른쪽을 비운다(숫자 칸까지 비우면 폰에서 긴 숫자가 잘린다 — 실측)
const CellInput = styled.input<{ $head?: boolean; $del?: boolean }>`
  width: 100%; min-width: 96px; height: 36px; box-sizing: border-box; border: none; background: transparent;
  padding: ${(p) => (p.$del ? '0 28px 0 10px' : '0 10px')}; font-size: 0.8125rem; color: #0F172A; font-weight: ${(p) => (p.$head ? 600 : 400)};
  text-align: ${(p) => (p.$head ? 'left' : 'right')};
  &:focus { outline: 2px solid #14B8A6; outline-offset: -2px; background: #fff; }
`;
const MiniBtn = styled.button`
  border: none; background: transparent; color: #64748B; cursor: pointer; font-size: 0.75rem; font-weight: 600;
  min-height: 32px; padding: 0 8px; border-radius: 6px;
  th & , td & { position: absolute; right: 2px; top: 2px; min-height: 32px; padding: 0 6px; }
  th:last-child &, td:last-child & { position: static; }
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Preview = styled.div`
  margin-top: 6px; border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden; background: #fff; line-height: 0;
  img { display: block; width: 100%; height: auto; }
`;
