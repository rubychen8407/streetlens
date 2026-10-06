import { useEffect, useMemo, useRef, useState } from 'react';
import { t, bilingual, useLanguage } from '../i18n';
import L from 'leaflet';
import { LocationCoord, POIMarker, StreetSegmentScore, SavedLocation } from '../types';
import { savedScoreLocations, visibleSavedScores } from '../utils/savedScoreMap';
import { formatNumber } from '../utils/formatNumber';

interface ScoutMapProps {
  currentLocation: LocationCoord;
  targetLocation: LocationCoord;
  onSelectLocation: (coord: LocationCoord, streetName?: string) => void;
  onBackgroundClick?: () => boolean;
  streetSegments: StreetSegmentScore[];
  poiMarkers: POIMarker[];
  savedLocations?: SavedLocation[];
  onSelectSaved?: (saved: SavedLocation) => void;
  activeLayers: {
    c1Safety: boolean;
    c2Amenity: boolean;
    c3Transit: boolean;
    c4Green: boolean;
    c5Vitality: boolean;
    streetScores: boolean;
    walkingRadius: boolean;
  };
  mapTheme: 'dark' | 'light';
  accuracyRadius?: number;
  heading?: number | null;
}

export const CARTO_STORAGE_KEY = 'cls_scout_carto_api_key';
const NO_SAVED_LOCATIONS: SavedLocation[] = [];

export function getActiveCartoKey(): string {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(CARTO_STORAGE_KEY)?.trim();
    if (saved) return saved;
  }
  return (import.meta.env.VITE_CARTO_API_KEY as string | undefined)?.trim() || '';
}

function getTileConfig(theme: 'dark' | 'light', key?: string) {
  const cartoKey = key !== undefined ? key.trim() : getActiveCartoKey();

  if (cartoKey) {
    const tileThemePath = theme === 'dark' ? 'dark_all' : 'rastertiles/voyager';
    // CARTO basemap raster tiles support key query param
    return {
      isCarto: true,
      url: `https://{s}.basemaps.cartocdn.com/${tileThemePath}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoKey)}`,
      options: {
        maxZoom: 20,
        minZoom: 10,
        subdomains: 'abcd',
        className: '',
        attribution: '&copy; OpenStreetMap &copy; CARTO',
      },
    };
  }

  // High-res OpenStreetMap with Apple Maps Dark / Light styling (No API key needed)
  return {
    isCarto: false,
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      minZoom: 10,
      className: theme === 'dark' ? 'apple-map-dark-tiles' : 'apple-map-light-tiles',
      attribution: '&copy; OpenStreetMap contributors',
    },
  };
}

