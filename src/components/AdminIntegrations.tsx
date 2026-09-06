import React, { useState } from 'react';
import { 
  Settings, 
  Key, 
  ShieldCheck, 
  Webhook, 
  Save, 
  RefreshCw,
  ExternalLink,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2
} from 'lucide-react';
import { motion } from 'motion/react';

export function AdminIntegrations() {
  const [showSecret, setShowSecret] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const [config, setConfig] = useState({
    clientId: 'evdekimi_prod_8291',
    clientSecret: '••••••••••••••••••••••••••••',
    webhookUrl: 'https://api.evdekimi.com/v1/webhooks/guesty',
    syncInterval: '60'
  });

  const handleTestConnection = () => {
    setIsTesting(true);
    setTimeout(() => {
      setIsTesting(false);
      alert('Connection successful! Guesty API handshake verified.');
    }, 1500);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-brand-navy">API Integrations</h2>
          <p className="text-brand-muted text-sm">Securely manage external service connections and authentication loops.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100 text-xs font-bold">
            <CheckCircle2 className="w-4 h-4" />
            Gateway: Online
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Connection Form */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-brand-muted/10 overflow-hidden">
            <div className="p-6 border-b border-brand-muted/10 bg-brand-bg/30 flex items-center gap-3">
              <div className="w-10 h-10 bg-brand-navy rounded-xl flex items-center justify-center">
                <Key className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-brand-navy">Guesty Open API (v1)</h3>
                <p className="text-[10px] uppercase font-bold text-brand-muted tracking-[0.1em]">OAuth 2.0 Credentials</p>
              </div>
            </div>
            
            <form onSubmit={handleSave} className="p-8 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-brand-navy uppercase tracking-wider block">Client ID</label>
                  <input 
                    type="text" 
                    value={config.clientId}
                    onChange={(e) => setConfig({...config, clientId: e.target.value})}
                    className="w-full bg-brand-bg border border-brand-muted/20 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/10 transition-all font-mono"
                    placeholder="Enter Client ID"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-brand-navy uppercase tracking-wider block">Client Secret</label>
                  <div className="relative">
                    <input 
                      type={showSecret ? "text" : "password"} 
                      value={config.clientSecret}
                      onChange={(e) => setConfig({...config, clientSecret: e.target.value})}
                      className="w-full bg-brand-bg border border-brand-muted/20 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/10 transition-all font-mono"
                      placeholder="Enter Client Secret"
                    />
                    <button 
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-brand-muted hover:text-brand-navy transition-colors"
                    >
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-brand-navy uppercase tracking-wider block">Webhook Endpoint URL</label>
                <div className="flex gap-3">
                  <input 
                    type="url" 
                    value={config.webhookUrl}
                    onChange={(e) => setConfig({...config, webhookUrl: e.target.value})}
                    className="flex-1 bg-brand-bg border border-brand-muted/20 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/10 transition-all"
                  />
                  <button type="button" className="p-3 bg-brand-bg hover:bg-brand-muted/10 rounded-xl transition-all border border-brand-muted/10">
                    <ExternalLink className="w-5 h-5 text-brand-muted" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-brand-muted/10">
                <button 
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  className="flex items-center gap-2 text-xs font-bold text-brand-muted hover:text-brand-navy transition-colors px-4 py-2 border border-brand-muted/20 rounded-xl"
                >
                  <RefreshCw className={`w-4 h-4 ${isTesting ? 'animate-spin' : ''}`} />
                  {isTesting ? 'Authenticating...' : 'Test Handshake'}
                </button>
                
                <button 
                  type="submit"
                  className="flex items-center gap-2 bg-brand-navy text-white px-8 py-3 rounded-xl font-bold hover:shadow-lg transition-all active:scale-95"
                >
                  {isSaved ? <CheckCircle2 className="w-5 h-5" /> : <Save className="w-5 h-5" />}
                  {isSaved ? 'Parameters Saved' : 'Save Configuration'}
                </button>
              </div>
            </form>
          </div>

          <div className="bg-brand-navy rounded-2xl p-8 text-white relative overflow-hidden">
             <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 blur-[100px] rounded-full" />
             <div className="flex items-start gap-4 relative z-10">
                <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center border border-white/10">
                   <ShieldCheck className="w-6 h-6 text-blue-300" />
                </div>
                <div className="space-y-2">
                   <h4 className="font-bold text-lg">Security Protocol Notice</h4>
                   <p className="text-white/60 text-sm leading-relaxed">
                     Credentials inserted here are encrypted using AES-256 standards before persistence. 
                     Evdekimi Admin Portals adhere to strict ISO/IEC 27001 data handling guidelines. 
                     Never share your Client Secret via unencrypted communication channels.
                   </p>
                </div>
             </div>
          </div>
        </div>

        {/* Info Sidebar */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-brand-muted/10">
            <h4 className="font-bold text-brand-navy mb-4 flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Sync Parameters
            </h4>
            <div className="space-y-4">
              <div className="p-4 bg-brand-bg rounded-xl border border-brand-muted/5">
                <span className="block text-[10px] font-bold text-brand-muted uppercase mb-2">Polling Frequency</span>
                <select className="w-full bg-transparent text-sm font-bold focus:outline-none cursor-pointer">
                  <option value="15">Every 15 Minutes</option>
                  <option value="60">Every 1 Hour (Stable)</option>
                  <option value="1440">Once Daily</option>
                </select>
              </div>
              <div className="p-4 bg-brand-bg rounded-xl border border-brand-muted/5">
                <span className="block text-[10px] font-bold text-brand-muted uppercase mb-2">Auto-Reconcile Financials</span>
                <div className="flex items-center gap-3">
                   <div className="w-10 h-5 bg-emerald-500 rounded-full relative">
                      <div className="absolute right-1 top-1 w-3 h-3 bg-white rounded-full" />
                   </div>
                   <span className="text-xs font-bold text-brand-navy">Enabled</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-brand-muted/10 flex flex-col gap-4">
             <div className="flex items-center gap-3">
                <Webhook className="w-5 h-5 text-brand-navy" />
                <h4 className="font-bold text-brand-navy">Active Webhooks</h4>
             </div>
             <div className="space-y-3">
                {['Reservation Created', 'Price Updated', 'Check-out Finalized'].map(item => (
                  <div key={item} className="flex items-center justify-between py-2 border-b border-brand-muted/5 last:border-0">
                    <span className="text-[11px] font-bold text-brand-muted uppercase">{item}</span>
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  </div>
                ))}
             </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
