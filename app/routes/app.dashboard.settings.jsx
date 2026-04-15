import { json } from "@remix-run/node";
import { useRouteLoaderData, useSubmit } from "@remix-run/react";
import {
  Building2,
  Mail,
  Link as LinkIcon,
  HelpCircle,
  Power,
  RefreshCcw,
  ExternalLink,
  CreditCard,
  Save
} from "lucide-react";
import { useState } from "react";

export const loader = async ({ request }) => {
  return null;
};

export const action = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    throw new Response("Missing shop parameter", { status: 400 });
  }

  const formData = await request.formData();
  const razorpay = {
    keyId: formData.get("keyId"),
    keySecret: formData.get("keySecret")
  };

  const { updateAppConfig } = await import("../models/config.server");
  await updateAppConfig(shop, { razorpay }, null);

  return json({ success: true });
};

export default function Settings() {
  const data = useRouteLoaderData("routes/app.dashboard");
  const { config, shop, shopName } = data || {};
  const submit = useSubmit();

  const [keyId, setKeyId] = useState(config?.razorpay?.keyId || "");
  const [keySecret, setKeySecret] = useState(config?.razorpay?.keySecret || "");
  const [isSaving, setIsSaving] = useState(false);

  if (!data || !config) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading settings...</div>;
  }

  return (
    <div className="settings-view">
      <header className="db-header">
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700' }}>Settings</h1>
          <p style={{ color: 'var(--text-muted)' }}>Manage your application preferences and support</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div className="glass-card" style={{ padding: '8px 16px', fontSize: '14px', fontWeight: '600', color: '#166534', background: '#dcfce7' }}>
            {shopName}
          </div>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '32px' }}>
        {/* LEFT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {/* APP STATUS */}
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ background: '#f0fdf4', padding: '10px', borderRadius: '12px', color: '#166534' }}>
                  <Power size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: '16px', fontWeight: '700' }}>App Status</h2>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Enable or disable the customization engine</p>
                </div>
              </div>
              <div style={{ padding: '6px 16px', background: '#dcfce7', color: '#166534', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
                ACTIVE
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', padding: '16px', background: '#eff6ff', borderRadius: '12px', border: '1px solid #bfdbfe', color: '#1e40af' }}>
              <HelpCircle size={18} flexShrink={0} />
              <div style={{ fontSize: '13px' }}>
                The app is currently managing your checkout rules. To stop all customizations, you can disable the "CheckoutPro Smart Rules" in your Shopify Admin {'>'} Settings {'>'} Payments {'>'} Customizations.
              </div>
            </div>
          </div>

          {/* SHOP INFORMATION */}
          <div className="glass-card">
            <h2 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Building2 size={20} color="var(--primary)" />
              Shop Information
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
                <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Store Name</span>
                <span style={{ fontSize: '14px', fontWeight: '600' }}>{shopName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
                <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Technical Domain</span>
                <span style={{ fontSize: '14px', fontWeight: '600' }}>{shop}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
                <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Verification Status</span>
                <span style={{ fontSize: '14px', fontWeight: '600', color: '#22c55e' }}>Verified Partner</span>
              </div>
            </div>
          </div>
          {/* RAZORPAY SETTINGS */}
          <div className="glass-card">
            <h2 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <CreditCard size={20} color="var(--primary)" />
              Razorpay API Settings
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-muted)' }}>Key ID</label>
                <input
                  type="text"
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value)}
                  placeholder="rzp_live_..."
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '14px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-muted)' }}>Key Secret</label>
                <input
                  type="password"
                  value={keySecret}
                  onChange={(e) => setKeySecret(e.target.value)}
                  placeholder="••••••••••••••••"
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '14px' }}
                />
              </div>

              <button
                onClick={() => {
                  setIsSaving(true);
                  const fd = new FormData();
                  fd.append("keyId", keyId);
                  fd.append("keySecret", keySecret);
                  submit(fd, { method: "post", action: `?shop=${shop}` });
                  setTimeout(() => setIsSaving(false), 1000);
                }}
                disabled={isSaving}
                className="custom-button"
                style={{ marginTop: '8px' }}
              >
                {isSaving ? 'Saving...' : 'Save Razorpay Keys'}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {/* SUPPORT */}
          <div className="glass-card" style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', color: 'white' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '12px' }}>Need assistance?</h2>
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.8)', marginBottom: '24px' }}>
              Our dedicated support team is here to help you with rule configuration or any technical issues.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <a
                href="mailto:support@checkoutpro.app"
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
                  background: 'rgba(255,255,255,0.1)', borderRadius: '10px',
                  color: 'white', textDecoration: 'none', fontSize: '14px', fontWeight: '500'
                }}
              >
                <Mail size={18} />
                support@checkoutpro.app
              </a>
              <a
                href="#"
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
                  background: 'rgba(255,255,255,0.1)', borderRadius: '10px',
                  color: 'white', textDecoration: 'none', fontSize: '14px', fontWeight: '500'
                }}
              >
                <LinkIcon size={18} />
                Documentation portal
                <ExternalLink size={14} style={{ marginLeft: 'auto' }} />
              </a>
            </div>
          </div>

          {/* DANGER ZONE */}
          <div className="glass-card" style={{ border: '1px solid #fee2e2' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#991b1b', marginBottom: '16px' }}>System Actions</h2>
            <button
              style={{
                width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #fecaca',
                background: '#fef2f2', color: '#991b1b', fontSize: '14px', fontWeight: '600',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer'
              }}
              onClick={() => {
                if (confirm('Are you sure you want to reset all app data? This cannot be undone.')) {
                  // Reset logic would go here
                  alert('System sync initiated...');
                }
              }}
            >
              <RefreshCcw size={18} />
              Resync app metadata
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
