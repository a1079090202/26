import { useEffect, useState } from 'react';
import { api, isUnauthorized, serverNowDate, syncClock } from '../api';
import { addDays, formatLocalDate, mondayOf, weekDates, weekdayName } from '../domain/dates';
import type { MenuDay } from '../domain/types';
import { errorText } from '../messages';
import { AdminGate } from './AdminGate';

function emptyWeek(monday: string): MenuDay[] {
  return weekDates(monday).map((date) => ({
    date,
    A: { name: '', price: 15 },
    B: { name: '', price: 14 },
  }));
}

/**
 * 价格输入原文 → 数值。允许 "15"、"15."、".5"、"15.5"（输入过程中要保留小数点），
 * 不允许负号、字母、多个小数点；空串和 "." 视为没填，返回 null。
 */
const PRICE_INPUT_RE = /^\d*\.?\d*$/;

export function parsePriceInput(text: string): number | null {
  const t = text.trim();
  if (!PRICE_INPUT_RE.test(t) || !/\d/.test(t)) return null;
  return Number(t);
}

export default function MenuAdminPage() {
  const [offset, setOffset] = useState(1); // 0=本周，1=下周（周四发下周菜单）
  const [days, setDays] = useState<MenuDay[] | null>(null);
  // 价格框里显示的原文（"15." 这种半截输入不能用 Number 反填，否则小数点会被吃掉）
  const [priceText, setPriceText] = useState<Record<string, string>>({});
  const [orderCount, setOrderCount] = useState(0);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [needAuth, setNeedAuth] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const monday = addDays(mondayOf(formatLocalDate(serverNowDate())), offset * 7);

  useEffect(() => {
    // 切周时旧请求可能晚回来：打个标记，作废上一周的一切 setState，
    // 否则 A 周的响应盖到 B 周的表单上，发布时就会把 A 周的菜写进 B 周
    let stale = false;
    setMsg(null);
    setDays(null);
    setPriceText({});
    setOrderCount(0);
    void (async () => {
      try {
        const st = await api.state(monday, addDays(monday, 4));
        if (stale) return;
        syncClock(st.serverNow);
        const week = st.menus.find((m) => m.id === monday);
        const nextDays = week
          ? week.days.map((d) => ({ ...d, A: { ...d.A }, B: { ...d.B } }))
          : emptyWeek(monday);
        setDays(nextDays);
        setPriceText(
          Object.fromEntries(
            nextDays.flatMap((d, i) =>
              (['A', 'B'] as const).map((c) => [`${i}:${c}`, String(d[c].price)] as const),
            ),
          ),
        );
        const rep = await api.report(monday, addDays(monday, 4));
        if (stale) return;
        setOrderCount(rep.orders.length);
      } catch (e) {
        if (stale) return;
        if (isUnauthorized(e)) {
          setNeedAuth(true);
          return;
        }
        setMsg({ kind: 'err', text: errorText(e) });
      }
    })();
    return () => {
      stale = true;
    };
  }, [monday, reloadKey]);

  function setMeal(idx: number, c: 'A' | 'B', field: 'name' | 'price', value: string) {
    if (!days) return;
    if (field === 'price') {
      // 非法字符（字母、负号、多个小数点）直接不进框；"15." 这类半截小数原样保留
      if (!PRICE_INPUT_RE.test(value.trim())) return;
      const price = parsePriceInput(value);
      setDays(
        days.map((d, i) =>
          i === idx ? { ...d, [c]: { ...d[c], price: price ?? 0 } } : d,
        ),
      );
      setPriceText((t) => ({ ...t, [`${idx}:${c}`]: value }));
      return;
    }
    setDays(
      days.map((d, i) => (i === idx ? { ...d, [c]: { ...d[c], name: value } } : d)),
    );
  }

  async function save() {
    if (!days) return;
    for (let i = 0; i < days.length; i += 1) {
      const d = days[i];
      for (const c of ['A', 'B'] as const) {
        if (!d[c].name.trim()) {
          setMsg({ kind: 'err', text: `${d.date}（${weekdayName(d.date)}）的 ${c} 套餐还没填名字` });
          return;
        }
        const price = parsePriceInput(priceText[`${i}:${c}`] ?? '');
        if (price === null || price < 0) {
          setMsg({ kind: 'err', text: `${d.date}（${weekdayName(d.date)}）的 ${c} 套餐价格不对` });
          return;
        }
      }
    }
    // 发布时按分取整，避免手敲一长串小数；价格快照只认这个规整后的值
    const daysToSave: MenuDay[] = days.map((d, i) => ({
      ...d,
      A: { ...d.A, price: Math.round(d.A.price * 100) / 100 },
      B: { ...d.B, price: Math.round(d.B.price * 100) / 100 },
    }));
    setBusy(true);
    setMsg(null);
    try {
      await api.saveMenu({ id: monday, publishedAt: new Date().toISOString(), days: daysToSave });
      setMsg({ kind: 'ok', text: '已发布！大家现在就能订这一周的餐了' });
    } catch (e) {
      if (isUnauthorized(e)) {
        setNeedAuth(true);
        return;
      }
      setMsg({ kind: 'err', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  if (needAuth) {
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
                      priceText={priceText[`${i}:${c}`] ?? ''}
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
  priceText,
  onName,
  onPrice,
}: {
  name: string;
  priceText: string;
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
          value={priceText}
          onChange={(e) => onPrice(e.target.value)}
        />
      </td>
    </>
  );
}
