import { useEffect, useMemo, useState } from 'react';
import { api, serverNowDate, syncClock } from '../api';
import { addDays, formatLocalDate, isLocked, mondayOf, weekdayName } from '../domain/dates';
import { planChanges } from '../domain/orders';
import type { Choice, MenuWeek, Order } from '../domain/types';
import { myStore, type Identity } from '../db/myOrders';
import { errorText } from '../messages';

export default function OrderPage() {
  const [identity, setIdentity] = useState<Identity>({ name: '', empId: '' });
  const [menus, setMenus] = useState<MenuWeek[]>([]);
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [edits, setEdits] = useState<Record<string, Choice | ''>>({});
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const today = formatLocalDate(serverNowDate());

  // 打开页面：先读本机 IndexedDB 秒开，再跟服务器对一遍
  useEffect(() => {
    void (async () => {
      const [id, cached] = await Promise.all([myStore.loadIdentity(), myStore.loadMyOrders()]);
      if (id) setIdentity(id);
      if (cached) setMyOrders(cached);
      try {
        const from = mondayOf(formatLocalDate(serverNowDate()));
        const st = await api.state(from, addDays(from, 11));
        syncClock(st.serverNow);
        setMenus(st.menus);
        if (id?.name.trim() && id.pin) {
          const mine = await api.mine(id.name, id.empId, id.pin);
          setMyOrders(mine.orders);
          void myStore.saveMyOrders(mine.orders);
        }
      } catch (e) {
        setMsg({ kind: 'err', text: errorText(e) });
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // 本周一到下周五，有菜单的日子
  const days = useMemo(() => {
    const from = mondayOf(today);
    const to = addDays(from, 11);
    return menus
      .flatMap((m) => m.days)
      .filter((d) => d.date >= from && d.date <= to)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [menus, today]);

  const orderOf = (date: string) => myOrders.find((o) => o.date === date);
  const choiceOf = (date: string): Choice | '' => edits[date] ?? orderOf(date)?.choice ?? '';
  const mealName = (o: Order) => {
    const day = menus.flatMap((m) => m.days).find((d) => d.date === o.date);
    return day ? day[o.choice].name : `${o.choice}餐`;
  };

  async function lookup() {
    const name = identity.name.trim();
    const pin = (identity.pin ?? '').trim();
    if (!name) {
      setMsg({ kind: 'err', text: '先填一下姓名' });
      return;
    }
    if (!pin) {
      setMsg({ kind: 'err', text: '填一下 PIN（第一次用就是设置，4-6 位数字）' });
      return;
    }
    try {
      const mine = await api.mine(name, identity.empId.trim(), pin);
      setMyOrders(mine.orders);
      void myStore.saveIdentity({ name, empId: identity.empId.trim(), pin });
      void myStore.saveMyOrders(mine.orders);
      setEdits({});
      setMsg(
        mine.orders.length
          ? { kind: 'ok', text: '查到了，你的订单和取餐码在下面' }
          : { kind: 'ok', text: '最近没有你的订餐记录' },
      );
    } catch (e) {
      setMsg({ kind: 'err', text: errorText(e) });
    }
  }

  async function submit() {
    const name = identity.name.trim();
    const pin = (identity.pin ?? '').trim();
    if (!name) {
      setMsg({ kind: 'err', text: '先填一下姓名，才能提交' });
      return;
    }
    if (!pin) {
      setMsg({ kind: 'err', text: '填一下 PIN（第一次用就是设置，4-6 位数字）' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const now = serverNowDate();
      const sel: Record<string, Choice | ''> = {};
      // 页面开着跨过了 15:00：渲染时还可订的天，提交时可能已截止。
      // 这些天的改动不能悄悄丢掉——挑出来，明确告诉用户哪几天没提交。
      const dropped: string[] = [];
      for (const d of days) {
        if (isLocked(d.date, now)) {
          if (choiceOf(d.date) !== (orderOf(d.date)?.choice ?? '')) dropped.push(d.date);
        } else {
          sel[d.date] = choiceOf(d.date);
        }
      }
      const droppedText = dropped.length
        ? `${dropped.map((dt) => `${dt.slice(5)}（${weekdayName(dt)}）`).join('、')}已过截止，这几天的改动没有提交`
        : '';
      const ops = planChanges(sel, myOrders);
      if (ops.length === 0) {
        setMsg(
          droppedText ? { kind: 'warn', text: droppedText } : { kind: 'ok', text: '没有改动' },
        );
        return;
      }
      const r = await api.batch(name, identity.empId.trim(), pin, ops);
      setMyOrders(r.orders);
      void myStore.saveIdentity({ name, empId: identity.empId.trim(), pin });
      void myStore.saveMyOrders(r.orders);
      setEdits({});
      // 反馈按实际执行的 订/改/退 说，干什么说什么
      const placed = ops.filter((o) => o.type === 'place').length;
      const changed = ops.filter((o) => o.type === 'change').length;
      const cancelled = ops.filter((o) => o.type === 'cancel').length;
      const parts: string[] = [];
      if (placed) parts.push(`新订 ${placed} 天`);
      if (changed) parts.push(`改 ${changed} 天`);
      if (cancelled) parts.push(`退 ${cancelled} 天`);
      let text: string;
      if (placed && !changed && !cancelled) {
        text = '订好了！取餐码在下面，一天一个';
      } else if (changed && !placed && !cancelled) {
        text = '改好了！取餐码不变';
      } else if (cancelled && !placed && !changed) {
        text = '退好了！';
      } else {
        text = `提交好了：${parts.join('、')}${placed ? '。取餐码在下面，一天一个' : ''}`;
      }
      if (droppedText) text += `。注意：${droppedText}`;
      setMsg({ kind: droppedText ? 'warn' : 'ok', text });
    } catch (e) {
      setMsg({ kind: 'err', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  const upcoming = myOrders
    .filter((o) => o.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <div className="page">
      <section className="card">
        <h2>我是谁</h2>
        <div className="id-row">
          <label>
            姓名
            <input
              value={identity.name}
              placeholder="必填"
              onChange={(e) => setIdentity({ ...identity, name: e.target.value })}
            />
          </label>
          <label>
            工号
            <input
              value={identity.empId}
              placeholder="选填，更保险"
              onChange={(e) => setIdentity({ ...identity, empId: e.target.value })}
            />
          </label>
          <label>
            PIN
            <input
              type="password"
              inputMode="numeric"
              value={identity.pin ?? ''}
              placeholder="4-6 位数字"
              onChange={(e) => setIdentity({ ...identity, pin: e.target.value })}
            />
          </label>
          <button className="btn" onClick={() => void lookup()}>
            查我的订单
          </button>
        </div>
        <p className="hint">
          认人规则：填了工号认工号，没填认姓名，每次填一样的就行。PIN 第一次用就是设置，以后查订单、订餐都要它；忘了找窗口重置。
        </p>
      </section>

      <section>
        <h2>
          订哪几天的餐 <span className="hint">每天下午 3 点截第二天的单，过了点改不了</span>
        </h2>
        {days.length === 0 && (
          <p className="hint">{loaded ? '这两周的菜单还没发布，等等再看。' : '加载中…'}</p>
        )}
        <div className="day-grid">
          {days.map((d) => {
            const locked = isLocked(d.date, serverNowDate());
            const sel = choiceOf(d.date);
            const my = orderOf(d.date);
            return (
              <div key={d.date} className={`day-card${locked ? ' locked' : ''}`}>
                <div className="day-head">
                  <strong>
                    {d.date.slice(5)} {weekdayName(d.date)}
                  </strong>
                  {locked ? <span className="tag">已截止</span> : <span className="tag open">可订</span>}
                </div>
                {(['A', 'B'] as const).map((c) => (
                  <label key={c} className={`meal-opt${sel === c ? ' sel' : ''}`}>
                    <input
                      type="radio"
                      name={`day-${d.date}`}
                      disabled={locked}
                      checked={sel === c}
                      onChange={() => setEdits({ ...edits, [d.date]: c })}
                    />
                    <span className="meal-name">
                      {c}餐 · {d[c].name}
                    </span>
                    <span className="meal-price">{d[c].price}元</span>
                  </label>
                ))}
                <label className={`meal-opt none${sel === '' ? ' sel' : ''}`}>
                  <input
                    type="radio"
                    name={`day-${d.date}`}
                    disabled={locked}
                    checked={sel === ''}
                    onChange={() => setEdits({ ...edits, [d.date]: '' })}
                  />
                  <span className="meal-name">不订</span>
                </label>
                {my && (
                  <div className="day-code">
                    取餐码 <code>{my.code}</code>
                    {my.status === 'redeemed' ? '（已取）' : ''}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {days.length > 0 && (
          <button className="btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? '提交中…' : '提交订餐'}
          </button>
        )}
        {msg && <p className={`msg-${msg.kind}`}>{msg.text}</p>}
      </section>

      <section className="card">
        <h2>我的取餐码</h2>
        {upcoming.length === 0 ? (
          <p className="hint">还没有待取的餐。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>日期</th>
                <th>套餐</th>
                <th>价格</th>
                <th>取餐码</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((o) => (
                <tr key={o.id}>
                  <td>
                    {o.date} {weekdayName(o.date)}
                  </td>
                  <td>{mealName(o)}</td>
                  <td>{o.price}元</td>
                  <td>
                    <code className="code">{o.code}</code>
                  </td>
                  <td>{o.status === 'redeemed' ? '已取' : '待取'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
