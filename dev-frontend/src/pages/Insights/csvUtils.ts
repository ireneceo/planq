// 통계 페이지 CSV 다운로드 utility.
// 데이터(rows) + 컬럼 정의 → CSV 문자열 → Blob 다운로드.

export interface CsvColumn<T> {
  key: keyof T | string;
  header: string;
  format?: (row: T) => string | number | null | undefined;
}

function escape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  // CSV 표준: 콤마/줄바꿈/따옴표 포함 시 이중따옴표로 wrap + 안의 따옴표는 두 번
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escape(c.header)).join(',');
  const body = rows.map((row) =>
    columns.map((c) => {
      const raw = c.format ? c.format(row) : (row as Record<string, unknown>)[c.key as string];
      return escape(raw);
    }).join(','),
  ).join('\n');
  return header + '\n' + body;
}

export function downloadCsv(filename: string, csv: string) {
  // BOM 추가 — Excel 한글 깨짐 방지
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadRowsAsCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]) {
  downloadCsv(filename, rowsToCsv(rows, columns));
}
