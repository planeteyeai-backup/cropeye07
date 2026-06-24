import type { PublicFactoryFarmer } from './factoryProgressTypes';
import { YIELD_TARGET_TON } from './progressData';

function formatExcelDate(raw: string | null | undefined): string {
  if (!raw) return '-';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatYieldTon(value: number | null | undefined): string | number {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return Number(Number(value).toFixed(2));
}

function formatYieldPerAcre(value: number | null | undefined): string | number {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return Number(Number(value).toFixed(2));
}

export function filterUnderTargetFarmers(
  farmers: PublicFactoryFarmer[],
): PublicFactoryFarmer[] {
  return [...farmers]
    .filter((farmer) => (farmer.yield ?? YIELD_TARGET_TON) < YIELD_TARGET_TON)
    .sort((a, b) => (a.yield ?? 0) - (b.yield ?? 0));
}

export function countUnderTargetFarmers(farmers: PublicFactoryFarmer[]): number {
  return filterUnderTargetFarmers(farmers).length;
}

export async function downloadUnderTargetFarmersExcel(
  factoryName: string,
  farmers: PublicFactoryFarmer[],
): Promise<number> {
  const [{ saveAs }, XLSX] = await Promise.all([
    import('file-saver'),
    import('xlsx'),
  ]);

  const underTarget = filterUnderTargetFarmers(farmers);
  const rows = underTarget.map((farmer, index) => ({
    No: index + 1,
    Name: farmer.farmer_name?.trim() || `Farmer ${farmer.id}`,
    'Phone No': farmer.phone_number?.trim() || '-',
    'Yield date': formatExcelDate(farmer.date),
    'Yield (T/acre)': formatYieldPerAcre(farmer.yield),
   
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: ['No', 'Name', 'Phone No', 'Yield date', 'Yield (T/acre)', ''],
  });
  worksheet['!cols'] = [
    { wch: 6 },
    { wch: 38 },
    { wch: 14 },
    { wch: 16 },
    { wch: 14 },
    { wch: 12 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, `Under ${YIELD_TARGET_TON} ton`);

  const safeName = factoryName
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 40);
  const filename = `${safeName}_under_${YIELD_TARGET_TON}ton_${underTarget.length}.xlsx`;
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  saveAs(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  );

  return underTarget.length;
}

export interface YieldRangeExportRow {
  name: string;
  phone: string;
  yieldDate: string;
  tons: number;
  hasYieldData: boolean;
}

export async function downloadYieldRangeFarmersExcel(
  factoryName: string,
  rangeLabel: string,
  farmers: YieldRangeExportRow[],
): Promise<number> {
  const [{ saveAs }, XLSX] = await Promise.all([
    import('file-saver'),
    import('xlsx'),
  ]);

  const rows = farmers.map((farmer, index) => ({
    No: index + 1,
    Name: farmer.name,
    'Phone No': farmer.phone || '-',
    'Yield date': farmer.yieldDate === '-' ? '-' : farmer.yieldDate,
    'Yield (ton)': farmer.hasYieldData ? formatYieldTon(farmer.tons) : '-',
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: ['No', 'Name', 'Phone No', 'Yield date', 'Yield (ton)'],
  });
  worksheet['!cols'] = [
    { wch: 6 },
    { wch: 38 },
    { wch: 14 },
    { wch: 16 },
    { wch: 12 },
  ];

  const safeFactory = factoryName
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 30);
  const safeRange = rangeLabel.replace(/[^\w-]/g, '_').slice(0, 20);
  const sheetName = `${rangeLabel} ton`.slice(0, 31);
  const filename = `${safeFactory}_${safeRange}ton_${farmers.length}.xlsx`;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  saveAs(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  );

  return farmers.length;
}
