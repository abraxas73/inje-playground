"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Shuffle,
  Star,
  Search,
  MapPin,
  Loader2,
  ExternalLink,
  Phone,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { KakaoPlace, FoodFavorite } from "@/types/food";
import { logAction } from "@/lib/action-log";

type RecommendMode = "favorite" | "random" | "search" | null;

interface SearchCondition {
  category: string;
  subCategory: string;
  detailCategory: string;
  radius: number;
  maxResults: number;
  keyword: string;
}

interface FoodRecommendModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: { x: number; y: number } | null;
  radius: number;
  category: string;
  subCategory: string;
  favorites: FoodFavorite[];
  searchResults: KakaoPlace[];
  lastSearch: SearchCondition | null;
}

export default function FoodRecommendModal({
  open,
  onOpenChange,
  location,
  radius,
  category,
  subCategory,
  favorites,
  searchResults,
  lastSearch,
}: FoodRecommendModalProps) {
  const [mode, setMode] = useState<RecommendMode>(null);
  const [result, setResult] = useState<KakaoPlace | FoodFavorite | null>(null);
  const [loading, setLoading] = useState(false);
  const [spinning, setSpinning] = useState(false);

  const recommendFromFavorites = () => {
    if (favorites.length === 0) return;
    setMode("favorite");
    setSpinning(true);
    setResult(null);

    // Slot machine effect
    let count = 0;
    const maxCount = 15;
    const interval = setInterval(() => {
      const idx = Math.floor(Math.random() * favorites.length);
      setResult(favorites[idx]);
      count++;
      if (count >= maxCount) {
        clearInterval(interval);
        const finalIdx = Math.floor(Math.random() * favorites.length);
        setResult(favorites[finalIdx]);
        setSpinning(false);
        logAction("즐겨찾기 랜덤 추천", "food", {
          placeName: favorites[finalIdx].place_name,
        });
      }
    }, 100);
  };

  const recommendRandom = async () => {
    if (!location) return;
    setMode("random");
    setLoading(true);
    setResult(null);

    try {
      // Fetch a random page
      const randomPage = Math.floor(Math.random() * 3) + 1;
      const params = new URLSearchParams({
        x: String(location.x),
        y: String(location.y),
        radius: String(radius),
        category_group_code: category,
        page: String(randomPage),
      });
      if (subCategory) params.set("sub_category", subCategory);
      const res = await fetch(`/api/food/search?${params}`);
      const data = await res.json();

      if (!res.ok || !data.documents?.length) {
        // Try page 1 if random page was empty
        if (randomPage !== 1) {
          const params2 = new URLSearchParams({
            x: String(location.x),
            y: String(location.y),
            radius: String(radius),
            category_group_code: category,
            page: "1",
          });
          if (subCategory) params2.set("sub_category", subCategory);
          const res2 = await fetch(`/api/food/search?${params2}`);
          const data2 = await res2.json();
          if (data2.documents?.length) {
            const pick = data2.documents[Math.floor(Math.random() * data2.documents.length)];
            setResult(pick);
            logAction("완전 랜덤 추천", "food", { placeName: pick.place_name });
            return;
          }
        }
        setResult(null);
        return;
      }

      // Slot machine effect with results
      setSpinning(true);
      const docs = data.documents as KakaoPlace[];
      let count = 0;
      const maxCount = 15;
      const interval = setInterval(() => {
        const idx = Math.floor(Math.random() * docs.length);
        setResult(docs[idx]);
        count++;
        if (count >= maxCount) {
          clearInterval(interval);
          const finalIdx = Math.floor(Math.random() * docs.length);
          setResult(docs[finalIdx]);
          setSpinning(false);
          logAction("완전 랜덤 추천", "food", {
            placeName: docs[finalIdx].place_name,
          });
        }
      }, 100);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const recommendFromSearch = () => {
    if (searchResults.length === 0) return;
    setMode("search");
    setSpinning(true);
    setResult(null);

    let count = 0;
    const maxCount = 15;
    const interval = setInterval(() => {
      const idx = Math.floor(Math.random() * searchResults.length);
      setResult(searchResults[idx]);
      count++;
      if (count >= maxCount) {
        clearInterval(interval);
        const finalIdx = Math.floor(Math.random() * searchResults.length);
        setResult(searchResults[finalIdx]);
        setSpinning(false);
        logAction("검색 조건내 랜덤 추천", "food", {
          placeName: searchResults[finalIdx].place_name,
        });
      }
    }, 100);
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setMode(null);
      setResult(null);
      setSpinning(false);
    }
    onOpenChange(open);
  };

  const retryRecommend = () => {
    if (mode === "favorite") recommendFromFavorites();
    else if (mode === "random") recommendRandom();
    else if (mode === "search") recommendFromSearch();
  };

  const placeName = result
    ? "place_name" in result
      ? result.place_name
      : ""
    : "";
  const placeUrl = result
    ? "place_url" in result
      ? result.place_url
      : null
    : null;
  const phone = result
    ? "phone" in result
      ? result.phone
      : null
    : null;
  const address = result
    ? "road_address_name" in result
      ? (result as KakaoPlace).road_address_name || (result as KakaoPlace).address_name
      : "road_address" in result
      ? (result as FoodFavorite).road_address || (result as FoodFavorite).address
      : null
    : null;
  const categoryName = result
    ? "category_name" in result
      ? result.category_name
      : null
    : null;
  const distance =
    result && "distance" in result
      ? parseInt((result as KakaoPlace).distance) >= 1000
        ? `${(parseInt((result as KakaoPlace).distance) / 1000).toFixed(1)}km`
        : `${(result as KakaoPlace).distance}m`
      : null;

  const categoryParts = categoryName ? categoryName.split(" > ") : [];
  const subCat = categoryParts.length >= 2 ? categoryParts[1] : null;
  const detailCat = categoryParts.length >= 3 ? categoryParts.slice(2).join(" > ") : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            랜덤 추천
          </DialogTitle>
        </DialogHeader>

        {!mode && (
          <div className="space-y-3 py-4">
            <Button
              onClick={recommendFromFavorites}
              variant="outline"
              className="w-full h-14 justify-start gap-3"
              disabled={favorites.length === 0}
            >
              <Star className="h-5 w-5 text-amber-500" />
              <div className="text-left">
                <div className="font-medium">즐겨찾기에서 추천</div>
                <div className="text-xs text-muted-foreground">
                  {favorites.length > 0
                    ? `${favorites.length}개의 즐겨찾기 중 랜덤 선택`
                    : "즐겨찾기가 없습니다"}
                </div>
              </div>
            </Button>
            <Button
              onClick={recommendFromSearch}
              variant="outline"
              className="w-full h-14 justify-start gap-3"
              disabled={searchResults.length === 0}
            >
              <Search className="h-5 w-5 text-emerald-500" />
              <div className="text-left">
                <div className="font-medium">검색 조건내 랜덤 추천</div>
                <div className="text-xs text-muted-foreground">
                  {searchResults.length > 0
                    ? `검색 결과 ${searchResults.length}곳 중 랜덤 선택`
                    : "먼저 검색을 실행해주세요"}
                </div>
              </div>
            </Button>
            <Button
              onClick={recommendRandom}
              variant="outline"
              className="w-full h-14 justify-start gap-3"
              disabled={!location}
            >
              <Shuffle className="h-5 w-5 text-blue-500" />
              <div className="text-left">
                <div className="font-medium">완전 랜덤</div>
                <div className="text-xs text-muted-foreground">
                  {location
                    ? `반경 ${radius >= 1000 ? `${(radius / 1000).toFixed(1)}km` : `${radius}m`} 내 랜덤 선택`
                    : "먼저 위치를 확인해주세요"}
                </div>
              </div>
            </Button>
          </div>
        )}

        {mode && (loading || spinning || result) && (
          <div className="py-6">
            {loading && !result && (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">검색 중...</p>
              </div>
            )}

            {result && (
              <div
                className={`text-center space-y-4 ${spinning ? "animate-pulse" : "animate-fade-up"}`}
              >
                <div className="text-4xl mb-2">
                  {category === "CE7" ? "☕" : "🍽️"}
                </div>
                <div>
                  <h3 className="text-xl font-bold">{placeName}</h3>
                  <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
                    {subCat && (
                      <Badge variant="outline" className="text-xs border-amber-200 bg-amber-50 text-amber-800">
                        {subCat}
                      </Badge>
                    )}
                    {detailCat && (
                      <Badge variant="outline" className="text-xs">
                        {detailCat}
                      </Badge>
                    )}
                    {distance && (
                      <Badge variant="secondary" className="text-xs">
                        {distance}
                      </Badge>
                    )}
                  </div>
                </div>

                {!spinning && (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {address && (
                      <p className="flex items-center justify-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {address}
                      </p>
                    )}
                    {phone && (
                      <p className="flex items-center justify-center gap-1">
                        <Phone className="h-3 w-3" />
                        {phone}
                      </p>
                    )}
                  </div>
                )}

                {!spinning && (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <Button variant="outline" size="sm" onClick={retryRecommend}>
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      다시 추천
                    </Button>
                    {placeUrl && (
                      <Button size="sm" asChild>
                        <a href={placeUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5 mr-1" />
                          상세보기
                        </a>
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {!loading && !spinning && !result && (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground">
                  주변에 검색된 음식점이 없습니다. 거리를 늘려보세요.
                </p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
