import { useEffect, useRef, useState } from 'react';
import { 
  MapPin, 
  AlertTriangle, 
  Shield, 
  Settings, 
  User as UserIcon, 
  LogOut, 
  Database, 
  Wifi, 
  WifiOff, 
  Compass, 
  Plus, 
  Check, 
  X, 
  Info, 
  Bell, 
  ChevronRight, 
  Download,
  Award,
  ExternalLink,
  Lock,
  ThumbsUp,
  Map as MapIcon,
  BarChart3,
  Moon,
  Sun,
  Share2
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer, 
  Cell 
} from 'recharts';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { usePWAInstall } from './hooks/usePWAInstall';

interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  trustPoints: number;
}

interface Report {
  id: string;
  reportedAt: string;
  creator: string;
  lat: number;
  lng: number;
  type: 'transito' | 'policia' | 'vialidad';
  description: string;
  locationName: string;
  status: 'Activo' | 'Despejado';
  votesUp: number;
  votesDown: number;
  votedUsers?: Record<string, 'up' | 'down'>;
}

interface SheetConfig {
  isConfigured: boolean;
  clientEmail: string;
  sheetId: string;
  sheetLink: string;
}

export default function App() {
  const isOnline = useOnlineStatus();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  
  // Auth state
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null);
  const [authForm, setAuthForm] = useState({ name: '', email: '', username: '', password: '' });
  const [authError, setAuthError] = useState('');

  // App settings/Google Sheets configuration
  const [config, setConfig] = useState<SheetConfig>({
    isConfigured: false,
    clientEmail: '',
    sheetId: '',
    sheetLink: ''
  });
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [configForm, setConfigForm] = useState({ clientEmail: '', privateKey: '', sheetId: '' });
  const [configMessage, setConfigMessage] = useState({ type: '', text: '' });
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // Map and location state
  const mapRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const mapMarkersGroupRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const [nightMode, setNightMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('night_mode');
    return saved ? JSON.parse(saved) : true;
  });
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedMapPoint, setSelectedMapPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<Omit<Report, 'id' | 'reportedAt' | 'votesUp' | 'votesDown' | 'status' | 'votedUsers'>[]>(() => {
    const saved = localStorage.getItem('offline_queue');
    return saved ? JSON.parse(saved) : [];
  });

  // Reporting state
  const [showReportWizard, setShowReportWizard] = useState(false);
  const [reportForm, setReportForm] = useState({
    type: 'transito' as 'transito' | 'policia' | 'vialidad',
    description: '',
    locationName: ''
  });

  // Editing state for user's own reports
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    type: 'transito' as 'transito' | 'policia' | 'vialidad',
    description: '',
    locationName: ''
  });

  // UI tabs/panels
  const [activeTab, setActiveTab] = useState<'map' | 'alerts' | 'profile' | 'stats'>('map');
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [proximityAlert, setProximityAlert] = useState<Report | null>(null);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [showQuickGuide, setShowQuickGuide] = useState<boolean>(() => {
    const saved = localStorage.getItem('has_seen_guide');
    return saved ? false : true;
  });
  const [guideStep, setGuideStep] = useState<number>(1);

  // Push Notification Preferences State
  const [notifDistance, setNotifDistance] = useState<number>(() => {
    const saved = localStorage.getItem('notif_distance');
    return saved ? parseFloat(saved) : 1.5;
  });
  const [notifTypes, setNotifTypes] = useState<{ transito: boolean, policia: boolean, vialidad: boolean }>(() => {
    const saved = localStorage.getItem('notif_types');
    return saved ? JSON.parse(saved) : { transito: true, policia: true, vialidad: true };
  });

  // Community leaderboard state
  const [leaderboard, setLeaderboard] = useState<{ name: string, username: string, trustPoints: number }[]>([]);

  useEffect(() => {
    localStorage.setItem('notif_distance', notifDistance.toString());
  }, [notifDistance]);

  useEffect(() => {
    localStorage.setItem('notif_types', JSON.stringify(notifTypes));
  }, [notifTypes]);

  // Visualization filters state
  const [filters, setFilters] = useState({
    transito: true,
    policia: true,
    vialidad: true
  });

  // Load configuration and reports on boot
  useEffect(() => {
    fetchConfig();
    fetchReports();
    fetchLeaderboard();
    requestNotificationPermission();

    // Set up location watching
    if (navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const coords = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setUserCoords(coords);
        },
        (error) => {
          console.warn('Geolocation access denied, using fallback city center.', error);
          // Set Bogota center as default fallback
          setUserCoords({ lat: 4.6097, lng: -74.0817 });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );

      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, []);

  // Sync offline queue when connection comes back online
  useEffect(() => {
    if (isOnline && offlineQueue.length > 0) {
      syncOfflineQueue();
    }
  }, [isOnline, offlineQueue]);

  // Periodic reports fetch (simulated real-time)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchReports();
    }, 15000); // refresh every 15 seconds
    return () => clearInterval(interval);
  }, []);

  // Monitor user proximity to traffic stops and trigger alert notifications
  useEffect(() => {
    if (!userCoords || reports.length === 0) return;

    // Find active reports closer than user preference range
    const closeReport = reports.find((report) => {
      if (report.status !== 'Activo') return false;
      
      // Filter by type preference
      const isAllowed = notifTypes[report.type as 'transito' | 'policia' | 'vialidad'];
      if (!isAllowed) return false;

      const dist = calculateDistance(userCoords.lat, userCoords.lng, report.lat, report.lng);
      return dist <= notifDistance; // User configured proximity alert distance
    });

    if (closeReport) {
      setProximityAlert(closeReport);
      // Trigger native browser notification
      if (Notification.permission === 'granted' && proximityAlert?.id !== closeReport.id) {
        new Notification('¡Alerta de Control Vial Cerca!', {
          body: `Se reportó un retén tipo: ${getReportLabel(closeReport.type)} en ${closeReport.locationName}. ¡Conduce con precaución!`,
          icon: '/icon.svg',
          vibrate: [200, 100, 200]
        });
      }
    } else {
      setProximityAlert(null);
    }
  }, [userCoords, reports, notifDistance, notifTypes]);

  // Initialize/Update Leaflet map
  useEffect(() => {
    // Only build map if we are on the 'map' tab
    if (activeTab !== 'map' || !userCoords) return;

    // Standard Leaflet import wrapper using global window.L
    const L = (window as any).L;
    if (!L) return;

    // If map isn't created yet, initialize it
    if (!mapRef.current) {
      const initialLat = userCoords.lat;
      const initialLng = userCoords.lng;

      mapRef.current = L.map('leaflet-map-container', {
        zoomControl: false,
        attributionControl: false
      }).setView([initialLat, initialLng], 14);

      // Add high quality tile layer
      tileLayerRef.current = L.tileLayer(
        nightMode 
          ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' 
          : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          maxZoom: 19,
        }
      ).addTo(mapRef.current);

      // Add zoom control at bottom right
      L.control.zoom({
        position: 'bottomright'
      }).addTo(mapRef.current);

      // Create group layer for markers
      mapMarkersGroupRef.current = L.layerGroup().addTo(mapRef.current);

      // Map click event to place report marker
      mapRef.current.on('click', (e: any) => {
        if (!user) {
          setAuthMode('login');
          return;
        }
        const { lat, lng } = e.latlng;
        setSelectedMapPoint({ lat, lng });
        setReportForm(prev => ({
          ...prev,
          locationName: `Cerca de coordenadas (${lat.toFixed(4)}, ${lng.toFixed(4)})`
        }));
        setShowReportWizard(true);
      });
    } else {
      // If map exists, just update user view if it has changed
      mapRef.current.setView([userCoords.lat, userCoords.lng]);
    }

    // Draw user location marker
    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng([userCoords.lat, userCoords.lng]);
    } else {
      const userIcon = L.divIcon({
        className: 'custom-user-marker',
        html: `
          <div class="relative flex items-center justify-center">
            <span class="absolute inline-flex h-8 w-8 animate-ping rounded-full bg-blue-400 opacity-75"></span>
            <div class="relative h-5 w-5 rounded-full bg-blue-600 border-2 border-white shadow-md flex items-center justify-center">
              <div class="h-2 w-2 rounded-full bg-white"></div>
            </div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      userMarkerRef.current = L.marker([userCoords.lat, userCoords.lng], { icon: userIcon })
        .addTo(mapRef.current);
    }

    // Refresh traffic stop markers
    updateMapMarkers();

  }, [activeTab, userCoords, reports, selectedMapPoint, filters]);

  // Update map tile layer style dynamically when nightMode changes
  useEffect(() => {
    const L = (window as any).L;
    if (!L || !mapRef.current || !tileLayerRef.current) return;

    try {
      mapRef.current.removeLayer(tileLayerRef.current);
      
      tileLayerRef.current = L.tileLayer(
        nightMode 
          ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' 
          : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', 
        {
          maxZoom: 19,
        }
      ).addTo(mapRef.current);
    } catch (e) {
      console.error('Error switching map tile layers:', e);
    }
  }, [nightMode]);

  // Recalculate distance between two coordinates
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const handleShareReport = async (report: Report) => {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${report.lat},${report.lng}`;
    const shareText = `🚨 ¡Alerta de Control Vial! Se reportó un ${getReportLabel(report.type)} en: ${report.locationName}. Conduce con precaución. Ubicación exacta en el mapa: ${mapsUrl}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Alerta de Control Vial - RetenAlerta',
          text: `Se reportó un ${getReportLabel(report.type)} en: ${report.locationName}. ¡Conduce con precaución!`,
          url: mapsUrl
        });
      } catch (err) {
        if ((err as any).name !== 'AbortError') {
          copyToClipboardFallback(shareText);
        }
      }
    } else {
      copyToClipboardFallback(shareText);
    }
  };

  const copyToClipboardFallback = (text: string) => {
    navigator.clipboard.writeText(text)
      .then(() => {
        setShareToast('¡Enlace copiado al portapapeles! Listo para pegar y compartir.');
        setTimeout(() => setShareToast(null), 4000);
      })
      .catch((err) => {
        console.error('Failed to copy text:', err);
      });
  };

  const getReportLabel = (type: string) => {
    switch (type) {
      case 'transito': return 'Control de Tránsito';
      case 'policia': return 'Control Policial';
      case 'vialidad': return 'Vialidad / Obras';
      default: return 'Alerta de Tráfico';
    }
  };

  const getReportColor = (type: string) => {
    switch (type) {
      case 'transito': return 'bg-amber-500 text-slate-900 border-amber-600';
      case 'policia': return 'bg-blue-600 text-white border-blue-700';
      case 'vialidad': return 'bg-orange-600 text-white border-orange-700';
      default: return 'bg-slate-500 text-white border-slate-600';
    }
  };

  // Redraw all traffic stop markers on map
  const updateMapMarkers = () => {
    const L = (window as any).L;
    if (!L || !mapMarkersGroupRef.current || !mapRef.current) return;

    // Clear old markers
    mapMarkersGroupRef.current.clearLayers();

    reports.forEach((report) => {
      if (report.status !== 'Activo') return;
      if (!filters[report.type as keyof typeof filters]) return;

      const markerHtml = `
        <div class="relative flex items-center justify-center">
          <span class="absolute inline-flex h-8 w-8 animate-pulse rounded-full ${
            report.type === 'transito' ? 'bg-amber-500/50' : report.type === 'policia' ? 'bg-blue-600/50' : 'bg-orange-600/50'
          }"></span>
          <div class="relative p-2 rounded-xl text-white shadow-xl border border-white flex items-center justify-center ${
            report.type === 'transito' ? 'bg-amber-500' : report.type === 'policia' ? 'bg-blue-600' : 'bg-orange-600'
          }">
            ${report.type === 'transito' ? '🚨' : report.type === 'policia' ? '👮' : '🚧'}
          </div>
        </div>
      `;

      const markerIcon = L.divIcon({
        className: 'custom-traffic-marker',
        html: markerHtml,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });

      const marker = L.marker([report.lat, report.lng], { icon: markerIcon })
        .addTo(mapMarkersGroupRef.current);

      // On click, show details panel/modal
      marker.on('click', () => {
        setSelectedReport(report);
      });
    });

    // If there is currently an unsubmitted point placement marker, render it
    if (selectedMapPoint) {
      const draftIcon = L.divIcon({
        className: 'custom-draft-marker',
        html: `
          <div class="relative flex items-center justify-center">
            <div class="h-6 w-6 rounded-full bg-rose-600 border-2 border-white shadow-lg flex items-center justify-center animate-bounce">
              <span class="text-white text-xs font-bold">+</span>
            </div>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      L.marker([selectedMapPoint.lat, selectedMapPoint.lng], { icon: draftIcon })
        .addTo(mapMarkersGroupRef.current);
    }
  };

  // Native Notification permissions request
  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationsEnabled(permission === 'granted');
    }
  };

  // Fetch Sheets config from backend
  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      setConfig(data);
      if (data.clientEmail || data.hasPrivateKey) {
        setConfigForm({
          clientEmail: data.clientEmail || '',
          privateKey: data.hasPrivateKey ? 'Preconfigurada_No_Es_Necesario_Modificar' : '',
          sheetId: data.sheetId || ''
        });
      }
    } catch (e) {
      console.error('Error fetching sheets configuration', e);
    }
  };

  // Fetch reported points
  const fetchReports = async () => {
    try {
      const res = await fetch('/api/reports');
      const data = await res.json();
      setReports(data);
    } catch (e) {
      console.error('Error fetching traffic stop reports', e);
    }
  };

  // Fetch Leaderboard
  const fetchLeaderboard = async () => {
    try {
      const res = await fetch('/api/users/leaderboard');
      const data = await res.json();
      if (Array.isArray(data)) {
        setLeaderboard(data);
      }
    } catch (e) {
      console.error('Error fetching community leaderboard', e);
    }
  };

  // Submit Sheets config to backend
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setConfigMessage({ type: '', text: '' });

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configForm)
      });
      const data = await res.json();

      if (res.ok) {
        setConfigMessage({ type: 'success', text: '¡Excelente! Google Sheets configurado y sincronizado exitosamente.' });
        fetchConfig();
        setTimeout(() => setShowConfigPanel(false), 2000);
      } else {
        setConfigMessage({ type: 'error', text: data.error || 'No se pudo guardar la configuración.' });
      }
    } catch (error) {
      setConfigMessage({ type: 'error', text: 'Error de red al conectar con el servidor.' });
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Handle Auth submission
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    const endpoint = authMode === 'register' ? '/api/register' : '/api/login';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm)
      });
      const data = await res.json();

      if (res.ok) {
        setUser(data.user);
        localStorage.setItem('user', JSON.stringify(data.user));
        setAuthMode(null);
        setAuthForm({ name: '', email: '', username: '', password: '' });
      } else {
        setAuthError(data.error || 'Error de autenticación.');
      }
    } catch (error) {
      setAuthError('Ocurrió un error al contactar el servidor de credenciales.');
    }
  };

  // Create new checkpoint report
  const handleCreateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const coordinates = selectedMapPoint || userCoords;
    if (!coordinates) {
      alert('Por favor selecciona una ubicación en el mapa.');
      return;
    }

    const reportData = {
      type: reportForm.type,
      description: reportForm.description,
      lat: coordinates.lat,
      lng: coordinates.lng,
      locationName: reportForm.locationName || 'Ubicación sin nombre',
      creator: user.username
    };

    if (!isOnline) {
      // Save offline queue
      const queuedReport = {
        ...reportData,
        reportedAt: new Date().toISOString()
      };
      const updatedQueue = [...offlineQueue, queuedReport];
      setOfflineQueue(updatedQueue);
      localStorage.setItem('offline_queue', JSON.stringify(updatedQueue));
      
      // Cache report locally for instant view while offline
      const tempReport: Report = {
        id: `offline-${Date.now()}`,
        reportedAt: queuedReport.reportedAt,
        creator: queuedReport.creator,
        lat: queuedReport.lat,
        lng: queuedReport.lng,
        type: queuedReport.type,
        description: queuedReport.description,
        locationName: queuedReport.locationName,
        status: 'Activo',
        votesUp: 0,
        votesDown: 0
      };
      setReports(prev => [tempReport, ...prev]);
      
      setShowReportWizard(false);
      setSelectedMapPoint(null);
      setReportForm({ type: 'transito', description: '', locationName: '' });
      alert('Guardado en caché local. Se sincronizará con Google Sheets de forma automática al recuperar conexión.');
      return;
    }

    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportData)
      });
      const data = await res.json();

      if (res.ok) {
        setReports(prev => [data.report, ...prev]);
        setShowReportWizard(false);
        setSelectedMapPoint(null);
        setReportForm({ type: 'transito', description: '', locationName: '' });
      } else {
        alert(data.error || 'No se pudo crear el reporte.');
      }
    } catch (e) {
      alert('Error de red al reportar el retén.');
    }
  };

  // Sync offline queue items
  const syncOfflineQueue = async () => {
    let succeededCount = 0;
    const pending = [...offlineQueue];

    for (const item of pending) {
      try {
        const res = await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        });
        if (res.ok) {
          succeededCount++;
        }
      } catch (e) {
        console.error('Error syncing queued offline item', e);
      }
    }

    const remaining = pending.slice(succeededCount);
    setOfflineQueue(remaining);
    localStorage.setItem('offline_queue', JSON.stringify(remaining));

    if (succeededCount > 0) {
      fetchReports();
      alert(`Sincronizados ${succeededCount} reportes creados sin conexión.`);
    }
  };

  // Cast vote on a report
  const handleVote = async (id: string, voteType: 'up' | 'down') => {
    if (!user) {
      setAuthMode('login');
      return;
    }

    try {
      const res = await fetch(`/api/reports/${id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, voteType })
      });
      const data = await res.json();

      if (res.ok) {
        setReports(prev => prev.map(r => r.id === id ? data.report : r));
        setSelectedReport(data.report);
        fetchLeaderboard();
      } else {
        alert(data.error || 'No se pudo registrar el voto.');
      }
    } catch (e) {
      alert('Error al emitir el voto.');
    }
  };

  // Start editing a report
  const handleStartEdit = (report: Report) => {
    setEditingReportId(report.id);
    setEditForm({
      type: report.type as 'transito' | 'policia' | 'vialidad',
      description: report.description || '',
      locationName: report.locationName
    });
  };

  // Save edited report
  const handleSaveEdit = async (id: string) => {
    if (!user) return;
    try {
      const res = await fetch(`/api/reports/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editForm,
          username: user.username
        })
      });
      const data = await res.json();
      if (res.ok) {
        setReports(prev => prev.map(r => r.id === id ? data.report : r));
        setEditingReportId(null);
        setShareToast('¡Reporte editado y sincronizado correctamente con Google Sheets!');
        setTimeout(() => setShareToast(null), 4000);
      } else {
        alert(data.error || 'No se pudo editar el reporte.');
      }
    } catch (e) {
      alert('Error de conexión al editar el reporte.');
    }
  };

  // Delete a report
  const handleDeleteReport = async (id: string) => {
    if (!user) return;
    if (!confirm('¿Estás seguro de que deseas eliminar este reporte permanentemente? Se borrará también de Google Sheets.')) {
      return;
    }

    try {
      const res = await fetch(`/api/reports/${id}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username })
      });
      const data = await res.json();
      if (res.ok) {
        setReports(prev => prev.filter(r => r.id !== id));
        if (selectedReport?.id === id) {
          setSelectedReport(null);
        }
        setShareToast('Reporte eliminado correctamente.');
        setTimeout(() => setShareToast(null), 4000);
      } else {
        alert(data.error || 'No se pudo eliminar el reporte.');
      }
    } catch (e) {
      alert('Error al conectar con el servidor.');
    }
  };

  // Simulate a report by another user to demonstrate push notifications in real-time
  const simulateNewReport = () => {
    if (!userCoords) return;
    
    // Generate an offset location near the user (~200m - 800m away)
    const latOffset = (Math.random() - 0.5) * 0.01;
    const lngOffset = (Math.random() - 0.5) * 0.01;
    const simulatedLat = userCoords.lat + latOffset;
    const simulatedLng = userCoords.lng + lngOffset;

    const simulatedTypes: ('transito' | 'policia' | 'vialidad')[] = ['transito', 'policia', 'vialidad'];
    const chosenType = simulatedTypes[Math.floor(Math.random() * simulatedTypes.length)];
    const simulatedNames = [
      'Avenida Principal / cruce comercial',
      'Calle de acceso rápido residencial',
      'Rotonda de circunvalación',
      'Frente a gasolinera de la zona'
    ];
    const chosenName = simulatedNames[Math.floor(Math.random() * simulatedNames.length)];

    const simulatedReport: Report = {
      id: `sim-${Date.now()}`,
      reportedAt: new Date().toISOString(),
      creator: 'ComunidadReten',
      lat: simulatedLat,
      lng: simulatedLng,
      type: chosenType,
      description: 'Reporte preventivo automatizado por cercanía vecinal.',
      locationName: chosenName,
      status: 'Activo',
      votesUp: 2,
      votesDown: 0
    };

    // Add to state
    setReports(prev => [simulatedReport, ...prev]);

    // Push notification trigger
    if (Notification.permission === 'granted') {
      new Notification('¡Nuevo Reporte en la Comunidad!', {
        body: `Se ha detectado un ${getReportLabel(chosenType)} en ${chosenName}. ¡Mantente alerta!`,
        icon: '/icon.svg'
      });
    } else {
      alert(`[SIMULACIÓN NOTIFICACIÓN PUSH]: Nuevo ${getReportLabel(chosenType)} reportado cerca de tu zona.`);
    }
  };

  const logout = () => {
    localStorage.removeItem('user');
    setUser(null);
  };

  const getStatsData = () => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentReports = reports.filter(r => {
      const reportDate = new Date(r.reportedAt);
      return reportDate >= sevenDaysAgo;
    });

    const counts = {
      transito: 0,
      policia: 0,
      vialidad: 0
    };

    recentReports.forEach(r => {
      if (counts[r.type] !== undefined) {
        counts[r.type]++;
      }
    });

    return [
      { name: 'Tránsito', cantidad: counts.transito, color: '#f59e0b' },
      { name: 'Policía', cantidad: counts.policia, color: '#2563eb' },
      { name: 'Vialidad', cantidad: counts.vialidad, color: '#ea580c' }
    ];
  };

  return (
    <div className={`flex-1 flex flex-col min-h-screen relative overflow-hidden transition-colors duration-300 ${
      nightMode ? 'bg-zinc-950 text-zinc-100' : 'bg-slate-900 text-slate-100'
    }`}>
      
      {/* Share Toast Notification Banner */}
      {shareToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top duration-300 max-w-sm border border-emerald-500/30">
          <Check className="h-5 w-5 shrink-0 bg-white/20 p-1 rounded-full text-white" />
          <span className="text-xs font-bold">{shareToast}</span>
        </div>
      )}
      
      {/* Offline Alert Banner */}
      {!isOnline && (
        <div className="bg-amber-500 text-slate-900 py-1.5 px-4 text-xs font-semibold flex items-center justify-between z-50 shadow-md">
          <div className="flex items-center gap-2">
            <WifiOff className="h-4 w-4 animate-pulse" />
            <span>Modo sin conexión activo — Visualizando datos en caché. Los reportes se sincronizarán al recuperar señal.</span>
          </div>
          {offlineQueue.length > 0 && (
            <span className="bg-slate-900 text-amber-400 text-[10px] px-2 py-0.5 rounded font-mono">
              {offlineQueue.length} pendientes
            </span>
          )}
        </div>
      )}

      {/* Proximity Warning Widget */}
      {proximityAlert && (
        <div className="bg-rose-600 text-white py-2 px-4 text-sm font-semibold flex items-center justify-between z-40 animate-pulse border-b border-rose-700">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>ALERTA: Control de seguridad reportado muy cerca ({proximityAlert.locationName}). ¡Precaución al conducir!</span>
          </div>
          <button 
            onClick={() => {
              setSelectedReport(proximityAlert);
              setActiveTab('map');
            }} 
            className="text-xs underline bg-rose-800 px-2 py-1 rounded"
          >
            Ver Mapa
          </button>
        </div>
      )}

      {/* Main Header */}
      <header className={`border-b px-4 py-3 flex items-center justify-between z-30 shadow-lg transition-colors duration-300 ${
        nightMode ? 'bg-zinc-900/95 border-zinc-800/80' : 'bg-slate-800/90 border-slate-700/80'
      }`}>
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-2 rounded-xl border border-white/20 shadow-md text-white">
            <AlertTriangle className="h-5 w-5 text-amber-300" />
          </div>
          <div>
            <h1 className="text-base font-extrabold tracking-tight text-white flex items-center gap-1.5">
              RetenAlerta
              <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded font-mono font-medium">PWA</span>
            </h1>
            <p className="text-[10px] text-slate-400">Alertas de Tránsito Ciudadano</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status Display */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
            {isOnline ? (
              <span className="flex items-center gap-1 text-emerald-400 font-medium">
                <Wifi className="h-3.5 w-3.5" /> En línea
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-400 font-medium">
                <WifiOff className="h-3.5 w-3.5" /> Sin conexión
              </span>
            )}
          </div>

          {/* Quick Install Option */}
          {isInstallable && !isInstalled && (
            <button 
              onClick={install}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-2.5 py-1.5 rounded-lg shadow-sm transition"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Instalar</span>
            </button>
          )}

          {isIOS && !isInstalled && (
            <button 
              onClick={() => setShowIOSGuide(true)}
              className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg shadow-sm transition"
            >
              <span>Instalar iOS</span>
            </button>
          )}

          {/* Night Mode Toggle Button */}
          <button 
            onClick={() => {
              setNightMode(prev => {
                const next = !prev;
                localStorage.setItem('night_mode', JSON.stringify(next));
                return next;
              });
            }}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-700/60 hover:text-white transition"
            title={nightMode ? "Activar Modo Día" : "Activar Modo Nocturno"}
          >
            {nightMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-indigo-400" />}
          </button>

          {/* Settings cog for Admin Setup */}
          <button 
            onClick={() => setShowConfigPanel(true)}
            className={`p-2 rounded-lg text-slate-400 hover:bg-slate-700/60 hover:text-white transition ${config.isConfigured ? 'text-blue-400' : ''}`}
            title="Sincronización con Google Sheets"
          >
            <Settings className="h-4 w-4" />
          </button>

          {/* User Sign In / Profile action */}
          {user ? (
            <div className="flex items-center gap-2">
              <div className="hidden md:flex flex-col items-end">
                <span className="text-xs font-semibold text-slate-200">@{user.username}</span>
                <span className="text-[10px] text-amber-400 font-medium flex items-center gap-0.5">
                  <Award className="h-3 w-3" /> {user.trustPoints} pts
                </span>
              </div>
              <button 
                onClick={logout}
                className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/10 transition"
                title="Cerrar sesión"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button 
              onClick={() => setAuthMode('login')}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition"
            >
              <UserIcon className="h-3.5 w-3.5" />
              <span>Entrar</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Container Layout */}
      <main className="flex-1 flex flex-col md:flex-row min-h-0 relative z-10">
        
        {/* LEAFLET INTERACTIVE MAP TAB */}
        <div className={`flex-1 relative min-h-0 ${activeTab === 'map' ? 'flex' : 'hidden md:flex'}`}>
          <div id="leaflet-map-container" className="absolute inset-0 w-full h-full z-0"></div>

          {/* Map Controls & Helpers */}
          <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 pointer-events-none">
            {/* Quick Helper Banner */}
            <div className="bg-slate-900/90 backdrop-blur-md px-3 py-2 rounded-xl text-xs shadow-xl border border-slate-700/50 max-w-xs text-slate-300 pointer-events-auto">
              <div className="font-bold text-white flex items-center gap-1.5 mb-1">
                <Compass className="h-4 w-4 text-blue-400 animate-spin" />
                <span>¿Cómo alertar un retén?</span>
              </div>
              <span>Toca en cualquier parte del mapa para agregar y reportar un punto de control en tiempo real.</span>
            </div>

            {/* Simulated Live Alert trigger for developer preview */}
            <button 
              onClick={simulateNewReport}
              className="bg-blue-600/90 hover:bg-blue-600 backdrop-blur-md px-3 py-2 rounded-xl text-xs font-bold shadow-xl border border-blue-500 text-white pointer-events-auto transition flex items-center gap-1.5 self-start"
            >
              <Bell className="h-4 w-4 animate-bounce" />
              <span>Simular Alerta</span>
            </button>
          </div>

          {/* Floating Map Filter Controls */}
          <div className={`absolute top-4 right-4 z-10 backdrop-blur-md p-3 rounded-2xl shadow-2xl transition-all duration-300 border ${
            nightMode ? 'bg-zinc-900/95 border-zinc-800' : 'bg-slate-900/95 border-slate-700/60'
          }`}>
            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Filtros de Mapa</h4>
            <div className="flex flex-col gap-1.5 w-32">
              <button
                onClick={() => setFilters(prev => ({ ...prev, transito: !prev.transito }))}
                className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  filters.transito 
                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-300' 
                    : nightMode 
                      ? 'bg-zinc-800/40 border-zinc-800/40 text-zinc-600 line-through'
                      : 'bg-slate-800/40 border-slate-700/40 text-slate-500 line-through'
                }`}
              >
                <div className="flex items-center gap-1">
                  <span>🚨</span>
                  <span>Tránsito</span>
                </div>
                <div className={`h-2 w-2 rounded-full ${filters.transito ? 'bg-amber-500 animate-pulse' : 'bg-slate-700'}`}></div>
              </button>

              <button
                onClick={() => setFilters(prev => ({ ...prev, policia: !prev.policia }))}
                className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  filters.policia 
                    ? 'bg-blue-500/20 border-blue-500/60 text-blue-300' 
                    : nightMode 
                      ? 'bg-zinc-800/40 border-zinc-800/40 text-zinc-600 line-through'
                      : 'bg-slate-800/40 border-slate-700/40 text-slate-500 line-through'
                }`}
              >
                <div className="flex items-center gap-1">
                  <span>👮</span>
                  <span>Policía</span>
                </div>
                <div className={`h-2 w-2 rounded-full ${filters.policia ? 'bg-blue-500 animate-pulse' : 'bg-slate-700'}`}></div>
              </button>

              <button
                onClick={() => setFilters(prev => ({ ...prev, vialidad: !prev.vialidad }))}
                className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  filters.vialidad 
                    ? 'bg-orange-500/20 border-orange-500/60 text-orange-300' 
                    : nightMode 
                      ? 'bg-zinc-800/40 border-zinc-800/40 text-zinc-600 line-through'
                      : 'bg-slate-800/40 border-slate-700/40 text-slate-500 line-through'
                }`}
              >
                <div className="flex items-center gap-1">
                  <span>🚧</span>
                  <span>Vialidad</span>
                </div>
                <div className={`h-2 w-2 rounded-full ${filters.vialidad ? 'bg-orange-500 animate-pulse' : 'bg-slate-700'}`}></div>
              </button>
            </div>
          </div>

          {/* Create Point Wizard Modal Overlay */}
          {showReportWizard && (
            <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4 z-20">
              <div className="w-full max-w-md bg-slate-800 rounded-2xl p-6 shadow-2xl border border-slate-700 animate-in fade-in zoom-in">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-rose-500" />
                    <h3 className="text-base font-bold text-white">Reportar Punto de Control</h3>
                  </div>
                  <button 
                    onClick={() => {
                      setShowReportWizard(false);
                      setSelectedMapPoint(null);
                    }} 
                    className="p-1 rounded-lg text-slate-400 hover:bg-slate-700"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <form onSubmit={handleCreateReport} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-2">TIPO DE CONTROL / AGENTE</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setReportForm(p => ({ ...p, type: 'transito' }))}
                        className={`py-3 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition ${
                          reportForm.type === 'transito' 
                            ? 'bg-amber-500 border-white text-slate-900 shadow-md' 
                            : 'bg-slate-700/50 border-slate-600 text-slate-300'
                        }`}
                      >
                        <span className="text-lg">🚨</span>
                        <span>Tránsito</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setReportForm(p => ({ ...p, type: 'policia' }))}
                        className={`py-3 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition ${
                          reportForm.type === 'policia' 
                            ? 'bg-blue-600 border-white text-white shadow-md' 
                            : 'bg-slate-700/50 border-slate-600 text-slate-300'
                        }`}
                      >
                        <span className="text-lg">👮</span>
                        <span>Policía</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setReportForm(p => ({ ...p, type: 'vialidad' }))}
                        className={`py-3 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition ${
                          reportForm.type === 'vialidad' 
                            ? 'bg-orange-600 border-white text-white shadow-md' 
                            : 'bg-slate-700/50 border-slate-600 text-slate-300'
                        }`}
                      >
                        <span className="text-lg">🚧</span>
                        <span>Vialidad</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1">REFERENCIA / CALLE / AV</label>
                    <input
                      type="text"
                      required
                      placeholder="Ej. Calle 45 con Av. Principal, frente al supermercado"
                      value={reportForm.locationName}
                      onChange={e => setReportForm(p => ({ ...p, locationName: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1">DETALLES / OBSERVACIONES (OPCIONAL)</label>
                    <textarea
                      placeholder="Ej. Están revisando documentos de motocicletas o deteniendo camiones..."
                      value={reportForm.description}
                      onChange={e => setReportForm(p => ({ ...p, description: e.target.value }))}
                      rows={2}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowReportWizard(false);
                        setSelectedMapPoint(null);
                      }}
                      className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 py-2.5 rounded-xl font-bold text-xs transition"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-bold text-xs transition shadow-md"
                    >
                      Publicar Alerta
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Highlighted Marker Detail Panel */}
          {selectedReport && (
            <div className={`absolute bottom-6 left-4 right-4 md:left-6 md:right-auto md:w-96 z-20 rounded-2xl shadow-2xl border p-5 animate-in slide-in-from-bottom transition-colors duration-300 ${
              nightMode ? 'bg-zinc-900 border-zinc-800 text-zinc-100' : 'bg-slate-800 border-slate-700 text-white'
            }`}>
              <div className="flex justify-between items-start mb-3">
                <span className={`px-2.5 py-1 rounded-full text-xs font-extrabold tracking-wide uppercase border ${getReportColor(selectedReport.type)}`}>
                  {getReportLabel(selectedReport.type)}
                </span>
                <div className="flex items-center gap-1.5">
                  <button 
                    onClick={() => handleShareReport(selectedReport)}
                    className={`p-1.5 rounded-full transition-colors ${
                      nightMode ? 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100' : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                    }`}
                    title="Compartir alerta"
                  >
                    <Share2 className="h-4 w-4" />
                  </button>
                  <button 
                    onClick={() => setSelectedReport(null)}
                    className={`p-1.5 rounded-full transition-colors ${
                      nightMode ? 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100' : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <h4 className={`text-base font-bold mb-1 ${nightMode ? 'text-white' : 'text-white'}`}>{selectedReport.locationName}</h4>
              <p className={`text-xs mb-3 ${nightMode ? 'text-zinc-400' : 'text-slate-400'}`}>
                Reportado por <span className={nightMode ? 'text-zinc-200' : 'text-slate-200'}>@{selectedReport.creator}</span> · {new Date(selectedReport.reportedAt).toLocaleTimeString()}
              </p>

              {selectedReport.description && (
                <p className={`text-xs p-2.5 rounded-xl border mb-4 font-mono transition-colors duration-300 ${
                  nightMode ? 'text-zinc-300 bg-zinc-950/50 border-zinc-800' : 'text-slate-300 bg-slate-900/50 border-slate-700/50'
                }`}>
                  "{selectedReport.description}"
                </p>
              )}

              {/* Voting / Verification Actions */}
              <div className={`border-t pt-4 flex items-center justify-between ${
                nightMode ? 'border-zinc-800' : 'border-slate-700/60'
              }`}>
                <span className={`text-[11px] font-bold uppercase tracking-wider ${nightMode ? 'text-zinc-400' : 'text-slate-400'}`}>¿Sigue ahí el retén?</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleVote(selectedReport.id, 'up')}
                    className={`flex items-center gap-1.5 border px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      nightMode 
                        ? 'bg-zinc-800 border-zinc-700 hover:bg-emerald-600/30 hover:text-emerald-400' 
                        : 'bg-slate-700 border-slate-600/80 hover:bg-emerald-600/30 hover:text-emerald-400'
                    }`}
                  >
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Sí ({selectedReport.votesUp || 0})</span>
                  </button>
                  <button
                    onClick={() => handleVote(selectedReport.id, 'down')}
                    className={`flex items-center gap-1.5 border px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      nightMode 
                        ? 'bg-zinc-800 border-zinc-700 hover:bg-rose-600/30 hover:text-rose-400' 
                        : 'bg-slate-700 border-slate-600/80 hover:bg-rose-600/30 hover:text-rose-400'
                    }`}
                  >
                    <X className="h-3.5 w-3.5 text-rose-400" />
                    <span>No ({selectedReport.votesDown || 0})</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RECENT ALERTS FEED TAB (Mobile / Sidebar Layout) */}
        <div className={`w-full md:w-96 md:border-l flex flex-col shrink-0 min-h-0 transition-colors duration-300 ${
          activeTab !== 'map' ? 'flex' : 'hidden md:flex'
        } ${
          nightMode ? 'border-zinc-800/80 bg-zinc-950' : 'border-slate-700/80 bg-slate-900'
        }`}>
          
          {/* Section Selector */}
          <div className={`flex border-b p-2 gap-1 shrink-0 overflow-x-auto select-none transition-colors duration-300 ${
            nightMode ? 'border-zinc-800 bg-zinc-900/40' : 'border-slate-700/60 bg-slate-800/40'
          }`}>
            <button
              onClick={() => setActiveTab('map')}
              className={`flex-1 md:hidden py-2 px-1.5 rounded-xl text-[10px] sm:text-xs font-bold flex items-center justify-center gap-1 shrink-0 transition ${
                activeTab === 'map' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              <span>Mapa</span>
            </button>
            <button
              onClick={() => setActiveTab('alerts')}
              className={`flex-1 py-2 px-1.5 rounded-xl text-[10px] sm:text-xs font-bold flex items-center justify-center gap-1 shrink-0 transition ${
                activeTab === 'alerts' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              <span>Lista</span>
            </button>
            <button
              onClick={() => {
                setActiveTab('stats');
                fetchLeaderboard();
              }}
              className={`flex-1 py-2 px-1.5 rounded-xl text-[10px] sm:text-xs font-bold flex items-center justify-center gap-1 shrink-0 transition ${
                activeTab === 'stats' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5 text-blue-400" />
              <span>Estadísticas</span>
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className={`flex-1 py-2 px-1.5 rounded-xl text-[10px] sm:text-xs font-bold flex items-center justify-center gap-1 shrink-0 transition ${
                activeTab === 'profile' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <UserIcon className="h-3.5 w-3.5" />
              <span>Mi Cuenta</span>
            </button>
          </div>

          {/* ACTIVE CONTENT VIEW */}
          <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
            
            {activeTab === 'stats' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-400">Estadísticas de la Ciudad</h3>
                  <span className="text-[10px] bg-blue-500/20 px-2 py-0.5 rounded text-blue-300 font-mono font-bold">
                    Últimos 7 días
                  </span>
                </div>

                <div className="bg-slate-800/80 rounded-2xl p-4 border border-slate-700 shadow-lg space-y-3">
                  <p className="text-xs text-slate-300">
                    Frecuencia de retenes y controles activos reportados en toda la comunidad ciudadana durante la última semana:
                  </p>

                  {/* Recharts Container */}
                  <div className="h-48 w-full mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={getStatsData()} margin={{ top: 10, right: 5, left: -30, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', borderRadius: '12px' }}
                          labelStyle={{ fontWeight: 'bold', color: '#f1f5f9' }}
                          itemStyle={{ color: '#3b82f6' }}
                        />
                        <Bar dataKey="cantidad" radius={[4, 4, 0, 0]}>
                          {getStatsData().map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* KPI Cards */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-700/60">
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">Alertas Totales</span>
                    <p className="text-xl font-black text-white mt-1">
                      {reports.filter(r => {
                        const sevenDaysAgo = new Date();
                        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                        return new Date(r.reportedAt) >= sevenDaysAgo;
                      }).length}
                    </p>
                  </div>
                  <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-700/60">
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">Confirmaciones</span>
                    <p className="text-xl font-black text-emerald-400 mt-1">
                      {reports.reduce((acc, curr) => acc + (curr.votesUp || 0), 0)} confirmadas
                    </p>
                  </div>
                </div>

                {/* Additional list with counts */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Resumen de Incidentes</h4>
                  {getStatsData().map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/40 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }}></span>
                        <span className="font-semibold text-slate-200">{item.name}</span>
                      </div>
                      <span className="font-bold text-slate-300">{item.cantidad} reportes</span>
                    </div>
                  ))}
                </div>

                {/* Community Leaderboard */}
                <div className="space-y-3 pt-3 border-t border-slate-700/40">
                  <div className="flex items-center gap-1.5">
                    <Award className="h-4.5 w-4.5 text-amber-400 animate-pulse" />
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Líderes de la Comunidad</h4>
                  </div>
                  
                  {leaderboard.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-2">Cargando tabla de clasificación...</p>
                  ) : (
                    <div className="space-y-1.5">
                      {leaderboard.map((item, index) => {
                        const isSelf = user && item.username === user.username;
                        const rank = index + 1;
                        let rankBadge = '';
                        let rankStyle = '';
                        
                        if (rank === 1) {
                          rankBadge = '🥇';
                          rankStyle = 'text-amber-400 font-black';
                        } else if (rank === 2) {
                          rankBadge = '🥈';
                          rankStyle = 'text-slate-300 font-black';
                        } else if (rank === 3) {
                          rankBadge = '🥉';
                          rankStyle = 'text-amber-600 font-black';
                        } else {
                          rankBadge = `#${rank}`;
                          rankStyle = 'text-slate-500 font-bold font-mono';
                        }

                        return (
                          <div 
                            key={item.username} 
                            className={`flex items-center justify-between p-3 rounded-2xl border transition-colors duration-300 ${
                              isSelf 
                                ? 'bg-blue-600/15 border-blue-500/40 shadow-inner' 
                                : nightMode 
                                  ? 'bg-zinc-900/40 border-zinc-800' 
                                  : 'bg-slate-800/20 border-slate-700/30'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className={`text-sm select-none shrink-0 w-6 text-center ${rankStyle}`}>
                                {rankBadge}
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1">
                                  <span className={`text-xs font-black truncate text-slate-100 ${isSelf ? 'text-blue-400' : ''}`}>
                                    {item.name}
                                  </span>
                                  {isSelf && (
                                    <span className="text-[9px] bg-blue-500/20 text-blue-300 px-1 py-0.2 rounded font-extrabold uppercase font-mono tracking-wider">
                                      Tú
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-slate-500 block truncate">@{item.username}</span>
                              </div>
                            </div>
                            <span className="text-xs font-black text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20 shrink-0 font-mono">
                              {item.trustPoints} pts
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500 text-center leading-relaxed">
                    Suma <strong className="text-slate-400">Puntos de Confianza</strong> reportando controles y recibiendo confirmaciones de otros ciudadanos. ¡Colabora con la seguridad vial!
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'alerts' && (
              <>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-400">Alertas Activas</h3>
                  <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300 font-mono font-bold">
                    {reports.filter(r => r.status === 'Activo').length} EN VIVO
                  </span>
                </div>

                {reports.filter(r => r.status === 'Activo').length === 0 ? (
                  <div className="bg-slate-800/40 rounded-2xl p-6 text-center border border-slate-700/40">
                    <MapPin className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-xs text-slate-400">No hay controles de tránsito reportados actualmente en tu zona.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {reports.filter(r => r.status === 'Activo').map((report) => (
                      <div 
                        key={report.id}
                        onClick={() => {
                          setSelectedReport(report);
                          setActiveTab('map');
                          if (userCoords && mapRef.current) {
                            mapRef.current.setView([report.lat, report.lng], 16);
                          }
                        }}
                        className="bg-slate-800/60 hover:bg-slate-800 rounded-2xl p-4 border border-slate-700/60 shadow-md cursor-pointer transition flex flex-col"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider border ${getReportColor(report.type)}`}>
                            {getReportLabel(report.type)}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {new Date(report.reportedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <h4 className="text-xs font-bold text-slate-100 mb-1 leading-tight">{report.locationName}</h4>
                        {report.description && (
                          <p className="text-[11px] text-slate-400 italic line-clamp-1 mb-2 font-mono">
                            "{report.description}"
                          </p>
                        )}
                        <div className="flex items-center justify-between text-[10px] text-slate-500 pt-2 border-t border-slate-700/50 mt-auto">
                          <span>Reportó: @{report.creator}</span>
                          <span className="flex items-center gap-1 text-emerald-400 font-bold">
                            <ThumbsUp className="h-3 w-3" /> {report.votesUp || 0} Confirmados
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {activeTab === 'profile' && (
              <div className="space-y-4">
                {user ? (
                  <div className="space-y-4">
                    {/* User profile Summary Card */}
                    <div className="bg-slate-800/80 rounded-2xl p-5 border border-slate-700 shadow-lg text-center relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-3">
                        <Award className="h-6 w-6 text-amber-400" />
                      </div>
                      <div className="h-16 w-16 rounded-full bg-blue-600 mx-auto flex items-center justify-center text-xl font-black text-white shadow-md border border-slate-600 mb-3">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <h3 className="text-base font-bold text-white">{user.name}</h3>
                      <p className="text-xs text-slate-400 mb-4">@{user.username}</p>
                      
                      <div className="grid grid-cols-2 gap-2 bg-slate-900/60 p-3 rounded-xl border border-slate-700/60">
                        <div>
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Confianza</p>
                          <p className="text-lg font-black text-amber-400">{user.trustPoints} pts</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Reportes</p>
                          <p className="text-lg font-black text-blue-400">
                            {reports.filter(r => r.creator === user.username).length}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Notification Preferences Card */}
                    <div className={`p-5 rounded-2xl border transition-colors duration-300 ${
                      nightMode ? 'bg-zinc-900/60 border-zinc-800' : 'bg-slate-800/80 border-slate-700 shadow-lg'
                    }`}>
                      <div className="flex items-center gap-2 mb-4">
                        <Bell className="h-4.5 w-4.5 text-blue-400 animate-bounce" />
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">Alertas por Proximidad</h4>
                      </div>

                      <div className="space-y-4">
                        {/* Range Distance Slider */}
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[11px] text-slate-400 font-bold uppercase">Radio de Cobertura</span>
                            <span className="text-xs font-black text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-lg">
                              {notifDistance} km
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0.5"
                            max="5.0"
                            step="0.5"
                            value={notifDistance}
                            onChange={(e) => setNotifDistance(parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">
                            Recibirás notificaciones nativas en segundo plano cuando te aproximes a un retén dentro de este radio.
                          </p>
                        </div>

                        {/* Allowed Types Checkboxes */}
                        <div className="border-t border-slate-700/50 pt-3">
                          <span className="text-[11px] text-slate-400 font-bold uppercase block mb-2">Tipos de Alerta Permitidos</span>
                          <div className="grid grid-cols-1 gap-2.5">
                            <label className="flex items-center gap-2.5 cursor-pointer group">
                              <input
                                type="checkbox"
                                checked={notifTypes.transito}
                                onChange={(e) => setNotifTypes(prev => ({ ...prev, transito: e.target.checked }))}
                                className="h-4 w-4 bg-slate-900 border-slate-700 rounded text-blue-600 accent-blue-500 focus:ring-0 cursor-pointer"
                              />
                              <span className="text-xs text-slate-300 group-hover:text-white transition">🚨 Control de Tránsito</span>
                            </label>
                            <label className="flex items-center gap-2.5 cursor-pointer group">
                              <input
                                type="checkbox"
                                checked={notifTypes.policia}
                                onChange={(e) => setNotifTypes(prev => ({ ...prev, policia: e.target.checked }))}
                                className="h-4 w-4 bg-slate-900 border-slate-700 rounded text-blue-600 accent-blue-500 focus:ring-0 cursor-pointer"
                              />
                              <span className="text-xs text-slate-300 group-hover:text-white transition">👮 Control Policial</span>
                            </label>
                            <label className="flex items-center gap-2.5 cursor-pointer group">
                              <input
                                type="checkbox"
                                checked={notifTypes.vialidad}
                                onChange={(e) => setNotifTypes(prev => ({ ...prev, vialidad: e.target.checked }))}
                                className="h-4 w-4 bg-slate-900 border-slate-700 rounded text-blue-600 accent-blue-500 focus:ring-0 cursor-pointer"
                              />
                              <span className="text-xs text-slate-300 group-hover:text-white transition">🚧 Vialidad / Obras</span>
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Contribution activity */}
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Historial de tus Reportes</h4>
                      {reports.filter(r => r.creator === user.username).length === 0 ? (
                        <p className="text-xs text-slate-500 text-center py-4">Aún no has reportado ningún retén. ¡Ayuda a tu comunidad alertando controles!</p>
                      ) : (
                        <div className="space-y-3">
                          {reports.filter(r => r.creator === user.username).map((report) => (
                            <div key={report.id} className={`p-4 rounded-2xl border transition-colors duration-300 ${
                              nightMode ? 'bg-zinc-900/60 border-zinc-800' : 'bg-slate-800/40 border-slate-700/40'
                            }`}>
                              {editingReportId === report.id ? (
                                <div className="space-y-3">
                                  <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-400">Ubicación</label>
                                    <input
                                      type="text"
                                      value={editForm.locationName}
                                      onChange={(e) => setEditForm(prev => ({ ...prev, locationName: e.target.value }))}
                                      className="w-full mt-1 px-3 py-1.5 rounded-xl text-xs bg-slate-900 text-white border border-slate-700"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-400">Tipo de Control</label>
                                    <select
                                      value={editForm.type}
                                      onChange={(e) => setEditForm(prev => ({ ...prev, type: e.target.value as any }))}
                                      className="w-full mt-1 px-3 py-1.5 rounded-xl text-xs bg-slate-900 text-white border border-slate-700"
                                    >
                                      <option value="transito">🚨 Control de Tránsito</option>
                                      <option value="policia">👮 Control Policial</option>
                                      <option value="vialidad">🚧 Vialidad / Obras</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-400">Descripción (Opcional)</label>
                                    <textarea
                                      value={editForm.description}
                                      onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                                      rows={2}
                                      className="w-full mt-1 px-3 py-1.5 rounded-xl text-xs bg-slate-900 text-white border border-slate-700 font-mono"
                                      placeholder="Agrega una descripción..."
                                    />
                                  </div>
                                  <div className="flex gap-2 justify-end pt-1">
                                    <button
                                      onClick={() => setEditingReportId(null)}
                                      className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition"
                                    >
                                      Cancelar
                                    </button>
                                    <button
                                      onClick={() => handleSaveEdit(report.id)}
                                      className="px-4 py-1.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition shadow-md"
                                    >
                                      Guardar Cambios
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <div className="flex justify-between items-start gap-2 mb-2">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-1.5">
                                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider border ${getReportColor(report.type)}`}>
                                          {getReportLabel(report.type)}
                                        </span>
                                        <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider ${
                                          report.status === 'Activo' 
                                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                        }`}>
                                          {report.status}
                                        </span>
                                      </div>
                                      <span className="font-extrabold text-white text-xs block">{report.locationName}</span>
                                    </div>
                                    <span className="text-[10px] text-slate-500 shrink-0 font-medium">
                                      {new Date(report.reportedAt).toLocaleDateString()}
                                    </span>
                                  </div>

                                  {report.description && (
                                    <p className="text-[11px] text-slate-400 bg-slate-900/40 p-2 rounded-lg border border-slate-700/20 mb-2 font-mono">
                                      "{report.description}"
                                    </p>
                                  )}

                                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-2 border-t border-slate-700/20 mt-2">
                                    <div className="flex gap-2.5">
                                      <span className="text-emerald-500 font-medium">✔️ {report.votesUp || 0} confirmados</span>
                                      <span className="text-rose-500 font-medium">❌ {report.votesDown || 0} despejados</span>
                                    </div>
                                    <div className="flex gap-1.5">
                                      <button
                                        onClick={() => handleStartEdit(report)}
                                        className="px-2.5 py-1 rounded-lg bg-blue-600/10 text-blue-400 border border-blue-500/10 hover:bg-blue-600/20 transition-all font-bold text-[10px]"
                                      >
                                        Editar
                                      </button>
                                      <button
                                        onClick={() => handleDeleteReport(report.id)}
                                        className="px-2.5 py-1 rounded-lg bg-rose-600/10 text-rose-400 border border-rose-500/10 hover:bg-rose-600/20 transition-all font-bold text-[10px]"
                                      >
                                        Eliminar
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-800/40 rounded-2xl p-6 text-center border border-slate-700/40">
                    <UserIcon className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-xs text-slate-300 mb-4">Regístrate o inicia sesión para reportar retenes y ganar puntos de confianza.</p>
                    <div className="flex gap-2 justify-center">
                      <button 
                        onClick={() => setAuthMode('login')}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition"
                      >
                        Iniciar Sesión
                      </button>
                      <button 
                        onClick={() => setAuthMode('register')}
                        className="bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold px-4 py-2 rounded-xl transition"
                      >
                        Registrarse
                      </button>
                    </div>
                  </div>
                )}

                {/* Quick Guide Card */}
                <div 
                  onClick={() => {
                    setGuideStep(1);
                    setShowQuickGuide(true);
                  }}
                  className={`p-4 rounded-2xl border text-left cursor-pointer transition mt-4 ${
                    nightMode 
                      ? 'bg-zinc-900/60 border-zinc-800 hover:bg-zinc-800/80 hover:border-zinc-700' 
                      : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Compass className="h-4.5 w-4.5 text-blue-400 animate-pulse" />
                    <h4 className="text-xs font-bold text-white">Guía Rápida Vial</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Aprende cómo alertar un retén, utilizar los filtros de mapa y operar en el modo sin conexión en cualquier momento.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* USER AUTH MODAL OVERLAY */}
      {authMode && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-800 rounded-2xl p-6 shadow-2xl border border-slate-700 animate-in fade-in zoom-in">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-white">
                {authMode === 'login' ? 'Iniciar Sesión' : 'Registro de Ciudadano'}
              </h3>
              <button 
                onClick={() => setAuthMode(null)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {authError && (
              <div className="bg-rose-500/15 border border-rose-500/50 text-rose-300 p-2.5 rounded-xl text-xs mb-4">
                {authError}
              </div>
            )}

            <form onSubmit={handleAuth} className="space-y-4">
              {authMode === 'register' && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1">NOMBRE COMPLETO</label>
                    <input
                      type="text"
                      required
                      placeholder="Ej. Juan Pérez"
                      value={authForm.name}
                      onChange={e => setAuthForm(p => ({ ...p, name: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1">CORREO ELECTRÓNICO</label>
                    <input
                      type="email"
                      required
                      placeholder="juan@ejemplo.com"
                      value={authForm.email}
                      onChange={e => setAuthForm(p => ({ ...p, email: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">NOMBRE DE USUARIO</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. juanperez"
                  value={authForm.username}
                  onChange={e => setAuthForm(p => ({ ...p, username: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1 font-mono uppercase">Contraseña</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={authForm.password}
                  onChange={e => setAuthForm(p => ({ ...p, password: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-sm transition shadow-md"
              >
                {authMode === 'login' ? 'Entrar' : 'Completar Registro'}
              </button>
            </form>

            <div className="mt-4 text-center">
              <button
                onClick={() => {
                  setAuthError('');
                  setAuthMode(authMode === 'login' ? 'register' : 'login');
                }}
                className="text-xs text-blue-400 hover:underline"
              >
                {authMode === 'login' ? '¿No tienes cuenta? Regístrate aquí' : '¿Ya tienes una cuenta? Inicia sesión'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADMIN GOOGLE SHEETS INTEGRATION MODAL OVERLAY */}
      {showConfigPanel && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-800 rounded-2xl p-6 shadow-2xl border border-slate-700 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">Configuración de Sincronización</h3>
              </div>
              <button 
                onClick={() => {
                  setShowConfigPanel(false);
                  setConfigMessage({ type: '', text: '' });
                }}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {configMessage.text && (
              <div className={`p-3 rounded-xl text-xs mb-4 border ${
                configMessage.type === 'success' 
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300' 
                  : 'bg-rose-500/15 border-rose-500/50 text-rose-300'
              }`}>
                {configMessage.text}
              </div>
            )}

            {config.isConfigured ? (
              <div className="bg-blue-950/40 border border-blue-900/60 rounded-xl p-3.5 text-xs mb-4">
                <div className="flex items-center gap-2 text-blue-400 font-bold mb-1.5">
                  <Check className="h-4.5 w-4.5" />
                  <span>Conexión Activa con Google Sheets</span>
                </div>
                <p className="text-slate-300 leading-relaxed mb-3">
                  Los registros de usuarios y alertas en tiempo real están sincronizándose con tu hoja de cálculo centralizada de Google Sheets.
                </p>
                <div className="flex gap-2">
                  <a 
                    href={config.sheetLink} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg font-bold transition text-[11px]"
                  >
                    <span>Abrir Google Sheet</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <button
                    onClick={() => {
                      // Disconnect config
                      setConfig({ isConfigured: false, clientEmail: '', sheetId: '', sheetLink: '' });
                      setConfigForm({ clientEmail: '', privateKey: '', sheetId: '' });
                    }}
                    className="text-rose-400 hover:underline text-[11px]"
                  >
                    Desconectar cuenta de servicio
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-slate-900/60 p-3.5 rounded-xl text-xs mb-4 border border-slate-700/50">
                <h4 className="font-bold text-slate-200 mb-1">¿Cómo configurar Google Sheets?</h4>
                <ol className="list-decimal pl-4 text-slate-400 space-y-1 mt-1 leading-normal">
                  <li>Crea una nueva hoja de cálculo vacía en tu cuenta de Google Sheets.</li>
                  <li>Crea una <b>Cuenta de Servicio (Service Account)</b> en Google Cloud Console.</li>
                  <li>Habilita la <b>Google Sheets API</b> en el proyecto de Google Cloud.</li>
                  <li>Genera una clave en formato JSON para la Cuenta de Servicio.</li>
                  <li>Comparte la hoja de cálculo con el correo electrónico de la Cuenta de Servicio con permisos de <b>Editor</b>.</li>
                  <li>Completa los siguientes campos usando las credenciales JSON:</li>
                </ol>
              </div>
            )}

            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">CORREO DE LA CUENTA DE SERVICIO</label>
                <input
                  type="email"
                  required
                  placeholder="tu-servicio@proyecto.iam.gserviceaccount.com"
                  value={configForm.clientEmail}
                  onChange={e => setConfigForm(p => ({ ...p, clientEmail: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">GOOGLE SPREADSHEET ID</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. 1a2b3c4d5e6f7g8h9i0j..."
                  value={configForm.sheetId}
                  onChange={e => setConfigForm(p => ({ ...p, sheetId: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
                <p className="text-[10px] text-slate-500 mt-1 leading-normal">
                  El ID de la hoja se encuentra en su URL: docs.google.com/spreadsheets/d/<b>[S_ID]</b>/edit
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">PRIVATE KEY (PEM / JSON private_key)</label>
                <textarea
                  required
                  placeholder="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC6..."
                  value={configForm.privateKey}
                  onChange={e => setConfigForm(p => ({ ...p, privateKey: e.target.value }))}
                  rows={4}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConfigPanel(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 py-2.5 rounded-xl font-bold text-xs transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingConfig}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl font-bold text-xs transition shadow-md disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {isSavingConfig ? (
                    <>
                      <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Verificando...</span>
                    </>
                  ) : (
                    <span>Probar y Guardar</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* IOS STANDALONE INSTALL GUIDE OVERLAY */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-800 rounded-2xl p-6 shadow-2xl border border-slate-700">
            <h3 className="text-lg font-bold text-white mb-2">Instalar en tu iPhone o iPad</h3>
            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              iOS no soporta la instalación automatizada con un solo toque, pero puedes añadirlo a tu pantalla de inicio siguiendo estos pasos:
            </p>
            <div className="space-y-3 mb-6">
              <div className="flex gap-3 items-start text-xs text-slate-300">
                <span className="bg-slate-900 h-6 w-6 rounded-full flex items-center justify-center font-bold text-blue-400 shrink-0">1</span>
                <p>Presiona el botón de <b>Compartir</b> en la barra de navegación de Safari (el icono de un cuadro con una flecha apuntando hacia arriba).</p>
              </div>
              <div className="flex gap-3 items-start text-xs text-slate-300">
                <span className="bg-slate-900 h-6 w-6 rounded-full flex items-center justify-center font-bold text-blue-400 shrink-0">2</span>
                <p>Desplázate hacia abajo por el menú y selecciona <b>Añadir a pantalla de inicio</b>.</p>
              </div>
              <div className="flex gap-3 items-start text-xs text-slate-300">
                <span className="bg-slate-900 h-6 w-6 rounded-full flex items-center justify-center font-bold text-blue-400 shrink-0">3</span>
                <p>Haz clic en <b>Añadir</b> en la esquina superior derecha para completar la instalación de la PWA.</p>
              </div>
            </div>
            <button
              onClick={() => setShowIOSGuide(false)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs transition"
            >
              Cerrar Instrucciones
            </button>
          </div>
        </div>
      )}

      {/* QUICK ONBOARDING GUIDE MODAL OVERLAY */}
      {showQuickGuide && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-3xl p-6 shadow-2xl border transition-colors duration-300 ${
            nightMode ? 'bg-zinc-900 border-zinc-800 text-zinc-100' : 'bg-slate-800 border-slate-700 text-white'
          }`}>
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
              <span className="text-[10px] bg-blue-600/20 text-blue-400 font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider font-mono">
                Guía Rápida · Paso {guideStep} de 3
              </span>
              <button 
                onClick={() => {
                  localStorage.setItem('has_seen_guide', 'true');
                  setShowQuickGuide(false);
                }}
                className={`p-1.5 rounded-xl transition-colors ${
                  nightMode ? 'text-zinc-400 hover:bg-zinc-800 hover:text-white' : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Step Contents */}
            <div className="min-h-[220px] flex flex-col justify-center py-2">
              {guideStep === 1 && (
                <div className="space-y-4 animate-in fade-in zoom-in-95 duration-300">
                  <div className="h-16 w-16 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center justify-center text-3xl shadow-inner">
                    🚨
                  </div>
                  <h3 className="text-lg font-black tracking-tight text-white">1. Cómo reportar un retén</h3>
                  <p className={`text-xs leading-relaxed ${nightMode ? 'text-zinc-400' : 'text-slate-300'}`}>
                    Para alertar sobre un nuevo control de seguridad en tiempo real, simplemente <strong className="text-white">toca cualquier parte del mapa</strong>. 
                  </p>
                  <p className={`text-xs leading-relaxed ${nightMode ? 'text-zinc-400' : 'text-slate-300'}`}>
                    Se abrirá un asistente para elegir el tipo de control (Tránsito, Policía o Vialidad), agregar detalles y enviar el reporte de forma inmediata.
                  </p>
                </div>
              )}

              {guideStep === 2 && (
                <div className="space-y-4 animate-in fade-in zoom-in-95 duration-300">
                  <div className="h-16 w-16 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-center justify-center text-3xl shadow-inner">
                    🔍
                  </div>
                  <h3 className="text-lg font-black tracking-tight text-white">2. Filtrar por categoría</h3>
                  <p className={`text-xs leading-relaxed ${nightMode ? 'text-zinc-400' : 'text-slate-300'}`}>
                    ¿Quieres ver solo controles policiales o evitar obras viales? Utiliza el nuevo <strong className="text-white">Panel de Filtros de Mapa</strong> flotante ubicado en la esquina superior derecha.
                  </p>
                  <p className={`text-xs leading-relaxed ${nightMode ? 'text-zinc-400' : 'text-slate-300'}`}>
                    Toca cada categoría para activar o desactivar su visibilidad en el mapa al instante.
                  </p>
                </div>
              )}

              {guideStep === 3 && (
                <div className="space-y-4 animate-in fade-in zoom-in-95 duration-300">
                  <div className="h-16 w-16 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center text-3xl shadow-inner">
                    📶
                  </div>
                  <h3 className="text-lg font-black tracking-tight text-white">3. Funcionamiento Offline</h3>
                  <p className={`text-xs leading-relaxed ${nightMode ? 'text-zinc-400' : 'text-slate-300'}`}>
                    RetenAlerta funciona <strong className="text-white">sin conexión a internet</strong>. Podrás seguir viendo el mapa y los reportes almacenados en caché.
                  </p>
                  <p className={`text-xs leading-relaxed ${nightMode ? 'text-zinc-400' : 'text-slate-300'}`}>
                    Si creas un reporte sin cobertura, este se guardará en tu cola de espera y se sincronizará automáticamente con Google Sheets y el servidor en cuanto recuperes la señal.
                  </p>
                </div>
              )}
            </div>

            {/* Stepper Footer */}
            <div className={`mt-8 pt-4 border-t flex items-center justify-between ${
              nightMode ? 'border-zinc-800' : 'border-slate-700/50'
            }`}>
              {/* Dots indicator */}
              <div className="flex gap-1.5">
                {[1, 2, 3].map((s) => (
                  <button
                    key={s}
                    onClick={() => setGuideStep(s)}
                    className={`h-2 rounded-full transition-all duration-300 ${
                      guideStep === s ? 'w-6 bg-blue-500' : 'w-2 bg-slate-600'
                    }`}
                  />
                ))}
              </div>

              {/* Navigation buttons */}
              <div className="flex gap-2">
                {guideStep > 1 && (
                  <button
                    onClick={() => setGuideStep(prev => prev - 1)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                      nightMode ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-750' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                    }`}
                  >
                    Atrás
                  </button>
                )}
                
                {guideStep < 3 ? (
                  <button
                    onClick={() => setGuideStep(prev => prev + 1)}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition flex items-center gap-1 shadow-md"
                  >
                    <span>Siguiente</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      localStorage.setItem('has_seen_guide', 'true');
                      setShowQuickGuide(false);
                    }}
                    className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-md"
                  >
                    ¡Empezar!
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
