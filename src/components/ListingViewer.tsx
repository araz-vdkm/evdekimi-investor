import React, { useEffect, useState } from 'react';
import { ExternalLink, Loader2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { isUsableListingUrl } from '../lib/listingsSheet';

export type ListingViewerTarget = {
  villaName: string;
  platform: string;
  url: string;
};

type ListingViewerProps = {
  listing: ListingViewerTarget | null;
  onClose: () => void;
};

export function ListingViewer({ listing, onClose }: ListingViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const safeUrl = listing && isUsableListingUrl(listing.url) ? listing.url : null;

  useEffect(() => {
    setIsLoading(true);
  }, [listing?.url]);

  useEffect(() => {
    if (!listing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [listing, onClose]);

  return (
    <AnimatePresence>
      {listing && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-0 sm:p-4 bg-brand-navy/70 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="bg-white w-full h-full sm:w-[90vw] sm:h-[90vh] sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          >
            <div className="shrink-0 bg-brand-navy text-white px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-widest font-bold text-white/60">
                  {listing.platform}
                </div>
                <div className="text-sm sm:text-base font-bold truncate">{listing.villaName}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {safeUrl && (
                  <a
                    href={safeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 transition-colors"
                  >
                    Open
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-xl hover:bg-white/10 transition-colors"
                  aria-label="Close listing viewer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="relative flex-1 bg-brand-bg min-h-0">
              {isLoading && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-brand-bg/90">
                  <Loader2 className="w-6 h-6 text-brand-navy animate-spin" />
                  <p className="text-xs font-semibold text-brand-muted">Loading live listing…</p>
                </div>
              )}

              {safeUrl ? (
                <iframe
                  key={safeUrl}
                  src={safeUrl}
                  title={`${listing.platform} - ${listing.villaName}`}
                  className="w-full h-full border-0 bg-white"
                  onLoad={() => setIsLoading(false)}
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
                  <p className="text-sm font-semibold text-brand-navy">This listing URL is not safe to open.</p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-brand-navy text-white"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>

            <div className="shrink-0 px-4 sm:px-6 py-3 border-t border-brand-muted/10 bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <p className="text-[11px] text-brand-muted">
                Some OTAs block embedding. Use <span className="font-semibold">Open</span> to view the live page in a new tab.
              </p>
              {safeUrl && (
                <a
                  href={safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-brand-navy bg-brand-navy/5 hover:bg-brand-navy/10 transition-colors"
                >
                  Open on OTA
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
