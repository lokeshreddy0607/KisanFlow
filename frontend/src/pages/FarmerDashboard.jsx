import { useEffect, useRef, useState } from "react";
import CentreCard, {
  getApproxDistanceKm,
  getApproxTravelMinutes,
} from "../components/CentreCard";
import AppointmentTracker from "../components/AppointmentTracker";

const API_URL = "http://127.0.0.1:8000";
const TIME_SLOTS = [
  "09:00 AM",
  "10:00 AM",
  "11:00 AM",
  "12:00 PM",
  "02:00 PM",
  "03:00 PM",
  "04:00 PM",
];
// Must match SLOT_CAPACITY in backend/main.py
const SLOT_CAPACITY = 5;
// Converts a slot string like "09:00 AM" into minutes since midnight,
// so it can be compared against the current time.
const getSlotMinutes = (slot) => {
  const [time, meridiem] = slot.split(" ");
  let [hours, minutes] = time.split(":").map(Number);

  if (meridiem === "PM" && hours !== 12) {
    hours += 12;
  }
  if (meridiem === "AM" && hours === 12) {
    hours = 0;
  }

  return hours * 60 + minutes;
};

// Returns today's date as "YYYY-MM-DD" in local time, matching the
// format used by the <input type="date"> element.
const getTodayDateString = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
};

function FarmerDashboard() {
  const [centres, setCentres] = useState([]);
  const [recommendation, setRecommendation] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [crop, setCrop] = useState("Paddy");
  const [quantity, setQuantity] = useState("");

  // Estimated payout (Government MSP based)
  const [payoutEstimate, setPayoutEstimate] = useState(null);
  const [payoutLoading, setPayoutLoading] = useState(false);

  // Booking states
  const [bookingCentre, setBookingCentre] = useState(null);
  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [bookedSlots, setBookedSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  // Alternative centres (Task 31)
  const [alternativeCentres, setAlternativeCentres] = useState([]);
  const [alternativesSourceCentre, setAlternativesSourceCentre] =
    useState(null);

  // Farmer details
  const [farmerName, setFarmerName] = useState("");
  const [farmerPhone, setFarmerPhone] = useState("");
  const [farmerVillage, setFarmerVillage] = useState("");

  // Appointment
  const [appointment, setAppointment] = useState(null);
  const [queuePosition, setQueuePosition] = useState(null);
  const [statusHistory, setStatusHistory] = useState([]);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState("");
  // Rescheduling suggestion 
  const [rescheduleDismissed, setRescheduleDismissed] = useState(false);
  const [switchingCentre, setSwitchingCentre] = useState(false);
  const [switchError, setSwitchError] = useState("");
  // Actual rescheduling form 
  const [showRescheduleForm, setShowRescheduleForm] = useState(false);
  const [rescheduleCentreId, setRescheduleCentreId] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleBookedSlots, setRescheduleBookedSlots] = useState([]);
  const [rescheduleSlotsLoading, setRescheduleSlotsLoading] =
    useState(false);
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");
  // Synchronous guard against rapid double-clicks on the booking
  // button (state updates like setBookingLoading are not instant,
  // so a plain ref is used to block a second click immediately).
  const bookingInProgressRef = useRef(false);

  // STEP 10/11 - Notifications + Voice support
  const [notification, setNotification] = useState(null);
  const [lastStatus, setLastStatus] = useState(null);
  const [language, setLanguage] = useState("en-IN");
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef(null);

  // STEP 12 - Offline / Low-Network Support
  const [networkStatus, setNetworkStatus] = useState(
    typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline"
  );
  const [pendingBookings, setPendingBookings] = useState([]);
  const [syncingBookings, setSyncingBookings] = useState(false);
  const [lastCentreSync, setLastCentreSync] = useState(null);

  // STEP 13 - Notification centre
  const [notificationHistory, setNotificationHistory] = useState([]);
  const [reminderEnabled, setReminderEnabled] = useState(true);

  const CENTRE_CACHE_KEY = "kisanflow_centres_cache";
  const PENDING_BOOKINGS_KEY = "kisanflow_pending_bookings";

  // --------------------------------------------------
  // STEP 11 - VOICE + MULTILINGUAL SUPPORT
  // --------------------------------------------------

  const translations = {
    "en-IN": { listening: "Listening...", help: "Say: Paddy 40 quintals" },
    "te-IN": { listening: "వింటున్నాము...", help: "వరి 40 క్వింటాళ్లు అని చెప్పండి" },
    "hi-IN": { listening: "सुन रहे हैं...", help: "धान 40 क्विंटल बोलें" },
  };

  const t = translations[language];

  const speak = (text) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  const startVoiceInput = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setBookingError("Voice input is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
      setBookingError("");
    };

    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      const lower = text.toLowerCase();

      const cropMap = {
        paddy: "Paddy", rice: "Paddy", వరి: "Paddy", धान: "Paddy",
        wheat: "Wheat", गेहूं: "Wheat", గోధుమ: "Wheat",
        cotton: "Cotton", పత్తి: "Cotton", कपास: "Cotton",
        maize: "Maize", corn: "Maize", మొక్కజొన్న: "Maize", मक्का: "Maize",
        turmeric: "Turmeric", పసుపు: "Turmeric", हल्दी: "Turmeric",
      };

      for (const [key, value] of Object.entries(cropMap)) {
        if (lower.includes(key.toLowerCase())) {
          setCrop(value);
          break;
        }
      }

      const numberMatch = text.match(/\d+(?:\.\d+)?/);
      if (numberMatch) setQuantity(numberMatch[0]);

      speak(language === "te-IN"
        ? "మీ పంట వివరాలు నమోదు చేయబడ్డాయి."
        : language === "hi-IN"
          ? "आपकी फसल की जानकारी दर्ज हो गई है।"
          : "Your crop details have been recorded.");
    };

    recognition.onerror = (event) => {
      console.error("Voice recognition error:", event.error);
      setBookingError("Could not understand the voice input. Please try again.");
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
  };

  const showNotification = (status, customMessage = null) => {
    const messages = {
      BOOKED: { icon: "🎫", title: "Appointment Confirmed", message: "Your procurement slot is confirmed." },
      IN_QUEUE: { icon: "👥", title: "You Are In Queue", message: "You are now in the procurement queue." },
      PROCESSING: { icon: "⚙️", title: "Procurement Started", message: "Your crop is now being processed." },
      COMPLETED: { icon: "🎉", title: "Procurement Completed", message: "Your procurement process is completed." },
      CANCELLED: { icon: "❌", title: "Appointment Cancelled", message: "Your appointment has been cancelled." },
    };
    const notice = messages[status] || customMessage;
    if (notice) {
      setNotification(notice);
      setNotificationHistory((previous) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          ...notice,
          status,
          createdAt: Date.now(),
        },
        ...previous,
      ].slice(0, 20));
      setTimeout(() => setNotification(null), 5000);
    }
  };

  useEffect(() => {
    setVoiceSupported("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  // --------------------------------------------------
  // STEP 12 - NETWORK + OFFLINE HELPERS
  // --------------------------------------------------

  const saveCentreCache = (data) => {
    try {
      localStorage.setItem(
        CENTRE_CACHE_KEY,
        JSON.stringify({
          data,
          savedAt: Date.now(),
        })
      );
      setLastCentreSync(Date.now());
    } catch (storageError) {
      console.error("Could not cache centre data:", storageError);
    }
  };

  const loadCentreCache = () => {
    try {
      const cached = localStorage.getItem(CENTRE_CACHE_KEY);
      if (!cached) return false;

      const parsed = JSON.parse(cached);
      if (!Array.isArray(parsed.data)) return false;

      setCentres(parsed.data);
      setLastCentreSync(parsed.savedAt || null);
      return true;
    } catch (storageError) {
      console.error("Could not read centre cache:", storageError);
      return false;
    }
  };

  const readPendingBookings = () => {
    try {
      const saved = localStorage.getItem(PENDING_BOOKINGS_KEY);
      const data = saved ? JSON.parse(saved) : [];
      const safeData = Array.isArray(data) ? data : [];
      setPendingBookings(safeData);
      return safeData;
    } catch (storageError) {
      console.error("Could not read pending bookings:", storageError);
      setPendingBookings([]);
      return [];
    }
  };

  const savePendingBookings = (items) => {
    try {
      localStorage.setItem(PENDING_BOOKINGS_KEY, JSON.stringify(items));
      setPendingBookings(items);
    } catch (storageError) {
      console.error("Could not save pending booking:", storageError);
    }
  };

  const addPendingBooking = (booking) => {
    const existing = readPendingBookings();
    const updated = [...existing, booking];
    savePendingBookings(updated);
    return updated;
  };

  const getNetworkStatus = () => {
    if (typeof navigator === "undefined" || !navigator.onLine) {
      return "offline";
    }

    const connection =
      navigator.connection ||
      navigator.mozConnection ||
      navigator.webkitConnection;

    const effectiveType = connection?.effectiveType;

    if (effectiveType === "slow-2g" || effectiveType === "2g") {
      return "poor";
    }

    return "online";
  };

  const syncPendingBookings = async () => {
    if (syncingBookings || !navigator.onLine) return;

    const queue = readPendingBookings();
    if (!queue.length) return;

    setSyncingBookings(true);
    let remaining = [...queue];

    for (const pending of queue) {
      try {
                const farmerResponse = await fetch(
          `${API_URL}/farmers/${pending.farmerId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(pending.farmer),
          }
        );

        if (!farmerResponse.ok) {
          throw new Error("Farmer profile update failed during sync");
        }

        const farmer = await farmerResponse.json();

        const appointmentResponse = await fetch(
          `${API_URL}/appointments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              farmer_id: pending.farmerId,
              centre_id: pending.appointment.centre_id,
              appointment_date: pending.appointment.appointment_date,
              appointment_time: pending.appointment.appointment_time,
            }),
          }
        );

        if (!appointmentResponse.ok) {
          throw new Error("Appointment creation failed during sync");
        }

        remaining = remaining.filter((item) => item.localId !== pending.localId);

        setAppointment({
          ...(await appointmentResponse.json()),
          farmer_name: farmer.name,
          crop: farmer.crop,
          quantity: farmer.quantity,
          centre_name: pending.centreName,
          location: pending.location,
        });

        showNotification("BOOKED");
        speak(
          language === "te-IN"
            ? "ఇంటర్నెట్ తిరిగి వచ్చింది. మీ బుకింగ్ విజయవంతంగా సమకాలీకరించబడింది."
            : language === "hi-IN"
              ? "इंटरनेट वापस आ गया है। आपकी बुकिंग सफलतापूर्वक सिंक हो गई है।"
              : "Internet is back. Your booking has been synchronized successfully."
        );
      } catch (syncError) {
        console.error("Pending booking sync failed:", syncError);
        break;
      }
    }

    savePendingBookings(remaining);
    setSyncingBookings(false);
  };

  useEffect(() => {
    const updateNetworkStatus = () => {
      const status = getNetworkStatus();
      setNetworkStatus(status);

      if (status !== "offline") {
        loadCentres();
        syncPendingBookings();
      }
    };

    const initialStatus = getNetworkStatus();
    setNetworkStatus(initialStatus);
    readPendingBookings();

    window.addEventListener("online", updateNetworkStatus);
    window.addEventListener("offline", updateNetworkStatus);

    const connection =
      navigator.connection ||
      navigator.mozConnection ||
      navigator.webkitConnection;

    if (connection) {
      connection.addEventListener?.("change", updateNetworkStatus);
    }

    return () => {
      window.removeEventListener("online", updateNetworkStatus);
      window.removeEventListener("offline", updateNetworkStatus);
      connection?.removeEventListener?.("change", updateNetworkStatus);
    };
  }, []);

  // --------------------------------------------------
  // STEP 13 - NOTIFICATION HISTORY + REMINDER
  // --------------------------------------------------

  useEffect(() => {
    try {
      const saved = localStorage.getItem("kisanflow_notification_history");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setNotificationHistory(parsed);
      }

      const savedReminder = localStorage.getItem("kisanflow_reminder_enabled");
      if (savedReminder !== null) {
        setReminderEnabled(savedReminder === "true");
      }
    } catch (storageError) {
      console.error("Could not load notification preferences:", storageError);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        "kisanflow_notification_history",
        JSON.stringify(notificationHistory.slice(0, 20))
      );
    } catch (storageError) {
      console.error("Could not save notification history:", storageError);
    }
  }, [notificationHistory]);

  useEffect(() => {
    localStorage.setItem(
      "kisanflow_reminder_enabled",
      String(reminderEnabled)
    );
  }, [reminderEnabled]);

  useEffect(() => {
    if (!appointment?.id || !reminderEnabled || !appointment.date) return;

    const timer = setInterval(() => {
      const now = new Date();
      const rawTime = (appointment.time_slot || "09:00 AM").trim();
      const match = rawTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);

      let appointmentDate;

      if (match) {
        let hours = Number(match[1]);
        const minutes = Number(match[2]);
        const meridiem = match[3]?.toUpperCase();

        if (meridiem === "PM" && hours !== 12) hours += 12;
        if (meridiem === "AM" && hours === 12) hours = 0;

        appointmentDate = new Date(appointment.date);
        appointmentDate.setHours(hours, minutes, 0, 0);
      } else {
        appointmentDate = new Date(`${appointment.date}T${rawTime}`);
      }

      if (!appointmentDate || Number.isNaN(appointmentDate.getTime())) return;

      const minutesUntil =
        (appointmentDate.getTime() - now.getTime()) / 60000;

      if (minutesUntil > 0 && minutesUntil <= 60) {
        const reminderKey = `kisanflow_reminder_${appointment.id}_${appointment.date}_${appointment.time_slot}`;

        if (!sessionStorage.getItem(reminderKey)) {
          sessionStorage.setItem(reminderKey, "sent");

          showNotification(null, {
            icon: "⏰",
            title: "Appointment Reminder",
            message: `Your procurement slot is scheduled within the next hour at ${appointment.centre_name || "your selected centre"}.`,
          });

          speak(
            language === "te-IN"
              ? "మీ ప్రొక్యూర్‌మెంట్ అపాయింట్‌మెంట్ ఒక గంటలో ఉంది."
              : language === "hi-IN"
                ? "आपका खरीद अपॉइंटमेंट एक घंटे के अंदर है।"
                : "Your procurement appointment is within the next hour."
          );
        }
      }
    }, 30000);

    return () => clearInterval(timer);
  }, [
    appointment?.id,
    appointment?.date,
    appointment?.time_slot,
    reminderEnabled,
    language,
  ]);

  // --------------------------------------------------
