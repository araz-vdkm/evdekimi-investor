import React, { useEffect, useState } from 'react';
import { Users, Home, Loader2, ArrowRight } from 'lucide-react';

interface Investor {
  id: string;
  name: string;
  code: string;
}

interface Villa {
  id: string;
  name: string;
  complex?: string;
  investorName: string;
  investorCode: string;
  status: string;
}

export function InvestorsMapping() {
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [villas, setVillas] = useState<Villa[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        const [invRes, vilRes] = await Promise.all([
          fetch('/api/sheet/investors'),
          fetch('/api/sheet/Villas')
        ]);
        
        if (!invRes.ok || !vilRes.ok) throw new Error('Failed to fetch data');
        
        const invData = await invRes.json();
        const vilData = await vilRes.json();

        let parsedInvestors: Investor[] = [];
        if (invData.values && invData.values.length > 1) {
           const rows = invData.values;
           const headers = rows[0].map((h: string) => h.toLowerCase());
           const idIdx = headers.findIndex((h: string) => h.includes('id'));
           const nameIdx = headers.findIndex((h: string) => h.includes('name'));
           const codeIdx = headers.findIndex((h: string) => h.includes('code'));

           parsedInvestors = rows.slice(1).map((row: any[]) => ({
             id: idIdx !== -1 ? row[idIdx] : '',
             name: nameIdx !== -1 ? row[nameIdx] : '',
             code: codeIdx !== -1 ? row[codeIdx] : ''
           })).filter((i: any) => i.code);
        }

        let parsedVillas: Villa[] = [];
        if (vilData.values && vilData.values.length > 1) {
           const rows = vilData.values;
           const headers = rows[0].map((h: string) => h.toLowerCase());
           const idIdx = headers.findIndex((h: string) => h.includes('id'));
           const nameIdx = headers.findIndex((h: string) => h.includes('villa name'));
           const complexIdx = headers.findIndex((h: string) => h.includes('complex'));
           const invNameIdx = headers.findIndex((h: string) => h.includes('investor name'));
           const codeIdx = headers.findIndex((h: string) => h.includes('investor code'));
           const statusIdx = headers.findIndex((h: string) => h.includes('status'));

           parsedVillas = rows.slice(1).map((row: any[]) => ({
             id: idIdx !== -1 ? row[idIdx] : '',
             name: nameIdx !== -1 ? row[nameIdx] : '',
             complex: complexIdx !== -1 ? row[complexIdx] : '',
             investorName: invNameIdx !== -1 ? row[invNameIdx] : '',
             investorCode: codeIdx !== -1 ? row[codeIdx] : '',
             status: statusIdx !== -1 ? row[statusIdx] : ''
           })).filter((v: any) => v.name);
        }
        
        setInvestors(parsedInvestors);
        setVillas(parsedVillas);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 text-brand-navy animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-12 text-center text-red-500 font-bold">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-brand-navy flex items-center gap-3">
          <Users className="w-6 h-6 text-indigo-400" />
          Investors Mapping
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {investors.map((investor, idx) => {
          // Find villas that map to this investor (by code)
          // The investorCode in villas might be comma-separated like "VA86IE, 7777777"
          const investorVillas = villas.filter(v => 
            v.investorCode && String(v.investorCode).split(',').map(s => s.trim()).includes(String(investor.code).trim())
          );

          return (
            <div key={investor.code + '-' + idx} className="bg-white rounded-3xl p-6 border border-brand-muted/10 shadow-sm flex flex-col group transition-shadow hover:shadow-md">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-brand-navy text-lg">{investor.name}</h3>
                  <p className="text-[10px] uppercase font-bold tracking-widest text-brand-muted mt-1">Code: {investor.code}</p>
                </div>
                <div className="w-10 h-10 rounded-full bg-brand-bg flex items-center justify-center text-brand-navy font-bold shadow-inner">
                  {investorVillas.length}
                </div>
              </div>

              <div className="mt-auto space-y-3">
                <h4 className="text-[10px] font-bold text-brand-muted uppercase tracking-widest border-b border-brand-muted/10 pb-2">Assigned Properties</h4>
                {investorVillas.length > 0 ? (
                  <div className="space-y-2">
                    {investorVillas.map((villa, vIdx) => (
                      <div key={villa.id + '-' + vIdx} className="flex items-center justify-between p-3 bg-brand-bg/50 rounded-xl">
                        <div className="flex items-center gap-3">
                           <Home className="w-4 h-4 text-brand-navy/50" />
                           <div className="flex flex-col">
                             <span className="text-sm font-bold text-brand-navy">{villa.name}</span>
                             {villa.complex && (
                               <span className="text-[10px] text-brand-muted font-bold uppercase tracking-widest">{villa.complex}</span>
                             )}
                           </div>
                        </div>
                        <span className={`text-[10px] uppercase font-bold tracking-widest px-2 py-1 rounded-full ${
                          villa.status.toLowerCase() === 'active' ? 'bg-emerald-400/20 text-emerald-600' : 'bg-brand-muted/10 text-brand-muted'
                        }`}>
                          {villa.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-center text-sm text-brand-muted italic bg-brand-bg/30 rounded-xl">
                    No properties assigned yet
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
