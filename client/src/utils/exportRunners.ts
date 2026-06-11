import * as XLSX from 'xlsx';
import type { RaceWithEvent, PnlStats } from '../services/chatApi';

function stakeToWin1(bsp: number): number {
  return 1 / (bsp - 1);
}

function buildRows(races: RaceWithEvent[], pnlStats: PnlStats): (string | number)[][] {
  const rows: (string | number)[][] = [];

  const sign = pnlStats.pnl >= 0 ? '+' : '-';
  rows.push([
    'Total P&L',
    `Staked: £${pnlStats.staked.toFixed(2)}`,
    `Returns: £${pnlStats.returns.toFixed(2)}`,
    `P&L: ${sign}£${Math.abs(pnlStats.pnl).toFixed(2)}`,
  ]);
  rows.push([]);

  rows.push(['Event', 'Race', 'Time', 'Country', 'Runner', 'Draw', 'BSP', 'Status', 'Stake/£1', 'P&L', '# in SP']);

  for (const race of races) {
    const inSpCount = race.runners.length;
    const raceTime = (() => {
      try {
        return new Date(race.marketTime).toLocaleString('en-GB', { timeZone: 'Europe/London' });
      } catch {
        return race.marketTime;
      }
    })();

    for (const runner of race.runners) {
      const bsp = runner.bsp ?? 0;
      const stake = bsp > 1 ? stakeToWin1(bsp) : 0;
      const pnl = runner.status === 'WINNER' ? 1 : bsp > 1 ? -stake : 0;
      rows.push([
        race.eventName,
        race.marketName,
        raceTime,
        race.countryCode,
        runner.name,
        runner.sortPriority,
        bsp,
        runner.status,
        +stake.toFixed(4),
        +pnl.toFixed(4),
        inSpCount,
      ]);
    }
  }

  return rows;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvCell(val: string | number): string {
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function exportToCsv(races: RaceWithEvent[], pnlStats: PnlStats): void {
  const rows = buildRows(races, pnlStats);
  const csv = '﻿' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, 'runners.csv');
}

export function exportToXlsx(races: RaceWithEvent[], pnlStats: PnlStats): void {
  const rows = buildRows(races, pnlStats);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Runners');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  triggerDownload(blob, 'runners.xlsx');
}
