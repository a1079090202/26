import { useEffect, useMemo, useState } from 'react';
import { api, isUnauthorized, serverNowDate } from '../api';
import { addDays, formatLocalDate, mondayOf, weekdayName } from '../domain/dates';
import { weeklyReport } from '../domain/summary';
import type { Order } from '../domain/types';
import { errorText } from '../messages';
import { AdminGate } from './AdminGate';

export default function ReportPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [err, setErr] = useState('');
  const [week, setWeek] = useState('');
  const [needAuth, setNeedAuth] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const today = formatLocalDate(serverNowDate());
        // 最近 8 周
        const from = addDays(mondayOf(today), -49);
        const r = await api.report(from, today);
        setOrders(r.orders);
        const weeks = [...new Set(r.orders.map((o) => mondayOf(o.date)))].sort().reverse();
        setWeek(weeks[0] ?? '');
      } catch (e) {
        if (isUnauthorized(e)) {
          setNeedAuth(true);
          return;
        }
        setErr(errorText(e));
      }
    })();
  }, [reloadKey]);

  const today = formatLocalDate(serverNowDate());
  const weeks = useMemo(
    () => [...new Set((orders ?? []).map((o) => mondayOf(o.date)))].sort().reverse(),
    [orders],
  );
  const report = orders && week ? weeklyReport(orders, week, today) : null;

  if (needAuth)
    return (
      <div className="page">
        <AdminGate
          onSaved={() => {
            setNeedAuth(false);
            setReloadKey((k) => k + 1);
          }}
        />
      </div>
    );
  if (err)
    return (
      <div className="page">
        <p className="msg-err">{err}</p>
      </div>
    );
  if (!orders)
    return (
      <div className="page">
        <p className="hint">加载中…</p>
      </div>
    );

  return (
    <div className="page">
      <h2>
        周报 <span className="hint">订了没取的算作废；数据只留最近 8 周</span>
      </h2>
      {weeks.length === 0 ? (
        <p className="hint">最近 8 周还没有订餐数据。</p>
      ) : (
        <>
          <div className="week-switch">
            {weeks.map((w) => (
              <button
                key={w}
                className={w === week ? 'btn active' : 'btn'}
                onClick={() => setWeek(w)}
              >
                {w.slice(5)} 那周
              </button>
            ))}
          </div>
          {report && (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>A餐</th>
                    <th>B餐</th>
                    <th>已取</th>
                    <th>作废</th>
                  </tr>
                </thead>
                <tbody>
                  {report.days.map((d) => (
                    <tr key={d.date}>
                      <td>
                        {d.date} {weekdayName(d.date)}
                      </td>
                      <td>{d.A} 份</td>
                      <td>{d.B} 份</td>
                      <td>{d.redeemed}</td>
                      <td>{d.void}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3>订了没取（{report.noShows.length} 人次）</h3>
              {report.noShows.length === 0 ? (
                <p className="msg-ok">这周全都取了，没人浪费。</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>姓名</th>
                      <th>工号</th>
                      <th>套餐</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.noShows.map((n, i) => (
                      <tr key={i}>
                        <td>
                          {n.date} {weekdayName(n.date)}
                        </td>
                        <td>{n.name}</td>
                        <td>{n.empId ?? '—'}</td>
                        <td>{n.choice}餐</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
