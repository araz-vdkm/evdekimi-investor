import React, { useMemo, useState } from 'react';
import { Eye, ExternalLink, Globe } from 'lucide-react';
import {
  canEmbedListingInViewer,
  formatVillaPayoutCondition,
  groupListingsByVilla,
  isUsableListingUrl,
  type InvestorListingsResult,
  type ListingRecord,
} from '../lib/listingsSheet';
import type { ParsedVillaRecord } from '../lib/villaSheet';
import { ListingViewer, type ListingViewerTarget } from './ListingViewer';
import { PlatformLogo } from './PlatformLogo';

type PropertyListingsProps = {
  investorListings: InvestorListingsResult | null;
};

export function PropertyListings({ investorListings }: PropertyListingsProps) {
  const [activeListing, setActiveListing] = useState<ListingViewerTarget | null>(null);

  const groups = useMemo(
    () => (investorListings ? groupListingsByVilla(investorListings) : []),
    [investorListings]
  );

  const villaByName = useMemo(() => {
    const map = new Map<string, ParsedVillaRecord>();
    for (const villa of investorListings?.ownedVillas || []) {
      map.set(villa.name, villa);
    }
    return map;
  }, [investorListings]);

  const ownedPropertyCount = useMemo(() => {
    const owned = investorListings?.ownedVillas || [];
    // Unique villas by name — ownership collection, not listing/OTA records.
    return new Set(owned.map((v) => v.name)).size;
  }, [investorListings]);

  const openListing = (villaName: string, listing: ListingRecord) => {
    if (!canEmbedListingInViewer(listing.url)) return;
    setActiveListing({
      villaName,
      platform: listing.platform,
      url: listing.url,
    });
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 shrink-0">
              <Globe className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-brand-navy">Property Listings</h2>
              <p className="text-xs text-brand-muted">Live OTA pages for your properties</p>
            </div>
          </div>
          <div className="text-left sm:text-right shrink-0 sm:pl-4">
            <div className="text-3xl sm:text-4xl font-extrabold text-brand-navy leading-none tracking-tight">
              {ownedPropertyCount}
            </div>
            <div className="mt-1 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-brand-muted">
              Owned Properties
            </div>
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="bg-white rounded-3xl border border-brand-muted/10 shadow-sm px-4 py-10 text-center">
            <p className="text-sm font-semibold text-brand-navy">
              No OTA listings are available for your properties.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {groups.map((group) => {
              const villa = villaByName.get(group.villaName);
              const payoutLabel = villa
                ? formatVillaPayoutCondition(villa)
                : 'Flat Payout';
              const platforms = group.platforms.filter((l) => isUsableListingUrl(l.url));

              return (
                <div
                  key={group.villaName}
                  className="bg-white rounded-2xl border border-brand-muted/10 shadow-sm overflow-hidden flex flex-col"
                >
                  <div className="px-4 sm:px-5 pt-4 pb-3">
                    <h3 className="text-sm font-bold text-brand-navy leading-snug">
                      {group.villaName}
                    </h3>
                    <p className="text-xs font-semibold text-brand-muted mt-1">{payoutLabel}</p>
                  </div>

                  <div className="border-t border-brand-muted/10 divide-y divide-brand-muted/10">
                    {platforms.map((listing) => (
                      <div
                        key={`${group.villaName}-${listing.platform}-${listing.url}`}
                        className="px-4 sm:px-5 py-2.5 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                          <PlatformLogo platform={listing.platform} />
                          <span className="text-xs font-semibold text-brand-navy truncate min-w-0">
                            {listing.platform}
                          </span>
                        </div>
                        <div className="flex items-center justify-end gap-1.5 shrink-0">
                          {canEmbedListingInViewer(listing.url) && (
                            <button
                              type="button"
                              onClick={() => openListing(group.villaName, listing)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                              title={`View ${listing.platform} listing`}
                              aria-label={`View ${listing.platform} listing`}
                            >
                              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                              View
                            </button>
                          )}
                          <a
                            href={listing.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center p-1.5 rounded-lg text-brand-muted hover:text-brand-navy hover:bg-brand-bg transition-colors"
                            title={`Open ${listing.platform} listing`}
                            aria-label={`Open ${listing.platform} listing`}
                          >
                            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ListingViewer listing={activeListing} onClose={() => setActiveListing(null)} />
    </>
  );
}
