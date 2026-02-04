import React, { useState, useMemo } from 'react'
import { motion } from 'framer-motion'

export interface TableColumn<T> {
  key: keyof T
  label: string
  render?: (value: any, row: T) => React.ReactNode
  sortable?: boolean
  searchable?: boolean
  width?: string
}

interface DataTableProps<T> {
  columns: TableColumn<T>[]
  data: T[]
  title?: string
  searchPlaceholder?: string
  onRowClick?: (row: T) => void
  rowHoverEffect?: boolean
}

function DataTable<T extends { id: string }>({
  columns,
  data,
  title,
  searchPlaceholder = 'Search...',
  onRowClick,
  rowHoverEffect = true
}: DataTableProps<T>) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortKey, setSortKey] = useState<keyof T | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const searchableColumns = columns.filter(col => col.searchable !== false)

  const filteredData = useMemo(() => {
    let result = [...data]

    // Search
    if (searchTerm) {
      result = result.filter(row =>
        searchableColumns.some(col => {
          const value = row[col.key]
          return String(value).toLowerCase().includes(searchTerm.toLowerCase())
        })
      )
    }

    // Sort
    if (sortKey) {
      result.sort((a, b) => {
        const aVal = a[sortKey]
        const bVal = b[sortKey]
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
    }

    return result
  }, [data, searchTerm, sortKey, sortDir, searchableColumns])

  const toggleSort = (key: keyof T) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  return (
    <div className="space-y-4">
      {title && <h3 className="text-lg font-bold text-white">{title}</h3>}

      {/* Search Bar */}
      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full px-4 py-2 pl-10 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
        />
        <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-800/50">
        <table className="w-full">
          <thead className="bg-slate-700/50 border-b border-slate-700">
            <tr>
              {columns.map(col => (
                <th
                  key={String(col.key)}
                  onClick={() => col.sortable && toggleSort(col.key)}
                  className={`px-4 py-3 text-left text-sm font-semibold text-slate-300 ${
                    col.sortable ? 'cursor-pointer hover:bg-slate-600/50 transition-colors' : ''
                  }`}
                  style={{ width: col.width }}
                >
                  <div className="flex items-center gap-2">
                    {col.label}
                    {col.sortable && sortKey === col.key && (
                      <span className="text-xs">
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-slate-400">
                  No data found {searchTerm && `for "${searchTerm}"`}
                </td>
              </tr>
            ) : (
              filteredData.map((row, idx) => (
                <motion.tr
                  key={row.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.02 }}
                  onClick={() => onRowClick?.(row)}
                  className={`border-t border-slate-700 ${
                    rowHoverEffect ? 'hover:bg-slate-700/30 transition-colors' : ''
                  } ${onRowClick ? 'cursor-pointer' : ''}`}
                >
                  {columns.map(col => (
                    <td
                      key={String(col.key)}
                      className="px-4 py-3 text-sm text-slate-300"
                      style={{ width: col.width }}
                    >
                      {col.render
                        ? col.render(row[col.key], row)
                        : String(row[col.key])}
                    </td>
                  ))}
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>
          Showing <span className="font-semibold text-slate-300">{filteredData.length}</span> of{' '}
          <span className="font-semibold text-slate-300">{data.length}</span>
        </span>
        {searchTerm && (
          <button
            onClick={() => setSearchTerm('')}
            className="text-blue-400 hover:text-blue-300 transition-colors"
          >
            Clear search
          </button>
        )}
      </div>
    </div>
  )
}

export default DataTable
