'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function MyDesignsPage() {
  const [designs, setDesigns] = useState([]);
  useEffect(() => { api('/api/designs').then((r) => setDesigns(r.designs || r || [])).catch(() => {}); }, []);
  return (
    <div className="site-section"><div className="container">
      <h1>My Designs</h1>
      {designs.length === 0 ? <p>No designs yet.</p> : designs.map((d) => <p key={d.id}>{d.name || d.id}</p>)}
    </div></div>
  );
}
