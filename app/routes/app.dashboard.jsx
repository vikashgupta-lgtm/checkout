import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useLocation, useRouteError } from "@remix-run/react";
import {
  LayoutDashboard,
  CreditCard,
  Settings2,
  Split,
  ShieldCheck,
  Settings,
  ChevronRight
} from "lucide-react";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  let shop = url.searchParams.get("shop");

  const { default: prisma } = await import("../db.server");
  const { getAppConfig } = await import("../models/config.server");

  if (!shop) {
    const lastSession = await prisma.session.findFirst({
      orderBy: { expires: 'desc' }
    });
    shop = lastSession?.shop;
  }

  if (!shop) {
    throw new Response("Missing shop parameter and no session in DB", { status: 400 });
  }

  const config = await getAppConfig(shop);
  return json({ config, shop });
};

export default function DashboardLayout() {
  const { config, shop } = useLoaderData();
  const location = useLocation();
  const currentPath = location.pathname;

  const navItems = [
    { name: "Dashboard", href: "/app/dashboard", icon: LayoutDashboard },
    { name: "Payment methods", href: "/app/dashboard/payments", icon: CreditCard },
    { name: "COD controls", href: "/app/dashboard/cod", icon: Settings2 },
    { name: "Partial COD", href: "/app/dashboard/partial-cod", icon: Split },
    { name: "Checkout rules", href: "/app/dashboard/rules", icon: ShieldCheck },
    { name: "Settings", href: "/app/dashboard/settings", icon: Settings },
  ];

  return (
    <div className="db-wrapper">
      <aside className="db-sidebar">
        <div className="db-brand">
          <div className="db-brand-title">
            <div style={{ background: 'var(--primary)', padding: '6px', borderRadius: '8px', color: 'white' }}>
              <ShieldCheck size={20} />
            </div>
            CheckoutKit
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{shop}</div>
        </div>

        <nav className="db-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPath === item.href;
            const urlWithShop = `${item.href}?shop=${shop}`;
            return (
              <Link
                key={item.href}
                to={urlWithShop}
                className={`db-nav-item ${isActive ? 'active' : ''}`}
              >
                <Icon size={18} />
                {item.name}
                {isActive && <ChevronRight size={14} style={{ marginLeft: 'auto' }} />}
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: 'auto', padding: '16px', background: '#f8fafc', borderRadius: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Free Plan</div>
          <div style={{ height: '4px', background: '#e2e8f0', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: '40%', height: '100%', background: 'var(--primary)' }} />
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '8px' }}>4/10 active rules used</div>
        </div>
      </aside>

      <main className="db-content">
        <Outlet />
      </main>
    </div>
  );
}
