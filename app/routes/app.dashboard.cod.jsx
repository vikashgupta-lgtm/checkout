import { json } from "@remix-run/node";
import { useRouteLoaderData, useSubmit, Form } from "@remix-run/react";
import { Settings2, ShieldAlert, BadgeInfo, X } from "lucide-react";
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
  const settings = JSON.parse(formData.get("settings"));

  const { updateAppConfig } = await import("../models/config.server");
  await updateAppConfig(shop, settings, null);

  return json({ success: true });
};

export default function CODControls() {
  const { config, shop } = useRouteLoaderData("routes/app.dashboard");
  const submit = useSubmit();
  const [pincodeInput, setPincodeInput] = useState("");

  const codConfig = config.cod;

  const saveSettings = (newSettings) => {
    const formData = new FormData();
    formData.append("settings", JSON.stringify(newSettings));
    submit(formData, { method: "post", action: `?shop=${shop}` });
  };

  const toggleSetting = (key) => {
    saveSettings({ cod: { ...codConfig, [key]: !codConfig[key] } });
  };

  const handleLimitChange = (e) => {
    const { name, value } = e.target;
    saveSettings({ cod: { ...codConfig, [name]: parseFloat(value) } });
  };

  const handlePincodeSubmit = (e) => {
    if (e.key === 'Enter' && pincodeInput.trim()) {
      const code = pincodeInput.trim();
      if (!codConfig.blockedPincodes.includes(code)) {
        saveSettings({ cod: { ...codConfig, blockedPincodes: [...codConfig.blockedPincodes, code] } });
      }
      setPincodeInput("");
    }
  };

  const removePincode = (code) => {
    saveSettings({ cod: { ...codConfig, blockedPincodes: codConfig.blockedPincodes.filter(p => p !== code) } });
  };

  return (
    <div className="cod-view">
      <header className="db-header">
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700' }}>COD controls</h1>
          <p style={{ color: 'var(--text-muted)' }}>Advanced configuration for Cash on Delivery</p>
        </div>
      </header>

      <div className="glass-card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600' }}>COD availability</h2>
          <label className="switch">
            <input type="checkbox" checked={codConfig.enabled} onChange={() => toggleSetting('enabled')} style={{ display: 'none' }} />
            <div style={{ width: '44px', height: '24px', background: codConfig.enabled ? 'var(--primary)' : '#cbd5e1', borderRadius: '12px', position: 'relative', cursor: 'pointer' }}>
              <div style={{ width: '18px', height: '18px', background: 'white', borderRadius: '50%', position: 'absolute', top: '3px', right: codConfig.enabled ? '3px' : '23px', transition: 'right 0.2s' }} />
            </div>
          </label>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: '600' }}>Enable COD globally</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Master switch — overrides all other settings</div>
            </div>
            <label className="switch">
              <input type="checkbox" checked={codConfig.globalEnable} onChange={() => toggleSetting('globalEnable')} style={{ display: 'none' }} />
              <div style={{ width: '44px', height: '24px', background: codConfig.globalEnable ? 'var(--primary)' : '#cbd5e1', borderRadius: '12px', position: 'relative', cursor: 'pointer' }}>
                <div style={{ width: '18px', height: '18px', background: 'white', borderRadius: '50%', position: 'absolute', top: '3px', right: codConfig.globalEnable ? '3px' : '23px' }} />
              </div>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: '600' }}>Block COD on prepaid orders</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Hide COD if cart has prepaid-only items</div>
            </div>
            <label className="switch">
              <input type="checkbox" checked={codConfig.blockPrepaid} onChange={() => toggleSetting('blockPrepaid')} style={{ display: 'none' }} />
              <div style={{ width: '44px', height: '24px', background: codConfig.blockPrepaid ? 'var(--primary)' : '#cbd5e1', borderRadius: '12px', position: 'relative', cursor: 'pointer' }}>
                <div style={{ width: '18px', height: '18px', background: 'white', borderRadius: '50%', position: 'absolute', top: '3px', left: codConfig.blockPrepaid ? '23px' : '3px' }} />
              </div>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: '600' }}>Require phone verification for COD</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>OTP before COD is confirmed</div>
            </div>
            <label className="switch">
              <input type="checkbox" checked={codConfig.requireOTP} onChange={() => toggleSetting('requireOTP')} style={{ display: 'none' }} />
              <div style={{ width: '44px', height: '24px', background: codConfig.requireOTP ? 'var(--primary)' : '#cbd5e1', borderRadius: '12px', position: 'relative', cursor: 'pointer' }}>
                <div style={{ width: '18px', height: '18px', background: 'white', borderRadius: '50%', position: 'absolute', top: '3px', left: codConfig.requireOTP ? '23px' : '3px' }} />
              </div>
            </label>
          </div>
        </div>
      </div>

      <div className="glass-card" style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '24px' }}>Order value limits</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-muted)' }}>Min order value (₹)</label>
            <input
              type="number"
              name="minOrder"
              defaultValue={codConfig.minOrder}
              onBlur={handleLimitChange}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', fontSize: '14px' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-muted)' }}>Max order value (₹)</label>
            <input
              type="number"
              name="maxOrder"
              defaultValue={codConfig.maxOrder}
              onBlur={handleLimitChange}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', fontSize: '14px' }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', background: '#eff6ff', padding: '12px', borderRadius: '8px', border: '1px solid #bfdbfe', color: '#1e40af', fontSize: '13px' }}>
          <BadgeInfo size={18} flexShrink={0} />
          COD will only appear when cart total is between these values. Leave max empty to disable upper limit.
        </div>
      </div>

      <div className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600' }}>Pincode restrictions</h2>
          <button style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', background: 'white' }}>Mode: Block list</button>
        </div>

        <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-muted)' }}>Add pincodes (press Enter or comma)</label>
        <div style={{
          minHeight: '44px',
          padding: '8px',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          background: 'white',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px'
        }}>
          {codConfig.blockedPincodes.map(code => (
            <span key={code} style={{
              background: '#f1f5f9',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              {code}
              <X size={12} style={{ cursor: 'pointer' }} onClick={() => removePincode(code)} />
            </span>
          ))}
          <input
            type="text"
            placeholder="e.g. 560001"
            value={pincodeInput}
            onChange={(e) => setPincodeInput(e.target.value)}
            onKeyDown={handlePincodeSubmit}
            style={{ border: 'none', outline: 'none', flex: 1, minWidth: '100px', fontSize: '14px' }}
          />
        </div>
      </div>
    </div>
  );
}
