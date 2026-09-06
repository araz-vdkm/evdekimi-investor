import React from 'react';
import { format, isSameDay, isWithinInterval, startOfDay } from 'date-fns';
import { motion } from 'motion/react';
import { Booking, Property } from '../types';
import { getDaysInMonth } from '../lib/utils';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Props {
  month: number;
  year: number;
  bookings: Booking[];
  properties: Property[];
  onBookingClick: (booking: Booking) => void;
}

export function LineCalendar({ month, year, bookings, properties, onBookingClick }: Props) {
  const days = getDaysInMonth(month, year);

  // Header with dates
  return (
    <div className="w-full bg-white border border-brand-muted/10 rounded-2xl overflow-hidden shadow-sm">
      <div className="p-4 border-b border-brand-muted/10 bg-brand-bg/30">
        <h3 className="text-sm font-bold text-brand-navy">Line calendar</h3>
      </div>
      
      <div className="overflow-x-auto custom-scrollbar">
        <div className="min-w-max">
          {/* Day Headers */}
          <div className="flex border-b border-brand-muted/10">
            <div className="w-48 flex-shrink-0 border-r border-brand-muted/10 bg-white" />
            {days.map((day) => (
              <div 
                key={day.toISOString()} 
                className="w-16 flex-shrink-0 text-center py-2 border-r border-brand-muted/10 bg-white flex flex-col justify-center"
              >
                <span className="text-[10px] font-bold text-brand-navy block uppercase">
                  {format(day, 'MMM d')}
                </span>
                <span className="text-[9px] text-brand-muted block">
                  {format(day, 'EEEE')}
                </span>
              </div>
            ))}
          </div>

          {/* Property Rows */}
          <div className="flex flex-col">
            {properties.map((prop, propIdx) => {
              const propBookings = bookings.filter(b => b.listingId?.toLowerCase().trim() === prop.name?.toLowerCase().trim() || b.listingId?.toLowerCase().trim() === prop.id?.toLowerCase().trim());
              
              return (
                <div key={prop.id + "-" + propIdx} className="flex items-stretch min-h-[100px] group border-b border-brand-muted/10 last:border-b-0">
                  <div className="w-48 flex-shrink-0 border-r border-brand-muted/10 p-4 bg-white sticky left-0 z-10 shadow-[4px_0_10px_-2px_rgba(0,0,0,0.05)] flex flex-col justify-center">
                    <h4 className="text-[11px] font-bold text-brand-navy leading-tight mb-0.5">
                      {prop.name}
                    </h4>
                    <p className="text-[9px] text-brand-muted font-normal uppercase tracking-tight mb-3">
                      ID: {prop.id}
                    </p>
                    <div className="text-[10px] font-bold text-brand-navy/30">
                      {propBookings.length} bookings
                    </div>
                  </div>
                  <div className="flex relative bg-brand-bg/10">
                    {/* Day Grid Lines */}
                    {days.map((day) => (
                      <div 
                        key={`grid-${day.toISOString()}`} 
                        className="w-16 flex-shrink-0 border-r border-brand-muted/5 h-full relative"
                      />
                    ))}
                    
                    {/* Booking Blocks */}
                    {propBookings.map((booking, bIdx) => {
                      const checkIn = startOfDay(new Date(`${booking.checkInDate}T00:00:00.000Z`));
                      const checkOut = startOfDay(new Date(`${booking.checkOutDate}T00:00:00.000Z`));
                      
                      // Find start index in days array
                      const startIndex = days.findIndex(d => isSameDay(d, checkIn));
                      
                      // Allow partial overlaps by checking boundaries if exact match not found
                      let drawStartIndex = startIndex;
                      let duration = 0;
                      
                      if (startIndex === -1 && checkIn <= days[0] && checkOut >= days[0]) {
                        drawStartIndex = 0;
                      }
                      
                      if (drawStartIndex !== -1) {
                        const start = Math.max(new Date(`${booking.checkInDate}T00:00:00.000Z`).getTime(), days[0].getTime());
                        if (drawStartIndex === 0) {
                          // Ensure we draw exactly from the beginning if it spans across
                        }
                        const end = Math.min(new Date(`${booking.checkOutDate}T00:00:00.000Z`).getTime(), days[days.length-1].getTime() + 86400000);
                        duration = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
                      }

                      if (drawStartIndex === -1 || duration <= 0) return null;

                      const isCanceled = booking.status?.toLowerCase() === 'canceled' || booking.status?.toLowerCase() === 'cancelled';
                      const checkInMonth = new Date(`${booking.checkInDate}T00:00:00.000Z`).getUTCMonth();
                      const checkOutMonth = new Date(`${booking.checkOutDate}T00:00:00.000Z`).getUTCMonth();
                      const isOverlappingMonth = checkInMonth !== month || checkOutMonth !== month;

                      return (
                        <motion.button
                          key={booking.id + "-" + bIdx}
                          whileHover={{ scale: 1.01, zIndex: 20 }}
                          onClick={() => onBookingClick(booking)}
                          style={{ 
                            left: `${drawStartIndex * 64}px`, 
                            width: `${duration * 64}px`,
                            top: '20px',
                            height: '48px'
                          }}
                          className={cn(
                            "absolute rounded-lg border-2 border-white shadow-md flex items-center px-3 overflow-hidden transition-shadow hover:shadow-lg",
                            isCanceled 
                              ? "bg-brand-navy text-white" 
                              : isOverlappingMonth
                                ? "bg-gray-200 text-brand-navy"
                                : "bg-emerald-400 text-brand-navy"
                          )}
                        >
                          <span className="text-[10px] font-bold truncate leading-none">
                            {booking.guest.name}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      
      <div className="p-3 bg-brand-bg/10 flex items-center gap-6 border-t border-brand-muted/10">
        <div className="flex items-center gap-2">
           <div className="w-3 h-3 bg-emerald-400 rounded-sm border border-brand-muted/10" />
           <span className="text-[10px] font-bold text-brand-muted uppercase tracking-widest">Active Booking</span>
        </div>
        <div className="flex items-center gap-2">
           <div className="w-3 h-3 bg-gray-200 rounded-sm border border-brand-muted/10" />
           <span className="text-[10px] font-bold text-brand-muted uppercase tracking-widest">Cross-Month</span>
        </div>
        <div className="flex items-center gap-2">
           <div className="w-3 h-3 bg-brand-navy rounded-sm border border-white/10" />
           <span className="text-[10px] font-bold text-brand-muted uppercase tracking-widest">Maintenance / Block</span>
        </div>
      </div>
    </div>
  );
}
