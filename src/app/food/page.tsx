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
} from "lucide-react";
import type { KakaoPlace, FoodFavorite } from "@/types/food";
import { logAction } from "@/lib/action-log";
import FoodRecommendModal from "@/components/food/FoodRecommendModal";
import AddressSearchModal from "@/components/food/AddressSearchModal";

type CategoryCode = "FD6" | "CE7";

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
  const [category, setCategory] = useState<CategoryCode>(savedFilters?.category ?? "FD6");
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

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { longitude, latitude } = position.coords;
        const loc = { x: longitude, y: latitude, address: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}` };
        setLocation(loc);
        saveLocation(loc);
        setLocating(false);
        logAction("위치 확인", "food", { lat: latitude, lng: longitude });
      },
      (err) => {
        setLocError(
          err.code === 1
            ? "위치 권한이 거부되었습니다. 브라우저 설정에서 허용해주세요."
            : "위치를 가져올 수 없습니다."
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
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

  return (
    <div className="animate-fade-up">
      <div className="flex items-center gap-3 mb-8">
        <div className="h-10 w-10 rounded-xl bg-amber-50 flex items-center justify-center">
          <UtensilsCrossed className="h-5 w-5 text-amber-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">오늘 뭐 먹지?</h1>
          <p className="text-sm text-muted-foreground">
            주변 음식점을 검색하고 랜덤 추천을 받아보세요
          </p>
        </div>
      </div>

      {/* Location & Search Controls */}
      <Card className="animate-fade-up delay-100 mb-6">
        <CardContent className="pt-4 space-y-4">
          {/* Location */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              {location ? (
                <>
                  <Button
                    onClick={() => setAddressSearchOpen(true)}
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                  >
                    <Search className="h-3.5 w-3.5 mr-1.5" />
                    주소 검색
                  </Button>
                  <Button
                    onClick={getCurrentLocation}
                    disabled={locating}
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                  >
                    {locating ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <MapPin className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    {locating ? "확인 중..." : "현위치로 재설정"}
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={getCurrentLocation} disabled={locating}>
                    {locating ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <MapPin className="h-4 w-4 mr-1.5" />
                    )}
                    {locating ? "위치 확인 중..." : "현재 위치 확인"}
                  </Button>
                  <Button
                    onClick={() => setAddressSearchOpen(true)}
                    variant="outline"
                  >
                    <Search className="h-4 w-4 mr-1.5" />
                    주소로 검색
                  </Button>
                </>
              )}
            </div>
            {location && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Navigation className="h-3 w-3 shrink-0" />
                <span className="truncate">{location.address}</span>
                <Badge variant="secondary" className="text-[10px] shrink-0">
                  {location.y.toFixed(5)}, {location.x.toFixed(5)}
                </Badge>
              </div>
            )}
            {locError && <span className="text-sm text-destructive">{locError}</span>}
          </div>

          {location && (
            <>
              {/* Category */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium shrink-0">카테고리</span>
                <div className="flex gap-2">
                  <Button
                    variant={category === "FD6" ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setCategory("FD6"); setSubCategory(""); }}
                  >
                    <UtensilsCrossed className="h-3.5 w-3.5 mr-1" />
                    음식점
                  </Button>
                  <Button
                    variant={category === "CE7" ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setCategory("CE7"); setSubCategory(""); }}
                  >
                    <Coffee className="h-3.5 w-3.5 mr-1" />
                    카페
                  </Button>
                </div>
              </div>

              {/* Keyword search */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium shrink-0">키워드</span>
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchPlaces()}
                  placeholder="음식점/카페 이름으로 검색 (선택)"
                  className="h-9 text-sm"
                />
              </div>

              {/* Sub-category filter */}
              {subCategories.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">분류</span>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge
                      variant={subCategory === "" ? "default" : "outline"}
                      className="cursor-pointer text-xs"
                      onClick={() => { setSubCategory(""); setDetailCategory(""); }}
                    >
                      전체
                    </Badge>
                    {subCategories.map((sc) => (
                      <Badge
                        key={sc}
                        variant={subCategory === sc ? "default" : "outline"}
                        className="cursor-pointer text-xs"
                        onClick={() => { setSubCategory(subCategory === sc ? "" : sc); setDetailCategory(""); }}
                      >
                        {sc}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Detail category filter */}
              {detailCategories.length > 0 && subCategory && (
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">상세 분류</span>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge
                      variant={detailCategory === "" ? "default" : "outline"}
                      className="cursor-pointer text-xs"
                      onClick={() => setDetailCategory("")}
                    >
                      전체
                    </Badge>
                    {detailCategories.map((dc) => (
                      <Badge
                        key={dc}
                        variant={detailCategory === dc ? "default" : "outline"}
                        className="cursor-pointer text-xs"
                        onClick={() => setDetailCategory(detailCategory === dc ? "" : dc)}
                      >
                        {dc}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Max results */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium shrink-0">검색 수</span>
                <div className="flex gap-1.5">
                  {[30, 50, 100, 250].map((n) => (
                    <Badge
                      key={n}
                      variant={maxResults === n ? "default" : "outline"}
                      className="cursor-pointer text-xs"
                      onClick={() => setMaxResults(n)}
                    >
                      {n}건
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Radius (logarithmic scale) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">거리</span>
                  <Badge variant="secondary">{radius >= 1000 ? `${(radius / 1000).toFixed(1)}km` : `${radius}m`}</Badge>
                </div>
                <Slider
                  value={[radiusToSlider(radius)]}
                  onValueChange={(v) => setRadius(sliderToRadius(v[0]))}
                  min={0}
                  max={100}
                  step={1}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>100m</span>
                  <span>500m</span>
                  <span>2km</span>
                  <span>20km</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCategory("FD6");
                    setSubCategory("");
                    setDetailCategory("");
                    setMaxResults(30);
                    setRadius(500);
                    setKeyword("");
                  }}
                  className="text-muted-foreground"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  초기화
                </Button>
                <Button onClick={() => searchPlaces()} disabled={searching}>
                  {searching ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4 mr-1.5" />
                  )}
                  검색
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setRecommendOpen(true)}
                  className="border-amber-300 text-amber-700 hover:bg-amber-50"
                >
                  <Shuffle className="h-4 w-4 mr-1.5" />
                  랜덤 추천
                </Button>
                <Button
                  variant={showFavorites ? "secondary" : "outline"}
                  onClick={() => setShowFavorites(!showFavorites)}
                >
                  <Heart className="h-4 w-4 mr-1.5" />
                  즐겨찾기 ({favorites.length})
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

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
                    {lastSearch.category === "FD6" ? "음식점" : "카페"}
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
      <div className="flex items-center gap-1 shrink-0 ml-2">
        {place.place_url && (
          <Button variant="ghost" size="sm" className="h-8 px-2" asChild>
            <a href={place.place_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className={`h-8 px-2 ${isFav ? "text-amber-500" : "text-muted-foreground hover:text-amber-500"}`}
          onClick={onToggleFavorite}
        >
          {isFav ? <Star className="h-3.5 w-3.5 fill-current" /> : <Star className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}
