/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  LocationCoord,
  C1Data,
  C2Data,
  C3Data,
  C4Data,
  C5Data,
  CLSWeights,
  FieldObservationAdjustment,
  POIMarker,
  StreetSegmentScore,
  WeatherData,
  SavedLocation,
  StreetAssessmentResponse,
  ScoreFactor,
  AssessmentEvidence,
  EvidencePhotoDraft,
} from './types';
import {
  DEFAULT_CLS_WEIGHTS,
} from './data/fieldIndicators';
import { ScoutMap } from './components/ScoutMap';
import { FloatingControls } from './components/FloatingControls';
import { AssessmentWorkspace } from './components/AssessmentWorkspace';
import {
  generateSurroundingStreetSegments,
} from './utils/scoreCalculator';
import {
  deleteEvidencePhotos,
  loadEvidencePhotoUrl,
  prepareEvidencePhoto,
  storeEvidencePhoto,
} from './utils/evidenceStore';

export default function App() {
  // Default coordinates: Taipei Daan Yongkang Area
  const defaultLocation: LocationCoord = { lat: 25.0326, lng: 121.5298 };
  const [currentLocation, setCurrentLocation] = useState<LocationCoord>(defaultLocation);
  const [targetLocation, setTargetLocation] = useState<LocationCoord>(defaultLocation);
  const [accuracyRadius, setAccuracyRadius] = useState<number | undefined>(20);
  const [isLocatingGPS, setIsLocatingGPS] = useState(false);
  const [hasLocated, setHasLocated] = useState(false);
  const [heading, setHeading] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsSuccessMsg, setGpsSuccessMsg] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  // Address
  const [streetName, setStreetName] = useState('永康街商圈');
  const [district, setDistrict] = useState('大安區');
  const [city, setCity] = useState('台北市');

  // Real-time environmental & POI data for the selected location
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [nearbyPois, setNearbyPois] = useState<POIMarker[]>([]);
  const [realStreetSegments, setRealStreetSegments] = useState<StreetSegmentScore[]>([]);

  // Map theme: default to dark to match the Apple Maps dark screenshot
  const [mapTheme, setMapTheme] = useState<'dark' | 'light'>('dark');

  // Bottom Sheet Visibility
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<'assessment' | 'saved' | 'settings'>('assessment');
  const [favoriteLocations, setFavoriteLocations] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('cls_favorite_locations') || '[]'); } catch { return []; }
  });
  const favoriteKey = (coord: LocationCoord, name: string) =>
    coord.lat.toFixed(5) + ':' + coord.lng.toFixed(5) + ':' + name.trim().toLowerCase();
  const isFavorite = favoriteLocations.includes(favoriteKey(targetLocation, streetName));
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>(() => {
    try { return JSON.parse(localStorage.getItem('cls_saved_locations') || '[]'); } catch { return []; }
  });

  // Weights
  const [weights, setWeights] = useState<CLSWeights>(DEFAULT_CLS_WEIGHTS);
  const [weightMode, setWeightMode] = useState<'equal' | 'pca' | 'custom'>('equal');

  // Field observation draft
  const [observationRatings, setObservationRatings] = useState<Record<string, number>>({});
  const [fieldNotes, setFieldNotes] = useState<string>('');
  const [evidenceDrafts, setEvidenceDrafts] = useState<EvidencePhotoDraft[]>([]);
  const [selectedSavedEvidence, setSelectedSavedEvidence] = useState<AssessmentEvidence[]>([]);
  const [savedEvidenceUrls, setSavedEvidenceUrls] = useState<Record<string, string>>({});
  const savedEvidenceUrlsRef = useRef<Record<string, string>>({});
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  // Source-backed assessment state. Scores are returned by the backend only.
  const [assessment, setAssessment] = useState<StreetAssessmentResponse | null>(null);
  const [fieldAdjustment, setFieldAdjustment] = useState<FieldObservationAdjustment | null>(null);
  const [isPreviewingFieldAdjustment, setIsPreviewingFieldAdjustment] = useState(false);
  const [isSavingAssessment, setIsSavingAssessment] = useState(false);
  const fieldAdjustmentRequestRef = useRef(0);
  const [c1, setC1] = useState<C1Data>({ crimeRate: null, accidentRate: null, hazardLevel: null, wCrime: 0.333, wAccident: 0.333, wHazard: 0.333, score: null });
  const [c2, setC2] = useState<C2Data>({ supermarketDist: null, convenienceDist: null, clinicDist: null, schoolDist: null, bankPostDist: null, decayBeta: null, poiDensityCount: null, score: null });
  const [c3, setC3] = useState<C3Data>({ mrtOrRailDist: null, busStopDist: null, busFrequencyScore: null, walkabilityScore: null, bikeLaneScore: null, wTransit: 0.4, wWalk: 0.35, wBike: 0.25, score: null });
  const [c4, setC4] = useState<C4Data>({ airQualityScore: null, noiseScore: null, greenCoveragePct: null, parkDistance: null, parkAccessScore: null, wAir: 0.25, wNoise: 0.25, wGreen: 0.25, wPark: 0.25, score: null });
  const [c5, setC5] = useState<C5Data>({ activityFrequency: null, neighborhoodTrust: null, jobCommercialDensity: null, governanceParticipation: null, wActivity: 0.25, wTrust: 0.25, wJobs: 0.25, wGovernance: 0.25, score: null });
  const [isLoadingBaseline, setIsLoadingBaseline] = useState<boolean>(false);
  const [baselineSummary, setBaselineSummary] = useState<string>('等待已儲存資料…');

  // Map active layers
  const [activeLayers, setActiveLayers] = useState({
    c1Safety: true,
    c2Amenity: true,
    c3Transit: true,
    c4Green: true,
    c5Vitality: true,
    streetScores: true,
    walkingRadius: true,
  });

  // Never calculate scores in the browser. The backend is the single source of truth.
  const clsScore = fieldAdjustment !== null ? fieldAdjustment.adjustedCls : assessment?.scores.overall ?? null;
  const baselineClsScore = fieldAdjustment !== null ? fieldAdjustment.baselineCls : assessment?.scores.overall ?? null;
  const clsGrade = clsScore == null ? null : clsScore >= 90 ? 'S' : clsScore >= 80 ? 'A' : clsScore >= 70 ? 'B' : clsScore >= 60 ? 'C' : 'D';


  const revokeDraftEvidence = (drafts: EvidencePhotoDraft[]) => {
    for (const draft of drafts) URL.revokeObjectURL(draft.previewUrl);
  };

  const clearEvidenceDrafts = useCallback(() => {
    setEvidenceDrafts(prev => {
      revokeDraftEvidence(prev);
      return [];
    });
    setEvidenceError(null);
  }, []);

  const handleAddEvidencePhotos = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setEvidenceError(null);
    const additions: EvidencePhotoDraft[] = [];

    for (const file of Array.from(files)) {
      try {
        const prepared = await prepareEvidencePhoto(file);
        const id = 'evidence_' + crypto.randomUUID();
        additions.push({
          id,
          fileName: file.name,
          blob: prepared.blob,
          previewUrl: URL.createObjectURL(prepared.blob),
          capturedAt: Date.now(),
          location: targetLocation,
          note: '',
          mimeType: prepared.mimeType,
          width: prepared.width,
          height: prepared.height,
        });
      } catch (error) {
        console.warn('Evidence photo preparation error:', error);
        setEvidenceError('部分照片無法加入，請確認檔案是可讀取的圖片。');
      }
    }

    if (additions.length > 0) {
      setEvidenceDrafts(prev => [...prev, ...additions].slice(0, 6));
    }
  }, [targetLocation]);

  const handleRemoveEvidencePhoto = useCallback((id: string) => {
    setEvidenceDrafts(prev => {
      const draft = prev.find(item => item.id === id);
      if (draft) URL.revokeObjectURL(draft.previewUrl);
      return prev.filter(item => item.id !== id);
    });
  }, []);

  const handleUpdateEvidenceNote = useCallback((id: string, note: string) => {
    setEvidenceDrafts(prev => prev.map(item => item.id === id ? { ...item, note } : item));
  }, []);

  // Fetch real-time weather & air quality for coordinate
  const fetchWeather = async (coord: LocationCoord) => {
    try {
      const res = await fetch(`/api/weather?lat=${coord.lat}&lng=${coord.lng}`);
      if (res.ok) {
        const wData = await res.json();
        setWeatherData(wData);
        if (wData && typeof wData.aqi === 'number') {
          // Dynamic EPA Air Quality integration into C4
          // C4 scoring is calculated by the backend from persisted source data.
        }
      }
    } catch (e) {
      console.warn('Weather fetch error:', e);
    }
  };

  // Fetch real-time nearby POIs for coordinate
  const fetchNearbyPois = async (coord: LocationCoord, dist: string, c: string, street: string) => {
    try {
      const res = await fetch(
        `/api/nearby-pois?lat=${coord.lat}&lng=${coord.lng}&district=${encodeURIComponent(
          dist
        )}&city=${encodeURIComponent(c)}&streetName=${encodeURIComponent(street)}`
      );
      if (res.ok) {
        const pData = await res.json();
        if (Array.isArray(pData.pois) && pData.pois.length > 0) {
          setNearbyPois(pData.pois);
        }
      }
    } catch (e) {
      console.warn('Nearby POIs fetch error:', e);
    }
  };

  // Fetch real street road network geometry from Google Routes API
  const fetchStreetNetwork = async (coord: LocationCoord, street: string) => {
    try {
      const res = await fetch(
        `/api/street-network?lat=${coord.lat}&lng=${coord.lng}&streetName=${encodeURIComponent(street)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.segments) && data.segments.length > 0) {
          setRealStreetSegments(data.segments);
        }
      }
    } catch (e) {
      console.warn('Street network fetch error:', e);
    }
  };

  // Read persisted assessment data. This request never fetches external sources.
  const fetchLocationData = useCallback(async (coord: LocationCoord, targetDist: string = district, targetCity: string = city, targetStreet: string = streetName, resetDraft = false) => {
    if (resetDraft) {
      setObservationRatings({});
      clearEvidenceDrafts();
      setSelectedSavedEvidence([]);
      Object.values(savedEvidenceUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
      savedEvidenceUrlsRef.current = {};
      setSavedEvidenceUrls({});
      setFieldNotes('');
      setFieldAdjustment(null);
      setAssessment(null);
      setEvidenceError(null);
      setBaselineSummary('正在載入新的街道資料…');
      setWeatherData(null);
      setNearbyPois([]);
      setRealStreetSegments([]);
    }
    setIsLoadingBaseline(true);
    try {
      await Promise.all([fetchWeather(coord), fetchNearbyPois(coord, targetDist, targetCity, targetStreet), fetchStreetNetwork(coord, targetStreet)]);
      const url = '/api/assessment?lat=' + coord.lat + '&lng=' + coord.lng + '&district=' + encodeURIComponent(targetDist) + '&city=' + encodeURIComponent(targetCity) + '&streetName=' + encodeURIComponent(targetStreet);
      const res = await fetch(url);
      if (res.status === 202) { setAssessment(null); setBaselineSummary('此座標尚未有已儲存資料；背景更新後即可取得評估。'); return; }
      if (!res.ok) throw new Error('assessment request failed: ' + res.status);
      const data: StreetAssessmentResponse = await res.json();
      setAssessment(data);
      setFieldAdjustment(null);
      setBaselineSummary(data.dataSources.length ? '資料來源：' + data.dataSources.join('、') : '資料來源資訊不足');
      const factor = (name: string) => data.factors.find((item) => item.indicator === name)?.value ?? null;
      setC1((prev) => ({ ...prev, accidentRate: factor('trafficAccidentCount500m'), score: data.scores.c1.score }));
      setC2((prev) => ({ ...prev, supermarketDist: factor('supermarketDist'), convenienceDist: factor('convenienceDist'), clinicDist: factor('clinicDist'), schoolDist: factor('schoolDist'), bankPostDist: factor('bankPostDist'), poiDensityCount: factor('poiDensityCount'), score: data.scores.c2.score }));
      setC3((prev) => ({ ...prev, mrtOrRailDist: factor('mrtOrRailDist'), busStopDist: factor('busStopDist'), score: data.scores.c3.score }));
      setC4((prev) => ({ ...prev, airQualityScore: factor('airQualityScore'), score: data.scores.c4.score }));
      setC5((prev) => ({ ...prev, activityFrequency: factor('communityCulturalPoiCount800m'), score: data.scores.c5.score }));
      setStreetName(data.location.streetName || targetStreet); setDistrict(data.location.district || targetDist); setCity(data.location.city || targetCity);
    } catch (err) { console.warn('Assessment load error', err); setAssessment(null); setBaselineSummary('目前無法取得已儲存的評估資料。'); }
    finally { setIsLoadingBaseline(false); }
  }, [district, city, streetName, clearEvidenceDrafts]);

  // Auto-fetch baseline data
  const handleAutoFetchBaseline = useCallback(() => {
    fetchLocationData(targetLocation, district, city, streetName);
  }, [fetchLocationData, targetLocation, district, city, streetName]);

  // Reverse Geocoding with automatic data refresh
  const fetchAddressFromCoords = async (coord: LocationCoord) => {
    try {
      const res = await fetch(`/api/reverse-geocode?lat=${coord.lat}&lon=${coord.lng}`);
      let resolvedRoad = streetName;
      let resolvedDistrict = district;
      let resolvedCity = city;

      if (res.ok) {
        const data = await res.json();
        if (data && data.address) {
          resolvedRoad =
            data.address.road ||
            data.address.pedestrian ||
            data.address.neighbourhood ||
            data.address.suburb ||
            '實勘路段';
          resolvedDistrict = data.address.suburb || data.address.district || data.address.town || district;
          resolvedCity = data.address.city || data.address.county || city;

          setStreetName(resolvedRoad);
          setDistrict(resolvedDistrict);
          setCity(resolvedCity);
        }
      }

      // Automatically fetch updated data for this new location!
      fetchLocationData(coord, resolvedDistrict, resolvedCity, resolvedRoad, true);
    } catch (err) {
      console.warn('Reverse geocode error', err);
      fetchLocationData(coord, district, city, streetName, true);
    }
  };

  // Initial load: fetch baseline data & weather for default location
  useEffect(() => {
    fetchLocationData(defaultLocation, '大安區', '台北市', '永康街商圈');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Select and load a saved location from the Bottom Sheet
  const handleSelectSavedLocation = (saved: SavedLocation) => {
    setTargetLocation(saved.coords);
    setStreetName(saved.streetName);
    setDistrict(saved.district);
    setCity(saved.city);
    if (saved.c1Data) setC1(saved.c1Data);
    if (saved.c2Data) setC2(saved.c2Data);
    if (saved.c3Data) setC3(saved.c3Data);
    if (saved.c4Data) setC4(saved.c4Data);
    if (saved.c5Data) setC5(saved.c5Data);
    if (saved.weights) setWeights(saved.weights);
    let restoredNotes = saved.fieldNotes || '';
    let restoredRatings = saved.observationRatings || {};
    if (!saved.observationRatings && restoredNotes.trim().startsWith('{')) {
      try {
        const legacy = JSON.parse(restoredNotes) as {
          notes?: unknown;
          observationRatings?: Record<string, unknown>;
        };
        if (typeof legacy.notes === 'string') restoredNotes = legacy.notes;
        if (legacy.observationRatings && typeof legacy.observationRatings === 'object') {
          restoredRatings = Object.fromEntries(
            Object.entries(legacy.observationRatings)
              .filter(([, value]) => Number.isFinite(Number(value)))
              .map(([key, value]) => [key, Number(value)]),
          );
        }
      } catch {
        // Keep the original field note when an older saved record is not JSON.
      }
    }
    setFieldNotes(restoredNotes);
    setObservationRatings(restoredRatings);
    setAssessment(saved.assessmentSnapshot || null);
    setFieldAdjustment(
      saved.baselineClsScore != null || saved.fieldAdjustmentDetails
        ? {
            baselineCls: saved.baselineClsScore ?? null,
            adjustedCls: saved.clsScore,
            adjustment: saved.fieldAdjustment ?? 0,
            categoryAdjustments: saved.fieldAdjustmentDetails?.categoryAdjustments ?? { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0 },
            itemAdjustments: saved.fieldAdjustmentDetails?.itemAdjustments ?? {},
            ratedItemCount: saved.fieldAdjustmentDetails?.ratedItemCount ?? Object.keys(saved.observationRatings || {}).length,
          }
        : null,
    );
    fetchWeather(saved.coords);
    setGpsSuccessMsg('已切換至已存地點【' + (saved.name || saved.streetName) + '】(CLS: ' + (saved.clsScore ?? '—') + '分)');
    setTimeout(() => setGpsSuccessMsg(null), 4000);
  };

  // Reliable Browser Geolocation Handler
  const handleLocateMe = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError('您的瀏覽器不支援 GPS 定位服務');
      return;
    }
    setIsLocatingGPS(true);
    setGpsError(null);

    // Primary attempt: High-accuracy GPS with ample timeout for browser permission dialog
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newCoord = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCurrentLocation(newCoord);
        setTargetLocation(newCoord);
        setAccuracyRadius(pos.coords.accuracy || 15);
        if (pos.coords.heading !== null && !isNaN(pos.coords.heading)) {
          setHeading(pos.coords.heading);
        }
        setIsLocatingGPS(false);
        setHasLocated(true);
        setGpsSuccessMsg(`已精確定位到所在位置（誤差約 ±${Math.round(pos.coords.accuracy || 15)}公尺）`);
        setTimeout(() => setGpsSuccessMsg(null), 4000);
        fetchAddressFromCoords(newCoord);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setIsLocatingGPS(false);
          setGpsError('已拒絕位置存取。請在瀏覽器網址列旁開啟「位置存取權限」以顯示目前位置');
          return;
        }

        // Secondary fallback: Fast cell/network location
        navigator.geolocation.getCurrentPosition(
          (secondPos) => {
            const newCoord = { lat: secondPos.coords.latitude, lng: secondPos.coords.longitude };
            setCurrentLocation(newCoord);
            setTargetLocation(newCoord);
            setAccuracyRadius(secondPos.coords.accuracy || 40);
            setIsLocatingGPS(false);
            setHasLocated(true);
            setGpsSuccessMsg(`已定位到所在位置（基地台輔助定位，誤差約 ±${Math.round(secondPos.coords.accuracy || 40)}公尺）`);
            setTimeout(() => setGpsSuccessMsg(null), 4000);
            fetchAddressFromCoords(newCoord);
          },
          (secondErr) => {
            setIsLocatingGPS(false);
            if (secondErr.code === secondErr.PERMISSION_DENIED) {
              setGpsError('請在瀏覽器網址列旁允許位置權限');
            } else {
              setGpsError('目前無法取得裝置 GPS 訊號，您可以直接在上方搜尋框輸入地址');
            }
          },
          {
            enableHighAccuracy: false,
            timeout: 8000,
            maximumAge: 60000,
          }
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 10000,
      }
    );
  }, []);

  // Initial auto-locate on app start
  useEffect(() => {
    handleLocateMe();
  }, [handleLocateMe]);

  // Continuous Real-Time GPS Tracking via watchPosition
  useEffect(() => {
    if (!navigator.geolocation) return;

    // Start watching position in real-time
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const newCoord = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCurrentLocation(newCoord);
        setAccuracyRadius(pos.coords.accuracy || 15);
        setGpsError(null);
        if (pos.coords.heading !== null && !isNaN(pos.coords.heading)) {
          setHeading(pos.coords.heading);
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          console.warn('Geolocation permission not granted yet');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 5000,
      }
    );

    watchIdRef.current = id;

    // Optional compass orientation for mobile devices
    const handleOrientation = (e: DeviceOrientationEvent) => {
      const compass = (e as any).webkitCompassHeading || (e.alpha ? 360 - e.alpha : null);
      if (compass !== null && compass !== undefined) {
        setHeading(Math.round(compass));
      }
    };

    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation);
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, []);

  // Update weights
  const handleUpdateWeights = (newWeights: CLSWeights, mode: 'equal' | 'pca' | 'custom') => {
    setWeights(newWeights);
    setWeightMode(mode);
  };

  const handleSaveAssessment = useCallback(async (name: string, notes: string): Promise<boolean> => {
    setIsSavingAssessment(true);
    let adjustment = fieldAdjustment;

    if (baselineClsScore != null || Object.keys(observationRatings).length > 0) {
      try {
        const response = await fetch('/api/assessment/field-adjustment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baselineCls: baselineClsScore, ratings: observationRatings }),
        });
        if (!response.ok) throw new Error('field adjustment request failed: ' + response.status);
        adjustment = await response.json() as FieldObservationAdjustment;
        setFieldAdjustment(adjustment);
      } catch (error) {
        console.warn('Field observation adjustment error:', error);
        setFieldAdjustment(null);
        setIsSavingAssessment(false);
        return false;
      }
    }

    const savedClsScore = adjustment?.adjustedCls ?? baselineClsScore;
    const savedGrade = savedClsScore == null ? null : savedClsScore >= 90 ? 'S' : savedClsScore >= 80 ? 'A' : savedClsScore >= 70 ? 'B' : savedClsScore >= 60 ? 'C' : 'D';
    const entry: SavedLocation = {
      id: 'saved_' + crypto.randomUUID(),
      name,
      streetName: streetName || 'Selected street',
      district,
      city,
      coords: targetLocation,
      clsScore: savedClsScore,
      baselineClsScore,
      fieldAdjustment: adjustment?.adjustment ?? null,
      fieldAdjustmentDetails: adjustment ? {
        categoryAdjustments: adjustment.categoryAdjustments,
        itemAdjustments: adjustment.itemAdjustments,
        ratedItemCount: adjustment.ratedItemCount,
      } : undefined,
      observationRatings,
      assessmentSnapshot: assessment ?? undefined,
      grade: savedGrade,
      scores: {
        c1: assessment?.scores.c1.score ?? null,
        c2: assessment?.scores.c2.score ?? null,
        c3: assessment?.scores.c3.score ?? null,
        c4: assessment?.scores.c4.score ?? null,
        c5: assessment?.scores.c5.score ?? null,
      },
      c1Data: c1,
      c2Data: c2,
      c3Data: c3,
      c4Data: c4,
      c5Data: c5,
      weights,
      fieldNotes: notes,
      timestamp: Date.now(),
    };
    setSavedLocations(prev => {
      const next = [entry, ...prev];
      try { localStorage.setItem('cls_saved_locations', JSON.stringify(next)); } catch {}
      return next;
    });
    setIsSavingAssessment(false);
    return true;
  }, [streetName, district, city, targetLocation, baselineClsScore, fieldAdjustment, observationRatings, assessment, c1, c2, c3, c4, c5, weights]);
  useEffect(() => {
    if (!isSheetOpen || workspaceView !== 'assessment') return;

    const requestId = ++fieldAdjustmentRequestRef.current;
    const timer = window.setTimeout(async () => {
      if (baselineClsScore == null && Object.keys(observationRatings).length === 0) {
        setFieldAdjustment(null);
        setIsPreviewingFieldAdjustment(false);
        return;
      }

      setIsPreviewingFieldAdjustment(true);
      try {
        const response = await fetch('/api/assessment/field-adjustment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baselineCls: baselineClsScore, ratings: observationRatings }),
        });
        if (!response.ok) throw new Error('field adjustment preview failed: ' + response.status);
        const result = await response.json() as FieldObservationAdjustment;
        if (requestId === fieldAdjustmentRequestRef.current) setFieldAdjustment(result);
      } catch (error) {
        if (requestId === fieldAdjustmentRequestRef.current) console.warn('Field observation adjustment preview error:', error);
      } finally {
        if (requestId === fieldAdjustmentRequestRef.current) setIsPreviewingFieldAdjustment(false);
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [isSheetOpen, workspaceView, observationRatings, baselineClsScore]);
  const handleToggleFavorite = useCallback(() => {
    const key = favoriteKey(targetLocation, streetName);
    setFavoriteLocations(prev => {
      const next = prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key];
      try { localStorage.setItem('cls_favorite_locations', JSON.stringify(next)); } catch {}
      return next;
    });
  }, [targetLocation, streetName]);

  const handleDeleteSaved = useCallback((id: string) => {
    setSavedLocations(prev => {
      const next = prev.filter(item => item.id !== id);
      try { localStorage.setItem('cls_saved_locations', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // Map POIs & Street Segments (100% real Google Routes & OSRM road geometry)
  const streetSegments: StreetSegmentScore[] = useMemo(() => {
    return realStreetSegments || [];
  }, [realStreetSegments]);

  // Only ever show real POIs fetched from the backend (Google Places /
  // OSM). If none are available yet, no markers render for that area
  // rather than falling back to placeholder data.
  const activePoiMarkers = nearbyPois;

  return (
    <div className="fixed inset-0 w-full h-full overflow-hidden select-none bg-slate-950 font-sans" id="app-root">
      {/* 1. Fullscreen Edge-to-Edge Map (Apple Maps Aesthetic) */}
      <ScoutMap
        currentLocation={currentLocation}
        targetLocation={targetLocation}
        onSelectLocation={(coord, customName) => {
          setTargetLocation(coord);
          if (customName) {
            setStreetName(customName);
            fetchLocationData(coord, district, city, customName, true);
          } else {
            fetchAddressFromCoords(coord);
          }
        }}
        streetSegments={streetSegments}
        poiMarkers={activePoiMarkers}
        activeLayers={activeLayers}
        mapTheme={mapTheme}
        accuracyRadius={accuracyRadius}
        heading={heading}
      />

      {/* GPS Status / Success Toast Banner */}
      {gpsSuccessMsg && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 px-4 py-2 bg-emerald-600/90 backdrop-blur-md text-white text-xs font-semibold rounded-full shadow-xl border border-emerald-400/40 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <span>{gpsSuccessMsg}</span>
          <button
            type="button"
            onClick={() => setGpsSuccessMsg(null)}
            className="w-4 h-4 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-[10px]"
          >
            ✕
          </button>
        </div>
      )}

      {gpsError && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 px-4 py-2 bg-rose-500/90 backdrop-blur-md text-white text-xs font-medium rounded-full shadow-xl border border-rose-400/40 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <span>{gpsError}</span>
          <button
            type="button"
            onClick={() => setGpsError(null)}
            className="w-4 h-4 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-[10px]"
          >
            ✕
          </button>
        </div>
      )}

      {/* 2. Floating iOS Style Overlays (Weather, Score Pill, Search Bar, Action Buttons) */}
      <FloatingControls
        currentStreetName={streetName}
        district={district}
        city={city}
        clsScore={clsScore}
        grade={clsGrade}
        isLocatingGPS={isLocatingGPS}
        onLocateMe={handleLocateMe}
        onSelectCoordinate={(coord, name, dist, c) => {
          setTargetLocation(coord);
          setStreetName(name);
          const newDist = dist || district;
          const newCity = c || city;
          if (dist) setDistrict(dist);
          if (c) setCity(c);
          fetchLocationData(coord, newDist, newCity, name, true);
        }}
        onOpenSheet={() => setIsSheetOpen(true)}
        onOpenSaved={() => { setWorkspaceView('saved'); setIsSheetOpen(true); }}
        onOpenSettings={() => { setWorkspaceView('settings'); setIsSheetOpen(true); }}
        isSheetOpen={isSheetOpen}
        activeLayers={activeLayers}
        onToggleLayer={(key) => setActiveLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
        mapTheme={mapTheme}
        onToggleMapTheme={() => setMapTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        currentLocation={currentLocation}
        targetLocation={targetLocation}
        accuracyRadius={accuracyRadius}
        weatherData={weatherData}
      />

      <AssessmentWorkspace
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        view={workspaceView}
        onViewChange={setWorkspaceView}
        streetName={streetName}
        district={district}
        city={city}
        targetLocation={targetLocation}
        clsScore={clsScore}
        grade={clsGrade}
        assessment={assessment}
        fieldNotes={fieldNotes}
        onUpdateNotes={setFieldNotes}
        onSave={handleSaveAssessment}
        observationRatings={observationRatings}
        onRatingChange={(id, rating) => setObservationRatings(prev => {
          const next = { ...prev };
          if (next[id] === rating) {
            delete next[id];
          } else {
            next[id] = rating;
          }
          return next;
        })}
        fieldAdjustment={fieldAdjustment}
        isPreviewingFieldAdjustment={isPreviewingFieldAdjustment}
        isSaving={isSavingAssessment}
        savedLocations={savedLocations}
        onSelectSaved={(saved) => {
          handleSelectSavedLocation(saved);
          setWorkspaceView('assessment');
        }}
        onDeleteSaved={handleDeleteSaved}
        onOpenDataLogs={() => setWorkspaceView('settings')}
        isFavorite={isFavorite}
        onToggleFavorite={handleToggleFavorite}
        favoriteLocationKeys={favoriteLocations}
      />
    </div>
  );
}
