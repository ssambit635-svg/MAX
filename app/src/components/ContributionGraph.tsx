import { useMemo } from "react";
import type { Contributions } from "../lib/types";

const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface ContributionGraphProps {
  data: Contributions;
  onHover?: (label: string | null) => void;
}

/**
 * The real GitHub contribution calendar, drawn as a quiet dashboard grid.
 * 53 weeks × 7 days, month labels on top, the same five levels GitHub uses.
 */
export function ContributionGraph({ data, onHover }: ContributionGraphProps) {
  const monthLabels = useMemo(() => {
    const labels: { index: number; label: string }[] = [];
    let lastMonth = -1;
    data.weeks.forEach((week, index) => {
      const first = week.find((day) => day.date);
      if (!first?.date) return;
      const month = Number(first.date.slice(5, 7)) - 1;
      if (month !== lastMonth) {
        // avoid a label that would collide with the previous one
        if (!labels.length || index - labels[labels.length - 1].index >= 3) {
          labels.push({ index, label: MONTHS[month] });
        }
        lastMonth = month;
      }
    });
    return labels;
  }, [data.weeks]);

  return (
    <div className="contrib">
      <div className="contrib__head">
        <span className="contrib__total">
          <b>{data.total.toLocaleString()}</b> contributions in the last year
        </span>
        <span className="contrib__meta">
          {data.streak > 0 && <span className="contrib__streak">{data.streak} day streak</span>}
          <span>best {data.best.count} on {data.best.date ?? "—"}</span>
        </span>
      </div>

      <div className="contrib__body">
        <div className="contrib__days" aria-hidden>
          {DAY_LABELS.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>

        <div className="contrib__scroll">
          <div className="contrib__months" aria-hidden>
            {data.weeks.map((_, index) => {
              const label = monthLabels.find((entry) => entry.index === index);
              return (
                <span key={index} className="contrib__month">
                  {label?.label ?? ""}
                </span>
              );
            })}
          </div>

          <div className="contrib__grid" role="img" aria-label={`${data.total} contributions in the last year`}>
            {data.weeks.map((week, weekIndex) => (
              <div className="contrib__week" key={weekIndex}>
                {week.map((day, dayIndex) => {
                  const date = day.date;
                  if (!date) return <span key={dayIndex} className="contrib__cell contrib__cell--pad" />;
                  const label = `${day.count} contribution${day.count === 1 ? "" : "s"} on ${date}`;
                  return (
                    <span
                      key={dayIndex}
                      className="contrib__cell"
                      data-level={day.level}
                      title={label}
                      onMouseEnter={() => onHover?.(`${day.count} on ${date.slice(5).replace("-", "/")}`)}
                      onMouseLeave={() => onHover?.(null)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="contrib__foot">
        <div className="contrib__months-bars">
          {data.monthly.slice(-6).map((month) => {
            const peak = Math.max(1, ...data.monthly.map((entry) => entry.count));
            return (
              <div className="contrib__monthbar" key={month.key} title={`${month.month}: ${month.count}`}>
                <span className="contrib__monthbar-fill" style={{ height: `${Math.max(6, (month.count / peak) * 100)}%` }} />
                <span className="contrib__monthbar-label">{month.month}</span>
              </div>
            );
          })}
        </div>
        <div className="contrib__legend">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} className="contrib__cell contrib__cell--legend" data-level={level} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
