import { useState } from 'react';
import { setAdminToken } from '../api';

/**
 * 管理页密码门：接口回了 401 就显示这个，输对密码存进浏览器后父组件重试。
 * 密码是服务启动时 ADMIN_PASSWORD 环境变量设的那个。
 */
export function AdminGate({ onSaved }: { onSaved: () => void }) {
  const [pwd, setPwd] = useState('');

  function save() {
    if (!pwd.trim()) return;
    setAdminToken(pwd.trim());
    onSaved();
  }

  return (
    <section className="card">
      <h2>需要管理密码</h2>
      <p className="hint">
        这个页面只有窗口/管理员能用。密码是窗口机器启动服务时 ADMIN_PASSWORD 设的那个，输一次这台电脑就记住了。
      </p>
      <div className="id-row">
        <label>
          管理密码
          <input
            type="password"
            value={pwd}
            autoFocus
            onChange={(e) => setPwd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
          />
        </label>
        <button className="btn" onClick={save}>
          确定
        </button>
      </div>
    </section>
  );
}
