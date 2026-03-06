"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, MapPin, Building2 } from "lucide-react";

interface GeoResult {
  address: string;
  road_address: string;
  x: string;
  y: string;
  type: "address" | "place";
  place_name?: string;
}

interface AddressSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (result: { x: number; y: number; address: string }) => void;
}

export default function AddressSearchModal({
  open,
  onOpenChange,
  onSelect,
}: AddressSearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/food/geocode?query=${encodeURIComponent(query.trim())}`
      );
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "검색에 실패했습니다.");
      }

      if (Array.isArray(data)) {
        setResults(data);
        if (data.length === 0) setError("검색 결과가 없습니다.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setSearching(false);
    }
  }, [query]);

  const handleSelect = (result: GeoResult) => {
    const displayAddress =
      result.type === "place" && result.place_name
        ? `${result.place_name} (${result.road_address || result.address})`
        : result.road_address || result.address;

    onSelect({
      x: parseFloat(result.x),
      y: parseFloat(result.y),
      address: displayAddress,
    });
    onOpenChange(false);
    setQuery("");
    setResults([]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            주소 검색
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="주소 또는 장소명을 입력하세요"
            className="flex-1"
            autoFocus
          />
          <Button onClick={handleSearch} disabled={searching || !query.trim()} size="sm">
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
          {results.map((result, idx) => (
            <button
              key={`${result.x}-${result.y}-${idx}`}
              onClick={() => handleSelect(result)}
              className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                {result.type === "place" ? (
                  <Building2 className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                ) : (
                  <MapPin className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                )}
                <span className="font-medium text-sm truncate">
                  {result.type === "place" && result.place_name
                    ? result.place_name
                    : result.road_address || result.address}
                </span>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {result.type === "place" ? "장소" : "주소"}
                </Badge>
              </div>
              {result.type === "place" && (
                <p className="text-xs text-muted-foreground ml-5.5 truncate">
                  {result.road_address || result.address}
                </p>
              )}
              {result.road_address && result.address && result.type === "address" && (
                <p className="text-xs text-muted-foreground ml-5.5 truncate">
                  (지번) {result.address}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground mt-1 ml-5.5">
                {parseFloat(result.y).toFixed(5)}, {parseFloat(result.x).toFixed(5)}
              </p>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
