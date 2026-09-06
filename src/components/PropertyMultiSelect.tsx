import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

interface Property {
  id: string;
  name: string;
  complex?: string;
  [key: string]: any;
}

interface PropertyMultiSelectProps {
  properties: Property[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function PropertyMultiSelect({ properties, selectedIds, onChange }: PropertyMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (id: string) => {
    if (id === 'all') {
      onChange([]);
    } else {
      if (selectedIds.includes(id)) {
        const next = selectedIds.filter(x => x !== id);
        onChange(next);
      } else {
        onChange([...selectedIds, id]);
      }
    }
  };

  const isAll = selectedIds.length === 0;

  return (
    <div className="relative group min-w-[220px]" ref={dropdownRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left appearance-none bg-white border border-brand-muted/30 px-6 py-3 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand-navy/10 cursor-pointer shadow-sm flex items-center justify-between transition-all"
      >
        <span className="truncate pr-4">
          {isAll 
            ? 'All Properties' 
            : selectedIds.length === 1 
              ? properties.find(p => p.id === selectedIds[0] || p.name === selectedIds[0])?.name || selectedIds[0]
              : `${selectedIds.length} Properties Selected`}
        </span>
        <ChevronDown className={`w-4 h-4 text-brand-muted transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {isOpen && (
        <div className="absolute top-full mt-2 left-0 w-72 max-h-[400px] overflow-y-auto bg-white border border-brand-muted/20 rounded-xl shadow-xl z-50 py-2 animate-fade-in custom-scrollbar">
          <div onClick={() => handleSelect('all')} className="flex items-center px-4 py-3 hover:bg-brand-bg/50 cursor-pointer gap-3 transition-colors">
            <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${isAll ? 'bg-indigo-600 border-indigo-600' : 'border-brand-muted/40 bg-white'}`}>
              {isAll && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
            </div>
            <span className={`text-sm font-bold ${isAll ? 'text-indigo-600' : 'text-brand-navy'}`}>All Properties</span>
          </div>
          
          <div className="my-1 border-t border-brand-muted/10"></div>
          
          {Array.from(new Set(properties.map(p => p.complex).filter(Boolean))).map((complex, idx) => (
            <div key={`complex-${idx}-${String(complex)}`} className="mb-1">
              <div className="px-4 py-2 text-[10px] font-bold text-brand-muted uppercase tracking-widest bg-brand-bg/30">
                {String(complex)}
              </div>
              <div className="flex flex-col">
                {properties.filter(p => p.complex === complex).map((p, pIdx) => {
                  const val = p.name || p.id;
                  const isSelected = selectedIds.includes(val);
                  return (
                    <div key={`val-${pIdx}-${val}`} onClick={() => handleSelect(val)} className="flex items-center px-4 py-2.5 hover:bg-brand-bg/50 cursor-pointer gap-3 transition-colors group/item">
                      <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'bg-brand-navy border-brand-navy' : 'border-brand-muted/40 bg-white group-hover/item:border-brand-navy/50'}`}>
                        {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                      </div>
                      <span className={`text-sm font-medium truncate ${isSelected ? 'text-brand-navy font-bold' : 'text-brand-muted group-hover/item:text-brand-navy'}`}>
                        {p.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          
          {properties.filter(p => !p.complex).length > 0 && (
            <div className="mb-1">
               <div className="px-4 py-2 text-[10px] font-bold text-brand-muted uppercase tracking-widest bg-brand-bg/30">
                 Other Properties
               </div>
               <div className="flex flex-col">
                 {properties.filter(p => !p.complex).map((p, pIdx) => {
                   const val = p.name || p.id;
                   const isSelected = selectedIds.includes(val);
                   return (
                     <div key={`other-${pIdx}-${val}`} onClick={() => handleSelect(val)} className="flex items-center px-4 py-2.5 hover:bg-brand-bg/50 cursor-pointer gap-3 transition-colors group/item">
                       <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'bg-brand-navy border-brand-navy' : 'border-brand-muted/40 bg-white group-hover/item:border-brand-navy/50'}`}>
                         {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                       </div>
                       <span className={`text-sm font-medium truncate ${isSelected ? 'text-brand-navy font-bold' : 'text-brand-muted group-hover/item:text-brand-navy'}`}>
                         {p.name}
                       </span>
                     </div>
                   );
                 })}
               </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
