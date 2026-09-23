const AdminBundleEditor = ({ initial, products, onSaved }) => {
  const [form, setForm] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const set = (key,value) => setForm(f => ({ ...f, [key]: value }));
  const preview = window.BundleRules.resolve(form, products);
  const updateMember = (i,key,value) => setForm(f => ({ ...f, members: f.members.map((m,j) => i===j ? {...m,[key]:value} : m) }));
  const field = { padding: 10, border: '1px solid var(--border-input)', borderRadius: 0, fontSize: 14, width: '100%', boxSizing: 'border-box', background: '#fff' };
  const save = async e => {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      const r = await apiFetch('/api/admin/bundles/' + form.id, { method: 'PUT', body: JSON.stringify(form) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save');
      setForm(d); onSaved(d); setMessage('Saved. Customers will see the updated bundle after refreshing.');
    } catch(e) { setMessage(e.message); } finally { setBusy(false); }
  };
  return <details style={{ padding: 18, border: '1px solid var(--rule-2)', background: '#fff', marginBottom: 12 }}>
    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{form.name} · {form.active ? 'Active' : 'Paused'} · GHS {preview.price.toFixed(2)}</summary>
    <form onSubmit={save} style={{ marginTop: 20 }}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14 }}>
          <label>Name<input required maxLength={100} style={field} value={form.name} onChange={e=>set('name',e.target.value)} /></label>
          <label>Saving (GH₵)<input required type="number" min={0} step="0.01" style={field} value={form.saving} onChange={e=>set('saving',Number(e.target.value))} /></label>
        </div>
        <label style={{ display: 'block', marginTop: 14 }}>Description<textarea maxLength={500} rows={2} style={field} value={form.description} onChange={e=>set('description',e.target.value)} /></label>
        <label style={{ display: 'block', marginTop: 14 }}>Custom image URL (optional)<input type="text" style={field} value={form.img} onChange={e=>set('img',e.target.value)} placeholder="Leave blank to use the included product photos" /></label>
        <label style={{ display: 'block', margin: '16px 0' }}><input type="checkbox" checked={form.active} onChange={e=>set('active',e.target.checked)} /> Available to customers</label>
        <p style={{ fontSize: 13, lineHeight: 1.6 }}>Quantities count the packs sold in Inventory. Change a product’s price in Inventory; bundle totals will update automatically. Remie currently counts as one pack of 12 sachets.</p>
        {form.members.map((m,i) => <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) 70px', gap: 8, padding: '12px 0', borderTop: '1px solid var(--rule)' }}>
          <label>Product<select style={field} value={m.productId} onChange={e=>updateMember(i,'productId',Number(e.target.value))}>{!products.some(p=>p.id===m.productId) && <option value={m.productId}>Missing product #{m.productId}</option>}{products.map(p=><option key={p.id} value={p.id}>{p.name} — GHS {Number(p.price).toFixed(2)}</option>)}</select></label>
          <label>Qty<input required type="number" min={1} max={99} style={field} value={m.quantity} onChange={e=>updateMember(i,'quantity',Number(e.target.value))} /></label>
          <label>Pack description override<input maxLength={80} style={field} placeholder="Use the product’s unit" value={m.label || ''} onChange={e=>updateMember(i,'label',e.target.value)} /></label>
          <button type="button" onClick={()=>set('members',form.members.filter((_,j)=>j!==i))} style={{ background: 'none', border: 0, color: 'var(--accent-red)' }}>Remove</button>
        </div>)}
        <button type="button" onClick={()=>{const p=products.find(p=>!form.members.some(m=>m.productId===p.id));if(p)set('members',[...form.members,{productId:p.id,quantity:1,label:''}]);}} style={{ ...bundleButtonStyle, background: '#fff', color: 'var(--ink)', margin: '14px 0' }}>Add product</button>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0' }}>
          <div style={{ width: 170, height: 150 }}><BundlePhoto bundle={preview} /></div>
          <div>Separate total: GHS {preview.regularTotal.toFixed(2)}<br/>Saving: GHS {preview.saving.toFixed(2)}<br/><strong>Bundle: GHS {preview.price.toFixed(2)}</strong>{!preview.valid && <p role="alert">Check product availability and discount.</p>}</div>
        </div>
        <button type="submit" disabled={!preview.valid || busy} style={bundleButtonStyle}>{busy ? 'Saving…' : 'Save bundle'}</button>
      </fieldset>
      {message && <p role="status" style={{ fontSize: 13 }}>{message}</p>}
    </form>
  </details>;
};
const AdminBundles = ({ products }) => {
  const [defs,setDefs] = React.useState(null), [error,setError] = React.useState('');
  React.useEffect(()=>{apiFetch('/api/admin/bundles').then(async r=>{if(!r.ok)throw new Error('Could not load bundles');return r.json();}).then(setDefs).catch(e=>setError(e.message));},[]);
  return <section><h2>Bundles</h2><p>Manage fixed contents, savings and availability. Individual product prices are managed in Inventory.</p>{error && <p role="alert">{error}</p>}{!defs && !error && <p>Loading bundles…</p>}{defs?.map(d=><AdminBundleEditor key={d.id} initial={d} products={products} onSaved={saved=>setDefs(prev=>prev.map(x=>x.id===saved.id?saved:x))} />)}</section>;
};
Object.assign(window,{AdminBundles});
