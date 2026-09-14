import { useEffect, useState } from 'react';
import { api, serverNowDate, syncClock, type StateResponse } from '../api';
import { addDays, formatLocalDate, isLocked, mondayOf, weekdayName } from '../domain/dates';
import { errorText } from '../messages';

export default function SummaryPage() {
  const [data, setData] = useState<StateResponse | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const from = mondayOf(formatLocalDate(serverNowDate()));
        const st = await api.state(from, addDays(from, 11));
        syncClock(st.serverNow);
        setData(st);
      } catch (e) {
        setErr(errorText(e));
      }
    })();
  }, []);

  if (err)
    return (
      <div className="page">
        <p className="msg-err">{err}</p>
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <p className="hint">加载中…</p>
      </div>
    );

  const now = serverNowDate();
  const today = formatLocalDate(now);
  const tomorrow = addDays(today, 1);
  const sumOf = (date: string) => data.summaries.find((s) => s.date === date);
  const menuDay = (date: string) =>
    data.menus.flatMap((m) => m.days).find((d) => d.date === date);
  const todayS = sumOf(today);
  const tomS = sumOf(tomorrow);
  const tomLocked = isLocked(tomorrow, now);

  return (
    <div className="page">
      <div className="sum-cards">
        <div className="sum-card">
          <h3>
            明天 {tomorrow.slice(5)} {weekdayName(tomorrow)}
          </h3>
          <div className="sum-nums">
            <span>
              A餐 <b>{tomS?.A ?? 0}</b> 份
            </span>
            <span>
              B餐 <b>{tomS?.B ?? 0}</b> 份
            </span>
          </div>
          <div className="hint">
            {tomLocked ? '已截止，就按这个数备餐' : '还没截止（今天 15:00 截），数字还会变'}
          </div>
        </div>
        <div className="sum-card">
          <h3>
            今天 {today.slice(5)} {weekdayName(today)}
          </h3>
          <div className="sum-nums">
            <span>
              已取 <b>{todayS?.redeemed ?? 0}</b>
            </span>
            <span>
              未取 <b>{todayS?.pending ?? 0}</b>
            </span>
            <span>
              共 <b>{todayS?.total ?? 0}</b>
            </span>
          </div>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>日期</th>
            <th>A 套餐</th>
            <th>B 套餐</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {data.summaries.map((s) => {
            const day = menuDay(s.date);
            const status =
              s.date < today ? '已过期' : isLocked(s.date, now) ? '已截止' : '订餐中';
            return (
              <tr key={s.date} className={s.date === tomorrow ? 'row-tomorrow' : ''}>
                <td>
                  {s.date} {weekdayName(s.date)}
                </td>
                <td>
                  {day?.A.name ?? 'A餐'} × <b>{s.A}</b>
                </td>
                <td>
                  {day?.B.name ?? 'B餐'} × <b>{s.B}</b>
                </td>
                <td>
                  {status}
                  {s.redeemed ? ` · 已取${s.redeemed}` : ''}
                  {s.void ? ` · 作废${s.void}` : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
