// 통계 페이지 CSV 다운로드 utility.
// 데이터(rows) + 컬럼 정의 → CSV 문자열 → Blob 다운로드.
import { downloadBlob } from '../../utils/download';

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
  // 웹은 동기 실행, 네이티브는 비동기 저장/공유 (fire-and-forget — 동기 시그니처 유지).
  void downloadBlob(blob, filename);
}

export function downloadRowsAsCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]) {
  downloadCsv(filename, rowsToCsv(rows, columns));
}
