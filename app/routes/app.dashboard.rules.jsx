import { useState } from "react";
import { json } from "@remix-run/node";
import { useRouteLoaderData, useSubmit } from "@remix-run/react";
import { Plus, Trash2, X } from "lucide-react";

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

export default function CheckoutRules() {
  const data = useRouteLoaderData("routes/app.dashboard");
  const submit = useSubmit();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [ruleType, setRuleType] = useState("block");
  const [condField, setCondField] = useState("Cart value");
  const [condOp, setCondOp] = useState("is greater than");
  const [condVal, setCondVal] = useState("");
  const [ruleAction, setRuleAction] = useState("Hide COD");

  if (!data || !data.config) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading rules configuration...</div>;
  }

  const { config, shop } = data;
  const rules = config.rules || [];

  const saveSettings = (newSettings) => {
    const formData = new FormData();
    formData.append("settings", JSON.stringify(newSettings));
    submit(formData, { method: "post", action: `?shop=${shop}` });
  };

  const handleAddRule = () => {
    if (!ruleName.trim()) return;

    const newRule = {
      id: Date.now(),
      title: ruleName,
      condition: `${condField} ${condOp} ${condVal}`,
      action: ruleAction.toLowerCase().replace(/ /g, "_"),
      tag: ruleType
    };

    saveSettings({ rules: [...rules, newRule] });
    setIsModalOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setRuleName("");
    setRuleType("block");
    setCondField("Cart value");
    setCondOp("is greater than");
    setCondVal("");
    setRuleAction("Hide COD");
  };

  const removeRule = (id) => {
    saveSettings({ rules: rules.filter(r => r.id !== id) });
  };

  return (
    <div className="rules-view">
      <header className="db-header">
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700' }}>Checkout rules</h1>
          <p style={{ color: 'var(--text-muted)' }}>Conditions that control payment visibility</p>
        </div>
        <button
          className="custom-button"
          onClick={() => {
            setIsModalOpen(true);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', zIndex: 100 }}
        >
          <Plus size={18} />
          Add rule
        </button>
      </header>
      <div className="glass-card" style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {rules.map((rule) => (
            <div key={rule.id} style={{ padding: '20px', background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <span className={`rule-tag ${rule.tag}`}>{rule.tag}</span>
                  <div>
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

          {rules.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
              No rules yet — add one to get started
            </div>
          )}

          <button
            onClick={() => setIsModalOpen(true)}
            style={{
              padding: '24px',
              background: 'white',
              borderRadius: '12px',
              border: '2px dashed #e2e8f0',
              color: 'var(--text-muted)',
              fontWeight: '600',
              textAlign: 'center',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            <Plus size={18} />
            Add new rule
          </button>
        </div>
      </div>

      {/* MODAL OVERLAY */}
      {isModalOpen && (
        <div className="modal-overlay" style={{
          display: 'flex',
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 9999,
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(8px)'
        }}>
          <div className="glass-card" style={{ width: '480px', background: 'white', padding: '32px', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: '700' }}>Add checkout rule</h2>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-muted)' }}>Rule name</label>
                <input
                  type="text"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="e.g. Block COD in metro cities"
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '14px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-muted)' }}>Type</label>
                <select
                  value={ruleType}
                  onChange={(e) => setRuleType(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '14px', background: 'white' }}
                >
                  <option value="block">Block payment method</option>
                  <option value="cod">COD condition</option>
                  <option value="partial">Partial COD</option>
                  <option value="custom">Custom rule</option>
                </select>
              </div>

              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '12px' }}>When</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '8px' }}>
                  <select
                    value={condField}
                    onChange={(e) => setCondField(e.target.value)}
                    style={{ padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', background: 'white' }}
                  >
                    <option>Cart value</option>
                    <option>Country</option>
                    <option>Pincode</option>
                    <option>Customer tag</option>
                  </select>
                  <select
                    value={condOp}
                    onChange={(e) => setCondOp(e.target.value)}
                    style={{ padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', background: 'white' }}
                  >
                    <option>is greater than</option>
                    <option>is less than</option>
                    <option>contains</option>
                  </select>
                  <input
                    type="text"
                    value={condVal}
                    onChange={(e) => setCondVal(e.target.value)}
                    placeholder="value"
                    style={{ padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-muted)' }}>Then (action)</label>
                <select
                  value={ruleAction}
                  onChange={(e) => setRuleAction(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '14px', background: 'white' }}
                >
                  <option>Hide COD</option>
                  <option>Block checkout</option>
                  <option>Show partial COD</option>
                  <option>Hide UPI</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
              <button
                onClick={() => setIsModalOpen(false)}
                className="glass-card"
                style={{ flex: 1, padding: '12px', fontWeight: '600', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddRule}
                className="custom-button"
                style={{ flex: 1, padding: '12px', fontWeight: '600' }}
              >
                Add rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
