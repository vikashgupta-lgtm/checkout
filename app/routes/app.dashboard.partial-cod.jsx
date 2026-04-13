import { json } from "@remix-run/node";
import { useRouteLoaderData, useSubmit, Form } from "@remix-run/react";
import { Split, Save, Info } from "lucide-react";
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

export default function PartialCOD() {
  const { config, shop } = useRouteLoaderData("routes/app.dashboard");
  const submit = useSubmit();

  const partialConfig = config.partialCod;

  const saveSettings = (newSettings) => {
    const formData = new FormData();
    formData.append("settings", JSON.stringify(newSettings));
    submit(formData, { method: "post", action: `?shop=${shop}` });
  };

  const toggleSetting = (key) => {
    saveSettings({ partialCod: { ...partialConfig, [key]: !partialConfig[key] } });
  };

  const handleSliderChange = (e) => {
    saveSettings({ partialCod: { ...partialConfig, upfrontPercentage: parseInt(e.target.value) } });
  };

  const handleInputChange = (e) => {
    const { name, value, type } = e.target;
    saveSettings({
      partialCod: {
        ...partialConfig,
        [name]: type === 'number' ? parseFloat(value) : value
      }
    });
  };

  return (
    <div className="partial-view">
      <header className="db-header">
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700' }}>Partial COD</h1>
          <p style={{ color: 'var(--text-muted)' }}>Configure upfront payment for Cash on Delivery</p>
        </div>
      </header>

      <div className="glass-card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '600' }}>Partial COD</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Customer pays a portion upfront, rest on delivery</p>
          </div>
          <label className="switch">
            <input type="checkbox" checked={partialConfig.enabled} onChange={() => toggleSetting('enabled')} style={{ display: 'none' }} />
            <div style={{ width: '44px', height: '24px', background: partialConfig.enabled ? 'var(--primary)' : '#cbd5e1', borderRadius: '12px', position: 'relative', cursor: 'pointer' }}>
              <div style={{ width: '18px', height: '18px', background: 'white', borderRadius: '50%', position: 'absolute', top: '3px', left: partialConfig.enabled ? '23px' : '3px', transition: 'left 0.2s' }} />
            </div>
          </label>
        </div>

        <div className="slider-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '4px' }}>Upfront payment</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--primary)' }}>{partialConfig.upfrontPercentage}%</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '4px' }}>On delivery</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-main)' }}>{100 - partialConfig.upfrontPercentage}%</div>
            </div>
          </div>
          <input
            type="range"
            min="10"
            max="90"
            step="5"
            value={partialConfig.upfrontPercentage}
            onChange={handleSliderChange}
            className="custom-range"
            style={{
              background: `linear-gradient(to right, var(--primary) ${partialConfig.upfrontPercentage}%, #e2e8f0 ${partialConfig.upfrontPercentage}%)`
            }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', margin: '32px 0' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-muted)' }}>Label — upfront</label>
            <input
              type="text"
              name="upfrontLabel"
              defaultValue={partialConfig.upfrontLabel}
              onBlur={handleInputChange}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', fontSize: '14px' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-muted)' }}>Label — on delivery</label>
            <input
              type="text"
              name="deliveryLabel"
              defaultValue={partialConfig.deliveryLabel}
              onBlur={handleInputChange}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', fontSize: '14px' }}
            />
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-muted)' }}>Note shown to customer</label>
          <textarea
            rows="3"
            name="customerNote"
            defaultValue={partialConfig.customerNote}
            onBlur={handleInputChange}
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', fontSize: '14px', resize: 'none' }}
          />
        </div>
      </div>

      <div className="glass-card">
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '24px' }}>Partial COD conditions</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontWeight: '600' }}>Only for orders above ₹</span>
              <input
                type="number"
                name="minOrder"
                defaultValue={partialConfig.minOrder}
                onBlur={handleInputChange}
                style={{ width: '80px', padding: '6px 12px', borderRadius: '6px', border: '1px solid #e2e8f0', background: 'white', fontSize: '14px' }}
              />
            </div>
            <label className="switch">
              <input type="checkbox" checked={partialConfig.enabled} style={{ display: 'none' }} />
              <div style={{ width: '44px', height: '24px', background: 'var(--primary)', borderRadius: '12px', position: 'relative', cursor: 'pointer' }}>
                <div style={{ width: '18px', height: '18px', background: 'white', borderRadius: '50%', position: 'absolute', top: '3px', right: '3px' }} />
              </div>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: '600' }}>Exclude sale / discounted items</div>
            <label className="switch">
              <input type="checkbox" checked={partialConfig.excludeSale} onChange={() => toggleSetting('excludeSale')} style={{ display: 'none' }} />
              <div style={{ width: '44px', height: '24px', background: partialConfig.excludeSale ? 'var(--primary)' : '#cbd5e1', borderRadius: '12px', position: 'relative', cursor: 'pointer' }}>
                <div style={{ width: '18px', height: '18px', background: 'white', borderRadius: '50%', position: 'absolute', top: '3px', left: partialConfig.excludeSale ? '23px' : '3px' }} />
              </div>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: '600' }}>Allow partial COD with coupon codes</div>
            <label className="switch">
              <input type="checkbox" checked={partialConfig.allowWithCoupon} onChange={() => toggleSetting('allowWithCoupon')} style={{ display: 'none' }} />
              <div style={{ width: '44px', height: '24px', background: partialConfig.allowWithCoupon ? 'var(--primary)' : '#cbd5e1', borderRadius: '12px', position: 'relative', cursor: 'pointer' }}>
                <div style={{ width: '18px', height: '18px', background: 'white', borderRadius: '50%', position: 'absolute', top: '3px', left: partialConfig.allowWithCoupon ? '23px' : '3px' }} />
              </div>
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '32px' }}>
          <button
            type="button"
            onClick={() => saveSettings({ partialCod: partialConfig })}
            className="custom-button"
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Save size={18} />
            Save partial COD settings
          </button>
        </div>
      </div>
    </div>
  );
}
