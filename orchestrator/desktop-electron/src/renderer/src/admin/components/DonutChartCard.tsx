import { useState } from 'react'
import type { AdminAgentStatusesMock } from '../../mocks/adminMocks'
import { DashboardPanel } from './DashboardPanel'

interface DonutChartCardProps {
  data: AdminAgentStatusesMock
}

export function DonutChartCard({ data }: DonutChartCardProps): React.JSX.Element {
  const [hoverId, setHoverId] = useState<string | null>(null)
  const total = data.slices.reduce((sum, slice) => sum + slice.value, 0) || 1
  const radius = 54
  const stroke = 16
  const circumference = 2 * Math.PI * radius
  let offset = 0

  const hovered = data.slices.find((slice) => slice.id === hoverId)

  return (
    <DashboardPanel title={data.title} className="admin-dashboard-panel--chart admin-dashboard-panel--donut">
      <div className="admin-donut-chart">
        <div className="admin-donut-chart__ring">
          <svg viewBox="0 0 140 140" aria-hidden>
            <g transform="translate(70 70) rotate(-90)">
              <circle r={radius - stroke / 2 - 2} fill="#fff" pointerEvents="none" />
              {data.slices.map((slice) => {
                const length = (slice.value / total) * circumference
                const dash = `${length} ${circumference - length}`
                const currentOffset = offset
                offset += length
                const isHovered = hoverId === slice.id
                const isDimmed = hoverId !== null && !isHovered
                return (
                  <circle
                    key={slice.id}
                    r={radius}
                    fill="none"
                    stroke={slice.color}
                    strokeWidth={isHovered ? stroke + 4 : stroke}
                    strokeDasharray={dash}
                    strokeDashoffset={-currentOffset}
                    strokeLinecap="butt"
                    className={isDimmed ? 'admin-donut-chart__slice is-dimmed' : 'admin-donut-chart__slice'}
                    onMouseEnter={() => setHoverId(slice.id)}
                    onMouseLeave={() => setHoverId(null)}
                  />
                )
              })}
            </g>
          </svg>
          <div className="admin-donut-chart__center">{hovered ? hovered.value : data.total}</div>
          {hovered ? (
            <div className="admin-donut-chart__tooltip">
              <strong>{hovered.label}</strong>
              <span>{hovered.value}</span>
            </div>
          ) : null}
        </div>
        <ul className="admin-donut-chart__legend">
          {data.slices.map((slice) => (
            <li
              key={slice.id}
              className={hoverId === slice.id ? 'active' : ''}
              onMouseEnter={() => setHoverId(slice.id)}
              onMouseLeave={() => setHoverId(null)}
            >
              <i style={{ background: slice.color }} />
              <span>{slice.label}</span>
              <strong>{slice.value}</strong>
            </li>
          ))}
        </ul>
      </div>
    </DashboardPanel>
  )
}
