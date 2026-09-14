import { useEffect, useState } from 'react';
import OrderPage from './pages/OrderPage';
import RedeemPage from './pages/RedeemPage';
import MenuAdminPage from './pages/MenuAdminPage';
import SummaryPage from './pages/SummaryPage';
import ReportPage from './pages/ReportPage';

const ROUTES = [
  { hash: '#/', label: '订餐', comp: OrderPage },
  { hash: '#/window', label: '窗口核销', comp: RedeemPage },
  { hash: '#/menu', label: '菜单管理', comp: MenuAdminPage },
  { hash: '#/summary', label: '份数汇总', comp: SummaryPage },
  { hash: '#/report', label: '周报', comp: ReportPage },
];

export default function App() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const route = ROUTES.find((r) => r.hash === hash) ?? ROUTES[0];
  const Comp = route.comp;
  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">食堂订餐</span>
        <nav>
          {ROUTES.map((r) => (
            <a key={r.hash} href={r.hash} className={r.hash === route.hash ? 'active' : ''}>
              {r.label}
            </a>
          ))}
        </nav>
      </header>
      <main>
        <Comp />
      </main>
    </div>
  );
}
