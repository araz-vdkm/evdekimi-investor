import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import Papa from 'papaparse';
import { Save, Upload, Download, AlertCircle, CheckCircle2 } from 'lucide-react';

export const DataManager = () => {
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('2026-08');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFile(file);
    setValidationErrors([]);
    setParsedData([]);
    setSuccessMsg('');

    if (file.name.endsWith('.csv')) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          validateData(results.data);
        },
      });
    } else if (file.name.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = JSON.parse(e.target?.result as string);
          validateData(Array.isArray(json) ? json : [json]);
        } catch (err) {
          setValidationErrors(['Invalid JSON file']);
        }
      };
      reader.readAsText(file);
    }
  };

  const validateData = (data: any[]) => {
    const errors: string[] = [];
    const validData: any[] = [];
    
    // Track uniqueness
    const seen = new Set<string>();

    data.forEach((row, index) => {
      const month = row.month || row.Month;
      const propertyId = row.propertyId || row.PropertyId || row.villaName;
      
      if (!month) errors.push(`Row ${index + 1}: Missing month`);
      if (!propertyId) errors.push(`Row ${index + 1}: Missing propertyId`);
      
      if (month && propertyId) {
        const key = `${month}_${propertyId}`;
        if (seen.has(key)) {
          errors.push(`Row ${index + 1}: Duplicate entry for ${month} - ${propertyId}`);
        } else {
          seen.add(key);
          // Parse numerics
          validData.push({
            ...row,
            month,
            propertyId,
            grossRevenue: parseFloat(row.grossRevenue) || 0,
            netProfit: parseFloat(row.netProfit) || parseFloat(row.finalDecisionToTransfer) || 0,
            occupancy: parseFloat(row.occupancy) || 0,
            adr: parseFloat(row.adr) || 0,
          });
        }
      }
    });

    setValidationErrors(errors);
    if (errors.length === 0 && validData.length > 0) {
      setParsedData(validData);
    }
  };

  const confirmImport = async () => {
    if (parsedData.length === 0) return;
    setIsImporting(true);
    setSuccessMsg('');
    try {
      const batch = writeBatch(db);
      parsedData.forEach(record => {
        const docId = `${record.month}_${record.propertyId}`;
        const ref = doc(db, 'monthly_reports', docId);
        batch.set(ref, record, { merge: true });
      });
      await batch.commit();
      setSuccessMsg(`Successfully imported ${parsedData.length} records to Firestore.`);
      setParsedData([]);
      setFile(null);
    } catch (err: any) {
      console.error(err);
      setValidationErrors([err.message || 'Error writing to Firestore']);
    }
    setIsImporting(false);
  };

  const exportData = async () => {
    try {
      setValidationErrors([]);
      setSuccessMsg('');
      const querySnapshot = await getDocs(collection(db, 'monthly_reports'));
      const data = querySnapshot.docs
        .map(doc => doc.data())
        .filter(d => d.month === selectedMonth);
        
      if (data.length === 0) {
        setValidationErrors([`No data found for ${selectedMonth}`]);
        return;
      }

      const csv = Papa.unparse(data);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `monthly_reports_${selectedMonth}.csv`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccessMsg(`Successfully exported ${data.length} records.`);
    } catch (err: any) {
      console.error(err);
      setValidationErrors([err.message || 'Error exporting data']);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-brand-navy tracking-tight mb-2">Firebase Data Management</h2>
        <p className="text-brand-muted text-sm">Upload verified monthly performance data to Firestore or export existing records.</p>
      </div>

      {validationErrors.length > 0 && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold mb-1">Errors</h4>
            <ul className="list-disc pl-5 text-sm space-y-1">
              {validationErrors.map((err, i) => (
                <li key={i + '-' + err.substring(0, 10)}>{err}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {successMsg && (
        <div className="bg-green-50 text-green-700 p-4 rounded-lg flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span className="font-bold">{successMsg}</span>
        </div>
      )}

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-brand-muted/10">
        <h3 className="text-lg font-bold text-brand-navy mb-4">Export Data</h3>
        <div className="flex items-center gap-4">
          <input 
            type="month" 
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-4 py-2"
          />
          <button 
            onClick={exportData}
            className="flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg hover:bg-brand-navy/90 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-brand-muted/10">
        <h3 className="text-lg font-bold text-brand-navy mb-4">Import Data</h3>
        
        <div className="mb-6">
          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <Upload className="w-8 h-8 text-gray-400 mb-2" />
              <p className="mb-2 text-sm text-gray-500"><span className="font-semibold">Click to upload</span> or drag and drop</p>
              <p className="text-xs text-gray-500">CSV or JSON file</p>
            </div>
            <input type="file" className="hidden" accept=".csv,.json" onChange={handleFileUpload} />
          </label>
        </div>

        {parsedData.length > 0 && validationErrors.length === 0 && (
          <div className="space-y-4">
            <div className="bg-blue-50 text-blue-700 p-4 rounded-lg flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              <span>Found <strong>{parsedData.length}</strong> valid records ready for import.</span>
            </div>
            <button 
              onClick={confirmImport}
              disabled={isImporting}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white px-4 py-3 rounded-xl hover:bg-emerald-700 transition-colors font-bold disabled:opacity-50"
            >
              <Save className="w-5 h-5" />
              {isImporting ? 'Importing to Firestore...' : 'Confirm Import'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
