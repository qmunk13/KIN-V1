/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { User } from 'firebase/auth';
import confetti from 'canvas-confetti';
import { 
  CalendarTheme, 
  CalendarFilters, 
  DayData, 
  GoogleCalendarEvent,
  PersonalNote 
} from './types/calendar';
import { 
  getHijriDate, 
  getJawaDate, 
  getPasaran, 
  getNeptuInfo, 
  checkAyyamulBidh, 
  checkHaramPuasa, 
  checkSeninKamis, 
  getEventsForDate,
  BULAN_HIJRIYAH,
  BULAN_JAWA
} from './utils/calendarMath';
import { 
  initAuth, 
  googleSignIn, 
  logout, 
  getAccessToken 
} from './services/auth';
import { 
  fetchCalendarEvents, 
  createCalendarEvent, 
  deleteCalendarEvent,
  CreateEventInput 
} from './services/googleCalendar';

import { CalendarHeader } from './components/CalendarHeader';
import { CalendarControls } from './components/CalendarControls';
import { DaysGrid } from './components/DaysGrid';
import { CalendarFooter } from './components/CalendarFooter';
import { PrayerTimesSection } from './components/PrayerTimesSection';
import { CalendarExportSection } from './components/CalendarExportSection';
import { DayDetailModal } from './components/DayDetailModal';
import { PersonalNotesModal } from './components/PersonalNotesModal';
import { AddEventModal } from './components/AddEventModal';
import { WetonCalculatorModal } from './components/WetonCalculatorModal';
import { ConfirmationModal } from './components/ConfirmationModal';

