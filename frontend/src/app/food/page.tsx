"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  UtensilsCrossed,
  MapPin,
  Loader2,
  Star,
  StarOff,
  Shuffle,
  Search,
  ExternalLink,
  Phone,
  Navigation,
  Coffee,
  Heart,
  RotateCcw,
  SlidersHorizontal,
  ChevronDown,
} from "lucide-react";
import type { KakaoPlace, FoodFavorite } from "@/types/food";
import { logAction } from "@/lib/action-log";
import FoodRecommendModal from "@/components/food/FoodRecommendModal";
import AddressSearchModal from "@/components/food/AddressSearchModal";

type CategoryCode = "ALL" | "FD6" | "CE7";

interface LocationState {
  x: number;
  y: number;
  address: string;
}

const LOCATION_STORAGE_KEY = "food-location";
const FILTERS_STORAGE_KEY = "food-filters";

interface SavedFilters {
  category: CategoryCode;
  subCategory: string;
  detailCategory: string;
  radius: number;
  maxResults: number;
}

function loadSavedLocation(): LocationState | null {
  try {
    const saved = localStorage.getItem(LOCATION_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return null;
}

function saveLocation(loc: LocationState) {
  try {
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(loc));
  } catch {}
}

function loadSavedFilters(): SavedFilters | null {
  try {
    const saved = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return null;
}

function saveFilters(filters: SavedFilters) {
  try {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {}
}

// Logarithmic scale: slider 0-100 → radius 100m-20km
// More precision at short distances, less at long distances
const RADIUS_MIN = 100;
const RADIUS_MAX = 20000;

function sliderToRadius(value: number): number {
  const ratio = value / 100;
  const radius = RADIUS_MIN * Math.pow(RADIUS_MAX / RADIUS_MIN, ratio);
  // Round to nice steps: <1km → 50m, <5km → 100m, else 500m
  if (radius < 1000) return Math.round(radius / 50) * 50;
  if (radius < 5000) return Math.round(radius / 100) * 100;
  return Math.round(radius / 500) * 500;
}

function radiusToSlider(radius: number): number {
  return Math.round(100 * Math.log(radius / RADIUS_MIN) / Math.log(RADIUS_MAX / RADIUS_MIN));
}

interface SearchCondition {
  category: CategoryCode;
  subCategory: string;
  detailCategory: string;
  radius: number;
  maxResults: number;
  keyword: string;
}

export default function FoodPage() {
  const [location, setLocation] = useState<LocationState | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const savedFilters = typeof window !== "undefined" ? loadSavedFilters() : null;
  const [radius, setRadius] = useState(savedFilters?.radius ?? 500);
  const [category, setCategory] = useState<CategoryCode>(savedFilters?.category ?? "ALL");
  const [subCategory, setSubCategory] = useState<string>(savedFilters?.subCategory ?? "");
  const [detailCategory, setDetailCategory] = useState<string>(savedFilters?.detailCategory ?? "");
  const [subCategories, setSubCategories] = useState<string[]>([]);
  const [detailCategories, setDetailCategories] = useState<string[]>([]);
  const [maxResults, setMaxResults] = useState(savedFilters?.maxResults ?? 30);
  const [keyword, setKeyword] = useState("");
  const [places, setPlaces] = useState<KakaoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<FoodFavorite[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [recommendOpen, setRecommendOpen] = useState(false);
  const [addressSearchOpen, setAddressSearchOpen] = useState(false);
  const [lastSearch, setLastSearch] = useState<SearchCondition | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [paycoPlaces, setPaycoPlaces] = useState<KakaoPlace[]>([]);
  const [paycoSearching, setPaycoSearching] = useState(false);
  const [paycoError, setPaycoError] = useState<string | null>(null);

  // Load saved location on mount
  useEffect(() => {
    const saved = loadSavedLocation();
    if (saved) setLocation(saved);
  }, []);

  // Save filters when they change
  useEffect(() => {
    saveFilters({ category, subCategory, detailCategory, radius, maxResults });
  }, [category, subCategory, detailCategory, radius, maxResults]);

  // Fetch favorites on mount
  useEffect(() => {
    fetch("/api/food/favorites")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setFavorites(data);
      })
      .catch(() => {});
  }, []);

  // Fetch subcategories when category changes
  const fetchSubCategories = useCallback((cat: CategoryCode) => {
    fetch(`/api/food/categories?category_group_code=${cat}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setSubCategories(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchSubCategories(category);
  }, [category, fetchSubCategories]);

  // Fetch detail categories when subCategory changes
  const fetchDetailCategories = useCallback((cat: CategoryCode, sub: string) => {
    if (!sub) {
      setDetailCategories([]);
      return;
    }
    fetch(`/api/food/categories?category_group_code=${cat}&sub_category=${encodeURIComponent(sub)}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setDetailCategories(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchDetailCategories(category, subCategory);
  }, [category, subCategory, fetchDetailCategories]);

  const getCurrentLocation = useCallback(async () => {
    setLocating(true);
    setLocError(null);

    if (!navigator.geolocation) {
      setLocError("브라우저가 위치 서비스를 지원하지 않습니다.");
      setLocating(false);
      return;
    }

    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
          })
      );

      const { longitude, latitude } = position.coords;
      const coordLabel = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      const loc = { x: longitude, y: latitude, address: coordLabel };
      setLocation(loc);
      saveLocation(loc);
      logAction("위치 확인", "food", { lat: latitude, lng: longitude });

      // Reverse geocode — 실패해도 좌표는 유지
      try {
        const res = await fetch(
          `/api/food/reverse-geocode?x=${longitude}&y=${latitude}`
        );
        const data = await res.json();
        if (data.address) {
          const updated = { x: longitude, y: latitude, address: data.address };
          setLocation(updated);
          saveLocation(updated);
        }
      } catch {
        // 좌표만 표시 (이미 설정됨)
      }
    } catch (err) {
      const geoErr = err as GeolocationPositionError;
      setLocError(
        geoErr?.code === 1
          ? "위치 권한이 거부되었습니다. 브라우저 설정에서 허용해주세요."
          : `위치를 가져올 수 없습니다. (${geoErr?.message || "알 수 없는 오류"})`
      );
    } finally {
      setLocating(false);
    }
  }, []);

  const searchPlaces = useCallback(
    async () => {
      if (!location) return;
      setSearching(true);
      setSearchError(null);

      try {
        const params = new URLSearchParams({
          x: String(location.x),
          y: String(location.y),
          radius: String(radius),
          category_group_code: category,
          max_results: String(maxResults),
        });
        if (subCategory) params.set("sub_category", subCategory);
        if (detailCategory) params.set("detail_category", detailCategory);
        if (keyword.trim()) params.set("keyword", keyword.trim());

        const res = await fetch(`/api/food/search?${params}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "검색에 실패했습니다.");
        }

        setPlaces(data.documents);
        setPaycoPlaces([]);
        setLastSearch({ category, subCategory, detailCategory, radius, maxResults, keyword: keyword.trim() });
        // Refresh categories (new ones may have been collected)
        fetchSubCategories(category);
        if (subCategory) fetchDetailCategories(category, subCategory);
        logAction("음식점 검색", "food", {
          category,
          subCategory,
          detailCategory,
          keyword: keyword.trim(),
          radius,
          maxResults,
          resultCount: data.documents.length,
        });
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      } finally {
        setSearching(false);
      }
    },
    [location, radius, category, subCategory, detailCategory, maxResults, keyword, fetchSubCategories, fetchDetailCategories]
  );

  const searchPayco = useCallback(async () => {
    if (!location) return;
    setPaycoSearching(true);
    setPaycoError(null);
    try {
      const res = await fetch("/api/food/payco", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: location.address, distance: radius }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const merchants = data.result || [];
      // Convert to KakaoPlace format for unified display
      const converted: KakaoPlace[] = merchants.map((m: { mrcCd: string; name: string; categoryName: string; address: string; telNo: string; distance: number; latitude: string; longitude: string }) => ({
        id: `payco_${m.mrcCd}`,
        place_name: m.name,
        category_name: m.categoryName || "",
        category_group_code: "",
        category_group_name: "PAYCO 식권",
        phone: m.telNo || "",
        address_name: m.address || "",
        road_address_name: m.address || "",
        x: m.longitude || "",
        y: m.latitude || "",
        place_url: "",
        distance: String(m.distance || ""),
      }));
      setPaycoPlaces(converted);
      setPlaces([]);
      logAction("PAYCO 식권 가맹점 검색", "food", { address: location.address, radius, count: converted.length });
    } catch (err) {
      setPaycoError(err instanceof Error ? err.message : "PAYCO 가맹점 조회 실패");
    } finally {
      setPaycoSearching(false);
    }
  }, [location, radius]);

  const toggleFavorite = async (place: KakaoPlace) => {
    const isFav = favorites.some((f) => f.place_id === place.id);

    if (isFav) {
      // Remove
      setFavorites((prev) => prev.filter((f) => f.place_id !== place.id));
      await fetch(`/api/food/favorites?place_id=${encodeURIComponent(place.id)}`, {
        method: "DELETE",
      });
      logAction("즐겨찾기 해제", "food", { placeId: place.id, placeName: place.place_name });
    } else {
      // Add
      const fav: Partial<FoodFavorite> = {
        place_id: place.id,
        place_name: place.place_name,
        category_name: place.category_name,
        address: place.address_name,
        road_address: place.road_address_name,
        phone: place.phone,
        place_url: place.place_url,
        x: parseFloat(place.x),
        y: parseFloat(place.y),
      };
      const res = await fetch("/api/food/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fav),
      });
      if (res.ok) {
        const saved = await res.json();
        setFavorites((prev) => [saved, ...prev]);
      }
      logAction("즐겨찾기 추가", "food", { placeId: place.id, placeName: place.place_name });
    }
  };

  const removeFavorite = async (placeId: string) => {
    setFavorites((prev) => prev.filter((f) => f.place_id !== placeId));
    await fetch(`/api/food/favorites?place_id=${encodeURIComponent(placeId)}`, {
      method: "DELETE",
    });
    logAction("즐겨찾기 해제", "food", { placeId });
  };

  const isFavorite = (placeId: string) => favorites.some((f) => f.place_id === placeId);

  const radiusLabel = radius >= 1000 ? `${(radius / 1000).toFixed(1)}km` : `${radius}m`;
  const hasActiveFilters = category !== "ALL" || subCategory || detailCategory || maxResults !== 30 || radius !== 500;

  return (
    <div className="animate-fade-up">
      {/* Header — compact */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg bg-amber-50 flex items-center justify-center">
            <UtensilsCrossed className="h-4.5 w-4.5 text-amber-600" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">오늘 뭐 먹지?</h1>
        </div>
        {favorites.length > 0 && (
          <Button
            variant={showFavorites ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setShowFavorites(!showFavorites)}
            className="shrink-0"
          >
            <Heart className={`h-3.5 w-3.5 mr-1 ${showFavorites ? "fill-current" : ""}`} />
            {favorites.length}
          </Button>
        )}
      </div>

      {/* Location — minimal when set */}
      {!location ? (
        <Card className="mb-4">
          <CardContent className="py-8 flex flex-col items-center gap-3">
            <MapPin className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">주변 검색을 위해 위치를 설정해주세요</p>
            <div className="flex gap-2">
              <Button onClick={getCurrentLocation} disabled={locating} size="sm">
                {locating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5 mr-1.5" />}
                {locating ? "확인 중..." : "현재 위치"}
              </Button>
              <Button onClick={() => setAddressSearchOpen(true)} variant="outline" size="sm">
                <Search className="h-3.5 w-3.5 mr-1.5" />
                주소 검색
              </Button>
            </div>
            {locError && <p className="text-xs text-destructive">{locError}</p>}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3 mb-4">
          {/* Location bar */}
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 border">
            <MapPin className="h-4 w-4 text-primary shrink-0" />
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-1 px-2 text-sm font-medium truncate justify-start flex-1 min-w-0"
              onClick={() => setAddressSearchOpen(true)}
              title={location.address}
            >
              <span className="truncate">{location.address}</span>
            </Button>
            <div className="flex gap-1.5 ml-auto shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setAddressSearchOpen(true)}
              >
                주소 변경
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={getCurrentLocation}
                disabled={locating}
              >
                {locating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Navigation className="h-3 w-3 mr-1" />}
                {locating ? "..." : "현위치"}
              </Button>
            </div>
          </div>
          {locError && (
            <p className="text-xs text-destructive -mt-1 px-1">{locError}</p>
          )}

          {/* Random recommend + PAYCO — 8:2 ratio */}
          <div className="flex gap-2">
            <Button
              onClick={() => setRecommendOpen(true)}
              className="flex-[4] h-11 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-md hover:shadow-lg transition-all"
            >
              <Shuffle className="h-4.5 w-4.5 mr-2" />
              랜덤 추천
            </Button>
            <Button
              onClick={searchPayco}
              disabled={paycoSearching}
              variant="outline"
              className="flex-1 h-11 border-red-300 text-red-600 hover:bg-red-50 font-bold text-xs"
            >
              {paycoSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : "PAYCO"}
            </Button>
          </div>

          {/* Search bar — keyword + search button */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchPlaces()}
                placeholder="음식점/카페 이름으로 검색"
                className="pl-9 h-10 text-sm"
              />
            </div>
            <Button onClick={() => searchPlaces()} disabled={searching} className="h-10 px-4 shrink-0">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          {/* Category tabs + filter toggle — single row */}
          <div className="flex items-center gap-2">
            <div className="flex gap-1 bg-muted/60 rounded-lg p-0.5">
              {([
                { code: "ALL" as CategoryCode, label: "전체", icon: null },
                { code: "FD6" as CategoryCode, label: "음식점", icon: UtensilsCrossed },
                { code: "CE7" as CategoryCode, label: "카페", icon: Coffee },
              ]).map(({ code, label, icon: Icon }) => (
                <button
                  key={code}
                  onClick={() => {
                    setCategory(code);
                    setSubCategory("");
                    setDetailCategory("");
                    if (code !== "ALL") setFiltersOpen(true);
                  }}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    category === code
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {Icon && <Icon className="h-3 w-3" />}
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 ml-auto">
              <Badge variant="secondary" className="text-[10px] font-normal">
                {radiusLabel}
              </Badge>
              <button
                onClick={() => setFiltersOpen(!filtersOpen)}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs transition-colors ${
                  filtersOpen || hasActiveFilters
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <SlidersHorizontal className="h-3 w-3" />
                필터
                {hasActiveFilters && !filtersOpen && (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                )}
                <ChevronDown className={`h-3 w-3 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
              </button>
            </div>
          </div>

          {/* Expandable filters */}
          {filtersOpen && (
            <Card className="animate-fade-up">
              <CardContent className="pt-4 pb-3 space-y-3">
                {/* Sub-categories */}
                {category !== "ALL" && subCategories.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">분류</span>
                    <div className="flex flex-wrap gap-1">
                      <Badge
                        variant={subCategory === "" ? "default" : "outline"}
                        className="cursor-pointer text-[11px] py-0.5"
                        onClick={() => { setSubCategory(""); setDetailCategory(""); }}
                      >
                        전체
                      </Badge>
                      {subCategories.map((sc) => (
                        <Badge
                          key={sc}
                          variant={subCategory === sc ? "default" : "outline"}
                          className="cursor-pointer text-[11px] py-0.5"
                          onClick={() => { setSubCategory(subCategory === sc ? "" : sc); setDetailCategory(""); }}
                        >
                          {sc}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Detail categories */}
                {category !== "ALL" && detailCategories.length > 0 && subCategory && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">상세 분류</span>
                    <div className="flex flex-wrap gap-1">
                      <Badge
                        variant={detailCategory === "" ? "default" : "outline"}
                        className="cursor-pointer text-[11px] py-0.5"
                        onClick={() => setDetailCategory("")}
                      >
                        전체
                      </Badge>
                      {detailCategories.map((dc) => (
                        <Badge
                          key={dc}
                          variant={detailCategory === dc ? "default" : "outline"}
                          className="cursor-pointer text-[11px] py-0.5"
                          onClick={() => setDetailCategory(detailCategory === dc ? "" : dc)}
                        >
                          {dc}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Distance + Max results — side by side */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">거리</span>
                      <span className="text-xs font-semibold">{radiusLabel}</span>
                    </div>
                    <Slider
                      value={[radiusToSlider(radius)]}
                      onValueChange={(v) => setRadius(sliderToRadius(v[0]))}
                      min={0}
                      max={100}
                      step={1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground/60">
                      <span>100m</span><span>500m</span><span>2km</span><span>20km</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">검색 수</span>
                    <div className="flex gap-1">
                      {[30, 50, 100, 250].map((n) => (
                        <Badge
                          key={n}
                          variant={maxResults === n ? "default" : "outline"}
                          className="cursor-pointer text-[11px] py-0.5 flex-1 justify-center"
                          onClick={() => setMaxResults(n)}
                        >
                          {n}건
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Reset */}
                {hasActiveFilters && (
                  <button
                    onClick={() => {
                      setCategory("ALL");
                      setSubCategory("");
                      setDetailCategory("");
                      setMaxResults(30);
                      setRadius(500);
                      setKeyword("");
                    }}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <RotateCcw className="h-3 w-3" />
                    필터 초기화
                  </button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {searchError && (
        <p className="text-destructive text-sm mb-4">{searchError}</p>
      )}

      {/* Favorites List */}
      {showFavorites && (
        <Card className="animate-fade-up mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Star className="h-4 w-4 text-amber-500" />
              즐겨찾기
            </CardTitle>
          </CardHeader>
          <CardContent>
            {favorites.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                즐겨찾기한 음식점이 없습니다
              </p>
            ) : (
              <div className="space-y-2">
                {favorites.map((fav) => (
                  <div
                    key={fav.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{fav.place_name}</span>
                        {fav.category_name && (() => {
                          const parts = fav.category_name.split(" > ");
                          const sub = parts.length >= 2 ? parts[1] : null;
                          const detail = parts.length >= 3 ? parts.slice(2).join(" > ") : null;
                          return (
                            <>
                              {sub && (
                                <Badge variant="outline" className="text-[10px] shrink-0 border-amber-200 bg-amber-50 text-amber-800">
                                  {sub}
                                </Badge>
                              )}
                              {detail && (
                                <Badge variant="outline" className="text-[10px] shrink-0">
                                  {detail}
                                </Badge>
                              )}
                            </>
                          );
                        })()}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {fav.road_address || fav.address}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {fav.place_url && (
                        <Button variant="ghost" size="sm" className="h-8 px-2" asChild>
                          <a href={fav.place_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-amber-500 hover:text-amber-600"
                        onClick={() => removeFavorite(fav.place_id)}
                      >
                        <StarOff className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Search Results */}
      {places.length > 0 && (
        <Card className="animate-fade-up">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base">
                검색 결과 ({places.length}곳)
              </CardTitle>
              {lastSearch && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="secondary" className="text-[10px]">
                    {lastSearch.category === "ALL" ? "전체" : lastSearch.category === "FD6" ? "음식점" : "카페"}
                  </Badge>
                  {lastSearch.keyword && (
                    <Badge variant="outline" className="text-[10px] border-blue-200 bg-blue-50 text-blue-800">
                      &quot;{lastSearch.keyword}&quot;
                    </Badge>
                  )}
                  {lastSearch.subCategory && (
                    <Badge variant="outline" className="text-[10px] border-amber-200 bg-amber-50 text-amber-800">
                      {lastSearch.subCategory}
                    </Badge>
                  )}
                  {lastSearch.detailCategory && (
                    <Badge variant="outline" className="text-[10px]">
                      {lastSearch.detailCategory}
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px]">
                    {lastSearch.radius >= 1000 ? `${(lastSearch.radius / 1000).toFixed(1)}km` : `${lastSearch.radius}m`}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    최대 {lastSearch.maxResults}건
                  </Badge>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {places.map((place, idx) => (
                <PlaceItem
                  key={`${place.id}-${idx}`}
                  place={place}
                  isFav={isFavorite(place.id)}
                  onToggleFavorite={() => toggleFavorite(place)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* PAYCO Results */}
      {paycoPlaces.length > 0 && (
        <Card className="animate-fade-up">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">
                <span className="text-red-600 font-bold">PAYCO</span> 식권 가맹점 ({paycoPlaces.length}곳)
              </CardTitle>
              <Badge variant="secondary" className="text-[10px]">
                {radius >= 1000 ? `${(radius / 1000).toFixed(1)}km` : `${radius}m`}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {paycoPlaces.map((place, idx) => (
                <div
                  key={`${place.id}-${idx}`}
                  className="flex items-start justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{place.place_name}</span>
                      <Badge variant="outline" className="text-[10px] border-red-200 bg-red-50 text-red-700">
                        {place.category_name || "식권"}
                      </Badge>
                      {place.distance && (
                        <span className="text-[10px] text-muted-foreground">{place.distance}m</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {place.address_name}
                    </p>
                    {place.phone && (
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Phone className="h-3 w-3" />{place.phone}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      {paycoError && (
        <p className="text-sm text-destructive text-center">{paycoError}</p>
      )}

      {/* Address Search Modal */}
      <AddressSearchModal
        open={addressSearchOpen}
        onOpenChange={setAddressSearchOpen}
        onSelect={(result) => {
          const loc = { x: result.x, y: result.y, address: result.address };
          setLocation(loc);
          saveLocation(loc);
          logAction("주소 검색으로 위치 설정", "food", { address: result.address, x: result.x, y: result.y });
        }}
      />

      {/* Random Recommend Modal */}
      <FoodRecommendModal
        open={recommendOpen}
        onOpenChange={setRecommendOpen}
        location={location}
        radius={radius}
        category={category}
        subCategory={subCategory}
        favorites={favorites}
        searchResults={places}
        lastSearch={lastSearch}
      />
    </div>
  );
}

function PlaceItem({
  place,
  isFav,
  onToggleFavorite,
}: {
  place: KakaoPlace;
  isFav: boolean;
  onToggleFavorite: () => void;
}) {
  const distanceStr =
    parseInt(place.distance) >= 1000
      ? `${(parseInt(place.distance) / 1000).toFixed(1)}km`
      : `${place.distance}m`;

  const categoryParts = place.category_name.split(" > ");
  const subCat = categoryParts.length >= 2 ? categoryParts[1] : null;
  const detailCat = categoryParts.length >= 3 ? categoryParts.slice(2).join(" > ") : null;

  return (
    <div className="flex items-start justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{place.place_name}</span>
          {subCat && (
            <Badge variant="outline" className="text-[10px] border-amber-200 bg-amber-50 text-amber-800">
              {subCat}
            </Badge>
          )}
          {detailCat && (
            <Badge variant="outline" className="text-[10px]">
              {detailCat}
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px]">
            {distanceStr}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1 truncate">
          {place.road_address_name || place.address_name}
        </p>
        {place.phone && (
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Phone className="h-2.5 w-2.5" />
            {place.phone}
          </p>
        )}
      </div>
      <div className="flex items-center shrink-0 ml-2">
        {place.place_url && (
          <Button variant="ghost" size="icon" className="h-10 w-10" asChild>
            <a href={place.place_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={`h-10 w-10 ${isFav ? "text-amber-500" : "text-muted-foreground hover:text-amber-500"}`}
          onClick={onToggleFavorite}
        >
          {isFav ? <Star className="h-4 w-4 fill-current" /> : <Star className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
