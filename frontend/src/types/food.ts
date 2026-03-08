export interface KakaoPlace {
  id: string;
  place_name: string;
  category_name: string;
  category_group_code: string;
  category_group_name: string;
  phone: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  place_url: string;
  distance: string;
}

export interface KakaoSearchResponse {
  meta: {
    total_count: number;
    pageable_count: number;
    is_end: boolean;
  };
  documents: KakaoPlace[];
}

export interface FoodFavorite {
  id: string;
  place_id: string;
  place_name: string;
  category_name: string | null;
  address: string | null;
  road_address: string | null;
  phone: string | null;
  place_url: string | null;
  x: number | null;
  y: number | null;
  created_at: string;
}
