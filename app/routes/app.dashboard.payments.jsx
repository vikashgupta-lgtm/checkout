import { json } from "@remix-run/node";
import { useRouteLoaderData } from "@remix-run/react";
import { useState } from "react";
import { Save } from "lucide-react";

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

export default function PaymentMethods() {
  const data = useRouteLoaderData("routes/app.dashboard");
  const { config, shop, shopName } = data || {};

  const [methods, setMethods] = useState(config.payments?.methods || []);
  const [codLabel, setCodLabel] = useState(
    config.payments?.methods?.find(m => m.id === 'cod')?.label || "Cash on Delivery"
  );
  const [upiLabel, setUpiLabel] = useState(
    config.payments?.methods?.find(m => m.id === 'upi')?.label || "Pay via UPI"
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const postToServer = async (newSettings) => {
    setSaving(true);
    const fd = new FormData();
    fd.append("settings", JSON.stringify(newSettings));
    await fetch(`/app/dashboard/payments?shop=${shop}`, {
      method: "POST",
      body: fd,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleMethod = (id) => {
    const updated = methods.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m);
    setMethods(updated);
    postToServer({ payments: { methods: updated } });
  };

  const saveLabels = () => {
    const updated = methods.map(m => {
      if (m.id === 'cod') return { ...m, label: codLabel };
      if (m.id === 'upi') return { ...m, label: upiLabel };
      return m;
    });
    setMethods(updated);
    postToServer({ payments: { methods: updated } });
  };

  return (
    <div className="payment-view">
      <header className="db-header">
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700' }}>Payment methods</h1>
          <p style={{ color: 'var(--text-muted)' }}>Manage your available payment options</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {saved && (
            <div style={{ padding: '8px 16px', background: '#dcfce7', color: '#166534', borderRadius: '8px', fontSize: '14px', fontWeight: '600' }}>
              ✓ Saved!
            </div>
          )}
          <div className="glass-card" style={{ padding: '8px 16px', fontSize: '14px', fontWeight: '600', color: '#166534', background: '#dcfce7' }}>
            {shopName}
          </div>
        </div>
      </header>

      <div className="glass-card" style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>Block / hide payment methods</h2>
        <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '24px' }}>Control which methods appear at checkout</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {methods.map((method) => (
            <div key={method.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: '600' }}>{method.name}</div>
              <div
                onClick={() => toggleMethod(method.id)}
                style={{
                  width: '44px', height: '24px',
                  background: method.enabled ? 'var(--primary)' : '#cbd5e1',
                  borderRadius: '12px', position: 'relative',
                  cursor: 'pointer', transition: 'background 0.2s'
                }}
              >
                <div style={{
                  width: '18px', height: '18px', background: 'white',
                  borderRadius: '50%', position: 'absolute', top: '3px',
                  left: method.enabled ? '23px' : '3px', transition: 'left 0.2s'
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-card">
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>Rename payment labels</h2>
        <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '24px' }}>Custom display names shown to customers</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-muted)' }}>COD label</label>
            <input
              type="text"
              value={codLabel}
              onChange={(e) => setCodLabel(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', fontSize: '14px' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-muted)' }}>UPI label</label>
            <input
              type="text"
              value={upiLabel}
              onChange={(e) => setUpiLabel(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', fontSize: '14px' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={saveLabels}
            disabled={saving}
            className="custom-button"
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Save size={18} />
            {saving ? 'Saving...' : 'Save labels'}
          </button>
        </div>
      </div>
    </div>
  );
}
