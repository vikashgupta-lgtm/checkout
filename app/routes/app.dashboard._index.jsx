import { json } from "@remix-run/node";
import { Link, useRouteLoaderData, useSubmit } from "@remix-run/react";
import { LayoutDashboard, MoreHorizontal, ShieldCheck, Ban, Percent, Plus, Trash2 } from "lucide-react";

export const loader = async ({ request }) => {
  return null;
};

export const action = async ({ request }) => {
  const url = new URL(request.url);
  let shop = url.searchParams.get("shop");

  if (!shop) {
    const { default: prisma } = await import("../db.server");
    const lastSession = await prisma.session.findFirst({ orderBy: { expires: 'desc' } });
    shop = lastSession?.shop;
  }

  if (!shop) {
    throw new Response("Missing shop parameter", { status: 400 });
  }

  const formData = await request.formData();
  const settings = JSON.parse(formData.get("settings"));

  const { updateAppConfig } = await import("../models/config.server");
  await updateAppConfig(shop, settings, null);
  return json({ success: true });
};

export default function DashboardOverview() {
  const { config, shop, shopName } = useRouteLoaderData("routes/app.dashboard");
  const submit = useSubmit();

  const stats = [
    { label: "Rules active", value: (config.rules?.length || 0).toString(), icon: ShieldCheck, color: "#6366f1" },
    { label: "COD blocked pincodes", value: (config.cod.blockedPincodes?.length || 0).toString(), icon: Ban, color: "#f43f5e" },
    { label: "Partial COD rate", value: `${config.partialCod.upfrontPercentage || 0}%`, icon: Percent, color: "#10b981" },
  ];

  const activeRules = config.rules || [];

  const saveSettings = (newSettings) => {
    const formData = new FormData();
    formData.append("settings", JSON.stringify(newSettings));
    submit(formData, { method: "post", action: `?shop=${shop}` });
  };

  const removeRule = (id) => {
    saveSettings({ rules: activeRules.filter(r => r.id !== id) });
  };

  return (
    <div className="dashboard-view">
      <header className="db-header">
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700' }}>Dashboard</h1>
          <p style={{ color: 'var(--text-muted)' }}>Welcome back to your checkout manager</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div className="glass-card" style={{ padding: '8px 16px', fontSize: '14px', fontWeight: '600', color: '#166534', background: '#dcfce7' }}>
            {shopName}
          </div>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <MoreHorizontal size={20} />
          </button>
        </div>
      </header>

      <div className="stat-grid">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div key={i} className="stat-card">
              <div style={{ color: 'var(--text-muted)', fontSize: '14px', fontWeight: '500' }}>{stat.label}</div>
              <div className="stat-value">{stat.value}</div>
            </div>
          );
        })}
      </div>

      <div className="glass-card" style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '600' }}>Active rules</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>All enabled checkout rules</p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {activeRules.map((rule) => (
            <div key={rule.id} style={{ padding: '20px', background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <span className={`rule-tag ${rule.tag}`}>{rule.tag}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '600', marginBottom: '8px' }}>{rule.title}</div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <div className="rule-pill">{rule.condition}</div>
                      <div className="rule-pill" style={{ background: '#dcfce7', color: '#166534' }}>{rule.action}</div>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => removeRule(rule.id)}
                  style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', fontSize: '12px', fontWeight: '600', color: '#ef4444', cursor: 'pointer' }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {activeRules.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
              No active rules. Create one to get started!
            </div>
          )}
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Quick actions</h3>
        <div style={{ display: 'flex', gap: '16px' }}>
          <Link to={`/app/dashboard/cod?shop=${shop}`} className="glass-card" style={{ flex: 1, textAlign: 'center', cursor: 'pointer', fontWeight: '600', color: 'var(--text-main)', textDecoration: 'none' }}>
            Configure COD
          </Link>
          <Link to={`/app/dashboard/partial-cod?shop=${shop}`} className="glass-card" style={{ flex: 1, textAlign: 'center', cursor: 'pointer', fontWeight: '600', color: 'var(--text-main)', textDecoration: 'none' }}>
            Set partial COD
          </Link>
          <Link to={`/app/dashboard/rules?shop=${shop}`} className="glass-card" style={{ flex: 1, textAlign: 'center', cursor: 'pointer', fontWeight: '600', color: 'white', background: 'var(--primary)', textDecoration: 'none' }}>
            Add checkout rule
          </Link>
        </div>
      </div>
    </div>
  );
}
