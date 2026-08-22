// CSV 내보내기 (#225) — 데이터(rows) + 컬럼 정의 → CSV 문자열 → 파일 저장.
//
// 원래 pages/Insights 안에 있던 것을 밖으로 꺼냈다. 통계뿐 아니라 고객·청구·업무 목록도
//   같은 방식으로 내보내야 하는데, 한 페이지 폴더 안에 있으면 다른 화면이 자기 것을 새로 만들게 된다.
//
// ★ 엑셀 전용 형식(.xlsx)을 만들지 않는 이유: 엑셀은 CSV 를 그대로 연다. 사용자가 원하는 건
//   "엑셀에서 열리는 것" 이지 특정 확장자가 아니고, BOM 만 붙이면 한글도 깨지지 않는다.
//   서식이 필요한 표(청구서 등)는 이미 PDF 가 담당한다.
import { downloadBlob } from './download';

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
