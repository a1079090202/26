import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, isUnauthorized, serverNowDate, syncClock } from '../api';
import { formatLocalDate, weekdayName } from '../domain/dates';
import type { MenuWeek, Order } from '../domain/types';
import { errorText } from '../messages';
import { AdminGate } from './AdminGate';

interface Result {
  kind: 'ok' | 'dup' | 'warn' | 'err';
  title: string;
  lines: string[];
}

/** 成功一声短响，失败一声长响，窗口不用老盯着屏幕 */
function beep(ok: boolean) {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.12 : 0.35));
    osc.onended = () => void ctx.close();
  } catch {
    /* 老机器没声音就算了 */
  }
}

export default function RedeemPage() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [progress, setProgress] = useState<{ redeemed: number; total: number } | null>(null);
  const [menus, setMenus] = useState<MenuWeek[]>([]);
  const [needAuth, setNeedAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetId, setResetId] = useState({ name: '', empId: '' });
  const [resetMsg, setResetMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  const today = formatLocalDate(serverNowDate());

  const mealName = (o: Order) => {
    const day = menus.flatMap((m) => m.days).find((d) => d.date === o.date);
    return day ? day[o.choice].name : `${o.choice}餐`;
  };

  const loadProgress = useCallback(async () => {
    try {
      const t = formatLocalDate(serverNowDate());
      const st = await api.state(t, t);
      syncClock(st.serverNow);
      setMenus(st.menus);
      const s = st.summaries.find((x) => x.date === t);
      setProgress({ redeemed: s?.redeemed ?? 0, total: s?.total ?? 0 });
    } catch {
      /* 下次输码时再试 */
    }
  }, []);

  useEffect(() => {
    void loadProgress();
    inputRef.current?.focus();
  }, [loadProgress]);

  async function submit(c: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    // 核销进行中，屏幕上绝不能残留上一单的"放行"信号
    setResult(null);
    try {
      const r = await api.redeem(c);
      const o = r.order;
      setResult({
        kind: 'ok',
        title: `${o.name} · ${o.choice}餐 · ${o.price}元`,
        lines: [mealName(o), '核销成功，请取餐'],
      });
      beep(true);
    } catch (e) {
      if (isUnauthorized(e)) {
        setNeedAuth(true);
        beep(false);
        return;
      }
      if (e instanceof ApiError) {
        const order = (e.data as { order?: Order } | undefined)?.order;
        if (e.code === 'already_redeemed') {
          setResult({
            kind: 'dup',
            title: '这份已经取过了！',
            lines: [
              order ? `${order.name} · ${order.choice}餐 · ${mealName(order)}` : '',
              order?.redeemedAt
                ? `取餐时间：${new Date(order.redeemedAt).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : '',
            ].filter(Boolean),
          });
        } else if (e.code === 'void') {
          setResult({
            kind: 'warn',
            title: '这个码已作废',
            lines: [order ? `${order.name} ${order.date} 的餐，过期没取` : ''],
          });
        } else if (e.code === 'not_today') {
          setResult({
            kind: 'warn',
            title: '不是今天的餐',
            lines: [order ? `${order.name} 这是 ${order.date}（${weekdayName(order.date)}）的码` : ''],
          });
        } else if (e.code === 'not_found') {
          setResult({ kind: 'warn', title: '无效取餐码', lines: ['今天没发过这个码'] });
        } else {
          setResult({ kind: 'warn', title: '出错了', lines: [errorText(e)] });
        }
      } else {
        // 网络断了/超时/服务没开：必须亮红灯，绝不能无声吞掉
        setResult({
          kind: 'err',
          title: '没核销上！',
          lines: ['连不上服务（网络断了或服务没开）', '这份还没核销——确认服务恢复后重输这个码'],
        });
      }
      beep(false);
    } finally {
      busyRef.current = false;
      setBusy(false);
      setCode('');
      inputRef.current?.focus();
      void loadProgress();
    }
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(v);
    if (result) setResult(null);
    if (v.length === 6) void submit(v);
  }

  async function resetPin() {
    const name = resetId.name.trim();
    if (!name) {
      setResetMsg({ kind: 'err', text: '填一下员工姓名' });
      return;
    }
    try {
      await api.resetPin(name, resetId.empId.trim());
      setResetMsg({ kind: 'ok', text: `${name} 的 PIN 已重置，让 TA 下次订餐或查询时重新设一个` });
    } catch (e) {
      if (isUnauthorized(e)) {
        setNeedAuth(true);
        return;
      }
      setResetMsg({ kind: 'err', text: errorText(e) });
    }
  }

  if (needAuth) {
    return (
      <div className="page">
        <AdminGate onSaved={() => setNeedAuth(false)} />
      </div>
    );
  }

  return (
    <div className="page redeem-page">
      <div className="redeem-head">
        <h2>
          窗口核销 · {today} {weekdayName(today)}
        </h2>
        {progress && (
          <span className="progress">
            今天已取 <b>{progress.redeemed}</b> / 共 <b>{progress.total}</b> 份
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        className="code-input"
        inputMode="numeric"
        autoComplete="off"
        placeholder="输 6 位取餐码"
        value={code}
        disabled={busy}
        onChange={onChange}
      />
      {busy ? (
        <p className="hint">核销中…</p>
      ) : result ? (
        <div className={`redeem-result ${result.kind}`}>
          <div className="redeem-title">{result.title}</div>
          {result.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      ) : (
        <p className="hint">输满 6 位自动核销。绿色放行；红色是取过的，别给餐。</p>
      )}
      <div className="reset-pin">
        <button className="btn-link" onClick={() => setShowReset(!showReset)}>
          员工忘 PIN？{showReset ? '收起' : ''}
        </button>
        {showReset && (
          <div className="id-row">
            <label>
              姓名
              <input
                value={resetId.name}
                onChange={(e) => setResetId({ ...resetId, name: e.target.value })}
              />
            </label>
            <label>
              工号
              <input
                value={resetId.empId}
                placeholder="他当时填了就填"
                onChange={(e) => setResetId({ ...resetId, empId: e.target.value })}
              />
            </label>
            <button className="btn" onClick={() => void resetPin()}>
              重置 PIN
            </button>
          </div>
        )}
        {resetMsg && <p className={resetMsg.kind === 'ok' ? 'msg-ok' : 'msg-err'}>{resetMsg.text}</p>}
      </div>
    </div>
  );
}
