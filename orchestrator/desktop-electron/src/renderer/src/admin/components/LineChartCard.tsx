import { useMemo, useRef, useState } from 'react'
import type { AdminLaunchDynamicsMock } from '../../mocks/adminMocks'
import { DashboardPanel } from './DashboardPanel'

interface LineChartCardProps {
  data: AdminLaunchDynamicsMock
}

function buildPath(points: Array<{ x: number; y: number }>): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
}

export function LineChartCard({ data }: LineChartCardProps): React.JSX.Element {
  const plotRef = useRef<HTMLDivElement>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const chartWidth = 520
  const chartHeight = 168
  const padTop = 8
  const padBottom = 8
  const plotHeight = chartHeight - padTop - padBottom
  const stepX = chartWidth / Math.max(data.xLabels.length - 1, 1)

  const coords = useMemo(() => {
    return data.series.map((series) =>
      series.points.map((value, index) => ({
        x: index * stepX,
        y: padTop + plotHeight - (value / data.yMax) * plotHeight
      }))
    )
  }, [data, plotHeight, stepX])

  const hoverX = hoverIndex === null ? null : hoverIndex * stepX

  function handlePointer(clientX: number): void {
    const rect = plotRef.current?.getBoundingClientRect()
    if (!rect) return
    const ratio = (clientX - rect.left) / rect.width
    const index = Math.round(ratio * (data.xLabels.length - 1))
    setHoverIndex(Math.max(0, Math.min(data.xLabels.length - 1, index)))
  }

  return (
    <DashboardPanel title={data.title} className="admin-dashboard-panel--chart admin-dashboard-panel--wide">
      <div className="admin-line-chart">
        <div className="admin-line-chart__y-axis">
          {data.yTicks
            .slice()
            .reverse()
            .map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
        </div>
        <div
          ref={plotRef}
          className="admin-line-chart__plot"
          onMouseMove={(event) => handlePointer(event.clientX)}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="admin-line-chart__svg" preserveAspectRatio="none">
            {data.yTicks.map((tick) => {
              const y = padTop + plotHeight - (tick / data.yMax) * plotHeight
              return (
                <line key={`h-${tick}`} x1={0} y1={y} x2={chartWidth} y2={y} className="admin-line-chart__grid-line" />
              )
            })}
            {data.xLabels.map((label, index) => (
              <line
                key={`v-${label}`}
                x1={index * stepX}
                y1={padTop}
                x2={index * stepX}
                y2={padTop + plotHeight}
                className="admin-line-chart__grid-line admin-line-chart__grid-line--vertical"
              />
            ))}
            {hoverX !== null ? (
              <rect
                x={Math.max(0, hoverX - stepX / 2)}
                y={0}
                width={stepX}
                height={chartHeight}
                className="admin-line-chart__hover-band"
              />
            ) : null}
            {hoverX !== null ? (
              <line x1={hoverX} y1={padTop} x2={hoverX} y2={padTop + plotHeight} className="admin-line-chart__hover-line" />
            ) : null}
            {data.series.map((series, seriesIndex) => (
              <path
                key={series.id}
                d={buildPath(coords[seriesIndex])}
                fill="none"
                stroke={series.color}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={hoverIndex !== null ? 'admin-line-chart__series is-dimmed' : 'admin-line-chart__series'}
              />
            ))}
            {data.series.map((series, seriesIndex) =>
              coords[seriesIndex].map((point, pointIndex) => (
                <circle
                  key={`${series.id}-${pointIndex}`}
                  cx={point.x}
                  cy={point.y}
                  r={hoverIndex === pointIndex ? 5 : 3.5}
                  fill={series.color}
                  stroke="#fff"
                  strokeWidth={hoverIndex === pointIndex ? 2 : 1.5}
                  className="admin-line-chart__dot"
                />
              ))
            )}
          </svg>
          {hoverIndex !== null ? (
            <div
              className="admin-line-chart__tooltip"
              style={{ left: `${(hoverIndex / Math.max(data.xLabels.length - 1, 1)) * 100}%` }}
            >
              <div className="admin-line-chart__tooltip-title">{data.xLabels[hoverIndex]}</div>
              {data.series.map((series) => (
                <div key={series.id} className="admin-line-chart__tooltip-row">
                  <i style={{ background: series.color }} />
                  <span>{series.label}</span>
                  <strong>{series.points[hoverIndex]}</strong>
                </div>
              ))}
            </div>
          ) : null}
          <div className="admin-line-chart__x-axis">
            {data.xLabels.map((label, index) => (
              <span key={label} className={hoverIndex === index ? 'active' : ''}>
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="admin-line-chart__legend">
        {data.legend.map((item) => (
          <span key={item.id} className="admin-line-chart__legend-item">
            <i style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </DashboardPanel>
  )
}
