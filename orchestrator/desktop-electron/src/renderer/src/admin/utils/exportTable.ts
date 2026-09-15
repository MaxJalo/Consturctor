export interface ExportTableData {
  filename: string
  headers: string[]
  rows: string[][]
}

function escapeCsv(value: string): string {
  if (/[;"\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(escapeCsv).join(';'), ...rows.map((row) => row.map(escapeCsv).join(';'))]
  return `\uFEFF${lines.join('\r\n')}`
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildPdfHtml(title: string, headers: string[], rows: string[][]): string {
  const head = headers.map((cell) => `<th>${xmlEscape(cell)}</th>`).join('')
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${xmlEscape(cell)}</td>`).join('')}</tr>`)
    .join('')
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"/>
<title>${xmlEscape(title)}</title>
<style>
  body { font-family: "Segoe UI", Arial, sans-serif; color: #102033; padding: 28px; }
  h1 { font-size: 22px; margin: 0 0 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #d7e0ea; padding: 8px; text-align: left; }
  th { background: #eef4fb; }
</style></head><body>
  <h1>${xmlEscape(title)}</h1>
  <table><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="' + headers.length + '">Нет данных</td></tr>'}</tbody></table>
</body></html>`
}

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1)
      crc = (crc >>> 1) ^ (0xedb88320 & mask)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function u16(value: number): Uint8Array {
  return Uint8Array.from([value & 0xff, (value >>> 8) & 0xff])
}

function u32(value: number): Uint8Array {
  return Uint8Array.from([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name)
    const crc = crc32(file.data)
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      file.data
    ])
    localParts.push(local)
    centralParts.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(file.data.length),
        u32(file.data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes
      ])
    )
    offset += local.length
  }
  const central = concat(centralParts)
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0)])
  return concat([...localParts, central, end])
}

function buildXlsx(headers: string[], rows: string[][], sheetName: string): Uint8Array {
  const sheetRows = [headers, ...rows]
  const sheetXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
    ...sheetRows.map((cells, rowIndex) => {
      const cols = cells
        .map((value, colIndex) => {
          const ref = `${String.fromCharCode(65 + Math.min(colIndex, 25))}${rowIndex + 1}`
          if (/^-?\d+(\.\d+)?$/.test(value)) {
            return `<c r="${ref}"><v>${value}</v></c>`
          }
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`
        })
        .join('')
      return `<row r="${rowIndex + 1}">${cols}</row>`
    }),
    '</sheetData></worksheet>'
  ].join('')

  const encoder = new TextEncoder()
  return zipStore([
    {
      name: '[Content_Types].xml',
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`
      )
    },
    {
      name: '_rels/.rels',
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
      )
    },
    {
      name: 'xl/workbook.xml',
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
      )
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`
      )
    },
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheetXml) }
  ])
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export async function downloadTableExport(format: string, data: ExportTableData): Promise<void> {
  const base = data.filename.replace(/\.[^.]+$/, '')
  const title = base.replace(/[-_]/g, ' ')

  if (format.includes('CSV')) {
    const text = buildCsv(data.headers, data.rows)
    if (window.api?.saveLocalFile) {
      const res = await window.api.saveLocalFile({
        defaultName: `${base}.csv`,
        text,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (!res.ok && !res.canceled) throw new Error(res.error || 'Ошибка сохранения CSV')
      return
    }
    downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), `${base}.csv`)
    return
  }

  if (format.includes('Excel')) {
    const bytes = buildXlsx(data.headers, data.rows, 'Экспорт')
    if (window.api?.saveLocalFile) {
      const res = await window.api.saveLocalFile({
        defaultName: `${base}.xlsx`,
        base64: bytesToBase64(bytes),
        filters: [{ name: 'Excel', extensions: ['xlsx'] }]
      })
      if (!res.ok && !res.canceled) throw new Error(res.error || 'Ошибка сохранения Excel')
      return
    }
    downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${base}.xlsx`)
    return
  }

  const html = buildPdfHtml(title, data.headers, data.rows)
  if (window.api?.exportPdf) {
    const res = await window.api.exportPdf({ html, defaultName: `${base}.pdf` })
    if (!res.ok && !res.canceled) throw new Error(res.error || 'Ошибка сохранения PDF')
    return
  }
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${base}.html`)
}