// LOAD CENTRES
// --------------------------------------------------

const loadCentres = async () => {
  try {
    setError("");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(`${API_URL}/centres`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Centres API returned ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error("Invalid centre data received from server");
    }

    setCentres(data);
    saveCentreCache(data);
    setNetworkStatus(getNetworkStatus());

  } catch (err) {
    console.error("LOAD CENTRES ERROR:", err);

    const usedCache = loadCentreCache();

    if (usedCache) {
      setNetworkStatus("offline");
      setError(
        "Live data is temporarily unavailable. Showing the latest saved centre information."
      );
    } else {
      setNetworkStatus("offline");
      setError(
        err.name === "AbortError"
          ? "Procurement centre server is taking too long to respond."
          : "Unable to load procurement centres. Make sure the backend is running."
      );
    }

  } finally {
    setLoading(false);
  }
};

  // --------------------------------------------------
  // LOAD RECOMMENDATION
  // --------------------------------------------------

  const loadRecommendation = async () => {
    try {
      const response = await fetch(
        `${API_URL}/recommend-centre`
      );

      if (!response.ok) {
        throw new Error("Recommendation failed");
      }

      const data = await response.json();

      setRecommendation(data);
    } catch (err) {
      console.error(err);
    }
  };

  // --------------------------------------------------
  // ESTIMATED PAYOUT (Government MSP based)
  // --------------------------------------------------

  useEffect(() => {
    const qty = Number(quantity);

    if (!crop || !qty || qty <= 0) {
      setPayoutEstimate(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadPayout = async () => {
      setPayoutLoading(true);
      try {
        const response = await fetch(
          `${API_URL}/estimate-payout?crop=${encodeURIComponent(
            crop
          )}&quantity=${qty}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error("Payout estimate failed");
        const data = await response.json();
        if (!cancelled) setPayoutEstimate(data);
      } catch (err) {
        if (!cancelled && err.name !== "AbortError") {
          console.error("Payout estimate error:", err);
        }
      } finally {
        if (!cancelled) setPayoutLoading(false);
      }
    };

    // Small debounce so we don't fire a request on every keystroke.
    const timer = setTimeout(loadPayout, 350);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [crop, quantity]);

  // --------------------------------------------------
  // INITIAL LOAD
  // --------------------------------------------------

  useEffect(() => {
    loadCentres();
    loadRecommendation();
  }, []);

  // --------------------------------------------------
// LIVE APPOINTMENT STATUS
// --------------------------------------------------

useEffect(() => {
  if (!appointment?.id) return;

  setStatusHistory([]);

  const checkAppointmentStatus = async () => {
    try {
      const response = await fetch(
        `${API_URL}/appointments`
      );

      if (!response.ok) return;

      const appointments = await response.json();

      const updatedAppointment = appointments.find(
        (item) => item.id === appointment.id
      );

      // Refresh centre data (queue, capacity, status, estimated wait)
      // on every poll so congestion/wait time stay live too.
      loadCentres();

      if (updatedAppointment) {
        const newStatus = updatedAppointment.status;

        // Record status history with a real timestamp, but only when
        // the status actually changes (so we don't add a duplicate
        // entry on every 3-second poll).
        setStatusHistory((prev) => {
          const lastEntry = prev[prev.length - 1];
          if (lastEntry && lastEntry.status === newStatus) {
            return prev;
          }
          return [...prev, { status: newStatus, timestamp: Date.now() }];
        });

        // Queue position = how many still-active appointments at this
        // centre (BOOKED / IN_QUEUE / PROCESSING) were booked before or
        // at the same time as this one, using appointment id as the
        // booking order (ids increase in booking order).
        const activeStatuses = ["BOOKED", "IN_QUEUE", "PROCESSING"];

        if (activeStatuses.includes(newStatus)) {
          const todayDateString = getTodayDateString();

          const position = appointments.filter(
            (item) =>
              item.centre_id === updatedAppointment.centre_id &&
              item.date === todayDateString &&
              activeStatuses.includes(item.status) &&
              item.id <= updatedAppointment.id
          ).length;

          setQueuePosition(position);
        } else {
          setQueuePosition(null);
        }

        if (lastStatus !== null && newStatus !== lastStatus) {
          showNotification(newStatus);

          const voiceMessages = {
            IN_QUEUE: {
              "en-IN": "You are now in the procurement queue.",
              "te-IN": "మీరు ఇప్పుడు ప్రొక్యూర్‌మెంట్ క్యూ లో ఉన్నారు.",
              "hi-IN": "आप अब खरीद कतार में हैं।",
            },
            PROCESSING: {
              "en-IN": "Your crop is now being processed.",
              "te-IN": "మీ పంటను ఇప్పుడు ప్రాసెస్ చేస్తున్నారు.",
              "hi-IN": "आपकी फसल की प्रोसेसिंग शुरू हो गई है।",
            },
            COMPLETED: {
              "en-IN": "Your procurement process is completed.",
              "te-IN": "మీ ప్రొక్యూర్‌మెంట్ ప్రక్రియ పూర్తయింది.",
              "hi-IN": "आपकी खरीद प्रक्रिया पूरी हो गई है।",
            },
          };

          const message = voiceMessages[newStatus]?.[language];
          if (message) speak(message);
        }

        setLastStatus(newStatus);
        setAppointment((previous) => ({
          ...previous,
          status: newStatus,
        }));
      }

    } catch (error) {
      console.error(
        "Failed to update appointment status:",
        error
      );
    }
  };

  // Check immediately
  checkAppointmentStatus();

  // Check every 3 seconds
  const interval = setInterval(
    checkAppointmentStatus,
    3000
  );

  return () => clearInterval(interval);

}, [appointment?.id]);

  // --------------------------------------------------
  // OPEN BOOKING
  // --------------------------------------------------

  const handleBooking = (centre) => {
    setBookingCentre(centre);
    setBookingError("");
    setAppointment(null);
    setNotification(null);
    setLastStatus(null);

    // Reset booking form
    setBookingDate("");
    setBookingTime("");
  };

  // --------------------------------------------------
  // CLOSE BOOKING
  // --------------------------------------------------

  const closeBooking = () => {
    setBookingCentre(null);
    setBookingError("");
    setNotification(null);
  };

    const findAlternativeCentres = (centre) => {
    const cropLower = crop.trim().toLowerCase();

    const alternatives = centres
      .filter(
        (c) =>
          c.id !== centre.id &&
          c.status !== "FULL"
      )
      .map((c) => {
        const distanceKm = farmerVillage.trim()
          ? getApproxDistanceKm(
              farmerVillage,
              c.location
            )
          : null;

        const cropMatch =
          cropLower.length > 0 &&
          c.name.toLowerCase().includes(cropLower);

        return {
          ...c,
          distanceKm,
          cropMatch,
        };
      })
      .sort((a, b) => {
        // Crop-compatible centres first
        if (a.cropMatch !== b.cropMatch) {
          return a.cropMatch ? -1 : 1;
        }

        // Then lower waiting time
        if (
          a.estimated_wait !==
          b.estimated_wait
        ) {
          return (
            a.estimated_wait -
            b.estimated_wait
          );
        }

        // Then shorter distance
        if (
          a.distanceKm !== null &&
          b.distanceKm !== null
        ) {
          return (
            a.distanceKm -
            b.distanceKm
          );
        }

        return 0;
      })
      .slice(0, 3);

    setAlternativesSourceCentre(centre);
    setAlternativeCentres(alternatives);
  };


  // --------------------------------------------------
  // CREATE FARMER
  // --------------------------------------------------

  const createFarmer = async () => {
    const response = await fetch(`${API_URL}/farmers`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        name: farmerName,
        phone: farmerPhone,
        village: farmerVillage,
        crop: crop,
        quantity: Number(quantity),
      }),
    });

   if (!response.ok) {
  const errorData = await response.json();

  console.error("CREATE FARMER ERROR:", errorData);

  if (Array.isArray(errorData.detail)) {
    const messages = errorData.detail
      .map((error) => {
        if (typeof error === "object") {
          return error.msg || JSON.stringify(error);
        }

        return String(error);
      })
      .join(", ");

    throw new Error(messages);
  }

  throw new Error(
    errorData.detail || "Failed to create farmer"
  );
}

        return await response.json();
  };

  // --------------------------------------------------
  // UPDATE FARMER
  // --------------------------------------------------
  // Used for authenticated bookings: keeps the logged-in farmer's
  // profile (crop/quantity/etc.) in sync with what they're booking,
  // WITHOUT creating a second farmer record.

  const updateFarmerRecord = async (farmerId) => {
    const response = await fetch(`${API_URL}/farmers/${farmerId}`, {
      method: "PUT",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        name: farmerName,
        phone: farmerPhone,
        village: farmerVillage,
        crop: crop,
        quantity: Number(quantity),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();

      console.error("UPDATE FARMER ERROR:", errorData);

      if (Array.isArray(errorData.detail)) {
        const messages = errorData.detail
          .map((error) => {
            if (typeof error === "object") {
              return error.msg || JSON.stringify(error);
            }

            return String(error);
          })
          .join(", ");

        throw new Error(messages);
      }

      throw new Error(
        errorData.detail || "Failed to update farmer"
      );
    }

    return await response.json();
  };

  // --------------------------------------------------
  // CREATE APPOINTMENT
  // --------------------------------------------------

  const createAppointment = async (farmerId) => {
    const response = await fetch(
      `${API_URL}/appointments`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          farmer_id: farmerId,
          centre_id: bookingCentre.id,
          appointment_date: bookingDate,
          appointment_time: bookingTime,
        }),
      }
    );

    if (!response.ok) {
  const errorData = await response.json();

  console.error("CREATE APPOINTMENT ERROR:", errorData);

  if (Array.isArray(errorData.detail)) {
    const messages = errorData.detail
      .map((error) => {
        if (typeof error === "object") {
          return error.msg || JSON.stringify(error);
        }

        return String(error);
      })
      .join(", ");

    throw new Error(messages);
  }

  throw new Error(
    errorData.detail || "Failed to create appointment"
  );
}

    return await response.json();
  };
 
  // --------------------------------------------------
  // CHECK SLOT AVAILABILITY
  // --------------------------------------------------
  useEffect(() => {
    if (!bookingCentre || !bookingDate) {
      setBookedSlots([]);
      return;
    }

    const loadBookedSlots = async () => {
      try {
        setSlotsLoading(true);

        const response = await fetch(`${API_URL}/appointments`);
        if (!response.ok) return;

        const appointments = await response.json();

        const slotCounts = {};

        appointments
          .filter(
            (item) =>
              item.centre_id === bookingCentre.id &&
              item.date === bookingDate &&
              item.status !== "CANCELLED"
          )
          .forEach((item) => {
            slotCounts[item.time_slot] =
              (slotCounts[item.time_slot] || 0) + 1;
          });

        const full = Object.keys(slotCounts).filter(
          (slot) => slotCounts[slot] >= SLOT_CAPACITY
        );

        setBookedSlots(full);

        if (full.includes(bookingTime)) {
          setBookingTime("");
        }
      } catch (err) {
        console.error("Failed to load slot availability:", err);
      } finally {
        setSlotsLoading(false);
      }
    };

    loadBookedSlots();
  }, [bookingCentre, bookingDate]);

  //---------------------------------------------------
  //RESCHEDULE SLOT AVAILABILITY
  //---------------------------------------------------

  useEffect(() => {
  if (!rescheduleCentreId || !rescheduleDate) {
    setRescheduleBookedSlots([]);
    return;
  }

  const loadRescheduleSlots = async () => {
    try {
      setRescheduleSlotsLoading(true);

      const response = await fetch(`${API_URL}/appointments`);

      if (!response.ok) return;

      const appointments = await response.json();

      const slotCounts = {};

      appointments
        .filter(
          (item) =>
            item.id !== appointment?.id &&
            item.centre_id === Number(rescheduleCentreId) &&
            item.date === rescheduleDate &&
            item.status !== "CANCELLED"
        )
        .forEach((item) => {
          slotCounts[item.time_slot] =
            (slotCounts[item.time_slot] || 0) + 1;
        });

      const full = Object.keys(slotCounts).filter(
        (slot) => slotCounts[slot] >= SLOT_CAPACITY
      );

      setRescheduleBookedSlots(full);

      if (full.includes(rescheduleTime)) {
        setRescheduleTime("");
      }
    } catch (err) {
      console.error(
        "Failed to load reschedule slot availability:",
        err
      );
    } finally {
      setRescheduleSlotsLoading(false);
    }
  };

  loadRescheduleSlots();
}, [rescheduleCentreId, rescheduleDate, appointment?.id]);

  // --------------------------------------------------
  // BOOK SLOT
  // --------------------------------------------------

    const handleConfirmBooking = async () => {
    if (bookingInProgressRef.current) {
      return;
    }
    bookingInProgressRef.current = true;

    try {
      setBookingLoading(true);
      setBookingError("");

      // Validation
      if (!farmerName.trim()) {
        throw new Error("Please enter your name.");
      }

      if (!farmerPhone.trim()) {
        throw new Error("Please enter your phone number.");
      }

      if (!farmerVillage.trim()) {
        throw new Error("Please enter your village.");
      }

      if (!quantity || Number(quantity) <= 0) {
        throw new Error("Please enter a valid quantity.");
      }

      if (!bookingDate) {
        throw new Error("Please select a date.");
      }

      if (!bookingTime) {
        throw new Error("Please select a time.");
      }

      const todayDateString = getTodayDateString();

      if (bookingDate < todayDateString) {
        throw new Error(
          "You cannot book a past date. Please choose today or a future date."
        );
      }

      if (
        bookingDate === todayDateString &&
        getSlotMinutes(bookingTime) <=
          new Date().getHours() * 60 + new Date().getMinutes()
      ) {
        throw new Error(
          "This slot's time has already passed today. Please choose a later slot or another date."
        );
      }

      // STEP 12: Preserve the booking when the network is unavailable.

      if (getNetworkStatus() === "offline") {
        const pendingBooking = {
          localId: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
          farmerId: farmerSession.id,
          farmer: {
            name: farmerName,
            phone: farmerPhone,
            village: farmerVillage,
            crop,
            quantity: Number(quantity),
          },
          appointment: {
            centre_id: bookingCentre.id,
            appointment_date: bookingDate,
            appointment_time: bookingTime,
          },
          centreName: bookingCentre.name,
          location: bookingCentre.location,
        };

        addPendingBooking(pendingBooking);

        setNotification({
          icon: "📡",
          title: "Booking Saved Offline",
          message: "Your booking is saved on this device and will sync when internet returns.",
        });

        setBookingError("");
        speak(
          language === "te-IN"
            ? "ఇంటర్నెట్ లేదు. మీ బుకింగ్ ఈ పరికరంలో సేవ్ చేయబడింది."
            : language === "hi-IN"
              ? "इंटरनेट नहीं है। आपकी बुकिंग इस डिवाइस पर सेव कर दी गई है।"
              : "Internet is unavailable. Your booking has been saved on this device."
        );

        return;
      }

      // Step 1: Keep the authenticated farmer's profile in sync with
      // this booking (does NOT create a new farmer record).
      const farmer = await updateFarmerRecord(farmerSession.id);

      // Step 2: Create appointment using the authenticated farmer's
      // existing database ID.
      const newAppointment =
        await createAppointment(farmerSession.id);

      setAppointment({
        ...newAppointment,
        farmer_name: farmer.name,
        crop: farmer.crop,
        quantity: farmer.quantity,
        centre_name: bookingCentre.name,
        location: bookingCentre.location,
      });

      const initialStatus = newAppointment.status || "BOOKED";
      setLastStatus(initialStatus);
      showNotification(initialStatus);
      speak(language === "te-IN"
        ? "మీ ప్రొక్యూర్‌మెంట్ స్లాట్ విజయవంతంగా బుక్ చేయబడింది."
        : language === "hi-IN"
          ? "आपका खरीद स्लॉट सफलतापूर्वक बुक हो गया है।"
          : "Your procurement slot has been booked successfully.");

        } catch (err) {
      console.error(err);

      setBookingError(
        err.message || "Booking failed. Please try again."
      );
    } finally {
      setBookingLoading(false);
      bookingInProgressRef.current = false;
    }
  };

  // --------------------------------------------------
  // FARMER AUTHENTICATION
  // --------------------------------------------------

  const FARMER_SESSION_KEY = "kisanflow_farmer_session";

  const [farmerSession, setFarmerSession] = useState(() => {
    const saved = sessionStorage.getItem(FARMER_SESSION_KEY);
    return saved ? JSON.parse(saved) : null;
  });

  const [authMode, setAuthMode] = useState("login");
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regVillage, setRegVillage] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: loginPhone.trim(),
          password: loginPassword.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Login failed.");
      }

      const farmer = await response.json();

      sessionStorage.setItem(FARMER_SESSION_KEY, JSON.stringify(farmer));
      setFarmerSession(farmer);
      setLoginPhone("");
      setLoginPassword("");
    } catch (err) {
      setAuthError(err.message || "Unable to log in.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: regName.trim(),
          phone: regPhone.trim(),
          village: regVillage.trim(),
          password: regPassword.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Registration failed.");
      }

      const farmer = await response.json();

      sessionStorage.setItem(FARMER_SESSION_KEY, JSON.stringify(farmer));
      setFarmerSession(farmer);
      setRegName("");
      setRegPhone("");
      setRegVillage("");
      setRegPassword("");
    } catch (err) {
      setAuthError(err.message || "Unable to register.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem(FARMER_SESSION_KEY);
    setFarmerSession(null);
  };

  // --------------------------------------------------
  // LOAD FULL PROFILE (name/phone/village/crop/quantity)
  // FROM THE BACKEND WHENEVER THE FARMER IS LOGGED IN
  // --------------------------------------------------

  useEffect(() => {
    if (!farmerSession?.id) return;

    const loadFullProfile = async () => {
      try {
        const response = await fetch(`${API_URL}/farmers/${farmerSession.id}`);
        if (!response.ok) return;

        const data = await response.json();

        setFarmerName(data.name || "");
        setFarmerPhone(data.phone || "");
        setFarmerVillage(data.village || "");
        if (data.crop) setCrop(data.crop);
        if (data.quantity) setQuantity(String(data.quantity));
      } catch (err) {
        console.error("Failed to load farmer profile:", err);
      }
    };

    loadFullProfile();
  }, [farmerSession?.id]);

  // --------------------------------------------------
  // LOAD EXISTING APPOINTMENT ON LOGIN / PAGE REFRESH
  // --------------------------------------------------
  // The appointment state is otherwise only ever set in memory at
  // booking time, so a fresh page load (or logging back in) would
  // show no "Current Appointment" card even though the backend
  // already has one. This loads it from the existing /appointments
  // API so the dashboard overview keeps showing it after a refresh.

  useEffect(() => {
    if (!farmerSession?.id) return;

    const loadExistingAppointment = async () => {
      try {
        const response = await fetch(`${API_URL}/appointments`);
        if (!response.ok) return;

        const appointments = await response.json();

        const farmerAppointments = appointments.filter(
          (item) => item.farmer_id === farmerSession.id
        );

        if (farmerAppointments.length === 0) return;

        // Most recently booked appointment for this farmer (ids
        // increase in booking order) is treated as the current one.
        const latestAppointment = farmerAppointments.reduce(
          (latest, item) => (item.id > latest.id ? item : latest)
        );

        setAppointment(latestAppointment);
        setLastStatus(latestAppointment.status);
      } catch (err) {
        console.error("Failed to load existing appointment:", err);
      }
    };

    loadExistingAppointment();
  }, [farmerSession?.id]);

  useEffect(() => {
  setRescheduleDismissed(false);
  setSwitchError("");
  }, [appointment?.id, appointment?.centre_id]);

  // --------------------------------------------------
  // FARMER PROFILE - SAVE CHANGES
  // --------------------------------------------------

  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");

  const handleSaveProfile = async () => {
    try {
      setProfileError("");
      setProfileSuccess("");
      setProfileSaving(true);

      if (!farmerName.trim()) {
        throw new Error("Please enter your name.");
      }

      if (!farmerPhone.trim()) {
        throw new Error("Please enter your phone number.");
      }

      if (!farmerVillage.trim()) {
        throw new Error("Please enter your village.");
      }

      if (!quantity || Number(quantity) <= 0) {
        throw new Error("Please enter a valid quantity.");
      }

      const updatedFarmer = await updateFarmerRecord(farmerSession.id);

      const updatedSession = {
        ...farmerSession,
        name: updatedFarmer.name,
        phone: updatedFarmer.phone,
        village: updatedFarmer.village,
      };

      sessionStorage.setItem(
        FARMER_SESSION_KEY,
        JSON.stringify(updatedSession)
      );
      setFarmerSession(updatedSession);

      setProfileSuccess("Profile updated successfully.");
    } catch (err) {
      setProfileError(err.message || "Failed to update profile.");
    } finally {
      setProfileSaving(false);
    }
  };

  // --------------------------------------------------
  // FARMER-ONLY PAGE PROTECTION
  // --------------------------------------------------

  if (!farmerSession) {
    return (
      <div className="farmer-dashboard">
        <div className="admin-gate">
          <div className="admin-gate-icon">🔐</div>

          <h2>
            {authMode === "login" ? "Farmer Login" : "Farmer Registration"}
          </h2>

          <p>
            {authMode === "login"
              ? "Log in with your phone number and password to book a procurement slot."
              : "Register with your phone number to create a farmer account."}
          </p>

          {authMode === "login" ? (
            <form onSubmit={handleLogin}>
              <input
                type="tel"
                placeholder="Phone number"
                value={loginPhone}
                onChange={(e) => setLoginPhone(e.target.value)}
                autoFocus
                required
              />

              <input
                type="password"
                placeholder="Password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />

              {authError && (
                <p className="admin-gate-error">{authError}</p>
              )}

              <button type="submit" disabled={authLoading}>
                {authLoading ? "Logging in..." : "Log In"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister}>
              <input
                type="text"
                placeholder="Full name"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                autoFocus
                required
              />

              <input
                type="tel"
                placeholder="Phone number"
                value={regPhone}
                onChange={(e) => setRegPhone(e.target.value)}
                required
              />

              <input
                type="text"
                placeholder="Village"
                value={regVillage}
                onChange={(e) => setRegVillage(e.target.value)}
                required
              />

              <input
                type="password"
                placeholder="Create a password"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                required
              />

              {authError && (
                <p className="admin-gate-error">{authError}</p>
              )}

              <button type="submit" disabled={authLoading}>
                {authLoading ? "Registering..." : "Register"}
              </button>
            </form>
          )}

          <p className="admin-gate-hint">
            {authMode === "login" ? (
              <>
                New farmer?{" "}
                <button
                  type="button"
                  className="auth-toggle"
                  onClick={() => {
                    setAuthMode("register");
                    setAuthError("");
                  }}
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already registered?{" "}
                <button
                  type="button"
                  className="auth-toggle"
                  onClick={() => {
                    setAuthMode("login");
                    setAuthError("");
                  }}
                >
                  Log in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // LOADING
  // --------------------------------------------------

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="loading-icon">🌾</div>

        <h2>
          Loading procurement centres...
        </h2>

        <p>
          Fetching the latest centre information.
        </p>
      </div>
        );
  }

  // --------------------------------------------------
  // CURRENT APPOINTMENT OVERVIEW (derived, not stored)
  // --------------------------------------------------
  // The card is shown whenever a farmer has an appointment at all, so
  // a CANCELLED one can still show its CANCELLED status/reason/time.
  // isCancelled is used further down to stop treating it as an active
  // BOOKED / IN_QUEUE / PROCESSING appointment (no queue position, no
  // wait time, no congestion, no processing message for it).
  const hasCurrentAppointment = Boolean(appointment);
  const isCancelled = appointment?.status === "CANCELLED";

  // Live centre record for the appointment (queue/capacity/status/
  // estimated_wait all come from the existing /centres data).
  const overviewCentre = hasCurrentAppointment
    ? centres.find((centre) => centre.id === appointment.centre_id)
    : null;

  const overviewCongestionPercent = overviewCentre
    ? Math.min(
        Math.round(
          (overviewCentre.current_queue / (overviewCentre.capacity || 1)) *
            100
        ),
        100
      )
    : 0;

  // Real cancellation timestamp captured by the existing status-history
  // tracking (Section 12), at the moment CANCELLED was first observed
  // via the existing 3-second polling — not invented.
  const cancelledHistoryEntry = statusHistory.find(
    (entry) => entry.status === "CANCELLED"
  );

    // ============================================================
  // RESCHEDULING SUGGESTION (Task 32)
  // ============================================================

  let rescheduleSuggestion = null;

  if (hasCurrentAppointment && !isCancelled && overviewCentre) {
    const cropLower = crop.trim().toLowerCase();

    const candidateCentres = centres
      .filter(
        (c) => c.id !== overviewCentre.id && c.status !== "FULL"
      )
      .map((c) => {
        const distanceKm = farmerVillage.trim()
          ? getApproxDistanceKm(farmerVillage, c.location)
          : null;

        const cropMatch =
          cropLower.length > 0 &&
          c.name.toLowerCase().includes(cropLower);

        return { ...c, distanceKm, cropMatch };
      })
      .sort((a, b) => {
        if (a.cropMatch !== b.cropMatch) {
          return a.cropMatch ? -1 : 1;
        }

        if (a.estimated_wait !== b.estimated_wait) {
          return a.estimated_wait - b.estimated_wait;
        }

        if (a.distanceKm !== null && b.distanceKm !== null) {
          return a.distanceKm - b.distanceKm;
        }

        return 0;
      });

    const bestCandidate = candidateCentres[0];

    if (
      bestCandidate &&
      bestCandidate.estimated_wait < overviewCentre.estimated_wait
    ) {
      rescheduleSuggestion = bestCandidate;
    }
  }

  const handleSwitchCentre = async (newCentre) => {
    if (!appointment?.id) return;

    setSwitchingCentre(true);
    setSwitchError("");

    try {
      const response = await fetch(
        `${API_URL}/appointments/${appointment.id}/centre`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            centre_id: newCentre.id,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Could not switch procurement centre."
        );
      }

      setAppointment(data);

      setNotification({
        icon: "🔁",
        title: "Centre switched",
        message: `Your booking has been moved to ${newCentre.name}.`,
      });
    } catch (err) {
      setSwitchError(err.message);
    } finally {
      setSwitchingCentre(false);
    }
  };

  const handleKeepCurrentBooking = () => {
    setRescheduleDismissed(true);
  };

  const openRescheduleForm = () => {
  if (!appointment) return;

  setRescheduleCentreId(String(appointment.centre_id));
  setRescheduleDate(appointment.date);
  setRescheduleTime(appointment.time_slot);
  setRescheduleError("");
  setShowRescheduleForm(true);
};

const closeRescheduleForm = () => {
  setShowRescheduleForm(false);
  setRescheduleError("");
};

const handleRescheduleSubmit = async () => {
  if (!appointment?.id) return;

  if (!rescheduleCentreId) {
    setRescheduleError("Please select a procurement centre.");
    return;
  }

  if (!rescheduleDate) {
    setRescheduleError("Please select a date.");
    return;
  }

  if (!rescheduleTime) {
    setRescheduleError("Please select a time slot.");
    return;
  }

  setRescheduleLoading(true);
  setRescheduleError("");

  try {
    const response = await fetch(
      `${API_URL}/appointments/${appointment.id}/reschedule`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          centre_id: Number(rescheduleCentreId),
          appointment_date: rescheduleDate,
          appointment_time: rescheduleTime,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.detail || "Could not reschedule this appointment."
      );
    }

    setAppointment(data);
    setShowRescheduleForm(false);

    setNotification({
      icon: "🔄",
      title: "Appointment rescheduled",
      message:
        "Your booking has been updated with the new centre, date and time.",
    });
  } catch (err) {
    setRescheduleError(err.message);
  } finally {
    setRescheduleLoading(false);
  }
};

  

  return (
    <div className="farmer-dashboard">

      {notification && (
        <div className="farmer-notification">
          <div className="notification-icon">{notification.icon}</div>
          <div className="notification-content">
            <strong>{notification.title}</strong>
            <p>{notification.message}</p>
          </div>
          <button className="notification-close" onClick={() => setNotification(null)}>✕</button>
        </div>
      )}

      {/* STEP 12 - NETWORK STATUS */}
      <div className={`network-banner ${networkStatus}`}>
        <div className="network-status-main">
          <span className="network-dot" />
          <strong>
            {networkStatus === "online"
              ? "Online"
              : networkStatus === "poor"
                ? "Poor Network"
                : "Offline Mode"}
          </strong>
          <span>
            {networkStatus === "online"
              ? "Live procurement data available"
              : networkStatus === "poor"
                ? "Connection is slow; saved data is available"
                : "Using saved centre data. Bookings will sync automatically."}
          </span>
        </div>

        <div className="network-actions">
          {pendingBookings.length > 0 && (
            <button
              type="button"
              className="sync-button"
              onClick={syncPendingBookings}
              disabled={syncingBookings || networkStatus === "offline"}
            >
              {syncingBookings
                ? "⏳ Syncing..."
                : `🔄 Sync ${pendingBookings.length} Pending`}
            </button>
          )}

          {lastCentreSync && (
            <small>
              Last centre sync: {new Date(lastCentreSync).toLocaleTimeString()}
            </small>
          )}
        </div>
      </div>

      {/* HEADER */}

      <div className="dashboard-header">

        <div>

          <p className="eyebrow">
            KISANFLOW
          </p>

          <h1>
            Smart Procurement
            <br />
            Coordination
          </h1>

          <p className="subtitle">
            Find the best procurement centre,
            avoid long queues and save time.
          </p>

        </div>

                <div className="farmer-header-actions">
          <div className="farmer-session-info">
            <span>👋 {farmerSession.name}</span>

            <button
              type="button"
              className="logout-button"
              onClick={handleLogout}
            >
              🚪 Logout
            </button>
          </div>

          <div className="farmer-icon">
            👨‍🌾
          </div>
        </div>

      </div>


      {/* FARMER PROFILE */}

      <div className="farmer-input-card">

        <div className="section-title">

          <span>👤</span>

          <div>

            <h2>
              Farmer Profile
            </h2>

            <p>
              View and update your saved details.
            </p>

          </div>

        </div>

        <div className="input-grid">

          <div className="input-group">
            <label>Full Name</label>
            <input
              type="text"
              value={farmerName}
              onChange={(e) => setFarmerName(e.target.value)}
            />
          </div>

          <div className="input-group">
            <label>Phone Number</label>
            <input
              type="tel"
              value={farmerPhone}
              onChange={(e) => setFarmerPhone(e.target.value)}
            />
          </div>

          <div className="input-group">
            <label>Village</label>
            <input
              type="text"
              value={farmerVillage}
              onChange={(e) => setFarmerVillage(e.target.value)}
            />
          </div>

          <div className="input-group">
            <label>Crop</label>
            <select
              value={crop}
              onChange={(e) => setCrop(e.target.value)}
            >
              <option>Paddy</option>
              <option>Wheat</option>
              <option>Cotton</option>
              <option>Maize</option>
              <option>Turmeric</option>
            </select>
          </div>

          <div className="input-group">
            <label>Quantity (Quintals)</label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>

        </div>

        {profileError && (
          <div className="booking-error">
            ⚠️ {profileError}
          </div>
        )}

        {profileSuccess && (
          <div className="payout-estimate">
            ✅ {profileSuccess}
          </div>
        )}

        <button
          className="find-button"
          onClick={handleSaveProfile}
          disabled={profileSaving}
        >
          {profileSaving ? "Saving..." : "💾 Save Profile"}
        </button>

      </div>


      {hasCurrentAppointment && (
        <div className="farmer-input-card">

          <div className="section-title">
            <span>{isCancelled ? "⚠️" : "🎫"}</span>
            <div>
              <h2>
                {isCancelled
                  ? "Appointment Cancelled"
                  : "Your Current Appointment"}
              </h2>
              <p>
                {isCancelled
                  ? "This appointment is no longer active."
                  : "Live status for your booked procurement slot."}
              </p>
            </div>
          </div>

          <div className="booking-info">

            <div>
              ✅ Booking confirmation:{" "}
              <strong>
                {appointment.status === "CANCELLED"
                  ? "Cancelled"
                  : "Confirmed"}
              </strong>
            </div>

            <div>
              🎟️ Appointment ID:{" "}
              <strong>#{appointment.id}</strong>
            </div>

            <div>
              🏢 Centre:{" "}
              <strong>{overviewCentre?.name || appointment.centre_name || "—"}</strong>
            </div>

            <div>
              📅 Date: <strong>{appointment.date}</strong>
            </div>

            <div>
              🕐 Time: <strong>{appointment.time_slot}</strong>
            </div>

            <div>
              📦 Quantity:{" "}
              <strong>
                {appointment.quantity ?? quantity} quintals
              </strong>
            </div>

            <div>
              📌 Status:{" "}
              <span
                className={
                  appointment.status === "CANCELLED"
                    ? "appointment-status status-cancelled"
                    : "appointment-status"
                }
              >
                {appointment.status || "BOOKED"}
              </span>
            </div>

            <div>
              📌 Status:{" "}
              <span
                className={
                  appointment.status === "CANCELLED"
                    ? "appointment-status status-cancelled"
                    : "appointment-status"
                }
              >
                {appointment.status || "BOOKED"}
              </span>
            </div>

            {isCancelled && (
              <>
                {appointment.cancellation_reason && (
                  <div>
                    📝 Cancellation reason:{" "}
                    <strong>{appointment.cancellation_reason}</strong>
                  </div>
                )}

                {cancelledHistoryEntry && (
                  <div>
                    🕓 Cancelled at:{" "}
                    <strong>
                      {new Date(
                        cancelledHistoryEntry.timestamp
                      ).toLocaleString()}
                    </strong>
                  </div>
                )}
              </>
            )}

            {!isCancelled && (
              <>
                <div>
                  👥{" "}
                  <strong>
                    {queuePosition !== null
                      ? `You are #${queuePosition} in queue`
                      : "Not currently in queue"}
                  </strong>
                </div>

                <div>
                  ⏱️ Estimated wait:{" "}
                  <strong>
                    {overviewCentre
                      ? `${overviewCentre.estimated_wait} minutes`
                      : "Unavailable"}
                  </strong>
                </div>

                <div>
                  🚦 Centre congestion:{" "}
                  {overviewCentre ? (
                    <span
                      className={
                        overviewCentre.status === "FULL"
                          ? "status-full"
                          : overviewCentre.status === "BUSY"
                          ? "status-busy"
                          : "status-open"
                      }
                    >
                      {overviewCentre.status} ({overviewCongestionPercent}%
                      of capacity)
                    </span>
                  ) : (
                    "Unavailable"
                  )}
                </div>

                {appointment.status === "PROCESSING" && (
                  <div className="payout-estimate">
                    🔄 Your crop is currently being processed at the
                    centre.
                  </div>
                )}
              </>
            )}

            {statusHistory.length > 0 && (
              <div>
                <strong>Status history:</strong>
                <ul>
                  {statusHistory.map((entry, index) => (
                    <li key={`${entry.status}-${entry.timestamp}-${index}`}>
                      {entry.status} —{" "}
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </li>
                  ))}
                </ul>
              </div>
            )}

          </div>

        {/* RESCHEDULING SUGGESTION (Task 32) */}

        {rescheduleSuggestion && !rescheduleDismissed && (
          <div className="congestion-warning">

            <p>
              💡 A faster procurement centre is available for your
              booking.
            </p>

            <div className="booking-info">

              <div>
                🏢 Current centre:{" "}
                <strong>{overviewCentre.name}</strong>
              </div>

              <div>
                ⏱️ Current ETA:{" "}
                <strong>
                  {overviewCentre.estimated_wait} minutes
                </strong>
              </div>

              <div>
                🏢 Alternative centre:{" "}
                <strong>{rescheduleSuggestion.name}</strong>
              </div>

              <div>
                ⏱️ Alternative ETA:{" "}
                <strong>
                  {rescheduleSuggestion.estimated_wait} minutes
                </strong>
              </div>

              <div>
                📍 Distance to alternative:{" "}
                <strong>
                  {rescheduleSuggestion.distanceKm !== null
                    ? `${rescheduleSuggestion.distanceKm} km`
                    : "Unknown"}
                </strong>
              </div>

            </div>

            {switchError && (
              <div className="booking-error">
                {switchError}
              </div>
            )}

            <div className="network-actions">

              <button
                type="button"
                className="find-button"
                disabled={switchingCentre}
                onClick={() =>
                  handleSwitchCentre(rescheduleSuggestion)
                }
              >
                {switchingCentre
                  ? "⏳ Switching..."
                  : `🔁 Switch to ${rescheduleSuggestion.name}`}
              </button>

              <button
                type="button"
                className="cancel-button"
                disabled={switchingCentre}
                onClick={handleKeepCurrentBooking}
              >
                ✅ Keep Current Booking
              </button>

           </div>

          </div>
        )}

        </div>
      )}

      {/* RESCHEDULE APPOINTMENT (Task 33) */}

      {hasCurrentAppointment && !isCancelled && (
        <div className="farmer-input-card">

          <div className="section-title">

            <span>🔄</span>

            <div>
              <h2>Reschedule Appointment</h2>

              <p>
                Change the centre, date, or time for your booking.
              </p>
            </div>

          </div>

          {!showRescheduleForm ? (

            <button
              type="button"
              className="find-button"
              onClick={openRescheduleForm}
            >
              🔄 Reschedule Appointment
            </button>

          ) : (

            <>

              <div className="booking-form">

                <select
                  value={rescheduleCentreId}
                  onChange={(e) =>
                    setRescheduleCentreId(e.target.value)
                  }
                >

                  {centres.map((centre) => (

                    <option
                      key={centre.id}
                      value={centre.id}
                      disabled={
                        centre.status === "FULL" &&
                        String(centre.id) !== rescheduleCentreId
                      }
                    >
                      {centre.name}
                      {centre.status === "FULL"
                        ? " (FULL)"
                        : ""}
                    </option>

                  ))}

                </select>

                <input
                  type="date"
                  value={rescheduleDate}
                  min={getTodayDateString()}
                  onChange={(e) =>
                    setRescheduleDate(e.target.value)
                  }
                />

                <div className="slot-grid">

                  {TIME_SLOTS.map((slot) => {

                    const isTaken =
                      rescheduleBookedSlots.includes(slot);

                    const isSelected =
                      rescheduleTime === slot;

                    return (
                      <button
                        type="button"
                        key={slot}
                        className={
                          isSelected
                            ? "slot-button selected"
                            : "slot-button"
                        }
                        disabled={isTaken}
                        onClick={() =>
                          setRescheduleTime(slot)
                        }
                      >
                        {slot}
                        {isTaken ? " (Full)" : ""}
                      </button>
                    );

                  })}

                </div>

                {rescheduleCentreId &&
                  rescheduleDate &&
                  !rescheduleSlotsLoading && (

                    <p className="slot-hint">
                      {rescheduleBookedSlots.length > 0
                        ? "Greyed-out slots have reached their maximum bookings for this date."
                        : "All slots are currently available for this date."}
                    </p>

                  )}

              </div>

              {rescheduleError && (
                <div className="booking-error">
                  ⚠️ {rescheduleError}
                </div>
              )}

              <div className="network-actions">

                <button
                  type="button"
                  className="confirm-button"
                  disabled={rescheduleLoading}
                  onClick={handleRescheduleSubmit}
                >
                  {rescheduleLoading
                    ? "⏳ Rescheduling..."
                    : "✅ Confirm Reschedule"}
                </button>

                <button
                  type="button"
                  className="cancel-button"
                  disabled={rescheduleLoading}
                  onClick={closeRescheduleForm}
                >
                  ✕ Cancel
                </button>

              </div>

            </>

          )}

        </div>
      )}

      {/* FARMER INPUT */}

      <div className="farmer-input-card">

        <div className="section-title">

          <span>🌾</span>

          <div>

            <h2>
              Your Crop Details
            </h2>

            <p>
              Tell us what you want to procure.
            </p>

          </div>

        </div>


        <div className="voice-controls">
          <div className="language-selector">
            <label>🌐 Language</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="en-IN">English</option>
              <option value="te-IN">తెలుగు</option>
              <option value="hi-IN">हिन्दी</option>
            </select>
          </div>

          <button
            type="button"
            className={`voice-button ${isListening ? "listening" : ""}`}
            onClick={startVoiceInput}
            disabled={!voiceSupported || isListening}
          >
            {isListening ? `🎙️ ${t.listening}` : "🎤 Speak Crop & Quantity"}
          </button>

          <button type="button" className="voice-help-button" onClick={() => speak(t.help)}>
            🔊 Voice Help
          </button>
        </div>

        <div className="input-grid">

          <div className="input-group">

            <label>
              Crop
            </label>

            <select
              value={crop}
              onChange={(e) =>
                setCrop(e.target.value)
              }
            >

              <option>Paddy</option>
              <option>Wheat</option>
              <option>Cotton</option>
              <option>Maize</option>
              <option>Turmeric</option>

            </select>

          </div>


          <div className="input-group">

            <label>
              Quantity (Quintals)
            </label>

            <input
              type="number"
              placeholder="e.g. 40"
              value={quantity}
              onChange={(e) =>
                setQuantity(e.target.value)
              }
            />

          </div>

        </div>


        <button
          className="find-button"
          onClick={loadRecommendation}
        >
          🤖 Find Best Procurement Centre
        </button>

        {/* ESTIMATED PAYOUT (Government MSP based) */}
        {payoutEstimate && (
          <div
            className={`payout-estimate ${
              payoutEstimate.has_msp ? "" : "payout-estimate-no-msp"
            }`}
          >
            {payoutEstimate.has_msp ? (
              <>
                <div className="payout-estimate-main">
                  <span>💰 Estimated Value (Govt. MSP)</span>
                  <strong>
                    ₹{payoutEstimate.estimated_amount.toLocaleString("en-IN")}
                  </strong>
                </div>
                <small>
                  ₹{payoutEstimate.msp_rate_per_quintal.toLocaleString("en-IN")}
                  /quintal · {payoutEstimate.season} · final amount depends on
                  quality grading at the centre
                </small>
              </>
            ) : (
              <small>ℹ️ {payoutEstimate.message}</small>
            )}
          </div>
        )}
        {payoutLoading && !payoutEstimate && (
          <div className="payout-estimate payout-estimate-loading">
            <small>Calculating estimated value…</small>
          </div>
        )}

      </div>


      {/* ERROR */}

      {error && (
        <div className="error-box">
          ⚠️ {error}
        </div>
      )}


      {/* SMART RECOMMENDATION */}

      {recommendation?.recommended_centre && (

        <section className="recommendation-section">

          <div className="section-heading">

            <div>

              <p className="eyebrow">
                SMART RECOMMENDATION
              </p>

              <h2>
                ⭐ Best Centre For You
              </h2>

            </div>

            <span className="ai-badge">
              🤖 SMART
            </span>

          </div>


          <CentreCard
            centre={
              recommendation.recommended_centre
            }
            recommended={true}
            onBook={handleBooking}
            farmerVillage={farmerVillage}
            onFindAlternatives={findAlternativeCentres}
          />

        </section>

      )}


      {/* ALL CENTRES */}

      <section className="centres-section">

        <div className="section-heading">

          <div>

            <p className="eyebrow">
              LIVE PROCUREMENT CENTRES
            </p>

            <h2>
              Compare All Centres
            </h2>

          </div>

          <span className="centre-count">
            {centres.length} Centres
          </span>

        </div>


        <div className="centre-grid">

          {centres.map((centre) => {

            const isRecommended =
              recommendation?.recommended_centre?.id ===
              centre.id;

            return (

              <CentreCard
                key={centre.id}
                centre={centre}
                recommended={isRecommended}
                onBook={handleBooking}
                farmerVillage={farmerVillage}
                onFindAlternatives={findAlternativeCentres}
              />

            );

          })}

        </div>

      </section>

      {/* ALTERNATIVE CENTRES */}

      {alternativeCentres.length > 0 && (
        <section className="centres-section">

          <h2>
            🔁 Alternative Centres
          </h2>

          {alternativesSourceCentre && (
            <div className="booking-error">
              {alternativesSourceCentre.name} is currently full.
              Here are some available alternatives:
            </div>
          )}

          <div className="centre-grid">

            {alternativeCentres.map((centre) => (
              <CentreCard
                key={centre.id}
                centre={centre}
                recommended={false}
                onBook={handleBooking}
                farmerVillage={farmerVillage}
                onFindAlternatives={
                  findAlternativeCentres
                }
              />
            ))}

          </div>

        </section>
      )}


      {/* STEP 14 - SIH DEMO READINESS */}
      <section className="sih-demo-card">
        <div>
          <p className="eyebrow">SIH DEMO READY</p>
          <h2>🏆 KisanFlow Farmer Journey</h2>
          <p>
            Choose your crop → get the lowest-wait centre → book a slot →
            track live status → receive voice and in-app updates.
          </p>
        </div>

        <div className="sih-metrics">
          <div>
            <strong>Lowest Wait</strong>
            <span>Smart centre recommendation</span>
          </div>
          <div>
            <strong>Live</strong>
            <span>Appointment status tracking</span>
          </div>
          <div>
            <strong>3</strong>
            <span>Supported languages</span>
          </div>
          <div>
            <strong>Offline</strong>
            <span>Booking fallback</span>
          </div>
        </div>
      </section>

      {/* STEP 12 - PENDING BOOKING QUEUE */}
      {pendingBookings.length > 0 && (
        <section className="pending-bookings-section">
          <div>
            <p className="eyebrow">OFFLINE QUEUE</p>
            <h2>📡 Pending Bookings</h2>
            <p>
              {pendingBookings.length} booking
              {pendingBookings.length > 1 ? "s are" : " is"} waiting to sync.
            </p>
          </div>

          <div className="pending-list">
            {pendingBookings.map((item) => (
              <div className="pending-item" key={item.localId}>
                <strong>{item.farmer.name}</strong>
                <span>
                  {item.centreName} • {item.appointment.appointment_date} •{" "}
                  {item.appointment.appointment_time}
                </span>
                <span className="pending-badge">WAITING FOR SYNC</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ================================================= */}
      {/* BOOKING MODAL */}
      {/* ================================================= */}

      {bookingCentre && (

        <div className="modal-overlay">

          <div className="booking-modal">

            {!appointment ? (

              <>

                <button
                  className="close-button"
                  onClick={closeBooking}
                >
                  ✕
                </button>


                <div className="modal-icon">
                  📅
                </div>


                <h2>
                  Book Procurement Slot
                </h2>


                <p>
                  {bookingCentre.name}
                </p>


                <div className="booking-info">

                    <div>
                      📍 {bookingCentre.location}
                    </div>

                    {farmerVillage.trim() && (
                      <div>
                        🚗 Distance (approx.):{" "}
                        {getApproxDistanceKm(
                          farmerVillage,
                          bookingCentre.location
                        )}{" "}
                        km · ~
                        {getApproxTravelMinutes(
                          getApproxDistanceKm(
                            farmerVillage,
                            bookingCentre.location
                          )
                        )}{" "}
                        min
                      </div>
                    )}

                    <div>
                      👥 Queue:{" "}
                      {bookingCentre.current_queue}
                    </div>

                  <div>
                    ⏱️ Estimated wait:{" "}
                    {bookingCentre.estimated_wait ??
                      Math.ceil(
                        (bookingCentre.current_queue /
                          bookingCentre.processing_rate) *
                          60
                      )}
                    {" "}minutes
                  </div>

                  {payoutEstimate?.has_msp && (
                    <div>
                      💰 Est. value:{" "}
                      ₹{payoutEstimate.estimated_amount.toLocaleString("en-IN")}
                      {" "}(Govt. MSP)
                    </div>
                  )}

                </div>


                {/* FARMER DETAILS */}

                <div className="booking-form">

                  <h3>
                    👨‍🌾 Farmer Details
                  </h3>


                  <input
                    type="text"
                    placeholder="Full Name"
                    value={farmerName}
                    onChange={(e) =>
                      setFarmerName(e.target.value)
                    }
                  />


                  <input
                    type="tel"
                    placeholder="Phone Number"
                    value={farmerPhone}
                    onChange={(e) =>
                      setFarmerPhone(e.target.value)
                    }
                  />


                  <input
                    type="text"
                    placeholder="Village"
                    value={farmerVillage}
                    onChange={(e) =>
                      setFarmerVillage(e.target.value)
                    }
                  />


                  <h3>
                    📅 Select Slot
                  </h3>


                  <input
                    type="date"
                    value={bookingDate}
                    min={getTodayDateString()}
                    onChange={(e) =>
                      setBookingDate(e.target.value)
                    }
                  />


                  <div className="slot-grid">

                    {TIME_SLOTS.map((slot) => {
                      const isTaken = bookedSlots.includes(slot);
                      const isSelected = bookingTime === slot;

                      return (
                        <button
                          type="button"
                          key={slot}
                          className={
                            isSelected
                              ? "slot-button selected"
                              : "slot-button"
                          }
                          disabled={isTaken}
                          onClick={() => setBookingTime(slot)}
                        >
                          {slot}
                          {isTaken ? " (Full)" : ""}
                        </button>
                      );
                    })}

                  </div>

                  {bookingCentre && bookingDate && !slotsLoading && (
                    <p className="slot-hint">
                      {bookedSlots.length > 0
                        ? "Greyed-out slots have reached their maximum bookings for this date."
                        : "All slots are currently available for this date."}
                    </p>
                  )}

                </div>

                


                {/* BOOKING ERROR */}

                {bookingError && (

                  <div className="booking-error">
                    ⚠️ {bookingError}
                  </div>

                )}


                {/* CONFIRM */}

                <button
                  className="confirm-button"
                  onClick={handleConfirmBooking}
                  disabled={bookingLoading}
                >

                  {bookingLoading
                    ? "⏳ Booking..."
                    : "✅ Confirm Procurement Slot"}

                </button>

              </>

            ) : (

              /* ================================================= */
              /* SUCCESS SCREEN */
              /* ================================================= */

              <div className="booking-success">

                <div className="success-icon">
                  🎉
                </div>

                <h2>
                  Slot Booked Successfully!
                </h2>

                <p>
                  Your procurement appointment
                  has been created.
                </p>


                <div className="ticket">

                  <div className="ticket-header">
                    KISANFLOW
                  </div>


                  <div className="ticket-id">

                    Appointment ID

                    <strong>
                      #{appointment.id}
                    </strong>

                  </div>
                  <AppointmentTracker appointment={appointment} />


                  <div className="ticket-details">

                    <p>
                      👨‍🌾{" "}
                      <strong>
                        {appointment.farmer_name}
                      </strong>
                    </p>

                    <p>
                      🌾 Crop:{" "}
                      {appointment.crop}
                    </p>

                    <p>
                      📦 Quantity:{" "}
                      {appointment.quantity} quintals
                    </p>

                    {payoutEstimate?.has_msp && (
                      <p>
                        💰 Est. value:{" "}
                        <strong>
                          ₹{payoutEstimate.estimated_amount.toLocaleString("en-IN")}
                        </strong>
                        {" "}(Govt. MSP)
                      </p>
                    )}

                    <p>
                      🏢 Centre:{" "}
                      {appointment.centre_name}
                    </p>

                    <p>
                      📍{" "}
                      {appointment.location}
                    </p>

                    <p>
                      📅{" "}
                      {appointment.date}
                    </p>

                    <p>
                      🕐{" "}
                      {appointment.time_slot}
                    </p>

                    <p>
                      {appointment.status === "CANCELLED"
                        ? "🔴 Status:"
                        : "🟢 Status:"}{" "}
                      <strong>
                        {appointment.status || "BOOKED"}
                      </strong>
                    </p>

                  </div>

                </div>



                <button
                  className="confirm-button"
                  onClick={closeBooking}
                >
                  Done
                </button>

              </div>

            )}

          </div>

        </div>

      )}

    </div>
  );
}

export default FarmerDashboard;