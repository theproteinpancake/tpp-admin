// Convert an .xlsx attachment (base64) to CSV-ish text so the PO parser can read it.
// Best-effort: returns '' on any failure (caller treats absence of text as "no data").
import ExcelJS from 'exceljs';

export async function xlsxToText(base64: string, filename = 'sheet'): Promise<string> {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(base64, 'base64') as any);
    const out: string[] = [];
    wb.eachSheet((ws) => {
      const rows: string[] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          const v = cell.value as any;
          let s = '';
          if (v == null) s = '';
          else if (typeof v === 'object') s = String(v.text ?? v.result ?? v.hyperlink ?? v.richText?.map((r: any) => r.text).join('') ?? '');
          else s = String(v);
          cells.push(s.replace(/\s+/g, ' ').trim());
        });
        if (cells.some((c) => c)) rows.push(cells.join(', '));
      });
      if (rows.length) out.push(`--- ${filename} · ${ws.name} ---\n${rows.join('\n')}`);
    });
    return out.join('\n\n').slice(0, 8000);
  } catch { return ''; }
}