export function ScoutMap({
  currentLocation,
  targetLocation,
  onSelectLocation,
  onBackgroundClick,
  streetSegments,
  poiMarkers,
  savedLocations = NO_SAVED_LOCATIONS,
  onSelectSaved,
  activeLayers,
  mapTheme,
  accuracyRadius,
  heading,
}: ScoutMapProps) {
  const language = useLanguage();
  const savedScores = useMemo(() => savedScoreLocations(savedLocations), [savedLocations]);
  const savedSelectionHandler = useRef(onSelectSaved);
  savedSelectionHandler.current = onSelectSaved;
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const selectionHandler = useRef(onSelectLocation);
  selectionHandler.current = onSelectLocation;
  const backgroundHandler = useRef(onBackgroundClick);
  backgroundHandler.current = onBackgroundClick;
  const themeRef = useRef(mapTheme);
  themeRef.current = mapTheme;
  const mapRef = useRef<L.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const userCircleRef = useRef<L.Circle | null>(null);
  const targetMarkerRef = useRef<L.Marker | null>(null);
  const radiusCirclesRef = useRef<L.LayerGroup | null>(null);
  const streetLayersRef = useRef<L.LayerGroup | null>(null);
  const poiLayersRef = useRef<L.LayerGroup | null>(null);

  // Helper to mount tile layer with fallback protection
  const setupTileLayer = (theme: 'dark' | 'light', activeMap?: L.Map | null) => {
    const targetMap = activeMap || mapRef.current;
    if (!targetMap) return;
    if (tileLayerRef.current) {
      targetMap.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    const config = getTileConfig(theme);
    const tiles = L.tileLayer(config.url, config.options);

    // If CARTO tiles fail to load (e.g. invalid key or 403), fallback safely to styled OSM
    if (config.isCarto) {
      let errorTriggered = false;
      tiles.on('tileerror', () => {
        if (errorTriggered) return;
        errorTriggered = true;
        console.warn('CARTO tile failed to load. Falling back to OpenStreetMap with Apple Maps theme.');
        if (tileLayerRef.current === tiles) {
          targetMap.removeLayer(tiles);
          const fallback = getTileConfig(theme, ''); // empty key forces OSM
          const fallbackTiles = L.tileLayer(fallback.url, fallback.options).addTo(targetMap);
          tileLayerRef.current = fallbackTiles;
        }
      });
    }

    tiles.addTo(targetMap);
    tileLayerRef.current = tiles;
  };

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [targetLocation.lat, targetLocation.lng],
      zoom: 16,
      zoomControl: false,
      scrollWheelZoom: true,
      touchZoom: true,
      doubleClickZoom: true,
      dragging: true,
      attributionControl: false,
    });

    // Add minimal attribution
    L.control.attribution({ position: 'bottomright' }).addTo(map);

    // Layer groups
    radiusCirclesRef.current = L.layerGroup().addTo(map);
    streetLayersRef.current = L.layerGroup().addTo(map);
    poiLayersRef.current = L.layerGroup().addTo(map);

    // Dismiss an open workspace first; that click must not also move its pin.
    map.on('click', (e: L.LeafletMouseEvent) => {
      const target = e.originalEvent.target;
      const isBackground = !(target instanceof Element && target.closest('.leaflet-interactive, .leaflet-marker-icon, .leaflet-control, .leaflet-popup'));
      if (isBackground && backgroundHandler.current?.()) return;
      mapContainerRef.current?.focus({ preventScroll: true });
      selectionHandler.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    mapRef.current = map;
    setMapInstance(map);
    setupTileLayer(mapTheme, map);

    // Listen for custom event when key is updated in dialog
    const handleKeyChange = () => {
      setupTileLayer(themeRef.current, map);
    };
    window.addEventListener('carto_key_updated', handleKeyChange);

    return () => {
      window.removeEventListener('carto_key_updated', handleKeyChange);
      map.remove();
      mapRef.current = null;
      userMarkerRef.current = null;
      userCircleRef.current = null;
      targetMarkerRef.current = null;
      radiusCirclesRef.current = null;
      streetLayersRef.current = null;
      poiLayersRef.current = null;
      setMapInstance(null);
    };
  }, []);

  // Update Tile Layer when mapTheme changes
  useEffect(() => {
    if (!mapInstance) return;
    setupTileLayer(mapTheme, mapInstance);
  }, [mapTheme, mapInstance]);

  // Handle window resizing or layout shifts
  useEffect(() => {
    const handleResize = () => {
      mapInstance?.invalidateSize();
    };
    const observer = new ResizeObserver(handleResize);
    if (mapContainerRef.current) observer.observe(mapContainerRef.current);
    window.addEventListener('resize', handleResize);
    return () => { observer.disconnect(); window.removeEventListener('resize', handleResize); };
  }, [mapInstance]);

  // Update User GPS Location Marker (Apple Maps Style blue pulsating beacon + flashlight cone)
  useEffect(() => {
    if (!mapInstance) return;

    const rotDeg = heading !== null && heading !== undefined ? heading : 0;

    // Custom Apple Maps style location dot with dual pulse waves and high-contrast core
    const userIcon = L.divIcon({
      className: 'ios-user-marker',
      html: `
        <div style="position: relative; width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; user-select: none;">
          <!-- Outer Radar Pulse Ring (Large) -->
          <div class="user-pulse-outer" style="position: absolute; width: 48px; height: 48px; border-radius: 9999px; background: rgba(212, 249, 113, 0.12);"></div>

          <!-- Middle Pulse Ring (Tight) -->
          <div class="user-pulse-inner" style="position: absolute; width: 30px; height: 30px; border-radius: 9999px; background: rgba(212, 249, 113, 0.22);"></div>

          <!-- Solid Apple Blue/Lime Dot with White Border -->
          <div style="position: relative; width: 22px; height: 22px; border-radius: 9999px; background: #D4F971; border: 3.5px solid #ffffff; box-shadow: 0 0 14px #D4F971, 0 3px 10px rgba(0, 0, 0, 0.4); z-index: 10;">
            <!-- Micro specular highlight -->
            <div style="position: absolute; top: 2px; left: 3px; width: 4px; height: 4px; border-radius: 9999px; background: rgba(255, 255, 255, 0.85);"></div>
          </div>
        </div>
      `,
      iconSize: [56, 56],
      iconAnchor: [28, 28],
    });

    if (userMarkerRef.current && mapInstance.hasLayer(userMarkerRef.current)) {
      userMarkerRef.current.setLatLng([currentLocation.lat, currentLocation.lng]);
      userMarkerRef.current.setIcon(userIcon);
    } else {
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
      }
      userMarkerRef.current = L.marker([currentLocation.lat, currentLocation.lng], {
        icon: userIcon,
        zIndexOffset: 3000,
        interactive: false,
      }).addTo(mapInstance);
    }

    // Accuracy Circle
    if (accuracyRadius && accuracyRadius > 10) {
      if (userCircleRef.current && mapInstance.hasLayer(userCircleRef.current)) {
        userCircleRef.current.setLatLng([currentLocation.lat, currentLocation.lng]);
        userCircleRef.current.setRadius(accuracyRadius);
      } else {
        if (userCircleRef.current) {
          userCircleRef.current.remove();
        }
        userCircleRef.current = L.circle([currentLocation.lat, currentLocation.lng], {
          radius: accuracyRadius,
          color: '#D4F971',
          weight: 1.5,
          opacity: 0.45,
          fillColor: '#D4F971',
          fillOpacity: 0.08,
          interactive: false,
        }).addTo(mapInstance);
      }
    } else if (userCircleRef.current) {
      userCircleRef.current.remove();
      userCircleRef.current = null;
    }
  }, [mapInstance, currentLocation.lat, currentLocation.lng, accuracyRadius, heading]);

  // Update Target Marker (Draggable Apple-style red pin with distinct label)
  useEffect(() => {
    if (!mapInstance) return;

    const targetIcon = L.divIcon({
      className: 'ios-target-marker',
      html: `
        <div class="relative flex flex-col items-center cursor-grab active:cursor-grabbing select-none group" style="width: 36px; height: 44px;">
          <!-- Drop Pin Head with subtle glow and crosshair target icon -->
          <div class="w-8 h-8 rounded-full bg-[#1e2632] border-2 border-[#D4F971] shadow-[0_4px_16px_rgba(212,249,113,0.35),0_2px_8px_rgba(0,0,0,0.5)] flex items-center justify-center text-[#D4F971] transform group-hover:scale-115 transition-all">
            <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
          </div>
          <!-- Pin Needle Tip -->
          <div style="width: 2px; height: 6px; background: #D4F971; margin-top: -1px; box-shadow: 0 0 4px rgba(212,249,113,0.6);"></div>
          <!-- Ground Shadow -->
          <div style="width: 12px; height: 4px; background: rgba(0, 0, 0, 0.45); border-radius: 9999px; filter: blur(0.5px); margin-top: 1px;"></div>
        </div>
      `,
      iconSize: [36, 44],
      iconAnchor: [18, 42],
    });

    if (targetMarkerRef.current && mapInstance.hasLayer(targetMarkerRef.current)) {
      targetMarkerRef.current.setLatLng([targetLocation.lat, targetLocation.lng]);
    } else {
      if (targetMarkerRef.current) {
        targetMarkerRef.current.remove();
      }
      const marker = L.marker([targetLocation.lat, targetLocation.lng], {
        icon: targetIcon,
        draggable: true,
        zIndexOffset: 1500,
      }).addTo(mapInstance);

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        selectionHandler.current({ lat: pos.lat, lng: pos.lng });
      });
      marker.on('click', () => {
        mapContainerRef.current?.focus({ preventScroll: true });
        const pos = marker.getLatLng();
        selectionHandler.current({ lat: pos.lat, lng: pos.lng });
      });

      targetMarkerRef.current = marker;
    }

    // Smooth fly to target location when updated
    mapInstance.flyTo([targetLocation.lat, targetLocation.lng], Math.max(mapInstance.getZoom(), 16), {
      animate: true,
      duration: 0.8,
    });
  }, [mapInstance, targetLocation.lat, targetLocation.lng]);

  // Update Walking Radius Circles (300m / 500m)
  useEffect(() => {
    if (!radiusCirclesRef.current) return;
    radiusCirclesRef.current.clearLayers();

    if (activeLayers.walkingRadius) {
      // 300m (3-4 mins walk)
      const c300 = L.circle([targetLocation.lat, targetLocation.lng], {
        radius: 300,
        color: '#8090a3',
        weight: 1.2,
        dashArray: '4, 4',
        opacity: 0.45,
        fillColor: '#8090a3',
        fillOpacity: 0.03,
        interactive: false,
      });

      // 500m (5-7 mins walk)
      const c500 = L.circle([targetLocation.lat, targetLocation.lng], {
        radius: 500,
        color: '#65768a',
        weight: 1.2,
        dashArray: '6, 6',
        opacity: 0.35,
        fillColor: '#65768a',
        fillOpacity: 0.02,
        interactive: false,
      });

      radiusCirclesRef.current.addLayer(c300);
      radiusCirclesRef.current.addLayer(c500);
    }
  }, [mapInstance, targetLocation.lat, targetLocation.lng, activeLayers.walkingRadius]);

  // Update Street Heatmap Polylines
  useEffect(() => {
    if (!streetLayersRef.current) return;
    streetLayersRef.current.clearLayers();

    if (activeLayers.streetScores) {
      streetSegments.forEach((segment) => {
        const color =
          segment.clsScore == null
            ? '#64748b'
            : segment.clsScore >= 85
            ? '#10b981'
            : segment.clsScore >= 75
            ? '#6366f1'
            : segment.clsScore >= 65
            ? '#f59e0b'
            : '#ef4444';

        const poly = L.polyline(segment.coords, {
          color,
          weight: 5,
          opacity: 0.75,
          lineCap: 'round',
        });

        poly.bindTooltip(
          `<div class="text-xs font-bold px-1.5 py-0.5 bg-slate-900 text-white rounded">${segment.name} · ${segment.clsScore == null ? t('待補') : `${segment.clsScore} ${t('score')}`}</div>`,
          { permanent: false, sticky: true, className: 'street-custom-tooltip' }
        );

        streetLayersRef.current?.addLayer(poly);
      });
    }
  }, [mapInstance, streetSegments, activeLayers.streetScores, language]);

  // Local-only score overlay. Pan/zoom/layer changes never request history,
  // assessment, reverse-geocoding or source data. Bound DOM work to 200 labels.
  useEffect(() => {
    if (!mapInstance) return;
    const layer = L.layerGroup().addTo(mapInstance);
    const markers = new Map<string, L.Marker>();
    const draw = () => {
      if (!activeLayers.streetScores) return;
      const bounds = mapInstance.getBounds().pad(0.1);
      const records = visibleSavedScores(savedScores, { south:bounds.getSouth(), north:bounds.getNorth(), west:bounds.getWest(), east:bounds.getEast() });
      const visibleIds = new Set(records.map(record => record.id));
      for (const [id, marker] of markers) {
        if (!visibleIds.has(id)) { layer.removeLayer(marker); markers.delete(id); }
      }
      for (const record of records) {
        if (markers.has(record.id)) continue;
        const score = formatNumber(record.clsScore);
        const label = bilingual('已儲存 CLS', 'Saved CLS') + ' ' + score + ' · ' + (record.name || record.streetName);
        const badge = document.createElement('div');
        badge.className = 'saved-score-badge';
        const caption = document.createElement('span'); caption.textContent = 'CLS';
        const value = document.createElement('strong'); value.textContent = score;
        badge.append(caption, value);
        const marker = L.marker([record.coords.lat, record.coords.lng], {
          icon:L.divIcon({ className:'saved-score-marker', html:badge, iconSize:[64,44], iconAnchor:[32,-8] }),
          title:label, alt:label, keyboard:true, bubblingMouseEvents:false, zIndexOffset:1800,
        });
        const tooltip = document.createElement('div');
        // User names are text, never HTML. No photo URLs or remote icons.
        tooltip.textContent = label + '\n' + new Date(record.timestamp).toLocaleString(language === 'en' ? 'en' : 'zh-TW');
        marker.bindTooltip(tooltip, { direction:'bottom', offset:[0,48], className:'saved-score-tooltip' });
        marker.on('click', () => savedSelectionHandler.current?.(record));
        layer.addLayer(marker);
        markers.set(record.id, marker);
        const element = marker.getElement();
        element?.setAttribute('aria-label',label);
        element?.setAttribute('role','button');
        element?.setAttribute('data-saved-assessment-id',record.id);
        element?.addEventListener('keydown', event => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault(); event.stopPropagation(); savedSelectionHandler.current?.(record);
          }
        });
      }
    };
    draw();
    mapInstance.on('moveend',draw);
    return () => { mapInstance.off('moveend',draw); layer.remove(); };
  }, [mapInstance, savedScores, activeLayers.streetScores, language]);

  // Update POI Markers (Apple Maps style icons)
  useEffect(() => {
    if (!poiLayersRef.current) return;
    poiLayersRef.current.clearLayers();

    const catEnabled = (cat: string) => {
      if (cat === 'C1') return activeLayers.c1Safety;
      if (cat === 'C2') return activeLayers.c2Amenity;
      if (cat === 'C3') return activeLayers.c3Transit;
      if (cat === 'C4') return activeLayers.c4Green;
      if (cat === 'C5') return activeLayers.c5Vitality;
      return true;
    };

    poiMarkers.forEach((poi) => {
      if (!catEnabled(poi.category)) return;

      let bg = 'bg-amber-500';
      let icon = '🛒';
      if (poi.category === 'C1') {
        bg = 'bg-rose-500';
        icon = '🛡️';
      } else if (poi.category === 'C3') {
        bg = 'bg-sky-500';
        icon = '🚇';
      } else if (poi.category === 'C4') {
        bg = 'bg-emerald-500';
        icon = '🌳';
      } else if (poi.category === 'C5') {
        bg = 'bg-purple-500';
        icon = '👥';
      }

      const poiIcon = L.divIcon({
        className: 'ios-poi-marker',
        html: `
          <div class="relative flex items-center justify-center -ml-3.5 -mt-3.5 cursor-pointer group">
            <div class="w-7 h-7 rounded-full ${bg} border border-white/80 shadow-md flex items-center justify-center text-xs transform group-hover:scale-125 transition-transform">
              <span>${icon}</span>
            </div>
          </div>
        `,
        iconSize: [0, 0],
      });

      const marker = L.marker([poi.lat, poi.lng], { icon: poiIcon });
      marker.bindTooltip(
        `<div class="text-xs font-semibold px-2 py-1 bg-black/85 backdrop-blur-md text-white rounded-lg shadow-lg border border-white/10">
          <div class="font-bold text-slate-100">${poi.name}</div>
          <div class="text-[10px] text-slate-300">${bilingual('約', 'About')} ${poi.distanceMeters}m · ${t(poi.note || '')}</div>
        </div>`,
        { direction: 'top', offset: [0, -10] }
      );

      poiLayersRef.current?.addLayer(marker);
    });
  }, [mapInstance, poiMarkers, activeLayers, language]);

  return (
    <div
      ref={mapContainerRef}
      className="w-full h-full absolute inset-0 z-0 bg-slate-900 outline-none"
      id="leaflet-apple-map"
      tabIndex={0}
      aria-label={t('街道地圖')}
      aria-description={t('點選街道查看評估；鍵盤 Enter 查看地圖中心。')}
      onKeyDown={event => {
        if (event.key !== 'Enter' || event.target !== event.currentTarget || !mapInstance) return;
        event.preventDefault();
        const center = mapInstance.getCenter();
        selectionHandler.current({ lat: center.lat, lng: center.lng });
      }}
    />
  );
}
