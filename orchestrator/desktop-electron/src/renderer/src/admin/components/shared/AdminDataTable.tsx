export interface AdminTableColumn {
  id: string
  label: string
  align?: 'left' | 'center' | 'right'
  width?: string
}

interface AdminDataTableProps {
  columns: AdminTableColumn[]
  rows: React.ReactNode[][]
}

export function AdminDataTable({ columns, rows }: AdminDataTableProps): React.JSX.Element {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} style={column.width ? { width: column.width } : undefined} className={column.align ? `is-${column.align}` : ''}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex}>
              {cells.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`} className={columns[cellIndex]?.align ? `is-${columns[cellIndex].align}` : ''}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