export default function App() {
  const today = useMemo(() => new Date(), []);
  const calendarContainerRef = useRef<HTMLElement | null>(null);
  
  // Calendar View State
  const [month, setMonth] = useState<number>(today.getMonth() + 1);
  const [year, setYear] = useState<number>(today.getFullYear());
  const [theme, setTheme] = useState<CalendarTheme>('classic');
  const [hijriAdjustment, setHijriAdjustment] = useState<number>(0);

  // Filters State
  const [filters, setFilters] = useState<CalendarFilters>({
    showAyyamulBidh: true,
    showSeninKamis: true,
    showHolidays: true,
    showGoogleEvents: true
  });

  // Auth State (Google Calendar)
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  // Google Events State
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarEvent[]>([]);
  const [isFetchingEvents, setIsFetchingEvents] = useState<boolean>(false);

  // Catatan Pribadi & Daily To-Do State (Offline & LocalStorage)
  const [personalNotes, setPersonalNotes] = useState<PersonalNote[]>(() => {
    try {
      const saved = localStorage.getItem('kalender_personal_notes');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isPersonalNotesOpen, setIsPersonalNotesOpen] = useState<boolean>(false);

  // Save personal notes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('kalender_personal_notes', JSON.stringify(personalNotes));
    } catch (e) {
      console.error('Failed to save personal notes', e);
    }
  }, [personalNotes]);

  // Modals & Interactive State
  const [selectedDayForDetail, setSelectedDayForDetail] = useState<DayData | null>(null);
  const [isAddEventOpen, setIsAddEventOpen] = useState<boolean>(false);
  const [eventDateTarget, setEventDateTarget] = useState<Date | null>(null);
  const [isWetonModalOpen, setIsWetonModalOpen] = useState<boolean>(false);
  const [isSavingEvent, setIsSavingEvent] = useState<boolean>(false);

  // Delete Event Confirmation State (MANDATORY per Google Workspace skill)
  const [eventToDelete, setEventToDelete] = useState<GoogleCalendarEvent | null>(null);
  const [isDeletingEvent, setIsDeletingEvent] = useState<boolean>(false);

  // Toast / notification banner
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  }, []);

  // Initialize Auth listener on mount
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, token) => {
        setUser(currentUser);
        setAccessToken(token);
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setGoogleEvents([]);
      }
    );

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  // Fetch Google Calendar events when month/year or accessToken changes
  const loadGoogleEvents = useCallback(async () => {
    if (!accessToken) return;

    try {
      setIsFetchingEvents(true);
      // Fetch for window from 7 days before start of month to 7 days after end of month
      const timeMin = new Date(year, month - 1, -7, 0, 0, 0);
      const totalDays = new Date(year, month, 0).getDate();
      const timeMax = new Date(year, month - 1, totalDays + 7, 23, 59, 59);

      const events = await fetchCalendarEvents(accessToken, timeMin, timeMax);
      setGoogleEvents(events);
    } catch (err: any) {
      console.warn('Could not fetch Google Calendar events:', err.message);
    } finally {
      setIsFetchingEvents(false);
    }
  }, [accessToken, month, year]);

  useEffect(() => {
    if (accessToken) {
      loadGoogleEvents();
    }
  }, [accessToken, loadGoogleEvents]);

  // Auth Handlers
  const handleSignIn = async () => {
    setIsLoggingIn(true);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setAccessToken(res.accessToken);
        showToast(`Berhasil terhubung dengan Google Calendar (${res.user.email})!`);
        confetti({ particleCount: 50, spread: 60, origin: { y: 0.8 } });
      }
    } catch (err: any) {
      console.error('Sign-in failed:', err);
      showToast(err.message || 'Gagal masuk ke Google Calendar.', 'error');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setAccessToken(null);
    setGoogleEvents([]);
    showToast('Telah keluar dari akun Google.');
  };

  // Navigation handlers
  const handlePrevMonth = () => {
    if (month === 1) {
      if (year > 1582) {
        setMonth(12);
        setYear(year - 1);
      }
    } else {
      setMonth(month - 1);
    }
  };

  const handleNextMonth = () => {
    if (month === 12) {
      if (year < 9999) {
        setMonth(1);
        setYear(year + 1);
      }
    } else {
      setMonth(month + 1);
    }
  };

  const handleSetToday = () => {
    const now = new Date();
    setMonth(now.getMonth() + 1);
    setYear(now.getFullYear());
  };

  // Personal Notes Handlers
  const handleAddPersonalNote = (dateStr: string, title: string) => {
    const newNote: PersonalNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      dateStr,
      title,
      isDone: false,
      createdAt: Date.now()
    };
    setPersonalNotes((prev) => [newNote, ...prev]);
    showToast('Catatan pribadi berhasil ditambahkan!');

    // Update selected day view if open
    if (selectedDayForDetail) {
      setSelectedDayForDetail((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          personalNotes: [newNote, ...prev.personalNotes]
        };
      });
    }
  };

  const handleTogglePersonalNote = (id: string) => {
    setPersonalNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isDone: !n.isDone } : n))
    );

    if (selectedDayForDetail) {
      setSelectedDayForDetail((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          personalNotes: prev.personalNotes.map((n) =>
            n.id === id ? { ...n, isDone: !n.isDone } : n
          )
        };
      });
    }
  };

  const handleDeletePersonalNote = (id: string) => {
    setPersonalNotes((prev) => prev.filter((n) => n.id !== id));
    showToast('Catatan dihapus.');

    if (selectedDayForDetail) {
      setSelectedDayForDetail((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          personalNotes: prev.personalNotes.filter((n) => n.id !== id)
        };
      });
    }
  };

  // Add Google event handler
  const handleOpenAddEvent = (date: Date) => {
    if (!user || !accessToken) {
      handleSignIn();
      return;
    }
    setEventDateTarget(date);
    setIsAddEventOpen(true);
  };

  const handleCreateEventSubmit = async (input: CreateEventInput) => {
    const token = accessToken || await getAccessToken();
    if (!token) {
      throw new Error('Sesi Google Calendar telah berakhir, silakan masuk kembali.');
    }

    setIsSavingEvent(true);
    try {
      await createCalendarEvent(token, input);
      showToast(`Agenda "${input.summary}" berhasil ditambahkan ke Google Calendar!`);
      confetti({ particleCount: 60, spread: 70, origin: { y: 0.7 } });
      await loadGoogleEvents();
    } finally {
      setIsSavingEvent(false);
    }
  };

  // Delete event handler with explicit confirmation
  const handleRequestDeleteEvent = (event: GoogleCalendarEvent) => {
    setEventToDelete(event);
  };

  const handleConfirmDeleteEvent = async () => {
    if (!eventToDelete) return;
    const token = accessToken || await getAccessToken();
    if (!token) {
      showToast('Sesi Google Calendar berakhir.', 'error');
      return;
    }

    setIsDeletingEvent(true);
    try {
      await deleteCalendarEvent(token, eventToDelete.id);
      showToast(`Agenda "${eventToDelete.summary}" berhasil dihapus dari Google Calendar.`);
      setEventToDelete(null);
      await loadGoogleEvents();
      // Also update selected day if open
      if (selectedDayForDetail) {
        setSelectedDayForDetail((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            googleEvents: prev.googleEvents.filter((e) => e.id !== eventToDelete.id)
          };
        });
      }
    } catch (err: any) {
      showToast(err.message || 'Gagal menghapus agenda.', 'error');
    } finally {
      setIsDeletingEvent(false);
    }
  };

  // Jump to specific year & month (from Weton Calculator or Personal Notes)
  const handleJumpToDate = (targetYear: number, targetMonth: number, day?: number) => {
    setYear(targetYear);
    setMonth(targetMonth);
    showToast(`Beralih ke kalender ${targetMonth}/${targetYear}`);

    if (day) {
      // Find and select day
      const targetDate = new Date(targetYear, targetMonth - 1, day);
      setTimeout(() => {
        const found = calendarDays.find(
          (cd) =>
            cd.dayNum === day &&
            cd.monthIdx === targetMonth - 1 &&
            cd.year === targetYear
        );
        if (found) {
          setSelectedDayForDetail(found);
        }
      }, 50);
    }
  };

  // Compute Calendar Grid Days
  const calendarDays = useMemo<DayData[]>(() => {
    if (isNaN(year) || year < 1582 || year > 9999 || month < 1 || month > 12) {
      return [];
    }

    const firstDayIndex = new Date(year, month - 1, 1).getDay(); // 0 = Ahad
    const totalDays = new Date(year, month, 0).getDate();
    const prevMonthTotalDays = new Date(year, month - 1, 0).getDate();

    const result: DayData[] = [];

    // Helper to extract google events for a specific Date
    const getGoogleEventsForDay = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dayStr = String(d.getDate()).padStart(2, '0');
      const dateIso = `${y}-${m}-${dayStr}`;

      return googleEvents.filter((ev) => {
        if (ev.start.date === dateIso) return true;
        if (ev.start.dateTime) {
          const evDate = ev.start.dateTime.split('T')[0];
          return evDate === dateIso;
        }
        return false;
      });
    };

    // Helper to generate DayData
    const makeDay = (dayNum: number, mIdx: number, y: number, isCurrent: boolean): DayData => {
      const d = new Date(y, mIdx, dayNum);
      const hijri = getHijriDate(d, hijriAdjustment);
      const jawa = getJawaDate(d, hijri);
      const pasaran = getPasaran(d);
      const neptu = getNeptuInfo(d, pasaran);
      const isAyyam = checkAyyamulBidh(hijri);
      const isHaram = checkHaramPuasa(hijri);
      const isSeninKm = checkSeninKamis(d.getDay(), isHaram);
      const holidays = getEventsForDate(d, hijri);
      const gEvents = getGoogleEventsForDay(d);

      const yStr = d.getFullYear();
      const mStr = String(d.getMonth() + 1).padStart(2, '0');
      const dStr = String(d.getDate()).padStart(2, '0');
      const dateIso = `${yStr}-${mStr}-${dStr}`;
      const dayNotes = personalNotes.filter((n) => n.dateStr === dateIso);

      const isTodayDate =
        d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear();

      return {
        date: d,
        dayNum,
        monthIdx: mIdx,
        year: y,
        isCurrentMonth: isCurrent,
        isToday: isTodayDate,
        dayOfWeek: d.getDay(),
        pasaran,
        hijri,
        jawa,
        neptu,
        isAyyamulBidh: isAyyam,
        isSeninKamis: isSeninKm,
        isHaramPuasa: isHaram,
        holidays,
        googleEvents: gEvents,
        personalNotes: dayNotes
      };
    };

    // 1. Previous month trailing days
    for (let i = firstDayIndex; i > 0; i--) {
      const dNum = prevMonthTotalDays - i + 1;
      const mIdx = month === 1 ? 11 : month - 2;
      const y = month === 1 ? year - 1 : year;
      result.push(makeDay(dNum, mIdx, y, false));
    }

    // 2. Current month active days
    for (let d = 1; d <= totalDays; d++) {
      result.push(makeDay(d, month - 1, year, true));
    }

    // 3. Next month leading days (to complete 35 or 42 cells)
    const totalRendered = result.length;
    const targetCount = totalRendered <= 35 ? 35 : 42;
    const remaining = targetCount - totalRendered;

    for (let n = 1; n <= remaining; n++) {
      const mIdx = month === 12 ? 0 : month;
      const y = month === 12 ? year + 1 : year;
      result.push(makeDay(n, mIdx, y, false));
    }

    return result;
  }, [year, month, hijriAdjustment, googleEvents, personalNotes, today]);

  // Compute dual Hijri & Javanese header subtitles
  const { hijriHeader, jawaHeader, monthlyEvents } = useMemo(() => {
    if (calendarDays.length === 0) {
      return {
        hijriHeader: '',
        jawaHeader: '',
        monthlyEvents: []
      };
    }

    const currentMonthDays = calendarDays.filter((d) => d.isCurrentMonth);
    if (currentMonthDays.length === 0) {
      return {
        hijriHeader: '',
        jawaHeader: '',
        monthlyEvents: []
      };
    }

    const first = currentMonthDays[0];
    const last = currentMonthDays[currentMonthDays.length - 1];

    let hText = `${BULAN_HIJRIYAH[first.hijri.month]} ${first.hijri.year} H`;
    if (first.hijri.month !== last.hijri.month) {
      if (first.hijri.year === last.hijri.year) {
        hText = `${BULAN_HIJRIYAH[first.hijri.month]} - ${BULAN_HIJRIYAH[last.hijri.month]} ${first.hijri.year} H`;
      } else {
        hText = `${BULAN_HIJRIYAH[first.hijri.month]} ${first.hijri.year} - ${BULAN_HIJRIYAH[last.hijri.month]} ${last.hijri.year} H`;
      }
    }

    let jText = `${BULAN_JAWA[first.hijri.month]} ${first.jawa.year}`;
    if (first.hijri.month !== last.hijri.month) {
      if (first.jawa.year === last.jawa.year) {
        jText = `${BULAN_JAWA[first.hijri.month]} - ${BULAN_JAWA[last.hijri.month]} ${first.jawa.year}`;
      } else {
        jText = `${BULAN_JAWA[first.hijri.month]} ${first.jawa.year} - ${BULAN_JAWA[last.hijri.month]} ${last.jawa.year}`;
      }
    }

    // Gather monthly events
    const eventList: Array<{ dayNum: number; title: string; isHoliday: boolean; type: string }> = [];

    currentMonthDays.forEach((d) => {
      d.holidays.forEach((h) => {
        eventList.push({
          dayNum: d.dayNum,
          title: h.title,
          isHoliday: !!h.isHoliday,
          type: h.type
        });
      });
    });

    eventList.sort((a, b) => a.dayNum - b.dayNum);

    return {
      hijriHeader: hText,
      jawaHeader: jText,
      monthlyEvents: eventList
    };
  }, [calendarDays]);

  // Date for Prayer Times: today if current month/year, else 1st of viewed month
  const activePrayerDate = useMemo(() => {
    if (today.getFullYear() === year && today.getMonth() + 1 === month) {
      return today;
    }
    return new Date(year, month - 1, 1);
  }, [year, month, today]);

  // Active personal notes count for this month
  const monthNotesCount = useMemo(() => {
    const mStr = String(month).padStart(2, '0');
    return personalNotes.filter(
      (n) => n.dateStr.startsWith(`${year}-${mStr}`) && !n.isDone
    ).length;
  }, [personalNotes, year, month]);

  return (
    <div className={`min-h-screen py-4 sm:py-8 px-2 sm:px-4 flex flex-col items-center ${
      theme === 'dark' ? 'bg-[#121212] text-stone-100' : 'bg-[#1a1a1a] text-stone-900'
    }`}>
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl shadow-xl text-xs sm:text-sm font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-top-4 duration-200 ${
            toastMessage.type === 'error'
              ? 'bg-red-600 text-white'
              : 'bg-emerald-600 text-white'
          }`}
        >
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Top Application Bar & Controls (Termasuk Tombol Catatan Pribadi disamping Google Calendar) */}
      <CalendarControls
        month={month}
        year={year}
        theme={theme}
        hijriAdjustment={hijriAdjustment}
        filters={filters}
        user={user}
        isLoggingIn={isLoggingIn}
        notesCount={monthNotesCount}
        onMonthChange={(m) => setMonth(m)}
        onYearChange={(y) => setYear(y)}
        onSetToday={handleSetToday}
        onThemeChange={(t) => setTheme(t)}
        onHijriAdjustmentChange={(adj) => setHijriAdjustment(adj)}
        onToggleFilter={(key) =>
          setFilters((prev) => ({ ...prev, [key]: !prev[key] }))
        }
        onOpenWetonCalculator={() => setIsWetonModalOpen(true)}
        onOpenPersonalNotes={() => setIsPersonalNotesOpen(true)}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
      />

      {/* Kerangka Kalender Dinding Interaktif (Poster Style) */}
      <main
        ref={calendarContainerRef}
        className={`calendar-container w-full max-w-[1020px] rounded-sm overflow-hidden shadow-2xl border-2 transition-all duration-200 ${
          theme === 'dark'
            ? 'bg-[#121212] border-stone-700 shadow-stone-950/80'
            : 'bg-white border-stone-800 shadow-black/70'
        }`}
      >
        {/* Header Atas: Angka Bulan Besar, Nama Bulan & Banner Hijriyah/Jawa */}
        <CalendarHeader
          month={month}
          year={year}
          hijriHeaderText={hijriHeader}
          jawaHeaderText={jawaHeader}
          theme={theme}
          onPrevMonth={handlePrevMonth}
          onNextMonth={handleNextMonth}
        />

        {/* Grid Kotak Tanggal */}
        <DaysGrid
          days={calendarDays}
          theme={theme}
          filters={filters}
          onSelectDay={(day) => setSelectedDayForDetail(day)}
        />

        {/* JADWAL WAKTU SHOLAT OTOMATIS: dibawah tanggal diatas hari libur */}
        <PrayerTimesSection
          currentDate={activePrayerDate}
          theme={theme}
        />

        {/* Footer Keterangan Hari Libur & Peringatan Bulan Ini */}
        <CalendarFooter
          events={monthlyEvents}
          theme={theme}
        />

        {/* EKSPOR KALENDER KE GAMBAR (PNG / JPG / PDF): dibawah hari libur & peringatan */}
        <CalendarExportSection
          month={month}
          year={year}
          theme={theme}
          targetRef={calendarContainerRef}
          onShowToast={showToast}
        />
      </main>

      {/* Footnote / Quick Information */}
      <footer className="mt-6 text-center text-xs text-stone-500 max-w-lg space-y-1 print:hidden">
        <p>
          Kalender Interaktif Nusantara &bull; Rentang Tahun 1582 - 9999 Masehi
        </p>
        <p className="text-[11px] text-stone-600">
          Dilengkapi Jadwal Sholat, Penanggalan Jawa & Hijriyah, Catatan Pribadi, serta Ekspor Gambar HD.
        </p>
      </footer>

      {/* MODAL 1: Day Detail Modal (Dengan Catatan Pribadi & Google Calendar) */}
      <DayDetailModal
        dayData={selectedDayForDetail}
        isOpen={!!selectedDayForDetail}
        onClose={() => setSelectedDayForDetail(null)}
        onOpenAddEvent={(date) => {
          setSelectedDayForDetail(null);
          handleOpenAddEvent(date);
        }}
        onRequestDeleteEvent={handleRequestDeleteEvent}
        isAuthenticated={!!user}
        onSignInPrompt={handleSignIn}
        onAddPersonalNote={handleAddPersonalNote}
        onTogglePersonalNote={handleTogglePersonalNote}
        onDeletePersonalNote={handleDeletePersonalNote}
      />

      {/* MODAL 2: Kelola Catatan Pribadi & To-Do List Harian */}
      <PersonalNotesModal
        isOpen={isPersonalNotesOpen}
        onClose={() => setIsPersonalNotesOpen(false)}
        month={month}
        year={year}
        notes={personalNotes}
        onAddNote={handleAddPersonalNote}
        onToggleNote={handleTogglePersonalNote}
        onDeleteNote={handleDeletePersonalNote}
        onSelectDate={handleJumpToDate}
      />

      {/* MODAL 3: Add Event to Google Calendar Modal */}
      <AddEventModal
        isOpen={isAddEventOpen}
        selectedDate={eventDateTarget}
        onClose={() => {
          setIsAddEventOpen(false);
          setEventDateTarget(null);
        }}
        onSubmit={handleCreateEventSubmit}
        isLoading={isSavingEvent}
      />

      {/* MODAL 4: Weton Calculator & Calendar Conversion Modal */}
      <WetonCalculatorModal
        isOpen={isWetonModalOpen}
        onClose={() => setIsWetonModalOpen(false)}
        onJumpToDate={(y, m) => handleJumpToDate(y, m)}
      />

      {/* MODAL 5: User Confirmation for Destructive Google Calendar Operations (MANDATORY per Google Workspace Skill) */}
      <ConfirmationModal
        isOpen={!!eventToDelete}
        title="Hapus Agenda Google Calendar"
        message={`Apakah Anda yakin ingin menghapus agenda "${eventToDelete?.summary}" dari Google Calendar utama Anda?\n\nTindakan ini bersifat permanen dan tidak dapat dibatalkan.`}
        confirmLabel="Ya, Hapus Agenda"
        cancelLabel="Batal"
        isDestructive={true}
        isLoading={isDeletingEvent}
        onConfirm={handleConfirmDeleteEvent}
        onCancel={() => setEventToDelete(null)}
      />
    </div>
  );
}
