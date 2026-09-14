import { useEffect, useState } from 'react';
import { api, serverNowDate, syncClock } from '../api';
import { addDays, formatLocalDate, mondayOf, weekDates, weekdayName } from '../domain/dates';
import type { MenuDay } from '../domain/types';
import { errorText } from '../messages';

function emptyWeek(monday: string): MenuDay[] {
  return weekDates(monday).map((date) => ({
    date,
    A: { name: '', price: 15 },
    B: { name: '', price: 14 },
  }));
}

export default function MenuAdminPage() {
  const [offset, setOffset] = useState(1); // 0=本周，1=下周（周四发下周菜单）
  const [days, setDays] = useState<MenuDay[] | null>(null);
  const [orderCount, setOrderCount] = useState(0);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const monday = addDays(mondayOf(formatLocalDate(serverNowDate())), offset * 7);

  useEffect(() => {
    void (async () => {
      setMsg(null);
      setDays(null);
      try {
        const st = await api.state(monday, addDays(monday, 4));
        syncClock(st.serverNow);
        const week = st.menus.find((m) => m.id === monday);
        setDays(
          week
            ? week.days.map((d) => ({ ...d, A: { ...d.A }, B: { ...d.B } }))
            : emptyWeek(monday),
        );
        const rep = await api.report(monday, addDays(monday, 4));
        setOrderCount(rep.orders.length);
      } catch (e) {
        setMsg({ kind: 'err', text: errorText(e) });
      }
    })();
  }, [monday]);

  function setMeal(idx: number, c: 'A' | 'B', field: 'name' | 'price', value: string) {
    if (!days) return;
    setDays(
      days.map((d, i) =>
        i === idx
          ? {
              ...d,
              [c]: field === 'name' ? { ...d[c], name: value } : { ...d[c], price: Number(value) || 0 },
            }
          : d,
      ),
    );
  }

  async function save() {
    if (!days) return;
    for (const d of days) {
      for (const c of ['A', 'B'] as const) {
        if (!d[c].name.trim()) {
          setMsg({ kind: 'err', text: `${d.date}（${weekdayName(d.date)}）的 ${c} 套餐还没填名字` });
          return;
        }
        if (!(d[c].price >= 0)) {
          setMsg({ kind: 'err', text: `${d.date}（${weekdayName(d.date)}）的 ${c} 套餐价格不对` });
          return;
        }
      }
    }
    setBusy(true);
    setMsg(null);
    try {
      await api.saveMenu({ id: monday, publishedAt: new Date().toISOString(), days });
      setMsg({ kind: 'ok', text: '已发布！大家现在就能订这一周的餐了' });
    } catch (e) {
      setMsg({ kind: 'err', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="week-switch">
        <button className={offset === 0 ? 'btn active' : 'btn'} onClick={() => setOffset(0)}>
          本周（{mondayOf(formatLocalDate(serverNowDate())).slice(5)} 起）
        </button>
        <button className={offset === 1 ? 'btn active' : 'btn'} onClick={() => setOffset(1)}>
          下周（{addDays(mondayOf(formatLocalDate(serverNowDate())), 7).slice(5)} 起）
        </button>
      </div>
      {orderCount > 0 && (
        <p className="msg-warn">
          这一周已经有 {orderCount} 份订餐。改菜单不会改他们下单时的价格快照，但菜名会变，最好发之前确认好。
        </p>
      )}
      {!days ? (
        <p className="hint">加载中…</p>
      ) : (
        <>
          <table className="table menu-edit">
            <thead>
              <tr>
                <th>日期</th>
                <th>A 套餐</th>
                <th>A 价格（元）</th>
                <th>B 套餐</th>
                <th>B 价格（元）</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d.date}>
                  <td>
                    {d.date.slice(5)} {weekdayName(d.date)}
                  </td>
                  {(['A', 'B'] as const).map((c) => (
                    <MealInputs
                      key={c}
                      name={d[c].name}
                      price={d[c].price}
                      onName={(v) => setMeal(i, c, 'name', v)}
                      onPrice={(v) => setMeal(i, c, 'price', v)}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? '发布中…' : '发布这一周的菜单'}
          </button>
        </>
      )}
      {msg && <p className={msg.kind === 'ok' ? 'msg-ok' : 'msg-err'}>{msg.text}</p>}
    </div>
  );
}

function MealInputs({
  name,
  price,
  onName,
  onPrice,
}: {
  name: string;
  price: number;
  onName: (v: string) => void;
  onPrice: (v: string) => void;
}) {
  return (
    <>
      <td>
        <input value={name} placeholder="菜名" onChange={(e) => onName(e.target.value)} />
      </td>
      <td>
        <input
          className="price-input"
          inputMode="decimal"
          value={String(price)}
          onChange={(e) => onPrice(e.target.value)}
        />
      </td>
    </>
  );
}
