"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  PartyPopper,
  Send,
  Users,
  ChevronLeft,
} from "lucide-react";
import type { KakaoPlace, FoodFavorite } from "@/types/food";
import type { DoorayMember } from "@/types/dooray";
import { logAction } from "@/lib/action-log";

type RecommendMode = "favorite" | "random" | "search" | null;
type Step = "select-mode" | "result" | "members" | "done";

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

const MEMBERS_STORAGE_KEY = "food-dooray-members";

function loadCachedMembers(): DoorayMember[] {
  try {
    const saved = localStorage.getItem(MEMBERS_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return [];
}

function saveCachedMembers(members: DoorayMember[]) {
  try {
    localStorage.setItem(MEMBERS_STORAGE_KEY, JSON.stringify(members));
  } catch {}
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
}: FoodRecommendModalProps) {
  const [mode, setMode] = useState<RecommendMode>(null);
  const [step, setStep] = useState<Step>("select-mode");
  const [result, setResult] = useState<KakaoPlace | FoodFavorite | null>(null);
  const [loading, setLoading] = useState(false);
  const [spinning, setSpinning] = useState(false);

  // Member selection
  const [members, setMembers] = useState<DoorayMember[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [memberSearch, setMemberSearch] = useState("");
  const [sendToChannel, setSendToChannel] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentResult, setSentResult] = useState<{
    webhookSent: boolean;
    personalSent: number;
    doorayUrl: string | null;
  } | null>(null);

  // Load Dooray members
  const loadMembers = useCallback(async () => {
    const cached = loadCachedMembers();
    if (cached.length > 0) {
      setMembers(cached);
      return;
    }

    setLoadingMembers(true);
    try {
      // Get settings for Dooray token and project ID
      const settingsRes = await fetch("/api/settings");
      const settings = await settingsRes.json();
      const token = settings.dooray_token;
      const projectId = settings.dooray_project_id;

      if (!token || !projectId) {
        setMembers([]);
        return;
      }

      const res = await fetch(`/api/dooray/members?projectId=${projectId}`, {
        headers: { "x-dooray-token": token },
      });
      const data = await res.json();

      if (data.members?.length) {
        setMembers(data.members);
        saveCachedMembers(data.members);
      }
    } catch {
      // Failed to load members
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadMembers();
  }, [open, loadMembers]);

  // Slot machine effect helper
  const runSlotMachine = (
    items: (KakaoPlace | FoodFavorite)[],
    onDone: (pick: KakaoPlace | FoodFavorite) => void
  ) => {
    setSpinning(true);
    setResult(null);
    let count = 0;
    const maxCount = 15;
    const interval = setInterval(() => {
      const idx = Math.floor(Math.random() * items.length);
      setResult(items[idx]);
      count++;
      if (count >= maxCount) {
        clearInterval(interval);
        const finalIdx = Math.floor(Math.random() * items.length);
        const pick = items[finalIdx];
        setResult(pick);
        setSpinning(false);
        setStep("result");
        onDone(pick);
      }
    }, 100);
  };

  const recommendFromFavorites = () => {
    if (favorites.length === 0) return;
    setMode("favorite");
    setStep("result");
    runSlotMachine(favorites, (pick) => {
      logAction("즐겨찾기 랜덤 추천", "food", { placeName: "place_name" in pick ? pick.place_name : "" });
    });
  };

  const recommendRandom = async () => {
    if (!location) return;
    setMode("random");
    setStep("result");
    setLoading(true);
    setResult(null);

    try {
      const params = new URLSearchParams({
        x: String(location.x),
        y: String(location.y),
        radius: String(radius),
        category_group_code: category,
        max_results: "45",
      });
      if (subCategory) params.set("sub_category", subCategory);
      const res = await fetch(`/api/food/search?${params}`);
      const data = await res.json();

      if (!res.ok || !data.documents?.length) {
        setResult(null);
        setLoading(false);
        return;
      }

      setLoading(false);
      runSlotMachine(data.documents as KakaoPlace[], (pick) => {
        logAction("완전 랜덤 추천", "food", { placeName: "place_name" in pick ? pick.place_name : "" });
      });
    } catch {
      setResult(null);
      setLoading(false);
    }
  };

  const recommendFromSearch = () => {
    if (searchResults.length === 0) return;
    setMode("search");
    setStep("result");
    runSlotMachine(searchResults, (pick) => {
      logAction("검색 조건내 랜덤 추천", "food", { placeName: "place_name" in pick ? pick.place_name : "" });
    });
  };

  const retryRecommend = () => {
    if (mode === "favorite") recommendFromFavorites();
    else if (mode === "random") recommendRandom();
    else if (mode === "search") recommendFromSearch();
  };

  const handleDecide = () => {
    setStep("members");
    setSelectedMembers(new Set());
    setMemberSearch("");
    setSendToChannel(true);
    setSentResult(null);
  };

  const filteredMembers = memberSearch.trim()
    ? members.filter((m) => m.name.toLowerCase().includes(memberSearch.trim().toLowerCase()))
    : members;

  const toggleMember = (id: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedMembers.size === members.length) {
      setSelectedMembers(new Set());
    } else {
      setSelectedMembers(new Set(members.map((m) => m.id)));
    }
  };

  const handleGo = async () => {
    if (!result || selectedMembers.size === 0) return;
    setSending(true);

    const pName = "place_name" in result ? result.place_name : "";
    const pUrl = "place_url" in result ? result.place_url : null;
    const catName = "category_name" in result ? result.category_name : null;
    const addr =
      "road_address_name" in result
        ? (result as KakaoPlace).road_address_name || (result as KakaoPlace).address_name
        : "road_address" in result
        ? (result as FoodFavorite).road_address || (result as FoodFavorite).address
        : null;

    const selectedMemberObjs = members.filter((m) => selectedMembers.has(m.id));
    const selectedNames = selectedMemberObjs.map((m) => m.name);
    const selectedIds = selectedMemberObjs.map((m) => m.id);

    try {
      const res = await fetch("/api/food/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place_name: pName,
          place_url: pUrl,
          category_name: catName,
          address: addr,
          members: selectedNames,
          member_ids: selectedIds,
          send_to_channel: sendToChannel,
        }),
      });
      const data = await res.json();

      setSentResult({
        webhookSent: data.webhook_sent || false,
        personalSent: data.personal_messages_sent || 0,
        doorayUrl: data.dooray_messenger_url || null,
      });
      setStep("done");

      logAction("점심 결정", "food", {
        placeName: pName,
        members: selectedNames,
        webhookSent: data.webhook_sent,
        personalSent: data.personal_messages_sent,
      });
    } catch {
      // Failed
    } finally {
      setSending(false);
    }
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setMode(null);
      setStep("select-mode");
      setResult(null);
      setSpinning(false);
      setSentResult(null);
    }
    onOpenChange(isOpen);
  };

  // Extract place info from result
  const placeName = result ? ("place_name" in result ? result.place_name : "") : "";
  const placeUrl = result ? ("place_url" in result ? result.place_url : null) : null;
  const phone = result ? ("phone" in result ? result.phone : null) : null;
  const address = result
    ? "road_address_name" in result
      ? (result as KakaoPlace).road_address_name || (result as KakaoPlace).address_name
      : "road_address" in result
      ? (result as FoodFavorite).road_address || (result as FoodFavorite).address
      : null
    : null;
  const categoryName = result ? ("category_name" in result ? result.category_name : null) : null;
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
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            {step === "members" ? "구성원 선택" : step === "done" ? "갑시다!" : "랜덤 추천"}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Select mode */}
        {step === "select-mode" && (
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

        {/* Step 2: Result */}
        {step === "result" && (loading || spinning || result) && (
          <div className="py-6">
            {loading && !result && (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">검색 중...</p>
              </div>
            )}

            {result && (
              <div className={`text-center space-y-4 ${spinning ? "animate-pulse" : "animate-fade-up"}`}>
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
                      <Badge variant="outline" className="text-xs">{detailCat}</Badge>
                    )}
                    {distance && (
                      <Badge variant="secondary" className="text-xs">{distance}</Badge>
                    )}
                  </div>
                </div>

                {!spinning && (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {address && (
                      <p className="flex items-center justify-center gap-1">
                        <MapPin className="h-3 w-3" />{address}
                      </p>
                    )}
                    {phone && (
                      <p className="flex items-center justify-center gap-1">
                        <Phone className="h-3 w-3" />{phone}
                      </p>
                    )}
                  </div>
                )}

                {!spinning && (
                  <div className="flex items-center justify-center gap-2 pt-2 flex-wrap">
                    <Button variant="outline" size="sm" onClick={retryRecommend}>
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      다시 추천
                    </Button>
                    {placeUrl && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={placeUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5 mr-1" />
                          상세보기
                        </a>
                      </Button>
                    )}
                    <Button size="sm" onClick={handleDecide} className="bg-amber-500 hover:bg-amber-600 text-white">
                      <PartyPopper className="h-3.5 w-3.5 mr-1" />
                      너로 정했어!
                    </Button>
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

        {/* Step 3: Member selection */}
        {step === "members" && (
          <div className="flex flex-col min-h-0">
            <div className="flex items-center gap-2 mb-3 text-sm text-muted-foreground">
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setStep("result")}>
                <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />
                뒤로
              </Button>
              <span className="font-medium text-foreground">{placeName}</span>
            </div>

            {loadingMembers ? (
              <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                구성원 불러오는 중...
              </div>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Dooray 프로젝트 구성원을 불러올 수 없습니다.<br />
                설정에서 Dooray 연동을 확인해주세요.
              </p>
            ) : (
              <>
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="구성원 검색..."
                    className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">
                    <Users className="h-3 w-3 inline mr-1" />
                    {selectedMembers.size}명 선택
                  </span>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={selectAll}>
                    {selectedMembers.size === members.length ? "전체 해제" : "전체 선택"}
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto space-y-1 min-h-0 max-h-[40vh]">
                  {filteredMembers.map((member) => (
                    <label
                      key={member.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedMembers.has(member.id)}
                        onCheckedChange={() => toggleMember(member.id)}
                      />
                      <span className="text-sm">{member.name}</span>
                    </label>
                  ))}
                </div>
                <label className="flex items-center gap-2 mt-3 cursor-pointer">
                  <Checkbox
                    checked={sendToChannel}
                    onCheckedChange={(v) => setSendToChannel(!!v)}
                  />
                  <span className="text-sm">채널 전송</span>
                  <span className="text-xs text-muted-foreground">(웹훅으로 채널에 메시지 전송)</span>
                </label>
                <Button
                  onClick={handleGo}
                  disabled={selectedMembers.size === 0 || sending}
                  className="mt-2 bg-amber-500 hover:bg-amber-600 text-white w-full"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : (
                    <Send className="h-4 w-4 mr-1.5" />
                  )}
                  갑시다! ({selectedMembers.size}명)
                </Button>
              </>
            )}
          </div>
        )}

        {/* Step 4: Done */}
        {step === "done" && (
          <div className="text-center py-8 space-y-4 animate-fade-up">
            <div className="text-5xl">🎉</div>
            <div>
              <h3 className="text-lg font-bold">{placeName}</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {members.filter((m) => selectedMembers.has(m.id)).map((m) => m.name).join(", ")}
              </p>
            </div>
            {sentResult && (
              <div className="space-y-1.5 text-sm">
                {sentResult.webhookSent && (
                  <p className="text-emerald-600 flex items-center justify-center gap-1">
                    <Send className="h-3 w-3" /> 채널 메시지 전송 완료
                  </p>
                )}
                {sentResult.personalSent > 0 && (
                  <p className="text-blue-600 flex items-center justify-center gap-1">
                    <Users className="h-3 w-3" /> 개인 메시지 {sentResult.personalSent}명 전송
                  </p>
                )}
                {!sentResult.webhookSent && sentResult.personalSent === 0 && (
                  <p className="text-muted-foreground">저장 완료 (메시지 발송 설정을 확인해주세요)</p>
                )}
              </div>
            )}
            <div className="flex items-center justify-center gap-2">
              {sentResult?.doorayUrl && (
                <Button variant="outline" size="sm" asChild>
                  <a href={sentResult.doorayUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 mr-1" />
                    메신저 열기
                  </a>
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => handleClose(false)}>
                닫기
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
